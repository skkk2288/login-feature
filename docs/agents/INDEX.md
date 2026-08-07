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
| 2026-08-07 | 前端 | index.html | 登录卡片 UI（邮箱/密码/记住我/登录按钮/错误提示/已登录态） |
| 2026-08-07 | 前端 | src/app.js | 前端逻辑：表单校验 + fetch /api/login、/api/me、/api/logout |
| 2026-08-07 | 后端 | server.js | 组装中间件 + /api 路由 |
| 2026-08-07 | 后端 | src/lib/userStore.js | 内存用户存储 + 预置测试用户 |
| 2026-08-07 | 后端 | src/lib/sessionStore.js | 内存 session 存储 |
| 2026-08-07 | 后端 | src/lib/auth.js | bcrypt 校验 + session 管理 |
| 2026-08-07 | 后端 | src/middleware/rateLimit.js | 按邮箱登录限流 5次/分钟 |
| 2026-08-07 | 后端 | src/routes/login.js | POST /api/login 路由 |
| 2026-08-07 | 后端 | src/routes/me.js | GET /api/me 路由 |
| 2026-08-07 | 后端 | src/routes/logout.js | POST /api/logout 路由 |
