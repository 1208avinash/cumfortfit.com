import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  APPROVED_STAGING_URL,
  generateConfig,
  validateSupabaseConfig,
} from "./generate-vercel-config.mjs";
import { buildStaticPackage } from "./build-vercel-package.mjs";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const generatorPath = fileURLToPath(new URL("./generate-vercel-config.mjs", import.meta.url));

function validEnv(overrides = {}) {
  return {
    CFP_SUPABASE_URL: "https://production-example.supabase.co",
    CFP_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_dummy-production-key",
    VERCEL_ENV: "production",
    ...overrides,
  };
}

test("missing Supabase URL and publishable key fail validation", () => {
  assert.throws(() => validateSupabaseConfig(validEnv({ CFP_SUPABASE_URL: "" })), /CFP_SUPABASE_URL/);
  assert.throws(() => validateSupabaseConfig(validEnv({ CFP_SUPABASE_PUBLISHABLE_KEY: "" })), /CFP_SUPABASE_PUBLISHABLE_KEY/);
});

test("invalid and non-HTTPS project URLs fail validation", () => {
  assert.throws(() => validateSupabaseConfig(validEnv({ CFP_SUPABASE_URL: "not a URL" })), /valid HTTPS project URL/);
  assert.throws(() => validateSupabaseConfig(validEnv({ CFP_SUPABASE_URL: "http://production-example.supabase.co" })), /HTTPS project origin/);
  assert.throws(() => validateSupabaseConfig(validEnv({ CFP_SUPABASE_URL: "https://example.supabase.co/rest/v1" })), /without credentials, path, query, or fragment/);
});

test("production rejects the approved staging endpoint", () => {
  assert.throws(() => validateSupabaseConfig(validEnv({
    CFP_SUPABASE_URL: APPROVED_STAGING_URL,
  })), /separate production Supabase project/);
});

test("Preview requires the approved staging endpoint", () => {
  const config = validateSupabaseConfig(validEnv({
    CFP_SUPABASE_URL: `${APPROVED_STAGING_URL}/`,
    CFP_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_dummy-preview-key",
    VERCEL_ENV: "preview",
  }));
  assert.deepEqual(config, {
    url: APPROVED_STAGING_URL,
    publishableKey: "sb_publishable_dummy-preview-key",
  });
  assert.throws(() => validateSupabaseConfig(validEnv({
    VERCEL_ENV: "preview",
  })), /approved staging Supabase project/);
});

test("service-role keys are rejected", () => {
  const jwtPayload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
  assert.throws(() => validateSupabaseConfig(validEnv({
    CFP_SUPABASE_PUBLISHABLE_KEY: `header.${jwtPayload}.signature`,
  })), /not a service-role key/);
  assert.throws(() => validateSupabaseConfig(validEnv({
    CFP_SUPABASE_PUBLISHABLE_KEY: "sb_secret_dummy-key",
  })), /not a service-role key/);
  assert.throws(() => validateSupabaseConfig(validEnv({
    CFP_SUPABASE_PUBLISHABLE_KEY: "service_role",
  })), /not a service-role key/);
});

test("generator writes the expected frozen config using safe JSON serialization", () => {
  const directory = mkdtempSync(join(tmpdir(), "cfp-vercel-config-"));
  const outputPath = join(directory, "admin", "config.js");
  const dummyKey = 'sb_publishable_dummy-"quoted"\\\\key';
  const messages = [];
  try {
    generateConfig({
      env: validEnv({ CFP_SUPABASE_PUBLISHABLE_KEY: dummyKey }),
      outputPath,
      log: (message) => messages.push(message),
    });
    const source = readFileSync(outputPath, "utf8");
    assert.match(source, /^window\.CFP_SUPABASE_CONFIG = Object\.freeze\(\{/);
    assert.match(source, /url: "https:\/\/production-example\.supabase\.co"/);
    assert.ok(source.includes(`publishableKey: ${JSON.stringify(dummyKey)}`));
    assert.ok(source.endsWith("});\n"));
    assert.deepEqual(messages, ["Generated admin/config.js."]);
    assert.ok(!messages.join("\n").includes(dummyKey));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("CLI failure logs do not disclose configuration values", () => {
  const secretUrl = "https://dkcjzisqufqgjtrgstch.supabase.co";
  const secretKey = "sb_publishable_dummy-never-log-this";
  const result = spawnSync(process.execPath, [generatorPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      CFP_SUPABASE_URL: secretUrl,
      CFP_SUPABASE_PUBLISHABLE_KEY: secretKey,
      VERCEL_ENV: "production",
    },
  });
  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 1);
  assert.match(output, /Production builds must use the separate production Supabase project/);
  assert.ok(!output.includes(secretUrl));
  assert.ok(!output.includes(secretKey));
});

test("generated config remains ignored and is not tracked by Git", () => {
  const ignored = execFileSync("git", ["check-ignore", "--no-index", "admin/config.js"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  assert.equal(ignored, "admin/config.js");
  assert.throws(() => execFileSync("git", ["ls-files", "--error-unmatch", "--", "admin/config.js"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }));
});

test("Vercel builds an explicit static package under dist", () => {
  const vercel = JSON.parse(readFileSync(join(repositoryRoot, "vercel.json"), "utf8"));
  assert.equal(vercel.framework, null);
  assert.equal(vercel.buildCommand, "node scripts/build-vercel-package.mjs");
  assert.equal(vercel.outputDirectory, "dist");
  assert.equal(execFileSync("git", ["check-ignore", "--no-index", "dist/"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim(), "dist/");
});

test("build packages only the static runtime and generated config", () => {
  const directory = mkdtempSync(join(tmpdir(), "cfp-vercel-package-"));
  const outputDirectory = join(directory, "dist");
  const env = {
    ...validEnv({
      CFP_SUPABASE_URL: APPROVED_STAGING_URL,
      CFP_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_dummy-preview-package-key",
      VERCEL_ENV: "preview",
    }),
  };
  const messages = [];
  try {
    buildStaticPackage({ env, outputDirectory, log: (message) => messages.push(message) });
    const requiredFiles = [
      "index.html",
      "lookbook.html",
      "public-catalogue.mjs",
      "admin/index.html",
      "admin/config.js",
      "admin/admin.js",
      "admin/admin.css",
      "admin/catalogue.mjs",
      "admin/content-management.mjs",
      "admin/homepage-editor.mjs",
      "admin/homepage-editor.css",
      "assets/custom-fit-prime-logo.png",
      "assets/hero-emerald.webp",
      "assets/custom-fit-prime-ad-draft.mp4",
      "assets/lookbook/blouse-look-22.webp",
    ];
    for (const relativePath of requiredFiles) {
      assert.ok(existsSync(join(outputDirectory, relativePath)), `missing packaged file ${relativePath}`);
    }
    for (const forbiddenPath of [
      "supabase",
      "scripts",
      ".git",
      "admin/README.md",
      "admin/config.example.js",
      "admin/catalogue.test.mjs",
      "README.md",
      ".env",
      "vercel.json",
    ]) {
      assert.equal(existsSync(join(outputDirectory, forbiddenPath)), false, `unexpected package path ${forbiddenPath}`);
    }
    for (const page of ["index.html", "lookbook.html", "admin/index.html"]) {
      const source = readFileSync(join(outputDirectory, page), "utf8");
      if (page !== "admin/index.html") {
        const configIndex = source.indexOf('<script src="admin/config.js"></script>');
        const catalogueIndex = source.indexOf('<script type="module" src="public-catalogue.mjs"></script>');
        assert.ok(configIndex >= 0 && catalogueIndex > configIndex, `${page} config must load before its catalogue module`);
      }
      for (const match of source.matchAll(/\b(src|poster|href)\s*=\s*["']([^"']+)["']/gi)) {
        const reference = match[2];
        if (/^(?:https?:|data:|mailto:|tel:|#)/i.test(reference)) continue;
        const relativeReference = reference.split(/[?#]/, 1)[0];
        const target = relativeReference.startsWith("/")
          ? resolve(outputDirectory, relativeReference.slice(1))
          : resolve(outputDirectory, dirname(page), relativeReference);
        assert.ok(existsSync(target), `${page} references missing packaged ${match[1]} ${reference}`);
      }
      for (const style of source.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
        for (const match of style[1].matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
          const reference = match[1].trim();
          if (/^(?:https?:|data:|#)/i.test(reference)) continue;
          const target = resolve(outputDirectory, dirname(page), reference.split(/[?#]/, 1)[0]);
          assert.ok(existsSync(target), `${page} references missing packaged CSS asset ${reference}`);
        }
      }
    }
    const packagedPaths = [];
    const collectPaths = (directory, prefix = "") => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const relativePath = join(prefix, entry.name);
        if (entry.isDirectory()) collectPaths(join(directory, entry.name), relativePath);
        else packagedPaths.push(relativePath);
      }
    };
    collectPaths(outputDirectory);
    assert.ok(packagedPaths.every((file) => !/\.(?:test\.(?:mjs|js)|sql|ps1|env)$/i.test(file)));
    assert.ok(!packagedPaths.some((file) => /(?:^|[\\/])README(?:\.[^\\/]*)?$/i.test(file)));
    assert.deepEqual(messages, ["Built the Vercel static package in dist/."]);
    const generatedConfig = readFileSync(join(outputDirectory, "admin/config.js"), "utf8");
    assert.match(generatedConfig, /Object\.freeze/);
    assert.ok(generatedConfig.includes(JSON.stringify(APPROVED_STAGING_URL)));
    assert.ok(generatedConfig.includes(JSON.stringify(env.CFP_SUPABASE_PUBLISHABLE_KEY)));
    assert.equal(execFileSync("git", ["check-ignore", "--no-index", "dist/admin/config.js"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim(), "dist/admin/config.js");
    assert.ok(!execFileSync("git", ["ls-files", "--", "dist/admin/config.js"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }).trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
