# Agent 产物索引

| 日期 | Agent | 路径 | 说明 |
|------|-------|------|------|
| 2026-08-07 | 需求编写 | docs/agents/需求编写/prd-draft.md | 登录功能 PRD 初稿 |
| 2026-08-07 | 架构师 | docs/agents/架构师/architecture.md | 登录功能架构设计 |
| 2026-08-07 | 架构师 | docs/agents/架构师/api-contract.md | 登录 API 契约 |
| 2026-08-07 | 架构师 | docs/agents/架构师/data-model.md | 登录数据模型 |
| 2026-08-07 | 前端 | index.html | 登录表单组件 + 认证流程（登录/登出/登录态切换） |
| 2026-08-07 | 后端 | server.js | POST /api/login + GET /api/me + POST /api/logout + UserRepository + SessionStore + RateLimitStore |
| 2026-08-07 | 后端 | package.json | 添加 bcrypt 依赖 |
| 2026-08-07 | QA | tests/auth_integration.test.js | 登录功能后端集成测试（33 用例） |
| 2026-08-07 | QA | src/app.test.js | 登录功能前端单元测试（27 用例） |
| 2026-08-07 | QA | docs/agents/QA/test-report.md | 登录功能测试报告 |
