const { Pool } = require("pg");

const ssl = String(process.env.DATABASE_SSL).toLowerCase() === "true"
  ? { rejectUnauthorized: false }
  : false;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", (err) => console.error("PostgreSQL pool error:", err.message));

module.exports = { pool };
