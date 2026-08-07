"use strict";

const express = require("express");
const auth = require("../lib/auth");

const router = express.Router();

const COOKIE_NAME = "sid";
const COOKIE_SECURE = process.env.COOKIE_SECURE !== "false";

/**
 * POST /api/logout
 * 退出登录，销毁服务端 session，清除 cookie。
 * 幂等：无论是否已登录均返回 200。
 *
 * Response: 200 { ok: true } + Set-Cookie sid=; Max-Age=0
 */
router.post("/", (req, res) => {
  const sessionId = req.cookies && req.cookies[COOKIE_NAME];
  if (sessionId) {
    auth.destroySession(sessionId);
  }

  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
  });

  return res.status(200).json({ ok: true });
});

module.exports = router;
