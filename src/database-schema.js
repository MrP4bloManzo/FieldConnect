const fs = require("fs");
const path = require("path");

function databaseSchema() {
  const schema = process.env.DATABASE_SCHEMA || "public";
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error("DATABASE_SCHEMA debe ser un identificador PostgreSQL en minúsculas.");
  return schema;
}

function schemaBundle(schema = databaseSchema()) {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error("Esquema inválido.");
  const base = fs.readFileSync(path.join(__dirname,"schema.sql"),"utf8");
  const migration = fs.readFileSync(path.join(__dirname,"migration-v2.sql"),"utf8")
    .replace("SET search_path=public", `SET search_path="${schema}"`);
  const web = fs.readFileSync(path.join(__dirname,"migration-web.sql"),"utf8");
  return `BEGIN;\nCREATE SCHEMA IF NOT EXISTS "${schema}";\nSET LOCAL search_path TO "${schema}";\n${base}\n${migration}\n${web}\nCOMMIT;`;
}

module.exports = { databaseSchema, schemaBundle };
