"use strict";

const bcrypt = require("bcryptjs");

/**
 * 密码哈希 / 校验模块（bcrypt cost=12）
 * 设计参考：docs/agents/架构师/architecture.md §3.2
 */

const BCRYPT_COST = parseInt(process.env.BCRYPT_COST, 10) || 12;

/**
 * 对明文密码做 bcrypt 哈希
 * @param {string} plain - 明文密码
 * @returns {string} bcrypt hash
 */
function hash(plain) {
  return bcrypt.hashSync(plain, BCRYPT_COST);
}

/**
 * 校验明文密码是否匹配 bcrypt hash
 * @param {string} plain - 明文密码
 * @param {string} hashed - bcrypt hash
 * @returns {boolean}
 */
function verify(plain, hashed) {
  return bcrypt.compareSync(plain, hashed);
}

module.exports = { hash, verify, BCRYPT_COST };
