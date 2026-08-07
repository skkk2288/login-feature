"use strict";

/**
 * LoginRateLimiter - 邮箱维度限流（内存计数）
 * 设计参考：docs/agents/架构师/data-model.md §login_attempts
 *
 * 规则：
 * - 仅"邮箱存在但密码错误"才计数；邮箱不存在不计数（防枚举）
 * - 连续 5 次失败 -> 锁定 15 分钟
 * - 登录成功 -> 清零
 * - 锁定过期后自动重置
 */

const MAX_FAILS = 5;
const LOCK_DURATION = 900000; // 15 分钟 (ms)

class LoginRateLimiter {
  constructor() {
    this._attempts = new Map(); // emailLower -> attemptObj
  }

  /**
   * 检查邮箱是否被锁定
   * @param {string} email
   * @returns {{ locked: boolean, retryAfterMin: number }}
   */
  check(email) {
    const key = email.toLowerCase();
    const attempt = this._attempts.get(key);

    if (!attempt || !attempt.locked_until) {
      return { locked: false, retryAfterMin: 0 };
    }

    const now = Date.now();
    if (now >= attempt.locked_until) {
      // 锁定已过期，自动重置
      this._attempts.delete(key);
      return { locked: false, retryAfterMin: 0 };
    }

    // 动态计算剩余分钟（向上取整）
    const remainingMs = attempt.locked_until - now;
    const retryAfterMin = Math.ceil(remainingMs / 60000);
    return { locked: true, retryAfterMin };
  }

  /**
   * 记录一次失败（内部判断是否触发锁定）
   * @param {string} email
   */
  recordFailure(email) {
    const key = email.toLowerCase();
    const now = Date.now();
    let attempt = this._attempts.get(key);

    if (!attempt) {
      attempt = {
        email: key,
        fail_count: 0,
        locked_until: null,
        last_attempt_at: now,
      };
      this._attempts.set(key, attempt);
    }

    attempt.fail_count += 1;
    attempt.last_attempt_at = now;

    if (attempt.fail_count >= MAX_FAILS) {
      attempt.locked_until = now + LOCK_DURATION;
    }
  }

  /**
   * 登录成功时清零
   * @param {string} email
   */
  reset(email) {
    this._attempts.delete(email.toLowerCase());
  }
}

// 单例
const loginRateLimiter = new LoginRateLimiter();

module.exports = loginRateLimiter;
