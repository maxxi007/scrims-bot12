const express = require("express");
const server = express();

server.all("/", (req, res) => {
  res.send("Bot is alive!");
});

function keepAlive() {
  const port = process.env.PORT || 3000; // important for Render
  server.listen(port, () => {
    console.log(`🌐 Keep-alive server running on port ${port}`);
  });
}

module.exports = keepAlive;
