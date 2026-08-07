# Test Report: 登录功能

## 1. 测试范围

- 验收标准：见 `docs/agents/需求编写/prd-draft.md` 第 3 节
- API 契约：见 `docs/agents/架构师/api-contract.md`
- 数据模型：见 `docs/agents/架构师/data-model.md`
- 被测代码：main 分支 commit 7096572（前端 PR #1 + 后端 PR #2 已 merge）

- 测试用例数：47
- 通过：47 pass
- 失败：0 fail
- 跳过：0 skip

测试框架：Node.js 内置 `node:test`（无额外测试框架依赖）
前端 DOM 模拟：jsdom

---

## 2. 测试用例

### 2.1 后端集成测试（tests/auth_integration.test.js）— 32 cases

通过 Express 真实 HTTP 服务器（ephemeral port）测试完整请求→中间件→路由→存储→响应链路。

| # | 用例 | 步骤 | 期望 | 实际 | 结果 |
|---|------|------|------|------|------|
| TC-01 | 正确邮箱+密码登录成功 | POST /api/login valid | 200 + userId + email | 200 + userId + email | ✅ pass |
| TC-02 | 登录成功 Set-Cookie 下发 sid | POST /api/login valid | Set-Cookie: sid=... | sid cookie 存在 | ✅ pass |
| TC-03 | cookie 安全属性 | POST /api/login valid | HttpOnly + SameSite + Path=/ | 全部存在 | ✅ pass |
| TC-04 | 未登录访问 /api/me | GET /api/me (no cookie) | 401 + unauthenticated | 401 + unauthenticated | ✅ pass |
| TC-05 | 登录后 /api/me | GET /api/me (with sid) | 200 + userId + email | 200 + userId + email | ✅ pass |
| TC-06 | 无效 sid 访问 /api/me | GET /api/me (invalid sid) | 401 | 401 | ✅ pass |
| TC-07 | 错误密码 | POST /api/login wrong password | 401 + 邮箱或密码错误 | 401 + 邮箱或密码错误 | ✅ pass |
| TC-08 | 不存在邮箱 | POST /api/login unknown email | 401 + 邮箱或密码错误 | 401 + 邮箱或密码错误 | ✅ pass |
| TC-09 | 防枚举响应一致 | 对比 TC-07 和 TC-08 响应 | statusCode/error/message 一致 | 全一致 | ✅ pass |
| TC-10 | 邮箱为空 | POST /api/login email="" | 400 + invalid_request | 400 + invalid_request | ✅ pass |
| TC-11 | 邮箱格式非法 | POST /api/login email="not-an-email" | 400 | 400 | ✅ pass |
| TC-12 | 密码为空 | POST /api/login password="" | 400 | 400 | ✅ pass |
| TC-13 | 密码 < 8 字符 | POST /api/login password="short1" | 400 | 400 | ✅ pass |
| TC-14 | 密码 > 64 字符 | POST /api/login password="a"×65 | 400 | 400 | ✅ pass |
| TC-15 | 密码恰好 8 字符（边界） | POST /api/login password="12345678" | 401（长度合法，密码错误） | 401 | ✅ pass |
| TC-16 | 密码恰好 64 字符（边界） | POST /api/login password="a"×64 | 401（长度合法，密码错误） | 401 | ✅ pass |
| TC-17 | rememberMe=true cookie Max-Age | POST /api/login rememberMe=true | Max-Age=2592000 | Max-Age=2592000 | ✅ pass |
| TC-18 | rememberMe=false 无 Max-Age | POST /api/login rememberMe=false | 无 Max-Age（会话级） | 无 Max-Age | ✅ pass |
| TC-19 | rememberMe 缺省无 Max-Age | POST /api/login (no rememberMe) | 无 Max-Age | 无 Max-Age | ✅ pass |
| TC-20 | 登录后退出 /api/me 返回 401 | login → me(200) → logout → me | me 最后一跳 401 | 401 | ✅ pass |
| TC-21 | 未登录 logout 幂等 | POST /api/logout (no cookie) | 200 + { ok: true } | 200 + { ok: true } | ✅ pass |
| TC-22 | logout 清除 cookie | login → logout | Set-Cookie sid=; Max-Age=0 | sid=; Max-Age=0 | ✅ pass |
| TC-23 | 连续 5 次失败后第 6 次 429 | 5×wrong password → 6th | 429 + rate_limited | 429 + rate_limited | ✅ pass |
| TC-24 | 限流期间正确密码也 429 | 5×wrong → correct password | 429 | 429 | ✅ pass |
| TC-25 | 登录成功后限流计数重置 | 3×wrong → success → 3×wrong | 后 3 次均为 401（非 429） | 全 401 | ✅ pass |
| TC-26 | 限流按邮箱隔离 | 5×wrong(preset) → wrong(other) | other 邮箱返回 401 | 401 | ✅ pass |
| TC-27 | 完整流程 login→me→logout→me | 全链路 | 200→200→200→401 | 200→200→200→401 | ✅ pass |
| TC-28 | 非 JSON body | POST text/plain | 400 或 401 | 400 | ✅ pass |
| TC-29 | 缺少 email 字段 | POST { password } | 400 | 400 | ✅ pass |
| TC-30 | 缺少 password 字段 | POST { email } | 400 | 400 | ✅ pass |
| TC-31 | 邮箱大小写不敏感 | POST email="test@EXAMPLE.com" | 200 + email 小写 | 200 + test@example.com | ✅ pass |
| TC-32 | rememberMe 非 boolean 视为 false | POST rememberMe="yes" | 无 Max-Age（会话级） | 无 Max-Age | ✅ pass |

### 2.2 前端单元测试（src/app.test.js）— 15 cases

通过 jsdom 模拟 DOM 环境，测试 `src/app.js` 的表单校验、错误提示、视图切换、loading 态、记住我传参等前端行为。

| # | 用例 | 步骤 | 期望 | 实际 | 结果 |
|---|------|------|------|------|------|
| TC-F01 | 邮箱为空阻止提交 | 填密码不填邮箱，提交 | 不调 /api/login + 显示邮箱错误 | 未调 fetch + 错误显示 | ✅ pass |
| TC-F02 | 邮箱格式非法阻止提交 | email="not-an-email" | 不调 /api/login + 显示错误 | 未调 fetch + 错误显示 | ✅ pass |
| TC-F03 | 合法邮箱通过校验 | email="test@example.com" | 调 /api/login + 无错误 | 调 fetch + 无错误 | ✅ pass |
| TC-F04 | 密码为空阻止提交 | 填邮箱不填密码 | 不调 /api/login + 显示密码错误 | 未调 fetch + 错误显示 | ✅ pass |
| TC-F05 | 密码 < 8 字符阻止提交 | password="short1" | 不调 /api/login + 提示含"8" | 未调 fetch + 提示含 8 | ✅ pass |
| TC-F06 | 密码 > 64 字符阻止提交 | password="a"×65 | 不调 /api/login + 显示错误 | 未调 fetch + 错误显示 | ✅ pass |
| TC-F07 | 登录成功展示已登录视图 | 填合法凭据提交 | logged-in-view 可见 + email 展示 | 视图切换 + email 正确 | ✅ pass |
| TC-F08 | 登录中 loading 态 | 提交后立即检查按钮 | disabled + 文案含"登录中" | disabled + "登录中…" | ✅ pass |
| TC-F09 | 401 显示"邮箱或密码错误" | mock /api/login 返回 401 | alert 显示"邮箱或密码错误" | 文案正确 | ✅ pass |
| TC-F10 | 429 显示限流提示 | mock /api/login 返回 429 | alert 显示限流文案 | 文案正确 | ✅ pass |
| TC-F11 | 退出后回到登录视图 | 初始已登录 → 点击退出 | login-view 可见 + logged-in 隐藏 | 视图正确切换 | ✅ pass |
| TC-F12 | 勾选记住我传 true | rememberMe checked | body.rememberMe === true | true | ✅ pass |
| TC-F13 | 不勾选记住我传 false | rememberMe unchecked | body.rememberMe === false | false | ✅ pass |
| TC-F14 | 密码恰好 8 字符通过校验 | password="12345678" | 调 /api/login + 无密码错误 | 调 fetch + 无错误 | ✅ pass |
| TC-F15 | 密码恰好 64 字符通过校验 | password="a"×64 | 调 /api/login + 无密码错误 | 调 fetch + 无错误 | ✅ pass |

---

## 3. 失败用例

无。所有 47 个测试用例全部通过。

---

## 4. 覆盖率

### 4.1 验收标准覆盖（PRD §3 逐项对照）

| PRD 验收标准 | 测试用例 | 状态 |
|---|---|---|
| 登录页展示邮箱、密码输入框、记住我复选框、登录按钮 | TC-F03, TC-F07（隐式：DOM 元素存在） | ✅ |
| 有效邮箱+正确密码登录成功，建立会话 | TC-01, TC-02, TC-03, TC-F03, TC-F07 | ✅ |
| 错误密码返回"邮箱或密码错误" | TC-07, TC-F09 | ✅ |
| 不存在邮箱返回"邮箱或密码错误"（防枚举） | TC-08, TC-09 | ✅ |
| 邮箱为空/格式非法前端阻止提交 | TC-F01, TC-F02 | ✅ |
| 密码为空前端阻止提交 | TC-F04 | ✅ |
| 密码长度非 8-64 前端阻止提交 | TC-F05, TC-F06 | ✅ |
| 记住我勾选=30天长会话 | TC-17, TC-F12 | ✅ |
| 记住我不勾选=浏览器会话级 | TC-18, TC-19, TC-F13 | ✅ |
| GET /api/me 已登录返回用户信息 | TC-05 | ✅ |
| GET /api/me 未登录返回 401 | TC-04, TC-06 | ✅ |
| 登录成功后展示"已登录：\<email\>"+退出按钮 | TC-F07, TC-F11 | ✅ |
| 退出登录后 /api/me 返回 401 | TC-20, TC-27 | ✅ |
| 连续 5 次密码错误后限流 1 分钟（429） | TC-23, TC-24, TC-25, TC-26 | ✅ |

### 4.2 后端模块覆盖

| 模块 | 文件 | 测试覆盖 |
|---|---|---|
| 登录路由 | src/routes/login.js | ✅ 全面（200/400/401/429 + 校验 + cookie） |
| Me 路由 | src/routes/me.js | ✅ 全面（200/401 + 无效 sid） |
| Logout 路由 | src/routes/logout.js | ✅ 全面（200 幂等 + cookie 清除 + 会话销毁） |
| 用户存储 | src/lib/userStore.js | ✅ 隐式（通过集成测试覆盖 findByEmail） |
| Session 存储 | src/lib/sessionStore.js | ✅ 隐式（通过集成测试覆盖 get/set/destroy） |
| 认证逻辑 | src/lib/auth.js | ✅ 隐式（verifyPassword + createSession + destroySession） |
| 限流中间件 | src/middleware/rateLimit.js | ✅ 全面（5次触发 + 隔离 + 重置 + 防探测） |

### 4.3 前端模块覆盖

| 功能 | 文件 | 测试覆盖 |
|---|---|---|
| 表单校验 | src/app.js (validateEmail/validatePassword) | ✅ 全面（空/非法/边界） |
| 视图切换 | src/app.js (showLoginView/showLoggedInView) | ✅ 全面（登录成功/退出） |
| 错误处理 | src/app.js (showAlert) | ✅ 全面（401/429） |
| Loading 态 | src/app.js (setLoading) | ✅ 已覆盖 |
| 记住我传参 | src/app.js (login) | ✅ 全面（true/false） |

---

## 5. 结论

- [x] 所有验收标准通过（PRD §3 共 14 项，全部覆盖并通过）
- [x] 无 P0 / P1 bug（0 fail）
- [x] 后端集成测试 32 pass / 0 fail
- [x] 前端单元测试 15 pass / 0 fail
- [x] 测试覆盖后端全部 3 个 API 端点 + 全部中间件/存储模块
- [x] 测试覆盖前端表单校验、错误处理、视图切换、loading 态、记住我传参

**建议发布。**
