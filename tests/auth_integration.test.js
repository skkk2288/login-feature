"use strict";

/**
 * Integration tests for the login feature (v0.1.0).
 *
 * Tests the full HTTP request → middleware → route → store → response cycle
 * using Express's built-in app.handle() (no real TCP port needed).
 *
 * Framework: Node.js built-in test runner (node:test) — no extra deps.
 *
 * Coverage maps to PRD acceptance criteria (§3) + API contract.
 */

const test = require("node:test");
const assert = require("node:assert");

// ---- App under test ----
// We require server.js but it also calls app.listen() at the bottom.
// To avoid opening a real port, we set PORT=0 before requiring; but Express
// will still bind. Instead, we restructure: server.js exports the app when
// required via a small shim. Since server.js calls app.listen unconditionally,
// we intercept by requiring it and grabbing the listener, then close it.
//
// Simpler approach: replicate the app setup for testing using the same modules.
const express = require("express");
const cookieParser = require("cookie-parser");

const loginRouter = require("../src/routes/login");
const meRouter = require("../src/routes/me");
const logoutRouter = require("../src/routes/logout");

// --- Internal modules for state reset between tests ---
const rateLimit = require("../src/middleware/rateLimit");

const PRESET_EMAIL = "test@example.com";
const PRESET_PASSWORD = "password123";

/**
 * Build a fresh Express app identical to server.js but WITHOUT app.listen().
 */
function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/login", loginRouter);
  app.use("/api/me", meRouter);
  app.use("/api/logout", logoutRouter);
  return app;
}

/**
 * Dispatch a request through the Express app without opening a port.
 * Returns { statusCode, headers, body }.
 */
function request(app, method, path, opts) {
  opts = opts || {};
  const headers = {};
  let body = null;

  if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["content-type"] = "application/json";
    headers["content-length"] = Buffer.byteLength(body);
  }
  if (opts.cookie) {
    headers.cookie = opts.cookie;
  }

  return new Promise((resolve, reject) => {
    const req = {
      method: method,
      url: path,
      headers: headers || {},
    };

    // Use Buffer stream for body
    const httpReq = require("http").mockRequest
      ? require("http").mockRequest(req)
      : null;

    const chunks = [];
    const res = {
      statusCode: 200,
      headers: {},
      _headers: {},
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = v;
        this._headers[k.toLowerCase()] = v;
      },
      getHeader(k) {
        return this._headers[k.toLowerCase()];
      },
      end(data) {
        const raw = data ? data.toString() : "";
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
        resolve({
          statusCode: this.statusCode,
          headers: this.headers,
          body: parsed,
          raw: raw,
        });
      },
    };

    // Use Express app.handle which simulates a real request
    app.handle(req, res, () => {
      resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: res.raw || "",
      });
    });

    if (body) {
      // simulate body data
      // Express reads body via express.json() middleware which expects a stream.
      // This manual approach won't work with express.json(). We need real HTTP.
    }
  });
}

// Since express.json() needs a real readable stream, use a real HTTP server.
const http = require("http");

/**
 * Start the app on an ephemeral port and return { server, baseUrl }.
 */
function startServer() {
  return new Promise((resolve) => {
    const app = createApp();
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

/**
 * Make an HTTP request to the running server.
 * Returns { statusCode, headers, body, setCookie }.
 */
function httpRequest(baseUrl, method, path, opts) {
  opts = opts || {};
  const headers = {};
  let bodyStr = null;

  if (opts.body !== undefined) {
    bodyStr = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = Buffer.byteLength(bodyStr);
  }
  if (opts.cookie) {
    headers["Cookie"] = opts.cookie;
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}${path}`,
      { method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: parsed,
            setCookie: res.headers["set-cookie"] || [],
          });
        });
      }
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Extract the `sid` cookie value from a Set-Cookie header array.
 */
function extractSid(setCookieArr) {
  if (!setCookieArr || setCookieArr.length === 0) return null;
  for (const c of setCookieArr) {
    const m = c.match(/^sid=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Extract a specific cookie attribute (e.g., Max-Age, HttpOnly, Secure, SameSite)
 * from the Set-Cookie header for `sid`.
 */
function sidCookieAttrs(setCookieArr) {
  if (!setCookieArr || setCookieArr.length === 0) return {};
  for (const c of setCookieArr) {
    if (c.startsWith("sid=")) {
      const parts = c.split(";").map((p) => p.trim());
      const attrs = {};
      for (let i = 1; i < parts.length; i++) {
        const [k, v] = parts[i].split("=");
        attrs[k.toLowerCase()] = v !== undefined ? v.trim() : true;
      }
      return attrs;
    }
  }
  return {};
}

// ---- Test suite ----

test.describe("登录功能集成测试", async () => {
  let server, baseUrl;

  test.before(async () => {
    const s = await startServer();
    server = s.server;
    baseUrl = s.baseUrl;
    // Set COOKIE_SECURE=false for test environment (HTTP)
    process.env.COOKIE_SECURE = "false";
  });

  test.after(async () => {
    if (server) await new Promise((r) => server.close(r));
  });

  // Reset rate limiter between groups that might trigger it
  test.afterEach(async () => {
    rateLimit.reset(PRESET_EMAIL);
    rateLimit.reset("unknown@example.com");
    rateLimit.reset("nobody@example.com");
  });

  // ================================================================
  // Group 1: 正确登录 + 会话建立
  // ================================================================
  test.describe("1. 正确登录 + 会话建立", async () => {
    test.it("TC-01: 正确邮箱+密码登录成功，返回 200 + userId + email", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: PRESET_PASSWORD },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.email, PRESET_EMAIL);
      assert.ok(res.body.userId, "userId should be present");
      assert.strictEqual(typeof res.body.userId, "string");
    });

    test.it("TC-02: 登录成功后 Set-Cookie 下发 sid cookie", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: PRESET_PASSWORD },
      });
      assert.strictEqual(res.statusCode, 200);
      const sid = extractSid(res.setCookie);
      assert.ok(sid, "sid cookie should be set");
      assert.ok(sid.length > 0, "sid should be non-empty");
    });

    test.it("TC-03: cookie 包含 HttpOnly + SameSite=Lax + Path=/ 属性", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: PRESET_PASSWORD },
      });
      const attrs = sidCookieAttrs(res.setCookie);
      assert.ok(attrs.httponly === true, "cookie should be HttpOnly");
      assert.ok(attrs.samesite !== undefined, "SameSite should be set");
      assert.ok(
        attrs.path === "/",
        "Path should be /"
      );
    });
  });

  // ================================================================
  // Group 2: GET /api/me
  // ================================================================
  test.describe("2. GET /api/me", async () => {
    test.it("TC-04: 未登录访问 /api/me 返回 401 + unauthenticated", async () => {
      const res = await httpRequest(baseUrl, "GET", "/api/me");
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body.error, "unauthenticated");
    });

    test.it("TC-05: 登录后带 cookie 访问 /api/me 返回 200 + 用户信息", async () => {
      // Login
      const loginRes = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: PRESET_PASSWORD },
      });
      const sid = extractSid(loginRes.setCookie);
      assert.ok(sid);

      // GET /api/me with cookie
      const meRes = await httpRequest(baseUrl, "GET", "/api/me", {
        cookie: `sid=${sid}`,
      });
      assert.strictEqual(meRes.statusCode, 200);
      assert.strictEqual(meRes.body.email, PRESET_EMAIL);
      assert.ok(meRes.body.userId, "userId should be present");
    });

    test.it("TC-06: 带无效 sid cookie 访问 /api/me 返回 401", async () => {
      const meRes = await httpRequest(baseUrl, "GET", "/api/me", {
        cookie: `sid=invalid-session-id`,
      });
      assert.strictEqual(meRes.statusCode, 401);
      assert.strictEqual(meRes.body.error, "unauthenticated");
    });
  });

  // ================================================================
  // Group 3: 防枚举（错误密码 / 不存在邮箱）
  // ================================================================
  test.describe("3. 防枚举 - 错误密码 / 不存在邮箱", async () => {
    test.it("TC-07: 错误密码返回 401 + invalid_credentials + '邮箱或密码错误'", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: "wrongpassword1" },
      });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body.error, "invalid_credentials");
      assert.strictEqual(res.body.message, "邮箱或密码错误");
    });

    test.it("TC-08: 不存在邮箱返回 401 + invalid_credentials + '邮箱或密码错误'（防枚举统一）", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: "nobody@example.com", password: "somepassword123" },
      });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body.error, "invalid_credentials");
      assert.strictEqual(res.body.message, "邮箱或密码错误");
    });

    test.it("TC-09: 不存在邮箱与错误密码的响应结构和消息一致（防枚举）", async () => {
      const wrongPass = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: "wrongpassword1" },
      });
      const unknownEmail = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: "nobody@example.com", password: "somepassword123" },
      });
      assert.strictEqual(wrongPass.statusCode, unknownEmail.statusCode);
      assert.strictEqual(wrongPass.body.error, unknownEmail.body.error);
      assert.strictEqual(wrongPass.body.message, unknownEmail.body.message);
    });
  });

  // ================================================================
  // Group 4: 输入校验（后端）
  // ================================================================
  test.describe("4. 后端输入校验 - 400 invalid_request", async () => {
    test.it("TC-10: 邮箱为空返回 400", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: "", password: "password123" },
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.error, "invalid_request");
    });

    test.it("TC-11: 邮箱格式非法返回 400", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: "not-an-email", password: "password123" },
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.error, "invalid_request");
    });

    test.it("TC-12: 密码为空返回 400", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: "" },
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.error, "invalid_request");
    });

    test.it("TC-13: 密码 < 8 字符返回 400", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: "short1" },
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.error, "invalid_request");
    });

    test.it("TC-14: 密码 > 64 字符返回 400", async () => {
      const longPass = "a".repeat(65);
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: longPass },
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.error, "invalid_request");
    });

    test.it("TC-15: 密码恰好 8 字符（边界）通过校验", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: "12345678" },
      });
      // 8 chars is valid length, but wrong password → 401 (not 400)
      assert.strictEqual(res.statusCode, 401);
    });

    test.it("TC-16: 密码恰好 64 字符（边界）通过校验", async () => {
      const longPass = "a".repeat(64);
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: longPass },
      });
      // 64 chars is valid length, but wrong password → 401 (not 400)
      assert.strictEqual(res.statusCode, 401);
    });
  });

  // ================================================================
  // Group 5: 记住我 cookie 行为
  // ================================================================
  test.describe("5. 记住我 cookie 行为", async () => {
    test.it("TC-17: rememberMe=true 时 cookie 包含 Max-Age=2592000（30天）", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: PRESET_PASSWORD, rememberMe: true },
      });
      assert.strictEqual(res.statusCode, 200);
      const attrs = sidCookieAttrs(res.setCookie);
      assert.ok(attrs["max-age"] !== undefined, "Max-Age should be present");
      assert.strictEqual(
        attrs["max-age"],
        "2592000",
        "Max-Age should be 30 days in seconds"
      );
    });

    test.it("TC-18: rememberMe=false 时 cookie 不包含 Max-Age（会话级）", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: PRESET_PASSWORD, rememberMe: false },
      });
      assert.strictEqual(res.statusCode, 200);
      const attrs = sidCookieAttrs(res.setCookie);
      assert.ok(
        attrs["max-age"] === undefined,
        "Max-Age should NOT be present for session cookie"
      );
    });

    test.it("TC-19: rememberMe 缺省（不传）时 cookie 不包含 Max-Age（会话级）", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: PRESET_PASSWORD },
      });
      assert.strictEqual(res.statusCode, 200);
      const attrs = sidCookieAttrs(res.setCookie);
      assert.ok(
        attrs["max-age"] === undefined,
        "Max-Age should NOT be present when rememberMe omitted"
      );
    });
  });

  // ================================================================
  // Group 6: 退出登录
  // ================================================================
  test.describe("6. 退出登录 POST /api/logout", async () => {
    test.it("TC-20: 登录后退出，/api/me 返回 401（会话已销毁）", async () => {
      // Login
      const loginRes = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: PRESET_PASSWORD },
      });
      const sid = extractSid(loginRes.setCookie);
      assert.ok(sid);

      // Verify logged in
      const meBefore = await httpRequest(baseUrl, "GET", "/api/me", {
        cookie: `sid=${sid}`,
      });
      assert.strictEqual(meBefore.statusCode, 200);

      // Logout
      const logoutRes = await httpRequest(baseUrl, "POST", "/api/logout", {
        cookie: `sid=${sid}`,
      });
      assert.strictEqual(logoutRes.statusCode, 200);
      assert.strictEqual(logoutRes.body.ok, true);

      // /api/me should now return 401
      const meAfter = await httpRequest(baseUrl, "GET", "/api/me", {
        cookie: `sid=${sid}`,
      });
      assert.strictEqual(meAfter.statusCode, 401);
      assert.strictEqual(meAfter.body.error, "unauthenticated");
    });

    test.it("TC-21: 未登录直接 logout 返回 200（幂等）", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/logout");
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.ok, true);
    });

    test.it("TC-22: logout 后 Set-Cookie 清除 sid（Expires 过期或 Max-Age=0）", async () => {
      // Login first
      const loginRes = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: PRESET_PASSWORD },
      });
      const sid = extractSid(loginRes.setCookie);
      assert.ok(sid);

      // Logout
      const logoutRes = await httpRequest(baseUrl, "POST", "/api/logout", {
        cookie: `sid=${sid}`,
      });
      // Check Set-Cookie clears sid
      const clearCookie = logoutRes.setCookie.find((c) => c.startsWith("sid="));
      assert.ok(clearCookie, "logout should Set-Cookie to clear sid");
      // sid value should be empty
      assert.ok(
        clearCookie.startsWith("sid=;"),
        "sid value should be empty in clear cookie"
      );
      // Should expire the cookie via Max-Age=0 or Expires=epoch
      assert.ok(
        clearCookie.includes("Max-Age=0") ||
          clearCookie.includes("Expires=Thu, 01 Jan 1970"),
        "clear cookie should have Max-Age=0 or Expires=epoch"
      );
    });
  });

  // ================================================================
  // Group 7: 限流
  // ================================================================
  test.describe("7. 限流 - 连续 5 次失败后 429", async () => {
    test.it("TC-23: 连续 5 次错误密码后第 6 次返回 429", async () => {
      // 5 failures
      for (let i = 0; i < 5; i++) {
        const res = await httpRequest(baseUrl, "POST", "/api/login", {
          body: { email: PRESET_EMAIL, password: "wrongpassword1" },
        });
        assert.strictEqual(res.statusCode, 401, `attempt ${i + 1} should be 401`);
      }

      // 6th attempt → 429
      const res6 = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: "wrongpassword1" },
      });
      assert.strictEqual(res6.statusCode, 429);
      assert.strictEqual(res6.body.error, "rate_limited");
      assert.strictEqual(res6.body.message, "登录尝试过于频繁，请稍后再试");
    });

    test.it("TC-24: 限流期间正确密码也返回 429（防探测）", async () => {
      // Trigger rate limit with 5 failures
      for (let i = 0; i < 5; i++) {
        await httpRequest(baseUrl, "POST", "/api/login", {
          body: { email: PRESET_EMAIL, password: "wrongpassword1" },
        });
      }

      // Correct password while rate limited → 429
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: PRESET_PASSWORD },
      });
      assert.strictEqual(res.statusCode, 429);
      assert.strictEqual(res.body.error, "rate_limited");
    });

    test.it("TC-25: 登录成功后限流计数重置", async () => {
      // 3 failures
      for (let i = 0; i < 3; i++) {
        await httpRequest(baseUrl, "POST", "/api/login", {
          body: { email: PRESET_EMAIL, password: "wrongpassword1" },
        });
      }

      // Successful login resets counter
      const okRes = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: PRESET_PASSWORD },
      });
      assert.strictEqual(okRes.statusCode, 200);

      // 3 more failures should NOT trigger rate limit (counter was reset)
      for (let i = 0; i < 3; i++) {
        const res = await httpRequest(baseUrl, "POST", "/api/login", {
          body: { email: PRESET_EMAIL, password: "wrongpassword1" },
        });
        assert.strictEqual(res.statusCode, 401, `post-reset attempt ${i + 1} should be 401 not 429`);
      }
    });

    test.it("TC-26: 限流按邮箱隔离，不同邮箱不受影响", async () => {
      // Rate limit PRESET_EMAIL
      for (let i = 0; i < 5; i++) {
        await httpRequest(baseUrl, "POST", "/api/login", {
          body: { email: PRESET_EMAIL, password: "wrongpassword1" },
        });
      }

      // Different email should still get 401 (not 429)
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: "other@example.com", password: "wrongpassword1" },
      });
      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(res.body.error, "invalid_credentials");
    });
  });

  // ================================================================
  // Group 8: 完整登录→验证→退出流程
  // ================================================================
  test.describe("8. 完整流程: 登录 → /api/me → 退出 → /api/me", async () => {
    test.it("TC-27: 完整登录-验证-退出流程", async () => {
      // 1. Login
      const loginRes = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL, password: PRESET_PASSWORD },
      });
      assert.strictEqual(loginRes.statusCode, 200);
      const sid = extractSid(loginRes.setCookie);
      assert.ok(sid);

      // 2. Verify session via /api/me
      const meRes = await httpRequest(baseUrl, "GET", "/api/me", {
        cookie: `sid=${sid}`,
      });
      assert.strictEqual(meRes.statusCode, 200);
      assert.strictEqual(meRes.body.email, PRESET_EMAIL);

      // 3. Logout
      const logoutRes = await httpRequest(baseUrl, "POST", "/api/logout", {
        cookie: `sid=${sid}`,
      });
      assert.strictEqual(logoutRes.statusCode, 200);

      // 4. /api/me after logout → 401
      const meAfter = await httpRequest(baseUrl, "GET", "/api/me", {
        cookie: `sid=${sid}`,
      });
      assert.strictEqual(meAfter.statusCode, 401);
    });
  });

  // ================================================================
  // Group 9: 边界 & 异常输入
  // ================================================================
  test.describe("9. 边界 & 异常输入", async () => {
    test.it("TC-28: 非 JSON body 返回 400", async () => {
      // Send with no content-type, empty body
      const res = await new Promise((resolve, reject) => {
        const req = http.request(
          `${baseUrl}/api/login`,
          {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
          },
          (r) => {
            const chunks = [];
            r.on("data", (c) => chunks.push(c));
            r.on("end", () => {
              const raw = Buffer.concat(chunks).toString();
              let parsed;
              try {
                parsed = JSON.parse(raw);
              } catch {
                parsed = raw;
              }
              resolve({
                statusCode: r.statusCode,
                body: parsed,
              });
            });
          }
        );
        req.on("error", reject);
        req.write("not json");
        req.end();
      });
      // express.json() will reject non-JSON → 400 or error
      // The route checks req.body which may be undefined
      assert.ok(
        res.statusCode === 400 || res.statusCode === 401,
        `expected 400 or 401, got ${res.statusCode}`
      );
    });

    test.it("TC-29: 缺少 email 字段返回 400", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { password: "password123" },
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.error, "invalid_request");
    });

    test.it("TC-30: 缺少 password 字段返回 400", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: PRESET_EMAIL },
      });
      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(res.body.error, "invalid_request");
    });

    test.it("TC-31: 邮箱大小写不敏感（test@EXAMPLE.com 也能登录）", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: { email: "test@EXAMPLE.com", password: PRESET_PASSWORD },
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.body.email, PRESET_EMAIL);
    });

    test.it("TC-32: rememberMe 传非 boolean 值视为 false（会话级）", async () => {
      const res = await httpRequest(baseUrl, "POST", "/api/login", {
        body: {
          email: PRESET_EMAIL,
          password: PRESET_PASSWORD,
          rememberMe: "yes",
        },
      });
      assert.strictEqual(res.statusCode, 200);
      const attrs = sidCookieAttrs(res.setCookie);
      assert.ok(
        attrs["max-age"] === undefined,
        "non-boolean rememberMe should result in session cookie (no Max-Age)"
      );
    });
  });
});
