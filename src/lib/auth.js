"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const sessionStore = require("./sessionStore");

const BCRYPT_COST = require("./userStore").BCRYPT_COST;

// 预生成的占位哈希，用于邮箱不存在时跑一次等价 bcrypt.compare，消除时序侧信道
const PLACEHOLDER_HASH = bcrypt.hashSync("placeholder", BCRYPT_COST);

/** 记住我：30 天，单位毫秒 */
const REMEMBER_ME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 校验密码。
 * - 用户存在：bcrypt.compare(password, user.passwordHash)
 * - 用户不存在：对占位哈希跑一次 compare（防时序侧信道），始终返回 null
 *
 * @param {import("./userStore").User | null} user
 * @param {string} password
 * @returns {boolean} 密码是否匹配（用户不存在时恒为 false）
 */
function verifyPassword(user, password) {
  if (!user) {
    // 邮箱不存在也跑一次 bcrypt compare，消除时序差异
    bcrypt.compareSync(password, PLACEHOLDER_HASH);
    return false;
  }
  return bcrypt.compareSync(password, user.passwordHash);
}

/**
 * 创建 session 并存入 sessionStore。
 * @param {import("./userStore").User} user
 * @param {boolean} rememberMe
 * @returns {Session} 创建的 session 对象
 */
function createSession(user, rememberMe) {
  const sessionId = crypto.randomUUID();
  const now = new Date();
  const session = {
    sessionId,
    userId: user.id,
    email: user.email,
    createdAt: now.toISOString(),
    expiresAt: rememberMe
      ? new Date(now.getTime() + REMEMBER_ME_MAX_AGE_MS).toISOString()
      : null,
  };
  sessionStore.set(sessionId, session);
  return session;
}

/**
 * 销毁 session。
 * @param {string} sessionId
 */
function destroySession(sessionId) {
  sessionStore.destroy(sessionId);
}

module.exports = {
  verifyPassword,
  createSession,
  destroySession,
  REMEMBER_ME_MAX_AGE_MS,
};
