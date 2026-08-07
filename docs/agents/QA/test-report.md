# Test Report: 登录功能 (Login Feature v0.1.0)

## 1. 测试范围

- 验收标准：见架构师通知的测试范围（对照 PRD + API 契约）
- 被测代码：main HEAD `82c8f1f`（PR #4 后端 + PR #5 前端已 merge）
- 测试用例数：36
- 通过：36 pass
- 失败：0 fail
- 跳过：0 skip

测试覆盖三大类：功能测试、限流测试、安全测试。测试通过 HTTP 请求
对 Express app 做端到端集成测试，验证完整登录/退出/me 流程。

## 2. 测试用例

| # | 用例 | 步骤 | 期望 | 实际 | 结果 |
|---|------|------|------|------|------|
| 1 | 正确邮箱+密码登录 | POST /api/login test@example.com/password123 | 200 + user + redirect=/ | 200 + user + redirect=/ | ✅ pass |
| 2 | 登录后 Set-Cookie 含 sid | 同上，检查 Set-Cookie | sid=sid.signature | sid=sid.signature | ✅ pass |
| 3 | 不存在邮箱 | POST /api/login nonexistent@example.com | 401 invalid_credentials | 401 invalid_credentials | ✅ pass |
| 4 | 错误密码 | POST /api/login test@example.com/wrongpass | 401 invalid_credentials | 401 invalid_credentials | ✅ pass |
| 5 | 空邮箱 | POST /api/login email="" | 400 invalid_input | 400 invalid_input | ✅ pass |
| 6 | 空密码 | POST /api/login password="" | 400 invalid_input | 400 invalid_input | ✅ pass |
| 7 | 缺失 email 字段 | POST /api/login 无 email | 400 invalid_input | 400 invalid_input | ✅ pass |
| 8 | 缺失 password 字段 | POST /api/login 无 password | 400 invalid_input | 400 invalid_input | ✅ pass |
| 9 | 非法邮箱格式 | POST /api/login email="notanemail" | 400 invalid_input | 400 invalid_input | ✅ pass |
| 10 | 非法邮箱（无域名） | POST /api/login email="test@" | 400 invalid_input | 400 invalid_input | ✅ pass |
| 11 | 密码 >64 字符 | POST /api/login password="a"×65 | 400 invalid_input | 400 invalid_input | ✅ pass |
| 12 | 密码恰好 64 字符 | POST /api/login password="a"×64 | 401（合法长度，走密码校验） | 401 invalid_credentials | ✅ pass |
| 13 | 邮箱大小写不敏感 | POST /api/login TEST@EXAMPLE.COM | 200 + user.email=小写 | 200 + email=小写 | ✅ pass |
| 14 | 记住我勾选 → Max-Age=2592000 | POST /api/login rememberMe=true | cookie Max-Age=2592000 | Max-Age=2592000 | ✅ pass |
| 15 | 记住我不勾选 → 会话级 | POST /api/login rememberMe=false | 无 Max-Age | 无 Max-Age | ✅ pass |
| 16 | 不传 rememberMe → 默认会话级 | POST /api/login 无 rememberMe | 无 Max-Age | 无 Max-Age | ✅ pass |
| 17 | cookie 属性 HttpOnly+Lax | 检查 Set-Cookie 属性 | HttpOnly; SameSite=Lax | HttpOnly; SameSite=Lax | ✅ pass |
| 18 | COOKIE_SECURE=false → 无 Secure | 检查 Set-Cookie | 无 Secure | 无 Secure | ✅ pass |
| 19 | 未登录访问 /api/me | GET /api/me 无 cookie | 401 unauthenticated | 401 unauthenticated | ✅ pass |
| 20 | 登录后访问 /api/me | 先登录获取 cookie，再 GET /api/me | 200 + user | 200 + user | ✅ pass |
| 21 | 无效签名 cookie → /api/me | GET /api/me cookie=invalid | 401 unauthenticated | 401 unauthenticated | ✅ pass |
| 22 | 篡改签名 cookie → /api/me | GET /api/me 签名被改 | 401 unauthenticated | 401 unauthenticated | ✅ pass |
| 23 | 退出登录 → 清除 cookie | POST /api/logout | 200 + redirect=/ + Max-Age=0 | 200 + redirect=/ + Max-Age=0 | ✅ pass |
| 24 | 退出后 cookie 失效 | 退出后 GET /api/me | 401 unauthenticated | 401 unauthenticated | ✅ pass |
| 25 | 未登录直接退出（幂等） | POST /api/logout 无 cookie | 200 + redirect=/ | 200 + redirect=/ | ✅ pass |
| 26 | 5 次密码错误 → 第 5 次 429 | 连续 5 次错误密码 | 第 5 次 429 account_locked | 429 account_locked | ✅ pass |
| 27 | 锁定期间正确密码也被锁 | 锁定后用正确密码 | 429 account_locked | 429 account_locked | ✅ pass |
| 28 | 邮箱不存在不计数（防枚举） | 6 次不存在邮箱登录 | 全部 401（不锁定） | 全部 401 | ✅ pass |
| 29 | 登录成功后限流清零 | 3 错→1 对→3 错 | 后 3 次仍 401（未锁定） | 3 次均 401 | ✅ pass |
| 30 | redirect /dashboard 放行 | ?redirect=/dashboard | redirect=/dashboard | redirect=/dashboard | ✅ pass |
| 31 | redirect https://evil.com 拦截 | ?redirect=https://evil.com | redirect=/ | redirect=/ | ✅ pass |
| 32 | redirect //evil.com 拦截 | ?redirect=//evil.com | redirect=/ | redirect=/ | ✅ pass |
| 33 | redirect javascript: 拦截 | ?redirect=javascript:alert(1) | redirect=/ | redirect=/ | ✅ pass |
| 34 | redirect 为空 → 默认 / | 无 redirect 参数 | redirect=/ | redirect=/ | ✅ pass |
| 35 | 登录响应不含 password_hash | 检查 /api/login 响应 | 无 password_hash | 无 password_hash | ✅ pass |
| 36 | /api/me 响应不含 password_hash | 检查 /api/me 响应 | 无 password_hash | 无 password_hash | ✅ pass |

## 3. 失败用例

无。所有 36 个测试用例均通过。

## 4. 覆盖率

测试为 HTTP 端到端集成测试，覆盖以下模块的关键路径：

| 模块 | 覆盖路径 |
|------|----------|
| src/routes/auth.js | POST /api/login（校验+限流+session+cookie）、POST /api/logout、GET /api/me |
| src/auth/session.js | session 创建、签名 cookie 生成、签名校验、session 销毁 |
| src/auth/password.js | bcrypt 校验（正确密码、错误密码） |
| src/auth/rateLimit.js | 失败计数、锁定触发、锁定期间拦截、成功清零、不存在邮箱不计数 |
| src/store/users.js | findByEmail（存在/不存在）、种子用户 |
| src/middleware/auth.js | requireAuth（无 cookie/无效签名/session 销毁/正常） |
| src/app.js | Express 装配（json 解析、cookie-parser、路由挂载） |

> 注：项目未配置覆盖率工具（无 istanbul/c8 依赖）。覆盖率以模块路径覆盖
> 衡量，核心认证流程（登录/退出/me/限流/redirect/cookie）均有测试覆盖。

## 5. 结论

- [x] 所有验收标准通过
- [x] 无 P0 / P1 bug
- [x] 核心认证流程测试覆盖完整

建议发布。登录功能（邮箱+密码+记住我）实现符合 PRD 验收标准和 API 契约，
36 个集成测试用例全部通过，包括功能、限流、安全三大类。
