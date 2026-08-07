(function () {
  "use strict";

  // ---- DOM 元素 ----
  var loginView = document.getElementById("login-view");
  var profileView = document.getElementById("profile-view");
  var loginForm = document.getElementById("login-form");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var rememberMeInput = document.getElementById("rememberMe");
  var loginButton = document.getElementById("login-button");
  var togglePasswordBtn = document.getElementById("toggle-password");
  var logoutButton = document.getElementById("logout-button");
  var loginError = document.getElementById("login-error");
  var emailError = document.getElementById("email-error");
  var passwordError = document.getElementById("password-error");
  var profileEmail = document.getElementById("profile-email");

  // ---- 工具函数 ----

  // 邮箱格式校验（与后端简化规则一致：xxx@xxx.xxx）
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  // 校验邮箱：合法返回 true，否则展示字段错误并返回 false
  function validateEmail() {
    var value = emailInput.value.trim();
    if (!value) {
      showFieldError(emailError, emailInput, "请输入邮箱");
      return false;
    }
    if (!isValidEmail(value)) {
      showFieldError(emailError, emailInput, "请输入有效的邮箱地址");
      return false;
    }
    clearFieldError(emailError, emailInput);
    return true;
  }

  function showFieldError(span, input, msg) {
    span.textContent = msg;
    span.hidden = false;
    input.setAttribute("aria-invalid", "true");
  }

  function clearFieldError(span, input) {
    span.textContent = "";
    span.hidden = true;
    input.removeAttribute("aria-invalid");
  }

  // 表单上方错误提示
  function showFormError(msg) {
    loginError.textContent = msg;
    loginError.hidden = false;
  }

  function clearFormError() {
    loginError.textContent = "";
    loginError.hidden = true;
  }

  // loading 态：禁止重复提交
  var submitting = false;
  function setLoading(loading) {
    submitting = loading;
    loginButton.disabled = loading;
    loginButton.classList.toggle("is-loading", loading);
    loginButton.querySelector(".btn-text").textContent = loading ? "登录中…" : "登录";
    loginButton.querySelector(".btn-spinner").hidden = !loading;
  }

  // ---- 密码显示/掩码切换 ----
  togglePasswordBtn.addEventListener("click", function () {
    var isText = passwordInput.type === "text";
    if (isText) {
      passwordInput.type = "password";
      togglePasswordBtn.querySelector(".eye-text").textContent = "显示";
      togglePasswordBtn.setAttribute("aria-label", "显示密码");
      togglePasswordBtn.setAttribute("aria-pressed", "false");
    } else {
      passwordInput.type = "text";
      togglePasswordBtn.querySelector(".eye-text").textContent = "隐藏";
      togglePasswordBtn.setAttribute("aria-label", "隐藏密码");
      togglePasswordBtn.setAttribute("aria-pressed", "true");
    }
  });

  // ---- 失焦校验 ----
  emailInput.addEventListener("blur", validateEmail);

  // 输入时清除该字段错误（改善体验）
  emailInput.addEventListener("input", function () {
    if (!emailError.hidden) clearFieldError(emailError, emailInput);
    clearFormError();
  });
  passwordInput.addEventListener("input", function () {
    if (!passwordError.hidden) clearFieldError(passwordError, passwordInput);
    clearFormError();
  });

  // ---- 表单提交 ----
  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (submitting) return;

    clearFormError();

    // 提交时校验
    var emailOk = validateEmail();
    var passwordOk = (function () {
      var value = passwordInput.value;
      if (!value) {
        showFieldError(passwordError, passwordInput, "请输入密码");
        return false;
      }
      if (value.length > 64) {
        showFieldError(passwordError, passwordInput, "密码不能超过 64 个字符");
        return false;
      }
      clearFieldError(passwordError, passwordInput);
      return true;
    })();

    if (!emailOk || !passwordOk) return;

    var email = emailInput.value.trim();
    var password = passwordInput.value;
    var rememberMe = rememberMeInput.checked;

    setLoading(true);

    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password, rememberMe: rememberMe }),
    })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, status: res.status, data: data };
        });
      })
      .then(function (result) {
        setLoading(false);
        if (result.ok) {
          // 登录成功：回跳（同源相对路径，后端已校验）
          var redirect = result.data.redirect || "/";
          window.location.href = redirect;
        } else {
          // 登录失败：错误信息显示在表单上方
          showFormError(result.data.message || "登录失败");
          // 密码框清空，邮箱框保留
          passwordInput.value = "";
          passwordInput.focus();
        }
      })
      .catch(function (err) {
        setLoading(false);
        showFormError("网络错误，请稍后重试");
        passwordInput.value = "";
        passwordInput.focus();
      });
  });

  // ---- 退出登录 ----
  logoutButton.addEventListener("click", function () {
    logoutButton.disabled = true;
    fetch("/api/logout", { method: "POST" })
      .then(function (res) {
        return res.json().then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        var redirect = (result.data && result.data.redirect) || "/";
        window.location.href = redirect;
      })
      .catch(function () {
        logoutButton.disabled = false;
        showFormError("退出失败，请稍后重试");
      });
  });

  // ---- 页面加载：检查登录态 ----
  function checkAuth() {
    fetch("/api/me")
      .then(function (res) {
        if (res.ok) {
          return res.json().then(function (data) {
            // 已登录 -> 展示已登录视图
            loginView.hidden = true;
            profileView.hidden = false;
            profileEmail.textContent = (data.user && data.user.email) || "";
          });
        }
        // 未登录 -> 保持登录视图，聚焦邮箱框
        loginView.hidden = false;
        profileView.hidden = true;
        emailInput.focus();
      })
      .catch(function () {
        // 网络错误：保持登录视图
        loginView.hidden = false;
        profileView.hidden = true;
        emailInput.focus();
      });
  }

  // 默认记住我不勾选（HTML 无 checked 即可不勾选，显式确保）
  rememberMeInput.checked = false;

  checkAuth();
})();
