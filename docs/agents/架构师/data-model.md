# Data Model: 登录功能

> v0.1.0 使用内存存储（Map）。以下模型定义数据结构 + 接口约定，后续可替换为 DB 实现。

## 概述

三组内存数据结构，各自封装为接口（`UserRepository` / `SessionStore` /
`RateLimitStore`），便于后续从内存 Map 替换为 Redis / DB 而不影响业务逻辑。

---

## 1. User

### 结构

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `id` | string (UUID) | PK, not null | 用户唯一 ID |
| `email` | string | unique, not null | 登录邮箱（小写存储） |
| `passwordHash` | string | not null | bcrypt hash（cost=12，含内嵌 salt） |
| `createdAt` | number (Unix ms) | not null | 创建时间 |

### UserRepository 接口

```js
interface UserRepository {
  findByEmail(email: string): User | null;  // email 大小写不敏感（内部 toLowerCase）
}
```

### 预置数据

```js
// 初始化时预置 demo 用户
{
  id: "<uuid>",
  email: "demo@example.com",
  passwordHash: bcrypt.hashSync("password123", 12),  // 启动时计算一次
  createdAt: Date.now()
}
```

### 存储

- `Map<email_lowercased, User>` - 内存 Map
- 索引：email（unique），按 email 直接 O(1) 查找

---

## 2. Session

### 结构

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `sid` | string (UUID) | PK, not null | session ID（`crypto.randomUUID()`） |
| `userId` | string | not null, FK->User.id | 关联用户 |
| `email` | string | not null | 冗余存储，避免每次反查 User |
| `expiresAt` | number (Unix ms) | not null | 过期时间戳 |
| `createdAt` | number (Unix ms) | not null | 创建时间 |

### SessionStore 接口

```js
interface SessionStore {
  create(userId: string, email: string, ttlSeconds: number): Session;  // 返回含 sid
  findBySid(sid: string): Session | null;   // 已过期返回 null 并删除
  delete(sid: string): void;
}
```

### 存储

- `Map<sid, Session>` - 内存 Map
- 过期策略：懒删除（`findBySid` 时检查 `expiresAt`，过期则 delete + return null）
- TTL：
  - `rememberMe=true` -> 30 天（`SESSION_TTL_REMEMBER`）
  - `rememberMe=false` -> 24h（`SESSION_TTL_SESSION`，兜底；浏览器关闭时 cookie 被删，服务端 session 自然过期）

### Cookie 中的 sid

cookie value = `<sid>.<hmac(sid, SESSION_SECRET)>`

服务端验证流程：
1. 分割 cookie -> `sid`, `signature`
2. `hmac = HMAC-SHA256(sid, SESSION_SECRET)`
3. `hmac === signature` ? `SessionStore.findBySid(sid)` : null

---

## 3. RateLimitEntry

### 结构

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| `email` | string (lowercased) | PK, not null | 限流键（按邮箱） |
| `failCount` | number | not null, ≥ 0 | 连续失败次数 |
| `lockedUntil` | number (Unix ms) \| null | nullable | 锁定截止时间戳，null 表示未锁定 |
| `lastFailureAt` | number (Unix ms) | not null | 最近一次失败时间 |

### RateLimitStore 接口

```js
interface RateLimitStore {
  // 检查是否锁定，返回 { locked: boolean, retryAfterMs?: number }
  check(email: string): { locked: boolean; retryAfterMs?: number };

  // 记录一次失败，返回更新后状态（含是否刚触发锁定）
  recordFailure(email: string): { locked: boolean; retryAfterMs?: number };

  // 登录成功时清除计数
  reset(email: string): void;
}
```

### 限流逻辑

```
check(email):
  entry = map.get(email)
  if entry.lockedUntil && entry.lockedUntil > now:
    return { locked: true, retryAfterMs: entry.lockedUntil - now }
  return { locked: false }

recordFailure(email):
  entry = map.get(email) || { failCount: 0, lockedUntil: null }
  entry.failCount += 1
  entry.lastFailureAt = now
  if entry.failCount >= 5:                        // RATE_LIMIT_MAX_FAILURES
    entry.lockedUntil = now + 15 * 60 * 1000      // RATE_LIMIT_LOCK_MINUTES
    entry.failCount = 0                            // 锁定后重置计数
  map.set(email, entry)
  return { locked: !!entry.lockedUntil, retryAfterMs: ... }

reset(email):
  map.delete(email)
```

### 存储

- `Map<email_lowercased, RateLimitEntry>` - 内存 Map
- 锁定过期后：下次 `check` 返回未锁定，下次 `recordFailure` 从 0 开始计数
- 注意：锁定到期不自动清除 entry（懒清理），但 `failCount` 已在锁定时重置为 0

---

## 索引汇总

| Store | 主键 | 查询方式 | 复杂度 |
|-------|------|----------|--------|
| UserRepository | `email` (lowercased) | `findByEmail` | O(1) Map.get |
| SessionStore | `sid` (UUID) | `findBySid` | O(1) Map.get |
| RateLimitStore | `email` (lowercased) | `check` / `recordFailure` / `reset` | O(1) Map.get/set |

## 数据生命周期

| 数据 | 创建 | 删除 | 备注 |
|------|------|------|------|
| User | 启动时预置 | 永不（demo） | 后续支持注册时由注册流程创建 |
| Session | 登录成功 | 过期懒删 / logout 主动删 | - |
| RateLimitEntry | 首次失败 | 登录成功 reset / 锁定过期后下次失败重建 | Map 不主动清理过期 entry（demo 级别无内存压力） |
