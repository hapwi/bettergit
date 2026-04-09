import { build } from "esbuild";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const electronCommon = {
  bundle: true,
  platform: "node",
  target: "node20",
  external: ["electron"],
  sourcemap: false,
  minify: false,
};

const builds = [
  {
    entryPoint: "electron/main.ts",
    outputFile: "dist-electron/main.js",
    options: { ...electronCommon, outdir: "dist-electron" },
  },
  {
    entryPoint: "electron/preload.ts",
    outputFile: "dist-electron/preload.js",
    options: { ...electronCommon, outdir: "dist-electron" },
  },
  {
    entryPoint: "server/main.ts",
    outputFile: "dist-server/main.mjs",
    options: {
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      outdir: "dist-server",
      outExtension: { ".js": ".mjs" },
      sourcemap: false,
      minify: false,
      // The Claude Agent SDK must NOT be bundled — it has dynamic requires
      // and subprocess spawning that break when inlined. Keep it external
      // and ship it via node_modules (same as hapcode's server build).
      // Built as ESM so the SDK's ESM entry (sdk.mjs) loads natively
      // without CJS→ESM interop issues inside Electron's asar archive.
      external: ["@anthropic-ai/claude-agent-sdk", "node-pty", "ws"],
    },
  },
];

function getMtimeMs(path) {
  return statSync(resolve(projectRoot, path)).mtimeMs;
}

function isUpToDate() {
  return builds.every(({ entryPoint, outputFile }) => {
    const absoluteOutput = resolve(projectRoot, outputFile);
    if (!existsSync(absoluteOutput)) {
      return false;
    }

    return statSync(absoluteOutput).mtimeMs >= getMtimeMs(entryPoint);
  });
}

const nativeBuild = spawnSync(process.execPath, ["scripts/build-native-terminal.mjs"], {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
});
if (nativeBuild.status !== 0) {
  process.exit(nativeBuild.status ?? 1);
}

if (process.argv.includes("--force") || !isUpToDate()) {
  await Promise.all(
    builds.map(({ entryPoint, options }) =>
      build({
        ...options,
        entryPoints: [entryPoint],
        // Use the format specified in options (ESM for server), default to CJS
        format: options.format ?? "cjs",
      }),
    ),
  );
} else {
  console.log("[build:electron] dist-electron & dist-server are up to date");
}
