require("dotenv").config();
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { pool } = require("./db");

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password && !password.startsWith("ChangeMe") && password.length >= 12) {
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      "INSERT INTO users(name,email,password_hash,role) VALUES($1,LOWER($2),$3,'admin') ON CONFLICT(email) DO NOTHING",
      [process.env.SEED_ADMIN_NAME || "Administrador", email, hash]
    );
    console.log("Usuario administrador verificado: " + email);
  } else {
    console.log("Esquema listo. Configura SEED_ADMIN_PASSWORD (12+ caracteres) para crear el administrador inicial.");
  }
  await pool.end();
}

main().catch(async (err) => {
  console.error("No se pudo inicializar la base de datos:", err.message);
  await pool.end();
  process.exit(1);
});
