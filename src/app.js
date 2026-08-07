/**
 * Login feature - frontend entry (pure HTML + JS, no framework)
 *
 * Responsibilities:
 *  - Form validation (email format, password 8-64 chars)
 *  - POST /api/login (with rememberMe)
 *  - GET /api/me (verify session on load)
 *  - POST /api/logout
 *
 * All fetch calls use credentials: "same-origin" so the httpOnly `sid`
 * cookie is sent/received automatically.
 */
(function () {
  "use strict";

  // ---- Config ----

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var PASSWORD_MIN = 8;
  var PASSWORD_MAX = 64;

  // ---- DOM refs ----

  var loginView = document.getElementById("login-view");
  var loggedInView = document.getElementById("logged-in-view");
  var loginForm = document.getElementById("login-form");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var rememberMeInput = document.getElementById("rememberMe");
  var loginBtn = document.getElementById("login-btn");
  var logoutBtn = document.getElementById("logout-btn");
  var loginAlert = document.getElementById("login-alert");
  var emailError = document.getElementById("email-error");
  var passwordError = document.getElementById("password-error");
  var loggedInEmail = document.getElementById("logged-in-email");

  // ---- Validation helpers ----

  function validateEmail(value) {
    if (!value) return "请输入邮箱";
    if (!EMAIL_RE.test(value)) return "邮箱格式不正确";
    return "";
  }

  function validatePassword(value) {
    if (!value) return "请输入密码";
    if (value.length < PASSWORD_MIN || value.length > PASSWORD_MAX) {
      return "密码长度需为 " + PASSWORD_MIN + "-" + PASSWORD_MAX + " 字符";
    }
    return "";
  }

  function showFieldError(inputEl, errorEl, msg) {
    if (msg) {
      inputEl.classList.add("invalid");
      errorEl.textContent = msg;
      errorEl.classList.add("show");
    } else {
      inputEl.classList.remove("invalid");
      errorEl.textContent = "";
      errorEl.classList.remove("show");
    }
  }

  function clearAlert() {
    loginAlert.textContent = "";
    loginAlert.classList.remove("show");
  }

  function showAlert(msg) {
    loginAlert.textContent = msg;
    loginAlert.classList.add("show");
  }

  // ---- View toggle ----

  function showLoginView() {
    loginView.classList.remove("hidden");
    loggedInView.classList.add("hidden");
  }

  function showLoggedInView(email) {
    loggedInEmail.textContent = email;
    loginView.classList.add("hidden");
    loggedInView.classList.remove("hidden");
  }

  // ---- Loading state ----

  function setLoading(loading) {
    loginBtn.disabled = loading;
    loginBtn.textContent = loading ? "登录中…" : "登录";
  }

  // ---- API calls ----

  /**
   * Login: POST /api/login
   * On 200 -> fetch /api/me to confirm, then show logged-in view.
   */
  function login(email, password, rememberMe) {
    setLoading(true);
    clearAlert();

    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        email: email,
        password: password,
        rememberMe: rememberMe,
      }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { status: res.status, data: data };
        });
      })
      .then(function (result) {
        if (result.status === 200) {
          // Confirm login state via /api/me
          fetchMe(function (meOk, meData) {
            setLoading(false);
            if (meOk) {
              showLoggedInView(meData.email);
            } else {
              // /api/me failed even though login returned 200 - show generic error
              showAlert("登录异常，请重试");
            }
          });
        } else if (result.status === 401) {
          setLoading(false);
          showAlert("邮箱或密码错误");
        } else if (result.status === 429) {
          setLoading(false);
          showAlert("登录尝试过于频繁，请稍后再试");
        } else {
          setLoading(false);
          var msg = (result.data && result.data.message) || "登录失败，请重试";
          showAlert(msg);
        }
      })
      .catch(function () {
        setLoading(false);
        showAlert("网络错误，请检查连接后重试");
      });
  }

  /**
   * GET /api/me - check current session.
   * callback(ok, data)
   */
  function fetchMe(callback) {
    fetch("/api/me", {
      method: "GET",
      credentials: "same-origin",
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (res.status === 200) {
            callback(true, data);
          } else {
            callback(false, data);
          }
        });
      })
      .catch(function () {
        callback(false, null);
      });
  }

  /**
   * POST /api/logout - destroy session, clear cookie.
   */
  function logout() {
    logoutBtn.disabled = true;
    logoutBtn.textContent = "退出中…";

    fetch("/api/logout", {
      method: "POST",
      credentials: "same-origin",
    })
      .then(function () {
        logoutBtn.disabled = false;
        logoutBtn.textContent = "退出登录";
        // Reset form and return to login view
        loginForm.reset();
        showFieldError(emailInput, emailError, "");
        showFieldError(passwordInput, passwordError, "");
        clearAlert();
        showLoginView();
      })
      .catch(function () {
        logoutBtn.disabled = false;
        logoutBtn.textContent = "退出登录";
        // Even on network error, return to login view (cookie may be stale)
        loginForm.reset();
        showLoginView();
      });
  }

  // ---- Event listeners ----

  // Live-validate on input (clear errors as user types)
  emailInput.addEventListener("input", function () {
    if (emailInput.classList.contains("invalid")) {
      showFieldError(emailInput, emailError, validateEmail(emailInput.value));
    }
  });

  passwordInput.addEventListener("input", function () {
    if (passwordInput.classList.contains("invalid")) {
      showFieldError(passwordInput, passwordError, validatePassword(passwordInput.value));
    }
  });

  // Form submit
  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    clearAlert();

    var email = emailInput.value.trim();
    var password = passwordInput.value;
    var rememberMe = rememberMeInput.checked;

    var emailMsg = validateEmail(email);
    var passwordMsg = validatePassword(password);

    showFieldError(emailInput, emailError, emailMsg);
    showFieldError(passwordInput, passwordError, passwordMsg);

    if (emailMsg || passwordMsg) {
      return;
    }

    login(email, password, rememberMe);
  });

  // Logout button
  logoutBtn.addEventListener("click", logout);

  // ---- Init: check if already logged in ----

  fetchMe(function (ok, data) {
    if (ok && data && data.email) {
      showLoggedInView(data.email);
    } else {
      showLoginView();
    }
  });
})();
