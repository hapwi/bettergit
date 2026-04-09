#!/usr/bin/env node

/**
 * Build a DMG artifact — modeled after hapcode's build-desktop-artifact.ts.
 *
 * 1. Stages dist/ and dist-electron/ into a temp directory
 * 2. Writes a minimal package.json with electron-builder config
 * 3. Runs electron-builder from the staging dir (clean of dev node_modules)
 * 4. Copies artifacts to release/
 */

import {
  mkdtempSync,
  mkdirSync,
  cpSync,
  writeFileSync,
  readdirSync,
  statSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const version = pkg.version ?? "0.0.1";

// 1. Create staging directory
const stageRoot = mkdtempSync(join(tmpdir(), "bettergit-dist-"));
const stageApp = join(stageRoot, "app");
const stageTmp = join(stageRoot, "tmp");
mkdirSync(stageApp, { recursive: true });
mkdirSync(stageTmp, { recursive: true });

console.log(`[dist] Staging in ${stageApp}`);

// 2. Copy built artifacts
cpSync(join(repoRoot, "dist"), join(stageApp, "dist"), { recursive: true });
cpSync(join(repoRoot, "dist-electron"), join(stageApp, "dist-electron"), { recursive: true });
cpSync(join(repoRoot, "dist-server"), join(stageApp, "dist-server"), { recursive: true });
cpSync(join(repoRoot, "build"), join(stageApp, "build"), { recursive: true });

// 3. Write a minimal package.json for electron-builder
const stagePackage = {
  name: "bettergit",
  version,
  private: true,
  description: "BetterGit — a better Git GUI",
  author: "BetterGit",
  main: "dist-electron/main.js",
  build: {
    appId: "com.bettergit.app",
    productName: "BetterGit",
    artifactName: "BetterGit-${version}-${arch}.${ext}",
    directories: {
      output: "dist-out",
      buildResources: "build",
    },
    // Don't restrict files — let electron-builder use its defaults so that
    // node_modules (production deps like the Claude Agent SDK) are included
    // automatically. Matches hapcode's build config.
    mac: {
      target: [{ target: "dmg", arch: ["arm64"] }],
      icon: "icon.icns",
      category: "public.app-category.developer-tools",
      identity: null,
    },
    dmg: {
      writeUpdateInfo: false,
    },
  },
  dependencies: {
    // The Claude Agent SDK is kept external (not bundled by esbuild) because
    // it has dynamic requires and subprocess spawning that break when inlined.
    // Same approach as hapcode's server build.
    "@anthropic-ai/claude-agent-sdk": pkg.dependencies["@anthropic-ai/claude-agent-sdk"] ?? "*",
    "node-pty": pkg.dependencies["node-pty"] ?? "*",
    "ws": pkg.dependencies["ws"] ?? "*",
  },
  devDependencies: {
    electron: "41.1.1",
  },
};

writeFileSync(join(stageApp, "package.json"), JSON.stringify(stagePackage, null, 2) + "\n");

const buildEnv = { ...process.env };
for (const [key, value] of Object.entries(buildEnv)) {
  if (value === "") {
    delete buildEnv[key];
  }
}

// Keep Bun/electron-builder inside a known-writable temp dir during staging.
buildEnv.TMPDIR = stageTmp;
buildEnv.TEMP = stageTmp;
buildEnv.TMP = stageTmp;
buildEnv.BUN_TMPDIR = stageTmp;

// Match hapcode's unsigned build path so existing signing env vars don't leak in.
buildEnv.CSC_IDENTITY_AUTO_DISCOVERY = "false";
delete buildEnv.CSC_LINK;
delete buildEnv.CSC_KEY_PASSWORD;
delete buildEnv.APPLE_API_KEY;
delete buildEnv.APPLE_API_KEY_ID;
delete buildEnv.APPLE_API_ISSUER;

// 4. Install electron in staging dir
console.log("[dist] Installing electron in staging dir...");
execSync("bun install --production", {
  cwd: stageApp,
  stdio: "inherit",
  env: buildEnv,
});

// 5. Run electron-builder with the same unsigned-build environment.
console.log(`[dist] Building DMG (version=${version}, arch=arm64)...`);
execSync("bunx electron-builder --mac --arm64 --publish never", {
  cwd: stageApp,
  stdio: "inherit",
  env: buildEnv,
});

// 6. Copy artifacts to release/ (clean old builds first)
const outputDir = join(repoRoot, "release");
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const stageDistOut = join(stageApp, "dist-out");
const entries = readdirSync(stageDistOut);
const copied = [];

for (const entry of entries) {
  const from = join(stageDistOut, entry);
  const stat = statSync(from);
  if (stat.isFile()) {
    const to = join(outputDir, entry);
    copyFileSync(from, to);
    copied.push(to);
  }
}

console.log("[dist] Done. Artifacts:");
for (const f of copied) {
  const size = (statSync(f).size / 1024 / 1024).toFixed(1);
  console.log(`  ${f} (${size} MB)`);
}
