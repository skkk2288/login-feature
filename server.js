const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

// TODO: persona 实现 /api/login + /api/me

app.listen(PORT, () => {
  console.log(`server listening on ${PORT}`);
});
