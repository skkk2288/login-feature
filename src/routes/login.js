"use strict";

const express = require("express");
const userStore = require("../lib/userStore");
const auth = require("../lib/auth");
const rateLimit = require("../middleware/rateLimit");

const router = express.Router();

// 邮箱格式校验（RFC 5322 近似，基本校验）
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// cookie 安全配置
const COOKIE_NAME = "sid";
const COOKIE_SECURE = process.env.COOKIE_SECURE !== "false"; // 默认 true，本地开发设 false

/**
 * POST /api/login
 * 校验邮箱 + 密码，建立会话。
 *
 * Request:  { email, password, rememberMe? }
 * Response: 200 { userId, email } + Set-Cookie sid
 *           400 invalid_request
 *           401 invalid_credentials（防枚举统一响应）
 *           429 rate_limited
 */
router.post("/", rateLimit.rateLimitMiddleware, (req, res) => {
  const { email, password, rememberMe } = req.body || {};

  // ---- 输入校验 ----
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email.length === 0 ||
    password.length < 8 ||
    password.length > 64 ||
    !EMAIL_RE.test(email)
  ) {
    return res.status(400).json({
      error: "invalid_request",
      message: "请求格式错误",
    });
  }

  const remember = rememberMe === true;

  // ---- 查找用户 ----
  const user = userStore.findByEmail(email);

  // ---- 校验密码（用户不存在时跑占位 bcrypt，防时序侧信道）----
  const ok = auth.verifyPassword(user, password);

  if (!ok) {
    // 限流计数 +1
    rateLimit.recordFailure(email);
    return res.status(401).json({
      error: "invalid_credentials",
      message: "邮箱或密码错误",
    });
  }

  // ---- 登录成功：重置限流计数 ----
  rateLimit.reset(email);

  // ---- 创建 session ----
  const session = auth.createSession(user, remember);

  // ---- 设置 cookie ----
  const cookieOpts = {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
  };
  if (remember) {
    cookieOpts.maxAge = auth.REMEMBER_ME_MAX_AGE_MS; // 30 天
  }
  // rememberMe=false 时不设 maxAge -> 浏览器会话级
  res.cookie(COOKIE_NAME, session.sessionId, cookieOpts);

  return res.status(200).json({
    userId: user.id,
    email: user.email,
  });
});

module.exports = router;
