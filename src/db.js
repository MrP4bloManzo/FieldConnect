const { Pool } = require("pg");
const { databaseSchema } = require("./database-schema");

const ssl = String(process.env.DATABASE_SSL).toLowerCase() === "true"
  ? { rejectUnauthorized: true, ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT.replace(/\\n/g, "\n") } : {}) }
  : false;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl,
  options: `-c search_path=${databaseSchema()}`,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

pool.on("error", (err) => console.error("PostgreSQL pool error:", err.message));

module.exports = { pool };
