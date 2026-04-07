import { build } from "esbuild";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

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
    outputFile: "dist-server/main.js",
    options: {
      bundle: true,
      platform: "node",
      target: "node20",
      outdir: "dist-server",
      sourcemap: false,
      minify: false,
      // The Claude Agent SDK must NOT be bundled — it has dynamic requires
      // and subprocess spawning that break when inlined. Keep it external
      // and ship it via node_modules (same as hapcode's server build).
      external: ["@anthropic-ai/claude-agent-sdk"],
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

if (process.argv.includes("--force") || !isUpToDate()) {
  await Promise.all(
    builds.map(({ entryPoint, options }) =>
      build({
        ...options,
        entryPoints: [entryPoint],
        format: "cjs",
      }),
    ),
  );
} else {
  console.log("[build:electron] dist-electron & dist-server are up to date");
}
