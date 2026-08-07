"use strict";

const { sessionRepository, verifyCookie } = require("../auth/session");
const userRepository = require("../store/users");

/**
 * 认证中间件
 * 设计参考：docs/agents/架构师/architecture.md §4（受保护页面访问）
 *
 * 流程：解析 cookie -> 校验签名 -> 查 session -> 查 user -> req.user
 * 失败返回 401 unauthenticated
 */

function requireAuth(req, res, next) {
  const signedSid = req.cookies && req.cookies.sid;
  if (!signedSid) {
    return res.status(401).json({
      error: "unauthenticated",
      message: "未登录，请先登录",
    });
  }

  const sid = verifyCookie(signedSid);
  if (!sid) {
    return res.status(401).json({
      error: "unauthenticated",
      message: "未登录，请先登录",
    });
  }

  const session = sessionRepository.find(sid);
  if (!session) {
    return res.status(401).json({
      error: "unauthenticated",
      message: "未登录，请先登录",
    });
  }

  const user = userRepository.findById(session.user_id);
  if (!user) {
    // session 存在但用户已被删除，清理 session
    sessionRepository.destroy(sid);
    return res.status(401).json({
      error: "unauthenticated",
      message: "未登录，请先登录",
    });
  }

  req.user = { id: user.id, email: user.email };
  req.session = session;
  next();
}

module.exports = { requireAuth };
