"use strict";

const express = require("express");
const cookieParser = require("cookie-parser");

const authRoutes = require("./routes/auth");

/**
 * Express app 装配
 * 设计参考：docs/agents/架构师/architecture.md §2（模块划分）
 *
 * 中间件顺序：
 * 1. express.json() - 解析 JSON body
 * 2. cookieParser() - 解析 cookie（session 校验依赖）
 * 3. express.static() - 静态文件（前端 HTML/JS/CSS）
 * 4. 路由挂载
 */

function createApp() {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());
  app.use(express.static(__dirname + "/.."));

  // API 路由
  app.use("/api", authRoutes);

  // 全局错误处理
  app.use((err, req, res, _next) => {
    console.error("Unhandled error:", err);
    res.status(500).json({
      error: "internal_error",
      message: "服务器内部错误",
    });
  });

  return app;
}

module.exports = createApp();
