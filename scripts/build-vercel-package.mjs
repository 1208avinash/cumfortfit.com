import { cpSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { generateConfig, validateSupabaseConfig } from "./generate-vercel-config.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");
const defaultOutputDirectory = resolve(projectRoot, "dist");

const RUNTIME_FILES = [
  "index.html",
  "lookbook.html",
  "public-catalogue.mjs",
  "studio-preview-messaging.mjs",
  "admin/index.html",
  "admin/admin.js",
  "admin/admin.css",
  "admin/catalogue.mjs",
  "admin/content-management.mjs",
  "admin/homepage-editor.mjs",
  "admin/homepage-image-library.mjs",
  "admin/homepage-editor.css",
  "contact-sheet.jpg",
  "catalogue-contact-sheet.jpg",
];

export function buildStaticPackage({
  env = process.env,
  outputDirectory = defaultOutputDirectory,
  log = console.log,
} = {}) {
  const config = validateSupabaseConfig(env);
  const destination = resolve(outputDirectory);
  if (destination === projectRoot || destination === resolve(projectRoot, "..") ||
    (destination !== defaultOutputDirectory && existsSync(destination))) {
    throw new Error("Refusing to replace an unexpected Vercel output directory.");
  }

  if (destination === defaultOutputDirectory && existsSync(destination)) {
    rmSync(destination, { recursive: true, force: true });
  }
  mkdirSync(destination, { recursive: true });

  for (const relativePath of RUNTIME_FILES) {
    const sourcePath = resolve(projectRoot, relativePath);
    const outputPath = resolve(destination, relativePath);
    if (!sourcePath.startsWith(`${projectRoot}${sep}`) ||
      !outputPath.startsWith(`${destination}${sep}`)) {
      throw new Error("A static package path resolved outside its expected directory.");
    }
    mkdirSync(dirname(outputPath), { recursive: true });
    copyFileSync(sourcePath, outputPath);
  }

  cpSync(resolve(projectRoot, "assets"), resolve(destination, "assets"), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  generateConfig({
    env: { ...env, CFP_SUPABASE_URL: config.url, CFP_SUPABASE_PUBLISHABLE_KEY: config.publishableKey },
    outputPath: resolve(destination, "admin", "config.js"),
    log: () => {},
  });
  log("Built the Vercel static package in dist/.");
  return destination;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && pathToFileURL(invokedPath).href === import.meta.url) {
  try {
    buildStaticPackage();
  } catch (error) {
    console.error(`Vercel package build failed: ${error.message}`);
    process.exitCode = 1;
  }
}
