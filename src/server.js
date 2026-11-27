require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const path = require("path");
const { pool } = require("./db");

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error("JWT_SECRET debe tener al menos 32 caracteres.");
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

require("./api")(app, { pool, jwt, bcrypt, analytics:require("./analytics"), jwtSecret:process.env.JWT_SECRET, randomUUID:require("crypto").randomUUID });

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log("FieldConnect Group escuchando en el puerto " + port));
}
module.exports = app;
