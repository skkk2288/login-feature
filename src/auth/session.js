"use strict";

const crypto = require("crypto");

/**
 * SessionRepository - 内存 Map 实现
 * 设计参考：docs/agents/架构师/data-model.md §sessions
 *
 * SID 生成：crypto.randomBytes(32) -> base64url
 * Cookie 值：<base64url-sid>.<hmac-signature>（HMAC-SHA256 签名防篡改）
 * 惰性过期：find() 时检查 expires_at，过期则删除并返回 null
 */

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const REMEMBER_TTL = 2592000000; // 30 天 (ms)
const SESSION_TTL = 86400000; // 24 小时兜底 (ms)

/**
 * 用 HMAC-SHA256 对 sid 签名
 * @param {string} sid
 * @returns {string} hex signature
 */
function sign(sid) {
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(sid)
    .digest("hex");
}

/**
 * 生成签名 cookie 值：sid.signature
 * @param {string} sid
 * @returns {string}
 */
function signCookie(sid) {
  return `${sid}.${sign(sid)}`;
}

/**
 * 校验并提取 sid from signed cookie value
 * @param {string} cookieValue - "sid.signature"
 * @returns {string|null} sid if valid, null otherwise
 */
function verifyCookie(cookieValue) {
  if (!cookieValue || typeof cookieValue !== "string") return null;
  const dotIdx = cookieValue.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const sid = cookieValue.substring(0, dotIdx);
  const sig = cookieValue.substring(dotIdx + 1);
  const expectedSig = sign(sid);

  // 常量时间比较防时序攻击
  const sidBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sidBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sidBuf, expectedBuf)) return null;
  return sid;
}

class SessionRepository {
  constructor() {
    this._sessions = new Map(); // sid -> sessionObj
  }

  /**
   * 创建 session
   * @param {{ userId: string, rememberMe: boolean }} param0
   * @returns {{ sid: string, session: object }}
   */
  create({ userId, rememberMe }) {
    const now = Date.now();
    const sid = crypto.randomBytes(32).toString("base64url");
    const ttl = rememberMe ? REMEMBER_TTL : SESSION_TTL;
    const session = {
      sid,
      user_id: userId,
      remember_me: rememberMe,
      created_at: now,
      expires_at: now + ttl,
    };
    this._sessions.set(sid, session);
    return { sid: signCookie(sid), session };
  }

  /**
   * 查找 session（惰性过期）
   * @param {string} sid - raw sid (not signed)
   * @returns {object|null}
   */
  find(sid) {
    const session = this._sessions.get(sid);
    if (!session) return null;
    if (Date.now() >= session.expires_at) {
      this._sessions.delete(sid);
      return null;
    }
    return session;
  }

  /**
   * 销毁 session
   * @param {string} sid - raw sid
   */
  destroy(sid) {
    this._sessions.delete(sid);
  }

  /**
   * 销毁某用户所有 session（多设备退出，可选）
   * @param {string} userId
   */
  destroyByUserId(userId) {
    for (const [sid, session] of this._sessions) {
      if (session.user_id === userId) {
        this._sessions.delete(sid);
      }
    }
  }
}

// 单例
const sessionRepository = new SessionRepository();

module.exports = { sessionRepository, verifyCookie, REMEMBER_TTL, SESSION_TTL };
