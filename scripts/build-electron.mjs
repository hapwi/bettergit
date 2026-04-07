import { build } from "esbuild";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  external: ["electron"],
  outdir: "dist-electron",
  sourcemap: false,
  minify: false,
};

const builds = [
  {
    entryPoint: "electron/main.ts",
    outputFile: "dist-electron/main.js",
  },
  {
    entryPoint: "electron/preload.ts",
    outputFile: "dist-electron/preload.js",
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
    builds.map(({ entryPoint }) =>
      build({
        ...common,
        entryPoints: [entryPoint],
        format: "cjs",
      }),
    ),
  );
} else {
  console.log("[build:electron] dist-electron is up to date");
}
