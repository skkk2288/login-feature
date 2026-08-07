# 产物索引

本文件是 append-only 的产物清单。agent 完成产出时 append 一行：

```
| <date> | <role> | <file> | <brief> |
```

例：

```
| 2026-08-05 | 需求编写 | docs/agents/需求编写/prd-draft.md | 登录功能 PRD 初稿 |
| 2026-08-05 | 架构师 | docs/agents/架构师/architecture.md | 登录功能架构设计 |
| 2026-08-06 | 前端 | src/components/Login.tsx | 登录表单组件 |
```

不要删除历史行（即使产物文件被删，索引保留作为审计记录）。

---

| date | role | file | brief |
|------|------|------|-------|
| 2026-08-07 | 后端 | src/app.js | Express 装配（cookie-parser + 路由挂载） |
| 2026-08-07 | 后端 | server.js | 入口改为 require(./src/app.js) |
| 2026-08-07 | 后端 | src/routes/auth.js | POST /api/login、POST /api/logout、GET /api/me |
| 2026-08-07 | 后端 | src/auth/session.js | SessionRepository（内存Map + HMAC签名 + 惰性过期） |
| 2026-08-07 | 后端 | src/auth/password.js | bcrypt 哈希/校验（cost=12） |
| 2026-08-07 | 后端 | src/auth/rateLimit.js | 邮箱维度限流（5次失败锁定15分钟，防枚举） |
| 2026-08-07 | 后端 | src/store/users.js | UserRepository（内存Map双索引）+ 种子用户 |
| 2026-08-07 | 后端 | src/middleware/auth.js | 认证中间件（cookie->session->req.user） |
| 2026-08-07 | 后端 | package.json | 新增依赖 bcryptjs、cookie-parser |
| 2026-08-07 | QA | tests/auth_integration.test.js | 登录功能集成测试（36 cases） |
| 2026-08-07 | QA | docs/agents/QA/test-report.md | 登录功能测试报告 |
