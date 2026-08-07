"use strict";

/**
 * LoginAttemptState
 * @typedef {Object} LoginAttemptState
 * @property {string} email        - 被限流的邮箱（小写）
 * @property {number} failCount    - 当前窗口内连续失败次数
 * @property {number} windowStart  - 当前计数窗口起始时间（Date.now() ms）
 */

/** @type {Map<string, LoginAttemptState>} key 为 email（小写） */
const attempts = new Map();

const MAX_FAILS = 5;
const WINDOW_MS = 60 * 1000; // 1 分钟

/**
 * 判断该邮箱是否已被限流。
 * - failCount >= 5 且窗口未过期：返回 true（限流中）
 * - 窗口已过期：重置计数
 *
 * @param {string} email
 * @returns {boolean} 是否应拒绝（429）
 */
function isRateLimited(email) {
  const key = String(email || "").toLowerCase();
  const state = attempts.get(key);
  if (!state) return false;

  const now = Date.now();
  if (now - state.windowStart >= WINDOW_MS) {
    // 窗口过期，重置
    attempts.set(key, { email: key, failCount: 0, windowStart: now });
    return false;
  }

  return state.failCount >= MAX_FAILS;
}

/**
 * 记录一次登录失败（failCount++）。
 * 若窗口过期则先重置。
 *
 * @param {string} email
 */
function recordFailure(email) {
  const key = String(email || "").toLowerCase();
  const now = Date.now();
  const state = attempts.get(key);

  if (state && now - state.windowStart < WINDOW_MS) {
    state.failCount += 1;
  } else {
    attempts.set(key, { email: key, failCount: 1, windowStart: now });
  }
}

/**
 * 登录成功后重置该邮箱的计数。
 *
 * @param {string} email
 */
function reset(email) {
  const key = String(email || "").toLowerCase();
  attempts.delete(key);
}

/**
 * Express 中间件：按邮箱限流。
 * 从 request body 读取 email，若被限流直接返回 429。
 *
 * 设计说明：限流在密码校验之前判断；被限流时即使密码正确也拒绝，
 * 防止通过正确密码"探测"账户。
 *
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {import("express").NextFunction} next
 */
function rateLimitMiddleware(req, res, next) {
  const email = req.body && req.body.email;
  if (email && isRateLimited(email)) {
    return res.status(429).json({
      error: "rate_limited",
      message: "登录尝试过于频繁，请稍后再试",
    });
  }
  next();
}

module.exports = {
  isRateLimited,
  recordFailure,
  reset,
  rateLimitMiddleware,
  MAX_FAILS,
  WINDOW_MS,
};
