#!/usr/bin/env node

/**
 * Build a DMG artifact — modeled after hapcode's build-desktop-artifact.ts.
 *
 * 1. Stages dist/ and dist-electron/ into a temp directory
 * 2. Writes a minimal package.json with electron-builder config
 * 3. Runs electron-builder from the staging dir (clean of dev node_modules)
 * 4. Copies artifacts to release/
 */

import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readdirSync, statSync, copyFileSync } from "node:fs";
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
mkdirSync(stageApp, { recursive: true });

console.log(`[dist] Staging in ${stageApp}`);

// 2. Copy built artifacts
cpSync(join(repoRoot, "dist"), join(stageApp, "dist"), { recursive: true });
cpSync(join(repoRoot, "dist-electron"), join(stageApp, "dist-electron"), { recursive: true });
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
    files: ["dist/**/*", "dist-electron/**/*", "package.json"],
    mac: {
      target: [{ target: "dmg", arch: ["arm64"] }],
      icon: "icon.icns",
      category: "public.app-category.developer-tools",
    },
    dmg: {
      writeUpdateInfo: false,
    },
  },
  dependencies: {},
  devDependencies: {
    electron: "41.1.1",
  },
};

writeFileSync(join(stageApp, "package.json"), JSON.stringify(stagePackage, null, 2) + "\n");

// 4. Install electron in staging dir
console.log("[dist] Installing electron in staging dir...");
execSync("bun install --production", { cwd: stageApp, stdio: "inherit" });

// 5. Run electron-builder with signing disabled (like hapcode does for unsigned builds)
console.log(`[dist] Building DMG (version=${version}, arch=arm64)...`);
const buildEnv = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" };
execSync("bunx electron-builder --mac --arm64 --publish never", {
  cwd: stageApp,
  stdio: "inherit",
  env: buildEnv,
});

// 6. Copy artifacts to release/
const outputDir = join(repoRoot, "release");
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
