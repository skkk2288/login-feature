"use strict";

/**
 * Frontend unit tests for src/app.js (login form validation + UI behavior).
 *
 * Framework: Node.js built-in test runner (node:test) + jsdom for DOM emulation.
 * Tests map to PRD §3 acceptance criteria for frontend-side validation:
 *   - Email empty / invalid format -> block submit, show error
 *   - Password empty / < 8 chars / > 64 chars -> block submit, show error
 *   - Successful login -> shows logged-in view
 *   - 401 -> shows "邮箱或密码错误"
 *   - 429 -> shows rate limit message
 *   - Loading state during submit
 *
 * NOTE: app.js runs as an IIFE and calls fetchMe() on load. The mock fetch
 * must handle that initial /api/me call (returning 401 so login view shows).
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

// ---- Load index.html markup ----
const HTML_PATH = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(HTML_PATH, "utf-8");

/**
 * Set up a JSDOM environment with a mocked fetch.
 *
 * @param {function} fetchImpl - mock fetch(url, opts) -> Promise<{status, json}>
 * @returns {JSDOM} the JSDOM instance with app.js loaded
 */
function setupDom(fetchImpl) {
  const dom = new JSDOM(html, {
    url: "http://localhost:3000/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });

  // Polyfill fetch (jsdom doesn't have it)
  dom.window.fetch = fetchImpl;

  // Polyfill crypto.randomUUID if missing (jsdom in some versions lacks it)
  if (!dom.window.crypto || !dom.window.crypto.randomUUID) {
    Object.defineProperty(dom.window, "crypto", {
      value: { randomUUID: () => "mock-uuid" },
      writable: true,
      configurable: true,
    });
  }

  // Load app.js into the JSDOM context
  const appJs = fs.readFileSync(path.join(__dirname, "app.js"), "utf-8");
  dom.window.eval(appJs);

  return dom;
}

/**
 * Create a default mock fetch that returns 401 for /api/me (not logged in)
 * and delegates /api/login to the provided handler.
 */
function defaultMockFetch(loginHandler) {
  return function (url, opts) {
    if (url === "/api/login") {
      return loginHandler(url, opts);
    }
    // /api/me and /api/logout default to unauthenticated
    return Promise.resolve({
      status: 401,
      json: () => Promise.resolve({ error: "unauthenticated", message: "未登录" }),
    });
  };
}

/** Wait for microtasks + timers to settle. */
function flushPromises(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms || 50));
}

test.describe("前端单元测试 - 登录表单校验 + UI 行为", async () => {
  let dom;

  test.afterEach(async () => {
    if (dom) {
      dom.window.close();
      dom = null;
    }
  });

  // ================================================================
  // Group 1: 邮箱校验
  // ================================================================
  test.describe("F1. 邮箱校验 - 前端阻止提交", async () => {
    test.it("TC-F01: 邮箱为空时提交被阻止，显示提示，不调 /api/login", async () => {
      let loginCalled = false;
      const fetchImpl = defaultMockFetch(() => {
        loginCalled = true;
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ userId: "u1", email: "test@example.com" }),
        });
      });

      dom = setupDom(fetchImpl);
      await flushPromises();
      const doc = dom.window.document;

      doc.getElementById("password").value = "password123";

      doc.getElementById("login-form").dispatchEvent(new dom.window.Event("submit"));
      await flushPromises();

      assert.strictEqual(loginCalled, false, "/api/login should NOT be called when email is empty");
      const emailError = doc.getElementById("email-error");
      assert.ok(emailError.classList.contains("show"), "email error should be shown");
      assert.ok(emailError.textContent.length > 0, "email error message should be non-empty");
    });

    test.it("TC-F02: 邮箱格式非法时提交被阻止，显示提示", async () => {
      let loginCalled = false;
      const fetchImpl = defaultMockFetch(() => {
        loginCalled = true;
        return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
      });

      dom = setupDom(fetchImpl);
      await flushPromises();
      const doc = dom.window.document;

      doc.getElementById("email").value = "not-an-email";
      doc.getElementById("password").value = "password123";

      doc.getElementById("login-form").dispatchEvent(new dom.window.Event("submit"));
      await flushPromises();

      assert.strictEqual(loginCalled, false, "/api/login should NOT be called for invalid email");
      const emailError = doc.getElementById("email-error");
      assert.ok(emailError.classList.contains("show"), "email error should be shown");
    });

    test.it("TC-F03: 合法邮箱格式通过前端校验，调用 /api/login", async () => {
      let loginCalled = false;
      const fetchImpl = defaultMockFetch(() => {
        loginCalled = true;
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ userId: "u1", email: "test@example.com" }),
        });
      });

      dom = setupDom(fetchImpl);
      await flushPromises();
      const doc = dom.window.document;

      doc.getElementById("email").value = "test@example.com";
      doc.getElementById("password").value = "password123";

      doc.getElementById("login-form").dispatchEvent(new dom.window.Event("submit"));
      await flushPromises(200);

      assert.strictEqual(loginCalled, true, "/api/login should be called for valid email");
      const emailError = doc.getElementById("email-error");
      assert.ok(!emailError.classList.contains("show"), "email error should NOT be shown");
    });
  });

  // ================================================================
  // Group 2: 密码校验
  // ================================================================
  test.describe("F2. 密码校验 - 前端阻止提交", async () => {
    test.it("TC-F04: 密码为空时提交被阻止，显示提示", async () => {
      let loginCalled = false;
      const fetchImpl = defaultMockFetch(() => {
        loginCalled = true;
        return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
      });

      dom = setupDom(fetchImpl);
      await flushPromises();
      const doc = dom.window.document;

      doc.getElementById("email").value = "test@example.com";
      doc.getElementById("password").value = "";

      doc.getElementById("login-form").dispatchEvent(new dom.window.Event("submit"));
      await flushPromises();

      assert.strictEqual(loginCalled, false, "/api/login should NOT be called when password is empty");
      const passwordError = doc.getElementById("password-error");
      assert.ok(passwordError.classList.contains("show"), "password error should be shown");
    });

    test.it("TC-F05: 密码 < 8 字符时提交被阻止，显示提示", async () => {
      let loginCalled = false;
      const fetchImpl = defaultMockFetch(() => {
        loginCalled = true;
        return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
      });

      dom = setupDom(fetchImpl);
      await flushPromises();
      const doc = dom.window.document;

      doc.getElementById("email").value = "test@example.com";
      doc.getElementById("password").value = "short1";

      doc.getElementById("login-form").dispatchEvent(new dom.window.Event("submit"));
      await flushPromises();

      assert.strictEqual(loginCalled, false, "/api/login should NOT be called for short password");
      const passwordError = doc.getElementById("password-error");
      assert.ok(passwordError.classList.contains("show"), "password error should be shown");
      assert.ok(passwordError.textContent.includes("8"), "error should mention 8 chars");
    });

    test.it("TC-F06: 密码 > 64 字符时提交被阻止，显示提示", async () => {
      let loginCalled = false;
      const fetchImpl = defaultMockFetch(() => {
        loginCalled = true;
        return Promise.resolve({ status: 200, json: () => Promise.resolve({}) });
      });

      dom = setupDom(fetchImpl);
      await flushPromises();
      const doc = dom.window.document;

      doc.getElementById("email").value = "test@example.com";
      doc.getElementById("password").value = "a".repeat(65);

      doc.getElementById("login-form").dispatchEvent(new dom.window.Event("submit"));
      await flushPromises();

      assert.strictEqual(loginCalled, false, "/api/login should NOT be called for password > 64 chars");
      const passwordError = doc.getElementById("password-error");
      assert.ok(passwordError.classList.contains("show"), "password error should be shown");
    });
  });

  // ================================================================
  // Group 3: 登录成功 + 已登录态展示
  // ================================================================
  test.describe("F3. 登录成功 + 已登录态展示", async () => {
    test.it("TC-F07: 登录成功后展示已登录视图（已登录：<email>）", async () => {
      let loggedIn = false;
      const fetchImpl = function (url) {
        if (url === "/api/login") {
          loggedIn = true;
          return Promise.resolve({
            status: 200,
            json: () => Promise.resolve({ userId: "u1", email: "test@example.com" }),
          });
        }
        // /api/me returns logged-in state only after login succeeds
        return Promise.resolve({
          status: loggedIn ? 200 : 401,
          json: () => Promise.resolve(
            loggedIn
              ? { userId: "u1", email: "test@example.com" }
              : { error: "unauthenticated", message: "未登录" }
          ),
        });
      };

      dom = setupDom(fetchImpl);
      await flushPromises();
      const doc = dom.window.document;

      doc.getElementById("email").value = "test@example.com";
      doc.getElementById("password").value = "password123";

      doc.getElementById("login-form").dispatchEvent(new dom.window.Event("submit"));
      await flushPromises(200);

      const loggedInView = doc.getElementById("logged-in-view");
      const loginView = doc.getElementById("login-view");
      assert.ok(!loggedInView.classList.contains("hidden"), "logged-in view should be visible");
      assert.ok(loginView.classList.contains("hidden"), "login view should be hidden");
      assert.strictEqual(
        doc.getElementById("logged-in-email").textContent,
        "test@example.com"
      );
    });

    test.it("TC-F08: 登录中按钮显示 loading 态", async () => {
      let resolveLogin;
      const fetchImpl = defaultMockFetch(() => {
        return new Promise((resolve) => {
          resolveLogin = () => resolve({
            status: 200,
            json: () => Promise.resolve({ userId: "u1", email: "test@example.com" }),
          });
        });
      });

      dom = setupDom(fetchImpl);
      await flushPromises();
      const doc = dom.window.document;

      doc.getElementById("email").value = "test@example.com";
      doc.getElementById("password").value = "password123";

      doc.getElementById("login-form").dispatchEvent(new dom.window.Event("submit"));
      await flushPromises(30);

      // While login is pending, button should show loading state
      const loginBtn = doc.getElementById("login-btn");
      assert.strictEqual(loginBtn.disabled, true, "button should be disabled during loading");
      assert.ok(
        loginBtn.textContent.includes("登录中") || loginBtn.textContent.includes("…"),
        "button text should indicate loading"
      );

      // Resolve the login
      if (resolveLogin) resolveLogin();
      await flushPromises(200);
    });
  });

  // ================================================================
  // Group 4: 登录失败错误处理
  // ================================================================
  test.describe("F4. 登录失败错误处理", async () => {
    test.it("TC-F09: 401 响应显示'邮箱或密码错误'", async () => {
      const fetchImpl = defaultMockFetch(() => {
        return Promise.resolve({
          status: 401,
          json: () => Promise.resolve({ error: "invalid_credentials", message: "邮箱或密码错误" }),
        });
      });

      dom = setupDom(fetchImpl);
      await flushPromises();
      const doc = dom.window.document;

      doc.getElementById("email").value = "test@example.com";
      doc.getElementById("password").value = "wrongpassword1";

      doc.getElementById("login-form").dispatchEvent(new dom.window.Event("submit"));
      await flushPromises(100);

      const alert = doc.getElementById("login-alert");
      assert.ok(alert.classList.contains("show"), "alert should be shown");
      assert.strictEqual(alert.textContent, "邮箱或密码错误");
    });

    test.it("TC-F10: 429 响应显示限流提示", async () => {
      const fetchImpl = defaultMockFetch(() => {
        return Promise.resolve({
          status: 429,
          json: () => Promise.resolve({ error: "rate_limited", message: "登录尝试过于频繁，请稍后再试" }),
        });
      });

      dom = setupDom(fetchImpl);
      await flushPromises();
      const doc = dom.window.document;

      doc.getElementById("email").value = "test@example.com";
      doc.getElementById("password").value = "password123";

      doc.getElementById("login-form").dispatchEvent(new dom.window.Event("submit"));
      await flushPromises(100);

      const alert = doc.getElementById("login-alert");
      assert.ok(alert.classList.contains("show"), "alert should be shown");
      assert.strictEqual(alert.textContent, "登录尝试过于频繁，请稍后再试");
    });
  });

  // ================================================================
  // Group 5: 退出登录
  // ================================================================
  test.describe("F5. 退出登录 UI 行为", async () => {
    test.it("TC-F11: 点击退出后回到登录视图", async () => {
      const fetchImpl = function (url) {
        if (url === "/api/logout") {
          return Promise.resolve({
            status: 200,
            json: () => Promise.resolve({ ok: true }),
          });
        }
        // Initial /api/me returns logged-in state
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ userId: "u1", email: "test@example.com" }),
        });
      };

      dom = setupDom(fetchImpl);
      // Wait for initial /api/me to show logged-in view
      await flushPromises(100);
      const doc = dom.window.document;

      const loggedInView = doc.getElementById("logged-in-view");
      assert.ok(!loggedInView.classList.contains("hidden"), "should start in logged-in view");

      // Click logout
      doc.getElementById("logout-btn").dispatchEvent(new dom.window.Event("click"));
      await flushPromises(100);

      const loginView = doc.getElementById("login-view");
      assert.ok(!loginView.classList.contains("hidden"), "login view should be visible after logout");
      assert.ok(loggedInView.classList.contains("hidden"), "logged-in view should be hidden after logout");
    });
  });

  // ================================================================
  // Group 6: 记住我 checkbox
  // ================================================================
  test.describe("F6. 记住我 checkbox", async () => {
    test.it("TC-F12: 勾选记住我时 rememberMe=true 传给后端", async () => {
      let capturedBody = null;
      const fetchImpl = defaultMockFetch((url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ userId: "u1", email: "test@example.com" }),
        });
      });

      dom = setupDom(fetchImpl);
      await flushPromises();
      const doc = dom.window.document;

      doc.getElementById("email").value = "test@example.com";
      doc.getElementById("password").value = "password123";
      doc.getElementById("rememberMe").checked = true;

      doc.getElementById("login-form").dispatchEvent(new dom.window.Event("submit"));
      await flushPromises(200);

      assert.strictEqual(capturedBody.rememberMe, true, "rememberMe should be true when checked");
    });

    test.it("TC-F13: 不勾选记住我时 rememberMe=false 传给后端", async () => {
      let capturedBody = null;
      const fetchImpl = defaultMockFetch((url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ userId: "u1", email: "test@example.com" }),
        });
      });

      dom = setupDom(fetchImpl);
      await flushPromises();
      const doc = dom.window.document;

      doc.getElementById("email").value = "test@example.com";
      doc.getElementById("password").value = "password123";
      doc.getElementById("rememberMe").checked = false;

      doc.getElementById("login-form").dispatchEvent(new dom.window.Event("submit"));
      await flushPromises(200);

      assert.strictEqual(capturedBody.rememberMe, false, "rememberMe should be false when unchecked");
    });
  });

  // ================================================================
  // Group 7: 密码边界值
  // ================================================================
  test.describe("F7. 密码边界值校验", async () => {
    test.it("TC-F14: 密码恰好 8 字符通过前端校验", async () => {
      let loginCalled = false;
      const fetchImpl = defaultMockFetch(() => {
        loginCalled = true;
        return Promise.resolve({
          status: 401,
          json: () => Promise.resolve({ error: "invalid_credentials", message: "邮箱或密码错误" }),
        });
      });

      dom = setupDom(fetchImpl);
      await flushPromises();
      const doc = dom.window.document;

      doc.getElementById("email").value = "test@example.com";
      doc.getElementById("password").value = "12345678"; // exactly 8 chars

      doc.getElementById("login-form").dispatchEvent(new dom.window.Event("submit"));
      await flushPromises(100);

      assert.strictEqual(loginCalled, true, "/api/login should be called for 8-char password");
      const passwordError = doc.getElementById("password-error");
      assert.ok(!passwordError.classList.contains("show"), "no password error for 8 chars");
    });

    test.it("TC-F15: 密码恰好 64 字符通过前端校验", async () => {
      let loginCalled = false;
      const fetchImpl = defaultMockFetch(() => {
        loginCalled = true;
        return Promise.resolve({
          status: 401,
          json: () => Promise.resolve({ error: "invalid_credentials", message: "邮箱或密码错误" }),
        });
      });

      dom = setupDom(fetchImpl);
      await flushPromises();
      const doc = dom.window.document;

      doc.getElementById("email").value = "test@example.com";
      doc.getElementById("password").value = "a".repeat(64); // exactly 64 chars

      doc.getElementById("login-form").dispatchEvent(new dom.window.Event("submit"));
      await flushPromises(100);

      assert.strictEqual(loginCalled, true, "/api/login should be called for 64-char password");
      const passwordError = doc.getElementById("password-error");
      assert.ok(!passwordError.classList.contains("show"), "no password error for 64 chars");
    });
  });
});
