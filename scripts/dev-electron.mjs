import { spawnSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, "..");
const APP_DISPLAY_NAME = "BetterGit (Dev)";
const APP_BUNDLE_ID = "com.bettergit.app";
const LAUNCHER_VERSION = 1;

function setPlistString(plistPath, key, value) {
  const result = spawnSync("plutil", ["-replace", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (result.status === 0) return;

  const insertResult = spawnSync("plutil", ["-insert", key, "-string", value, plistPath], {
    encoding: "utf8",
  });
  if (insertResult.status !== 0) {
    throw new Error(`Failed to update plist key "${key}" at ${plistPath}`);
  }
}

function patchAppBundle(appBundlePath, iconPath) {
  const infoPlistPath = join(appBundlePath, "Contents", "Info.plist");
  setPlistString(infoPlistPath, "CFBundleDisplayName", APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, "CFBundleName", APP_DISPLAY_NAME);
  setPlistString(infoPlistPath, "CFBundleIdentifier", APP_BUNDLE_ID);
  setPlistString(infoPlistPath, "CFBundleIconFile", "icon.icns");

  const resourcesDir = join(appBundlePath, "Contents", "Resources");
  copyFileSync(iconPath, join(resourcesDir, "icon.icns"));
  copyFileSync(iconPath, join(resourcesDir, "electron.icns"));
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function buildMacLauncher(electronBinaryPath) {
  const sourceAppBundlePath = resolve(electronBinaryPath, "../../..");
  const runtimeDir = join(projectDir, ".electron-runtime");
  const targetAppBundlePath = join(runtimeDir, `${APP_DISPLAY_NAME}.app`);
  const targetBinaryPath = join(targetAppBundlePath, "Contents", "MacOS", "Electron");
  const iconPath = join(projectDir, "build", "icon.icns");
  const metadataPath = join(runtimeDir, "metadata.json");

  mkdirSync(runtimeDir, { recursive: true });

  const expectedMetadata = {
    launcherVersion: LAUNCHER_VERSION,
    sourceAppBundlePath,
    sourceAppMtimeMs: statSync(sourceAppBundlePath).mtimeMs,
    iconMtimeMs: statSync(iconPath).mtimeMs,
  };

  const currentMetadata = readJson(metadataPath);
  if (
    existsSync(targetBinaryPath) &&
    currentMetadata &&
    JSON.stringify(currentMetadata) === JSON.stringify(expectedMetadata)
  ) {
    return targetBinaryPath;
  }

  rmSync(targetAppBundlePath, { recursive: true, force: true });
  // Use macOS cp -R instead of Node cpSync to preserve framework symlinks
  const cpResult = spawnSync("cp", ["-R", sourceAppBundlePath, targetAppBundlePath], {
    encoding: "utf8",
  });
  if (cpResult.status !== 0) {
    throw new Error(`Failed to copy Electron.app: ${cpResult.stderr}`);
  }
  patchAppBundle(targetAppBundlePath, iconPath);
  writeFileSync(metadataPath, `${JSON.stringify(expectedMetadata, null, 2)}\n`);

  return targetBinaryPath;
}

function resolveElectronPath() {
  const require = createRequire(import.meta.url);
  const electronBinaryPath = require("electron");

  if (process.platform !== "darwin") {
    return electronBinaryPath;
  }

  return buildMacLauncher(electronBinaryPath);
}

const electronPath = resolveElectronPath();

async function detectDevServerUrl() {
  const configuredUrl = process.env.BETTERGIT_DEV_SERVER_URL;
  if (configuredUrl) {
    return configuredUrl;
  }

  const deadline = Date.now() + 30_000;
  const candidatePorts = [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180];
  const candidateHosts = ["localhost", "127.0.0.1"];

  while (Date.now() < deadline) {
    for (const host of candidateHosts) {
      for (const port of candidatePorts) {
        const url = `http://${host}:${port}`;
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(500) });
          if (response.ok) {
            return url;
          }
        } catch {
          // Keep polling until Vite is ready on one of the candidate URLs.
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error("Timed out waiting for the Vite dev server");
}

const childEnv = { ...process.env };
// Electron must NOT run in "node mode" — if this leaks in from the parent
// process chain (bun → concurrently → node) it disables Electron's internal
// require("electron") interception, causing the app module to be undefined.
delete childEnv.ELECTRON_RUN_AS_NODE;

const devServerUrl = await detectDevServerUrl();
childEnv.BETTERGIT_DEV_SERVER_URL = devServerUrl;
console.log(`[dev-electron] Launching Electron against ${devServerUrl}`);

const child = spawn(electronPath, ["."], {
  cwd: projectDir,
  stdio: "inherit",
  env: childEnv,
});

child.on("exit", (code) => process.exit(code ?? 0));
