import fs from "node:fs";
import path from "node:path";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Copy .env.example to .env and set it.`);
    process.exit(1);
  }
  return value;
}

const secretKey = required("SECRET_KEY");
if (secretKey.length < 32) {
  console.error("SECRET_KEY must be at least 32 characters.");
  process.exit(1);
}

export const config = {
  adminPassword: required("ADMIN_PASSWORD"),
  secretKey,
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT) || 3000,
  dataDir: path.resolve(process.env.DATA_DIR || "./data"),
  // Set when the dashboard is served over HTTPS (behind a proxy), so cookies get the Secure flag.
  secureCookies: process.env.SECURE_COOKIES === "true",
};
