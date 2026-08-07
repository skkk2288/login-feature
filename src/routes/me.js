"use strict";

const express = require("express");
const sessionStore = require("../lib/sessionStore");

const router = express.Router();

const COOKIE_NAME = "sid";

/**
 * GET /api/me
 * 获取当前登录用户信息，用于验证登录态。
 *
 * Response: 200 { userId, email }
 *           401 unauthenticated
 */
router.get("/", (req, res) => {
  const sessionId = req.cookies && req.cookies[COOKIE_NAME];
  if (!sessionId) {
    return res.status(401).json({
      error: "unauthenticated",
      message: "未登录",
    });
  }

  const session = sessionStore.get(sessionId);
  if (!session) {
    return res.status(401).json({
      error: "unauthenticated",
      message: "未登录",
    });
  }

  return res.status(200).json({
    userId: session.userId,
    email: session.email,
  });
});

module.exports = router;
