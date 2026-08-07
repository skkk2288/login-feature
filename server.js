const express = require("express");
const cookieParser = require("cookie-parser");

const loginRouter = require("./src/routes/login");
const meRouter = require("./src/routes/me");
const logoutRouter = require("./src/routes/logout");

const app = express();
const PORT = process.env.PORT || 3000;

// ---- 中间件 ----
app.use(express.json());
app.use(cookieParser());
app.use(express.static(__dirname));

// ---- /api 路由 ----
app.use("/api/login", loginRouter);
app.use("/api/me", meRouter);
app.use("/api/logout", logoutRouter);

app.listen(PORT, () => {
  console.log(`server listening on ${PORT}`);
});
