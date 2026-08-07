"use strict";

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");
const fs = require("node:fs");
const path = require("node:path");

// ---------------------------------------------------------------------------
// Frontend unit tests for login form (index.html)
//
// Tests the inline JS behavior: email validation, form submission,
// view switching, error banner display, and API interaction.
//
// PRD §3 验收标准:
//   - 登录页面包含邮箱输入框、密码输入框、"记住我"复选框和"登录"按钮
//   - 用户输入无效邮箱格式，前端阻止提交
//   - 密码和邮箱均不为空时才允许提交
//   - 错误提示统一在表单上方显示
// ---------------------------------------------------------------------------

const HTML_PATH = path.join(__dirname, "..", "index.html");

/** @type {JSDOM|null} */
let dom;
/** @type {Window|null} */
let window;
/** @type {Document|null} */
let document;

/** Original fetch to restore */
let originalFetch;

/**
 * Create a fresh JSDOM instance from index.html.
 * The inline script calls init() which calls fetch("/api/me").
 * We inject fetch via beforeParse so it's available when the script runs.
 *
 * @param {function} fetchImpl - Mock fetch implementation
 * @returns {Promise<void>}
 */
function setupDOM(fetchImpl) {
  const html = fs.readFileSync(HTML_PATH, "utf-8");
  const mockFetch = fetchImpl || (async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: "not_authenticated", message: "未登录" }),
  }));

  dom = new JSDOM(html, {
    runScripts: "dangerously",
    resources: "usable",
    url: "http://localhost:3000/",
    pretendToBeVisual: true,
    beforeParse(window) {
      // Inject fetch before any scripts run so init() can call it
      window.fetch = mockFetch;
    },
  });
  window = dom.window;
  document = window.document;

  // Wait for scripts to run and init() to complete
  return new Promise((resolve) => {
    setTimeout(resolve, 200);
  });
}

function teardownDOM() {
  if (dom) {
    dom.window.close();
  }
  dom = null;
  window = null;
  document = null;
}

// ── DOM structure tests ─────────────────────────────────────────────────

describe("Login form DOM structure (PRD §3)", function () {
  beforeEach(async function () {
    await setupDOM();
  });

  afterEach(function () {
    teardownDOM();
  });

  test("form_has_email_input", function () {
    const emailInput = document.getElementById("email");
    assert.ok(emailInput, "email input should exist");
    assert.strictEqual(emailInput.type, "email");
  });

  test("form_has_password_input", function () {
    const passwordInput = document.getElementById("password");
    assert.ok(passwordInput, "password input should exist");
    assert.strictEqual(passwordInput.type, "password");
  });

  test("form_has_remember_me_checkbox", function () {
    const rememberMe = document.getElementById("rememberMe");
    assert.ok(rememberMe, "rememberMe checkbox should exist");
    assert.strictEqual(rememberMe.type, "checkbox");
    assert.strictEqual(rememberMe.checked, false, "checkbox should default to unchecked");
  });

  test("form_has_login_button", function () {
    const loginBtn = document.getElementById("login-btn");
    assert.ok(loginBtn, "login button should exist");
    assert.strictEqual(loginBtn.type, "submit");
    assert.strictEqual(loginBtn.textContent.trim(), "登录");
  });

  test("form_has_logout_button", function () {
    const logoutBtn = document.getElementById("logout-btn");
    assert.ok(logoutBtn, "logout button should exist");
  });

  test("form_has_error_banner", function () {
    const errorBanner = document.getElementById("error-banner");
    assert.ok(errorBanner, "error banner should exist");
  });

  test("form_uses_novalidate_attribute", function () {
    const form = document.getElementById("login-form");
    assert.ok(form.hasAttribute("novalidate"), "form should have novalidate to use custom validation");
  });
});

// ── Email validation ────────────────────────────────────────────────────

describe("Email format validation (PRD §3: 无效邮箱格式前端阻止提交)", function () {
  beforeEach(async function () {
    await setupDOM();
  });

  afterEach(function () {
    teardownDOM();
  });

  /**
   * Simulate filling the form and submitting, returning the error message shown.
   * @param {string} email
   * @param {string} password
   * @returns {string} error banner text (empty if no error shown)
   */
  function trySubmit(email, password) {
    document.getElementById("email").value = email;
    document.getElementById("password").value = password;

    const form = document.getElementById("login-form");
    form.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));

    const banner = document.getElementById("error-banner");
    return banner.textContent;
  }

  test("empty_email_shows_error_and_blocks_submit", function () {
    const error = trySubmit("", "password123");
    assert.ok(error.length > 0, "should show error for empty email");
    assert.ok(error.includes("邮箱"), "error should mention email");
  });

  test("invalid_email_no_at_sign_shows_error", function () {
    const error = trySubmit("invalidemail", "password123");
    assert.ok(error.length > 0, "should show error for email without @");
  });

  test("invalid_email_missing_domain_shows_error", function () {
    const error = trySubmit("test@", "password123");
    assert.ok(error.length > 0, "should show error for email without domain");
  });

  test("invalid_email_spaces_shows_error", function () {
    const error = trySubmit("test @example.com", "password123");
    assert.ok(error.length > 0, "should show error for email with spaces");
  });

  test("valid_email_no_error_shown", function () {
    const error = trySubmit("test@example.com", "password123");
    // No validation error should be shown (the form will attempt fetch, but validation passes)
    assert.strictEqual(error, "", "valid email should not show validation error");
  });

  test("empty_password_shows_error", function () {
    const error = trySubmit("test@example.com", "");
    assert.ok(error.length > 0, "should show error for empty password");
    assert.ok(error.includes("密码"), "error should mention password");
  });
});

// ── View switching ──────────────────────────────────────────────────────

describe("View switching behavior", function () {
  afterEach(function () {
    teardownDOM();
  });

  test("page_load_shows_login_form_when_not_authenticated", async function () {
    await setupDOM(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: "not_authenticated", message: "未登录" }),
    }));

    // Wait for init() to complete
    await new Promise((r) => setTimeout(r, 150));

    const loginView = document.getElementById("login-view");
    assert.strictEqual(loginView.style.display, "block", "login view should be visible");
  });

  test("page_load_shows_logged_in_view_when_authenticated", async function () {
    await setupDOM(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ email: "demo@example.com" }),
    }));

    await new Promise((r) => setTimeout(r, 150));

    const loggedInView = document.getElementById("logged-in-view");
    assert.strictEqual(loggedInView.style.display, "block", "logged-in view should be visible");

    const emailSpan = document.getElementById("current-email");
    assert.strictEqual(emailSpan.textContent, "demo@example.com");
  });

  test("page_load_network_error_shows_login_form", async function () {
    await setupDOM(async () => {
      throw new Error("Network error");
    });

    await new Promise((r) => setTimeout(r, 150));

    const loginView = document.getElementById("login-view");
    assert.strictEqual(loginView.style.display, "block", "should show login form on network error");
  });
});

// ── Form submission & API interaction ───────────────────────────────────

describe("Form submission and API interaction", function () {
  afterEach(function () {
    teardownDOM();
  });

  test("successful_login_shows_logged_in_view_with_email", async function () {
    let loginCalled = false;
    let loginBody = null;

    await setupDOM(async (url, opts) => {
      if (url === "/api/me" || (opts && opts.method === "GET" && url.includes("/api/me"))) {
        return { ok: false, status: 401, json: async () => ({ error: "not_authenticated" }) };
      }
      if (opts && opts.method === "POST") {
        loginCalled = true;
        loginBody = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ email: loginBody.email }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    await new Promise((r) => setTimeout(r, 150));

    // Fill form
    document.getElementById("email").value = "demo@example.com";
    document.getElementById("password").value = "password123";
    document.getElementById("rememberMe").checked = true;

    // Submit
    const form = document.getElementById("login-form");
    form.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));

    // Wait for async fetch to resolve
    await new Promise((r) => setTimeout(r, 100));

    assert.ok(loginCalled, "fetch should have been called for login");
    assert.strictEqual(loginBody.email, "demo@example.com");
    assert.strictEqual(loginBody.password, "password123");
    assert.strictEqual(loginBody.rememberMe, true);

    const loggedInView = document.getElementById("logged-in-view");
    assert.strictEqual(loggedInView.style.display, "block", "should show logged-in view after success");

    const emailSpan = document.getElementById("current-email");
    assert.strictEqual(emailSpan.textContent, "demo@example.com");
  });

  test("failed_login_shows_error_message", async function () {
    await setupDOM(async (url, opts) => {
      if (url === "/api/me" || (opts && opts.method === "GET")) {
        return { ok: false, status: 401, json: async () => ({ error: "not_authenticated" }) };
      }
      if (opts && opts.method === "POST") {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: "invalid_credentials", message: "邮箱或密码错误" }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    await new Promise((r) => setTimeout(r, 150));

    document.getElementById("email").value = "demo@example.com";
    document.getElementById("password").value = "wrongpassword";

    const form = document.getElementById("login-form");
    form.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));

    await new Promise((r) => setTimeout(r, 100));

    const errorBanner = document.getElementById("error-banner");
    assert.ok(errorBanner.classList.contains("visible"), "error banner should be visible");
    assert.strictEqual(errorBanner.textContent, "邮箱或密码错误");
  });

  test("rate_limit_error_shows_too_many_attempts_message", async function () {
    await setupDOM(async (url, opts) => {
      if (url === "/api/me" || (opts && opts.method === "GET")) {
        return { ok: false, status: 401, json: async () => ({ error: "not_authenticated" }) };
      }
      if (opts && opts.method === "POST") {
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: "too_many_attempts", message: "登录尝试过多，请 15 分钟后再试" }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    await new Promise((r) => setTimeout(r, 150));

    document.getElementById("email").value = "demo@example.com";
    document.getElementById("password").value = "password123";

    const form = document.getElementById("login-form");
    form.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));

    await new Promise((r) => setTimeout(r, 100));

    const errorBanner = document.getElementById("error-banner");
    assert.ok(errorBanner.classList.contains("visible"));
    assert.strictEqual(errorBanner.textContent, "登录尝试过多，请 15 分钟后再试");
  });

  test("button_disabled_and_loading_text_during_submit", async function () {
    let resolveLogin;
    await setupDOM(async (url, opts) => {
      if (url === "/api/me" || (opts && opts.method === "GET")) {
        return { ok: false, status: 401, json: async () => ({ error: "not_authenticated" }) };
      }
      if (opts && opts.method === "POST") {
        // Return a promise that we resolve later
        return new Promise((resolve) => {
          resolveLogin = () => resolve({
            ok: true,
            status: 200,
            json: async () => ({ email: "demo@example.com" }),
          });
        });
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    await new Promise((r) => setTimeout(r, 150));

    document.getElementById("email").value = "demo@example.com";
    document.getElementById("password").value = "password123";

    const loginBtn = document.getElementById("login-btn");
    const form = document.getElementById("login-form");
    form.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));

    // Button should be disabled and show loading text
    assert.strictEqual(loginBtn.disabled, true, "button should be disabled during submit");
    assert.strictEqual(loginBtn.textContent, "登录中…", "button should show loading text");

    // Resolve the login
    resolveLogin();
    await new Promise((r) => setTimeout(r, 100));

    // Button should be re-enabled
    assert.strictEqual(loginBtn.disabled, false, "button should be re-enabled after response");
    assert.strictEqual(loginBtn.textContent, "登录", "button text should be restored");
  });

  test("logout_click_calls_api_and_shows_login_form", async function () {
    let logoutCalled = false;
    await setupDOM(async (url, opts) => {
      if (url === "/api/me" || (opts && opts.method === "GET")) {
        return { ok: true, status: 200, json: async () => ({ email: "demo@example.com" }) };
      }
      if (opts && opts.method === "POST" && url.includes("/api/logout")) {
        logoutCalled = true;
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    await new Promise((r) => setTimeout(r, 150));

    // Should be in logged-in view
    const loggedInView = document.getElementById("logged-in-view");
    assert.strictEqual(loggedInView.style.display, "block");

    // Click logout
    const logoutBtn = document.getElementById("logout-btn");
    logoutBtn.dispatchEvent(new window.Event("click", { bubbles: true }));

    await new Promise((r) => setTimeout(r, 100));

    assert.ok(logoutCalled, "should call /api/logout");

    const loginView = document.getElementById("login-view");
    assert.strictEqual(loginView.style.display, "block", "should show login form after logout");
  });

  test("network_error_shows_network_error_message", async function () {
    await setupDOM(async (url, opts) => {
      if (url === "/api/me" || (opts && opts.method === "GET")) {
        return { ok: false, status: 401, json: async () => ({ error: "not_authenticated" }) };
      }
      if (opts && opts.method === "POST") {
        throw new Error("Network error");
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });

    await new Promise((r) => setTimeout(r, 150));

    document.getElementById("email").value = "demo@example.com";
    document.getElementById("password").value = "password123";

    const form = document.getElementById("login-form");
    form.dispatchEvent(new window.Event("submit", { cancelable: true, bubbles: true }));

    await new Promise((r) => setTimeout(r, 100));

    const errorBanner = document.getElementById("error-banner");
    assert.ok(errorBanner.classList.contains("visible"));
    assert.ok(errorBanner.textContent.includes("网络错误"), "should show network error message");
  });
});

// ── Error banner behavior ───────────────────────────────────────────────

describe("Error banner behavior", function () {
  beforeEach(async function () {
    await setupDOM();
  });

  afterEach(function () {
    teardownDOM();
  });

  test("error_banner_hidden_by_default", function () {
    const errorBanner = document.getElementById("error-banner");
    assert.ok(!errorBanner.classList.contains("visible"), "error banner should not be visible by default");
  });

  test("typing_in_email_clears_error", function () {
    // First show an error
    const errorBanner = document.getElementById("error-banner");
    errorBanner.textContent = "some error";
    errorBanner.classList.add("visible");

    // Simulate typing in email
    const emailInput = document.getElementById("email");
    emailInput.dispatchEvent(new window.Event("input", { bubbles: true }));

    assert.ok(!errorBanner.classList.contains("visible"), "error should be cleared on input");
    assert.strictEqual(errorBanner.textContent, "");
  });

  test("typing_in_password_clears_error", function () {
    const errorBanner = document.getElementById("error-banner");
    errorBanner.textContent = "some error";
    errorBanner.classList.add("visible");

    const passwordInput = document.getElementById("password");
    passwordInput.dispatchEvent(new window.Event("input", { bubbles: true }));

    assert.ok(!errorBanner.classList.contains("visible"));
  });

  test("field_error_class_removed_on_input", function () {
    const emailInput = document.getElementById("email");
    emailInput.classList.add("field-error");

    emailInput.dispatchEvent(new window.Event("input", { bubbles: true }));

    assert.ok(!emailInput.classList.contains("field-error"), "field-error class should be removed on input");
  });
});

// ── Demo user hint ──────────────────────────────────────────────────────

describe("Demo user hint", function () {
  beforeEach(async function () {
    await setupDOM();
  });

  afterEach(function () {
    teardownDOM();
  });

  test("demo_hint_shows_credentials", function () {
    const hint = document.querySelector(".demo-hint");
    assert.ok(hint, "demo hint element should exist");
    assert.ok(hint.textContent.includes("demo@example.com"), "should show demo email");
    assert.ok(hint.textContent.includes("password123"), "should show demo password");
  });
});
