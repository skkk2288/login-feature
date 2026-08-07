"use strict";

const express = require("express");
const cookieParser = require("cookie-parser");

const userRepository = require("../store/users");
const passwordUtil = require("../auth/password");
const { sessionRepository, verifyCookie, REMEMBER_TTL } = require("../auth/session");
const rateLimiter = require("../auth/rateLimit");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

const COOKIE_SECURE = process.env.COOKIE_SECURE !== "false"; // 默认 true

// --- 辅助函数 ---

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 校验 redirect 参数：只允许同源相对路径（以 / 开头，不以 // 开头）
 * @param {string} redirect
 * @returns {string} 合法的 redirect 或 "/"
 */
function sanitizeRedirect(redirect) {
  if (
    typeof redirect === "string" &&
    redirect.startsWith("/") &&
    !redirect.startsWith("//")
  ) {
    return redirect;
  }
  return "/";
}

/**
 * 构造 Set-Cookie 头
 * @param {string} signedSid
 * @param {number|null} maxAge - null 表示会话级
 * @returns {string}
 */
function buildCookie(signedSid, maxAge) {
  let cookie = `sid=${signedSid}; HttpOnly; Path=/; SameSite=Lax`;
  if (COOKIE_SECURE) {
    cookie += "; Secure";
  }
  if (maxAge !== null && maxAge !== undefined) {
    cookie += `; Max-Age=${maxAge}`;
  }
  return cookie;
}

/**
 * 构造清除 cookie 头
 * @returns {string}
 */
function buildClearCookie() {
  let cookie = "sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";
  if (COOKIE_SECURE) {
    cookie += "; Secure";
  }
  return cookie;
}

// --- 路由 ---

/**
 * POST /api/login
 * 登录：校验凭证 -> 限流检查 -> 创建 session -> Set-Cookie
 */
router.post("/login", (req, res) => {
  const { email, password, rememberMe } = req.body || {};

  // 输入校验
  if (!email || !password) {
    return res.status(400).json({
      error: "invalid_input",
      message: "请填写邮箱和密码",
    });
  }
  if (typeof email !== "string" || !EMAIL_REGEX.test(email)) {
    return res.status(400).json({
      error: "invalid_input",
      message: "请输入有效的邮箱地址",
    });
  }
  if (typeof password !== "string" || password.length < 1 || password.length > 64) {
    return res.status(400).json({
      error: "invalid_input",
      message: "密码长度需为 1-64 字符",
    });
  }

  const normalizedEmail = email.toLowerCase();

  // 限流检查
  const lockStatus = rateLimiter.check(normalizedEmail);
  if (lockStatus.locked) {
    return res.status(429).json({
      error: "account_locked",
      message: `账户已锁定，请 ${lockStatus.retryAfterMin} 分钟后重试`,
    });
  }

  // 查找用户
  const user = userRepository.findByEmail(normalizedEmail);
  if (!user) {
    // 邮箱不存在：返回统一错误，不计数（防枚举）
    return res.status(401).json({
      error: "invalid_credentials",
      message: "邮箱或密码错误",
    });
  }

  // 校验密码
  if (!passwordUtil.verify(password, user.password_hash)) {
    // 密码错误：记失败次数
    rateLimiter.recordFailure(normalizedEmail);

    // 检查是否刚触发锁定
    const newLockStatus = rateLimiter.check(normalizedEmail);
    if (newLockStatus.locked) {
      return res.status(429).json({
        error: "account_locked",
        message: `账户已锁定，请 ${newLockStatus.retryAfterMin} 分钟后重试`,
      });
    }

    return res.status(401).json({
      error: "invalid_credentials",
      message: "邮箱或密码错误",
    });
  }

  // 登录成功：清零限流
  rateLimiter.reset(normalizedEmail);

  // 创建 session
  const isRemember = rememberMe === true;
  const { sid: signedSid, session } = sessionRepository.create({
    userId: user.id,
    rememberMe: isRemember,
  });

  // Set-Cookie
  const maxAge = isRemember ? REMEMBER_TTL / 1000 : undefined; // Max-Age 单位是秒
  res.setHeader("Set-Cookie", buildCookie(signedSid, maxAge));

  return res.status(200).json({
    user: { id: user.id, email: user.email },
    redirect: sanitizeRedirect(req.query.redirect),
  });
});

/**
 * POST /api/logout
 * 退出：销毁 session + 清除 cookie
 */
router.post("/logout", (req, res) => {
  const signedSid = req.cookies && req.cookies.sid;
  if (signedSid) {
    const sid = verifyCookie(signedSid);
    if (sid) {
      sessionRepository.destroy(sid);
    }
  }
  res.setHeader("Set-Cookie", buildClearCookie());
  return res.status(200).json({ redirect: "/" });
});

/**
 * GET /api/me
 * 获取当前登录用户（受认证中间件保护）
 */
router.get("/me", requireAuth, (req, res) => {
  return res.status(200).json({
    user: { id: req.user.id, email: req.user.email },
  });
});

module.exports = router;
