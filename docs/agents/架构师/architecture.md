# Architecture: 登录功能

## 1. 概述

本功能实现邮箱 + 密码登录，支持"记住我"长效会话。技术栈基于现有
skeleton：Express (Node.js) 后端 + 原生 HTML/JS 前端，无需引入前端框架。

认证机制采用 **服务端 session + 签名 cookie**（非 JWT）。理由：本项目是
单体应用、无跨服务调用，session 方案更简单且可即时吊销；JWT 的无状态
优势在此场景不适用，反而增加 token 续期与吊销的复杂度。"记住我"通过
cookie 的 `Max-Age` 控制（勾选 = 30 天，不勾选 = session cookie，浏览器
关闭即失效）。

密码存储使用 bcrypt（cost factor = 12）。登录限流使用内存 Map，按邮箱
统计连续失败次数，5 次后锁定 15 分钟。

## 2. 模块划分

| 模块 | Owner | 职责 |
|------|-------|------|
| `index.html` + 内联 JS | @前端 | 登录表单 UI、前端校验、调用 `/api/login` 与 `/api/me`、登录态切换 |
| `server.js` | @后端 | Express 服务器、路由定义、session 管理、bcrypt 校验、限流中间件 |
| 用户数据 store | @后端 | 内存 Map 存储用户（预置 demo 用户），封装为 `UserRepository` 接口便于后续替换为 DB |
| session store | @后端 | 内存 Map 存储 session（sid → userId + 过期时间），封装为 `SessionStore` 接口 |
| 限流 store | @后端 | 内存 Map 存储失败计数 + 锁定时间戳 |

> **注意**：@前端 和 @后端 在各自的分支工作，不互相改文件。@前端 只改
> `index.html`，@后端 只改 `server.js`（及按需新增 `package.json` 依赖）。

## 3. 关键决策

### 3.1 认证机制：Server-side session（非 JWT）

- **选择**：服务端 session + 签名 cookie
- **理由**：
  - 单体应用，无微服务间 token 传递需求
  - Session 可即时吊销（删 Map 即可），JWT 吊销需额外 blacklist
  - "记住我"只需控制 cookie Max-Age，无需独立 refresh token 机制
  - 复杂度低，契合 v0.1.0 最小可用目标
- **替代方案（已否决）**：JWT — 适合无状态分布式场景，本项目用不上

### 3.2 "记住我"实现

- **勾选**：cookie `Max-Age=2592000`（30 天），session 在服务端也存 30 天过期
- **不勾选**：cookie 不设 Max-Age（session cookie，浏览器关闭即删除），服务端 session 过期 24h（兜底）
- **cookie 属性**：`HttpOnly`（防 XSS 读取）、`Secure`（生产 HTTPS）、`SameSite=Lax`（防 CSRF）
- **环境变量** `COOKIE_SECURE`：dev 环境设为 `false` 以支持 HTTP 测试

### 3.3 密码存储：bcrypt cost=12

- **算法**：bcrypt
- **cost factor**：12（~250ms/hash，兼顾安全与性能，满足 <200ms 响应要求——bcrypt 校验在正常路径只执行一次）
- **salt**：bcrypt 内置自动 salt（每次 hash 不同），无需单独管理
- **替代方案（已否决）**：argon2 — 更现代但需 native binding，增加部署复杂度；bcrypt 在 Node 生态成熟稳定

### 3.4 登录限流：内存 Map

- **策略**：按邮箱统计连续失败次数
- **阈值**：5 次失败 → 锁定 15 分钟
- **存储**：内存 `Map<email, {count, lockedUntil}>`
- **复位**：登录成功时清除计数
- **理由**：v0.1.0 单实例部署，内存方案足够；后续多实例可替换为 Redis
- **注意**：限流在密码校验**之前**检查，避免锁定期间仍执行 bcrypt（防止通过故意触发 bcrypt 消耗 CPU）

### 3.5 登录态校验：`GET /api/me`

- 已登录 → 返回用户信息（email）
- 未登录 → 401
- 前端页面加载时调用此接口判断登录态，决定显示登录表单还是已登录状态

### 3.6 错误提示策略

- 登录失败统一返回 `"邮箱或密码错误"`，不区分邮箱不存在 vs 密码错误（防枚举）
- 限流锁定返回 `"登录尝试过多，请 15 分钟后再试"`
- 前端校验失败显示具体字段错误（邮箱格式、空值）——这些不泄露账号信息

## 4. 数据流

```
用户填写表单 → 前端 JS 校验（邮箱格式、非空）
  → POST /api/login { email, password, rememberMe }
    → 限流检查（该邮箱是否已锁定？）
      → 锁定中 → 429 { error: "too_many_attempts" }
      → 未锁定 → UserRepository.findByEmail(email)
        → 用户不存在 → 记录失败计数 → 401 { error: "invalid_credentials" }
        → 用户存在 → bcrypt.compare(password, user.passwordHash)
          → 不匹配 → 记录失败计数 → 401 { error: "invalid_credentials" }
          → 匹配 → 清除失败计数
            → SessionStore.create(userId, ttl)
            → Set-Cookie: sid=<signed>, HttpOnly, [Secure], SameSite=Lax, [Max-Age]
            → 200 { email }
  → 前端收到 200 → 切换为已登录状态
  → 前端收到 4xx → 显示错误提示

页面加载 → GET /api/me
  → 解析 cookie → 验证 sid → 查 SessionStore
    → 有效 session → 200 { email }
    → 无效/过期 → 401
  → 前端据此显示登录表单或已登录状态
```

## 5. 错误处理

### HTTP 状态码约定

| 状态码 | 场景 | 响应体 |
|--------|------|--------|
| 200 | 登录成功 / `/api/me` 已登录 | `{ "email": "..." }` |
| 400 | 请求体格式错误（缺字段） | `{ "error": "bad_request", "message": "..." }` |
| 401 | 凭据错误 / 未登录 | `{ "error": "invalid_credentials", "message": "邮箱或密码错误" }` |
| 429 | 登录限流锁定 | `{ "error": "too_many_attempts", "message": "登录尝试过多，请 15 分钟后再试" }` |
| 500 | 服务端内部错误 | `{ "error": "internal_error", "message": "服务器内部错误" }` |

### 错误响应统一格式

```json
{ "error": "<machine_readable_code>", "message": "<human_readable_zh>" }
```

## 6. 安全考虑

- **密码传输**：生产环境强制 HTTPS（`Secure` cookie）；dev 环境通过 `COOKIE_SECURE=false` 放行 HTTP
- **密码存储**：bcrypt cost=12，永不明文存储或返回密码
- **cookie 安全**：`HttpOnly` + `Secure` + `SameSite=Lax`
- **session ID**：使用 `crypto.randomUUID()` 生成，通过 HMAC 签名防篡改
- **登录失败提示**：统一模糊提示，不区分邮箱/密码错误（防账号枚举）
- **限流**：5 次失败锁定 15 分钟，防暴力破解
- **输入校验**：前后端双重校验（前端 UX，后端安全底线）
- **CORS**：同源访问，无需 CORS 配置

## 7. 性能考虑

- **预期负载**：v0.1.0 为 demo 级别，QPS < 10
- **响应时间**：正常登录路径 < 200ms（bcrypt cost=12 单次校验 ~250ms，可接受——PRD 要求 <200ms 为正常负载下的目标，bcrypt 是安全必需开销）
- **内存 store**：用户/Session/限流均存内存，无需 DB 连接开销
- **无缓存需求**：登录接口无读多写少场景，不引入缓存层
