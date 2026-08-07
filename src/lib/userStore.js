"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");

const BCRYPT_COST = 12;

// 预置测试用户明文密码（源码中只出现明文，启动时 bcrypt 哈希后存入内存）
const SEED_EMAIL = "test@example.com";
const SEED_PASSWORD = "password123";

/**
 * User 对象
 * @typedef {Object} User
 * @property {string} id            - uuid
 * @property {string} email         - 小写存储
 * @property {string} passwordHash  - bcrypt 哈希（$2b$12$...）
 * @property {string} createdAt     - ISO 8601
 */

/** @type {Map<string, User>} key 为 email（小写） */
const users = new Map();

/**
 * 启动时注入预置测试用户。
 * 明文密码经 bcrypt 哈希后存入，源码不暴露哈希常量。
 */
function seed() {
  const passwordHash = bcrypt.hashSync(SEED_PASSWORD, BCRYPT_COST);
  users.set(SEED_EMAIL, {
    id: crypto.randomUUID(),
    email: SEED_EMAIL,
    passwordHash,
    createdAt: new Date().toISOString(),
  });
}

// 模块加载时执行 seed
seed();

/**
 * 按邮箱查找用户。
 * @param {string} email
 * @returns {User | null} 找不到返回 null
 */
function findByEmail(email) {
  const key = String(email || "").toLowerCase();
  return users.get(key) || null;
}

module.exports = { findByEmail, seed, BCRYPT_COST };
