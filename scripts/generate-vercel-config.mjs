import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const APPROVED_STAGING_URL = "https://dkcjzisqufqgjtrgstch.supabase.co";
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");

function isServiceRoleKey(key) {
  if (key.startsWith("sb_secret_")) return true;
  if (/(^|[^a-z])service[_-]?role([^a-z]|$)/i.test(key)) return true;
  const segments = key.split(".");
  if (segments.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

export function validateSupabaseConfig(env = process.env) {
  const rawUrl = env.CFP_SUPABASE_URL;
  const publishableKey = env.CFP_SUPABASE_PUBLISHABLE_KEY;
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("Missing required environment variable CFP_SUPABASE_URL.");
  }
  if (typeof publishableKey !== "string" || !publishableKey.trim()) {
    throw new Error("Missing required environment variable CFP_SUPABASE_PUBLISHABLE_KEY.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl.trim());
  } catch {
    throw new Error("CFP_SUPABASE_URL must be a valid HTTPS project URL.");
  }
  if (parsedUrl.protocol !== "https:" || !parsedUrl.hostname ||
    parsedUrl.username || parsedUrl.password || parsedUrl.pathname !== "/" ||
    parsedUrl.search || parsedUrl.hash) {
    throw new Error("CFP_SUPABASE_URL must be an HTTPS project origin without credentials, path, query, or fragment.");
  }

  const url = parsedUrl.origin;
  const key = publishableKey.trim();
  if (/\s/.test(key) || isServiceRoleKey(key)) {
    throw new Error("CFP_SUPABASE_PUBLISHABLE_KEY must be a publishable key, not a service-role key.");
  }

  const vercelEnvironment = env.VERCEL_ENV;
  if (vercelEnvironment === "production" && url === APPROVED_STAGING_URL) {
    throw new Error("Production builds must use the separate production Supabase project.");
  }
  if (vercelEnvironment === "preview" && url !== APPROVED_STAGING_URL) {
    throw new Error("Preview builds must use the approved staging Supabase project.");
  }

  return { url, publishableKey: key };
}

export function generateConfig({
  env = process.env,
  outputPath = resolve(projectRoot, "dist", "admin", "config.js"),
  log = console.log,
} = {}) {
  const config = validateSupabaseConfig(env);
  const source = [
    "window.CFP_SUPABASE_CONFIG = Object.freeze({",
    `  url: ${JSON.stringify(config.url)},`,
    `  publishableKey: ${JSON.stringify(config.publishableKey)}`,
    "});",
    "",
  ].join("\n");

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, source, { encoding: "utf8" });
  log("Generated admin/config.js.");
  return outputPath;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  try {
    generateConfig();
  } catch (error) {
    console.error(`Vercel config generation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
