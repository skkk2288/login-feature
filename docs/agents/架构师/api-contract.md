# API Contract: 登录功能

> 前后端共同遵循的 API 契约。@前端 按 Request 格式调用，@后端 按 Response 格式返回。

## Endpoints

---

### POST /api/login

用户登录，成功后通过 `Set-Cookie` 下发 session。

**Request:**

```json
{
  "email": "user@example.com",
  "password": "secret123",
  "rememberMe": true
}
```

**Headers:**
```
Content-Type: application/json
```

**Response 200** - 登录成功：
```json
{
  "email": "user@example.com"
}
```
Headers:
```
Set-Cookie: sid=<signed-session-id>; HttpOnly; SameSite=Lax; [Secure;] [Max-Age=2592000;] Path=/
```
- `Secure`：生产环境（`COOKIE_SECURE=true`）包含，dev 环境省略
- `Max-Age=2592000`：仅当 `rememberMe=true` 时包含（30 天 = 2592000 秒）

**Response 400** - 请求体格式错误（缺字段 / 字段类型错误）：
```json
{
  "error": "bad_request",
  "message": "邮箱和密码不能为空"
}
```

**Response 401** - 凭据错误（邮箱不存在或密码不匹配）：
```json
{
  "error": "invalid_credentials",
  "message": "邮箱或密码错误"
}
```

**Response 429** - 登录限流（该邮箱连续失败 ≥ 5 次，锁定 15 分钟）：
```json
{
  "error": "too_many_attempts",
  "message": "登录尝试过多，请 15 分钟后再试"
}
```

---

### GET /api/me

查询当前登录状态。前端页面加载时调用，判断显示登录表单还是已登录状态。

**Request:**

无 request body。浏览器自动携带 cookie。

**Headers:**
```
Cookie: sid=<signed-session-id>
```

**Response 200** - 已登录：
```json
{
  "email": "user@example.com"
}
```

**Response 401** - 未登录 / session 过期 / cookie 无效：
```json
{
  "error": "not_authenticated",
  "message": "未登录"
}
```

---

### POST /api/logout

登出，清除 session。PRD 标注为"可附带实现"，建议实现以保证体验完整。

**Request:**

无 request body。浏览器自动携带 cookie。

**Headers:**
```
Cookie: sid=<signed-session-id>
```

**Response 200** - 登出成功：
```json
{
  "ok": true
}
```
Headers:
```
Set-Cookie: sid=; HttpOnly; SameSite=Lax; Max-Age=0; Path=
```

> 未登录时调用 `/api/logout` 也返回 200 + `{"ok":true}`（幂等）。

---

## 字段约定

### Request 字段

| 字段 | 类型 | 必填 | 约束 | 说明 |
|------|------|------|------|------|
| `email` | string | 是 | RFC 5322 合法格式，非空 | 用户邮箱 |
| `password` | string | 是 | 1-64 字符，非空 | 用户密码明文（传输层由 HTTPS 保护） |
| `rememberMe` | boolean | 否 | 默认 `false` | 是否记住登录状态 |

### Response 字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `email` | string | 登录成功后返回用户邮箱（`POST /api/login`、`GET /api/me`） |
| `error` | string | 机器可读错误码（snake_case） |
| `message` | string | 人类可读中文错误描述 |
| `ok` | boolean | 操作成功标记（`POST /api/logout`） |

### 错误码汇总

| error code | HTTP | 触发场景 |
|------------|------|----------|
| `bad_request` | 400 | 请求体缺字段 / 类型错误 |
| `invalid_credentials` | 401 | 邮箱不存在或密码不匹配 |
| `not_authenticated` | 401 | `/api/me`、`/api/logout` 未登录 |
| `too_many_attempts` | 429 | 连续失败 ≥ 5 次，锁定 15 分钟 |
| `internal_error` | 500 | 服务端未捕获异常 |

## Cookie 约定

| 属性 | 值 | 说明 |
|------|----|------|
| Name | `sid` | session cookie 名称 |
| Value | `<uuid>.<hmac>` | `crypto.randomUUID()` + HMAC-SHA256 签名 |
| HttpOnly | true | 防止 JS 读取（XSS 防护） |
| Secure | true/false | 生产 true（`COOKIE_SECURE=true`），dev false |
| SameSite | Lax | 防 CSRF |
| Max-Age | 2592000 / 无 | `rememberMe=true` 时 30 天，否则省略（session cookie） |
| Path | / | 全站有效 |

### Cookie 签名验证

服务端收到 cookie 后：
1. 按 `.` 分割为 `sid` 和 `signature`
2. 用 `SESSION_SECRET` 环境变量对 `sid` 做 HMAC-SHA256，与 `signature` 比对
3. 签名不匹配 -> 视为未登录（401），不报错

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3000 | 服务器端口 |
| `SESSION_SECRET` | - | cookie 签名密钥，**必须设置**（@后端 代码中给定 fallback dev 默认值 + 启动时 warn） |
| `COOKIE_SECURE` | `true` | 是否设置 cookie `Secure` 属性；dev 设为 `false` |
| `SESSION_TTL_REMEMBER` | 2592000 | 记住我 session TTL（秒，默认 30 天） |
| `SESSION_TTL_SESSION` | 86400 | 普通 session TTL（秒，默认 24h，兜底防永久 session） |
| `RATE_LIMIT_MAX_FAILURES` | 5 | 限流阈值 |
| `RATE_LIMIT_LOCK_MINUTES` | 15 | 锁定时长（分钟） |

## Demo 用户

v0.1.0 无注册功能，后端预置 demo 用户供测试：

| email | password | 说明 |
|-------|----------|------|
| `demo@example.com` | `password123` | 测试用户 |

> @后端 在 `UserRepository` 初始化时预置此用户（bcrypt hash），@QA 测试用此账号。
