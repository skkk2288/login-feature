"use strict";

const crypto = require("crypto");
const passwordUtil = require("../auth/password");

/**
 * UserRepository - 内存 Map 实现
 * 设计参考：docs/agents/架构师/data-model.md §users
 *
 * 双索引：email(lowercase) -> userObj, id -> userObj
 * 后续换 Postgres 时只需替换实现类，接口不变。
 */

class UserRepository {
  constructor() {
    this._byEmail = new Map(); // emailLower -> userObj
    this._byId = new Map(); // id -> userObj
  }

  /**
   * @param {string} email
   * @returns {object|null} user（不含 password_hash 对外暴露，但内部返回完整对象）
   */
  findByEmail(email) {
    return this._byEmail.get(email.toLowerCase()) || null;
  }

  /**
   * @param {string} id
   * @returns {object|null}
   */
  findById(id) {
    return this._byId.get(id) || null;
  }

  /**
   * @param {{ email: string, passwordHash: string }} param0
   * @returns {object} user
   */
  create({ email, passwordHash }) {
    const now = Date.now();
    const user = {
      id: crypto.randomUUID(),
      email: email.toLowerCase(),
      password_hash: passwordHash,
      created_at: now,
      updated_at: now,
    };
    this._byEmail.set(user.email, user);
    this._byId.set(user.id, user);
    return user;
  }

  /**
   * 启动时注入种子用户（仅 v0.1.0 测试用）
   * test@example.com / password123
   */
  seed() {
    const email = "test@example.com";
    if (!this.findByEmail(email)) {
      this.create({
        email,
        passwordHash: passwordUtil.hash("password123"),
      });
    }
  }
}

// 单例
const userRepository = new UserRepository();
userRepository.seed();

module.exports = userRepository;
