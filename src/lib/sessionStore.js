"use strict";

/**
 * Session 对象
 * @typedef {Object} Session
 * @property {string} sessionId    - uuid
 * @property {string} userId       - uuid, FK -> users.id
 * @property {string} email        - 冗余存储，避免每次 join 查 user
 * @property {string} createdAt    - ISO 8601
 * @property {string | null} expiresAt - ISO 8601 或 null（浏览器会话级）
 */

/** @type {Map<string, Session>} key 为 sessionId */
const sessions = new Map();

/**
 * 获取 session。
 * @param {string} sessionId
 * @returns {Session | null} 找不到返回 null
 */
function get(sessionId) {
  return sessions.get(sessionId) || null;
}

/**
 * 存储 session。
 * @param {string} sessionId
 * @param {Session} session
 */
function set(sessionId, session) {
  sessions.set(sessionId, session);
}

/**
 * 销毁 session（幂等，不存在不报错）。
 * @param {string} sessionId
 */
function destroy(sessionId) {
  sessions.delete(sessionId);
}

module.exports = { get, set, destroy };
