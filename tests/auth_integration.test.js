"use strict";

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("node:child_process");
const http = require("node:http");

// ---------------------------------------------------------------------------
// Integration tests for login feature API
//
// Tests the full HTTP stack: POST /api/login, GET /api/me, POST /api/logout
// by spawning the real server as a child process and making HTTP requests.
//
// Design docs:
//   - PRD: docs/agents/需求编写/prd-draft.md §3 验收标准
//   - API contract: docs/agents/架构师/api-contract.md
//   - Data model: docs/agents/架构师/data-model.md
//   - Architecture: docs/agents/架构师/architecture.md
//
// Demo user: demo@example.com / password123
// ---------------------------------------------------------------------------

const PORT = 4567;
const BASE = `http://localhost:${PORT}`;

let serverProcess;

/**
 * Make an HTTP request to the test server.
 * @param {string} method
 * @param {string} path
 * @param {object} [opts]
 * @param {object} [opts.body] - JSON body to send
 * @param {string} [opts.cookie] - Cookie header value
 * @returns {Promise<{status:number, headers:object, body:object}>}
 */
function request(method, path, opts = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Accept: "application/json" };
    let bodyStr = null;

    if (opts.body) {
      bodyStr = JSON.stringify(opts.body);
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }
    if (opts.cookie) {
      headers["Cookie"] = opts.cookie;
    }

    const req = http.request(
      `${BASE}${path}`,
      { method, headers },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: parsed });
        });
      }
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * Extract the Set-Cookie header value from response headers.
 * @param {object} headers
 * @returns {string|null}
 */
function getSetCookie(headers) {
  const sc = headers["set-cookie"];
  if (!sc) return null;
  // set-cookie can be array; take first
  const first = Array.isArray(sc) ? sc[0] : sc;
  // extract the sid=... part (before first ;)
  return first.split(";")[0];
}

// ── Setup & teardown ─────────────────────────────────────────────────────

before(async function () {
  // Start the server as a child process with test env vars
  serverProcess = spawn("node", ["server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      COOKIE_SECURE: "false",
      SESSION_SECRET: "test-secret-key-for-integration-tests",
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  serverProcess.stderr.on("data", (d) => {
    // Uncomment for debug:
    // console.error("[server stderr]", d.toString());
  });

  // Wait for server to be ready
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server startup timeout")), 10000);
    function check() {
      const req = http.request(`${BASE}/api/me`, { method: "GET" }, (res) => {
        clearTimeout(timeout);
        resolve();
      });
      req.on("error", () => setTimeout(check, 100));
      req.end();
    }
    setTimeout(check, 200);
  });
});

after(function () {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
});

// ── POST /api/login ─────────────────────────────────────────────────────

describe("POST /api/login", function () {
  test("it_login_valid_credentials_returns_200_and_email", async function () {
    const res = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123", rememberMe: false },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.email, "demo@example.com");
    assert.ok(res.headers["set-cookie"], "should set cookie");
    const cookie = getSetCookie(res.headers);
    assert.ok(cookie.startsWith("sid="), "cookie name should be sid");
  });

  test("it_login_wrong_password_returns_401_invalid_credentials", async function () {
    const res = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "wrongpassword", rememberMe: false },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "invalid_credentials");
    assert.strictEqual(res.body.message, "邮箱或密码错误");
  });

  test("it_login_nonexistent_user_returns_401_same_message", async function () {
    // PRD §3: error message must not reveal whether email exists (anti-enumeration)
    const res = await request("POST", "/api/login", {
      body: { email: "nobody@example.com", password: "password123", rememberMe: false },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "invalid_credentials");
    assert.strictEqual(res.body.message, "邮箱或密码错误");
  });

  test("it_login_missing_email_returns_400_bad_request", async function () {
    const res = await request("POST", "/api/login", {
      body: { password: "password123" },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "bad_request");
  });

  test("it_login_missing_password_returns_400_bad_request", async function () {
    const res = await request("POST", "/api/login", {
      body: { email: "demo@example.com" },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "bad_request");
  });

  test("it_login_empty_email_returns_400_bad_request", async function () {
    const res = await request("POST", "/api/login", {
      body: { email: "  ", password: "password123" },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "bad_request");
  });

  test("it_login_empty_password_returns_400_bad_request", async function () {
    const res = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "" },
    });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "bad_request");
  });

  test("it_login_empty_body_returns_400_bad_request", async function () {
    const res = await request("POST", "/api/login", { body: {} });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, "bad_request");
  });

  test("it_login_case_insensitive_email_works", async function () {
    // data-model.md §1: email lowercased for lookup
    const res = await request("POST", "/api/login", {
      body: { email: "DEMO@EXAMPLE.COM", password: "password123", rememberMe: false },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.email, "demo@example.com");
  });

  test("it_login_rememberMe_true_sets_max_age_30_days", async function () {
    const res = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123", rememberMe: true },
    });
    assert.strictEqual(res.status, 200);
    const setCookie = res.headers["set-cookie"];
    assert.ok(setCookie, "should set cookie");
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
    assert.ok(cookieStr.includes("Max-Age=2592000"), "Max-Age should be 2592000 (30 days) for rememberMe=true");
  });

  test("it_login_rememberMe_false_no_max_age", async function () {
    const res = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123", rememberMe: false },
    });
    assert.strictEqual(res.status, 200);
    const setCookie = res.headers["set-cookie"];
    assert.ok(setCookie);
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
    assert.ok(!cookieStr.includes("Max-Age"), "Max-Age should be absent for rememberMe=false (session cookie)");
  });

  test("it_login_cookie_has_httponly_and_samesite_lax", async function () {
    const res = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123", rememberMe: false },
    });
    const setCookie = res.headers["set-cookie"];
    assert.ok(setCookie);
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
    assert.ok(/HttpOnly/i.test(cookieStr), "cookie should be HttpOnly");
    assert.ok(/SameSite=Lax/i.test(cookieStr), "cookie should be SameSite=Lax");
  });

  test("it_login_rememberMe_not_provided_defaults_false", async function () {
    const res = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123" },
    });
    assert.strictEqual(res.status, 200);
    const setCookie = res.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
    assert.ok(!cookieStr.includes("Max-Age"), "no Max-Age when rememberMe omitted");
  });

  test("it_login_rememberMe_string_true_treated_as_false", async function () {
    // rememberMe must be boolean true, not truthy string
    const res = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123", rememberMe: "true" },
    });
    assert.strictEqual(res.status, 200);
    const setCookie = res.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
    assert.ok(!cookieStr.includes("Max-Age"), "string 'true' should not trigger Max-Age");
  });

  test("it_login_success_returns_session_cookie_for_subsequent_requests", async function () {
    // Login, then use cookie to call /api/me
    const loginRes = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123", rememberMe: false },
    });
    const cookie = getSetCookie(loginRes.headers);
    assert.ok(cookie);

    const meRes = await request("GET", "/api/me", { cookie });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.body.email, "demo@example.com");
  });
});

// ── GET /api/me ─────────────────────────────────────────────────────────

describe("GET /api/me", function () {
  test("it_me_without_cookie_returns_401_not_authenticated", async function () {
    const res = await request("GET", "/api/me");
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.error, "not_authenticated");
  });

  test("it_me_with_valid_cookie_returns_200_and_email", async function () {
    const loginRes = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123", rememberMe: false },
    });
    const cookie = getSetCookie(loginRes.headers);
    const meRes = await request("GET", "/api/me", { cookie });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.body.email, "demo@example.com");
  });

  test("it_me_with_tampered_signature_returns_401", async function () {
    const loginRes = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123", rememberMe: false },
    });
    const cookie = getSetCookie(loginRes.headers);
    // Tamper: replace the HMAC part with garbage
    const tampered = cookie.replace(/\.[a-f0-9]+$/, ".deadbeefdeadbeef");
    const meRes = await request("GET", "/api/me", { cookie: tampered });
    assert.strictEqual(meRes.status, 401);
    assert.strictEqual(meRes.body.error, "not_authenticated");
  });

  test("it_me_with_garbage_cookie_returns_401", async function () {
    const meRes = await request("GET", "/api/me", { cookie: "sid=garbagevalue" });
    assert.strictEqual(meRes.status, 401);
  });

  test("it_me_after_logout_returns_401", async function () {
    const loginRes = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123", rememberMe: false },
    });
    const cookie = getSetCookie(loginRes.headers);

    // Logout
    await request("POST", "/api/logout", { cookie });

    // /api/me should now fail with the same cookie
    const meRes = await request("GET", "/api/me", { cookie });
    assert.strictEqual(meRes.status, 401);
  });

  test("it_me_cookie_without_dot_returns_401", async function () {
    const meRes = await request("GET", "/api/me", { cookie: "sid=nodotsjustsid" });
    assert.strictEqual(meRes.status, 401);
  });

  test("it_me_after_login_with_rememberMe_works", async function () {
    const loginRes = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123", rememberMe: true },
    });
    const cookie = getSetCookie(loginRes.headers);
    const meRes = await request("GET", "/api/me", { cookie });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.body.email, "demo@example.com");
  });
});

// ── POST /api/logout ────────────────────────────────────────────────────

describe("POST /api/logout", function () {
  test("it_logout_logged_in_returns_200_ok", async function () {
    const loginRes = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123", rememberMe: false },
    });
    const cookie = getSetCookie(loginRes.headers);
    const res = await request("POST", "/api/logout", { cookie });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
  });

  test("it_logout_clears_cookie_with_max_age_0", async function () {
    const loginRes = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123", rememberMe: false },
    });
    const cookie = getSetCookie(loginRes.headers);
    const res = await request("POST", "/api/logout", { cookie });
    const setCookie = res.headers["set-cookie"];
    assert.ok(setCookie, "should send Set-Cookie on logout");
    const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie;
    // Express clearCookie uses Expires=Thu, 01 Jan 1970 and/or Max-Age=0
    assert.ok(
      /Max-Age=0/i.test(cookieStr) || /expires=Thu, 01 Jan 1970/i.test(cookieStr),
      "logout should clear cookie (Max-Age=0 or expired date)"
    );
  });

  test("it_logout_without_login_returns_200_ok_idempotent", async function () {
    // api-contract.md: "未登录时调用 /api/logout 也返回 200 + {"ok":true}（幂等）"
    const res = await request("POST", "/api/logout");
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
  });

  test("it_logout_without_cookie_still_clears_cookie", async function () {
    // Even without login, should still attempt to clear cookie
    const res = await request("POST", "/api/logout");
    assert.strictEqual(res.status, 200);
    const setCookie = res.headers["set-cookie"];
    assert.ok(setCookie, "should still set clear-cookie header");
  });

  test("it_logout_double_logout_both_return_200", async function () {
    const loginRes = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123", rememberMe: false },
    });
    const cookie = getSetCookie(loginRes.headers);

    const res1 = await request("POST", "/api/logout", { cookie });
    assert.strictEqual(res1.status, 200);

    const res2 = await request("POST", "/api/logout", { cookie });
    assert.strictEqual(res2.status, 200);
  });

  test("it_logout_invalidates_session_for_me", async function () {
    const loginRes = await request("POST", "/api/login", {
      body: { email: "demo@example.com", password: "password123", rememberMe: false },
    });
    const cookie = getSetCookie(loginRes.headers);

    await request("POST", "/api/logout", { cookie });
    const meRes = await request("GET", "/api/me", { cookie });
    assert.strictEqual(meRes.status, 401);
  });
});

// ── Rate limiting ────────────────────────────────────────────────────────

describe("Rate limiting (5 failures -> 429 lockout)", function () {
  test("it_rate_limit_5_failures_then_6th_request_locked_429", async function () {
    // Use a unique email per test to avoid cross-test contamination
    const email = "ratelimit-test-1@example.com";

    // 5 failed login attempts (wrong password)
    for (let i = 0; i < 5; i++) {
      const res = await request("POST", "/api/login", {
        body: { email, password: "wrongpassword", rememberMe: false },
      });
      assert.strictEqual(res.status, 401, `attempt ${i + 1} should be 401`);
    }

    // 6th attempt should be locked
    const res = await request("POST", "/api/login", {
      body: { email, password: "wrongpassword", rememberMe: false },
    });
    assert.strictEqual(res.status, 429);
    assert.strictEqual(res.body.error, "too_many_attempts");
    assert.strictEqual(res.body.message, "登录尝试过多，请 15 分钟后再试");
  });

  test("it_rate_limit_correct_credentials_also_blocked_when_locked", async function () {
    // Even correct password should be blocked when locked
    const email = "ratelimit-test-2@example.com";

    // Create 5 failures with wrong password on a nonexistent email
    for (let i = 0; i < 5; i++) {
      await request("POST", "/api/login", {
        body: { email, password: "wrongpassword", rememberMe: false },
      });
    }

    // Now even with correct credentials (but this email doesn't exist in user repo)
    // Should get 429 because rate limit check is before bcrypt
    const res = await request("POST", "/api/login", {
      body: { email, password: "anything", rememberMe: false },
    });
    assert.strictEqual(res.status, 429);
  });

  test("it_rate_limit_4_failures_not_locked_yet", async function () {
    const email = "ratelimit-test-3@example.com";

    for (let i = 0; i < 4; i++) {
      const res = await request("POST", "/api/login", {
        body: { email, password: "wrong", rememberMe: false },
      });
      assert.strictEqual(res.status, 401, `attempt ${i + 1} should be 401 (not locked yet)`);
    }

    // 5th attempt should still be 401 (the 5th failure triggers lock, but the request itself gets 401)
    const res5 = await request("POST", "/api/login", {
      body: { email, password: "wrong", rememberMe: false },
    });
    assert.strictEqual(res5.status, 401, "5th failure returns 401 (lock triggers on this failure)");

    // 6th attempt: now locked
    const res6 = await request("POST", "/api/login", {
      body: { email, password: "wrong", rememberMe: false },
    });
    assert.strictEqual(res6.status, 429, "6th attempt should be locked (429)");
  });

  test("it_rate_limit_reset_on_successful_login", async function () {
    // This test uses the real demo user
    // First, fail a few times (but less than 5 to avoid lock)
    const email = "demo@example.com";

    // 2 failures
    await request("POST", "/api/login", {
      body: { email, password: "wrong1", rememberMe: false },
    });
    await request("POST", "/api/login", {
      body: { email, password: "wrong2", rememberMe: false },
    });

    // Successful login - should reset counter
    const successRes = await request("POST", "/api/login", {
      body: { email, password: "password123", rememberMe: false },
    });
    assert.strictEqual(successRes.status, 200);

    // Now we should have 0 failures again, 5 more failures needed to lock
    for (let i = 0; i < 4; i++) {
      const res = await request("POST", "/api/login", {
        body: { email, password: "wrong", rememberMe: false },
      });
      assert.strictEqual(res.status, 401, `attempt ${i + 1} after reset should be 401`);
    }

    // 5th failure triggers lock (but returns 401)
    const res5 = await request("POST", "/api/login", {
      body: { email, password: "wrong", rememberMe: false },
    });
    assert.strictEqual(res5.status, 401);

    // 6th: locked
    const res6 = await request("POST", "/api/login", {
      body: { email, password: "wrong", rememberMe: false },
    });
    // Note: after lock, failCount is reset to 0. The 6th attempt will be blocked by check() -> 429
    assert.strictEqual(res6.status, 429);
  });

  test("it_rate_limit_different_emails_independent", async function () {
    // Failure on one email should not affect another
    const email1 = "ratelimit-a@example.com";
    const email2 = "ratelimit-b@example.com";

    // 3 failures on email1
    for (let i = 0; i < 3; i++) {
      await request("POST", "/api/login", {
        body: { email: email1, password: "wrong", rememberMe: false },
      });
    }

    // email2 should still work normally
    const res = await request("POST", "/api/login", {
      body: { email: email2, password: "wrong", rememberMe: false },
    });
    assert.strictEqual(res.status, 401); // 401 because wrong password, but NOT 429
  });
});
