"use strict";

/**
 * 入口文件
 * 装配 app 并启动 HTTP 服务
 */

const app = require("./src/app");
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`server listening on ${PORT}`);
});
