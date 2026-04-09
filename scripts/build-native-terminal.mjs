import { mkdirSync, statSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ghosttyDir = resolve(projectRoot, "vendor/ghostty");
const addonSource = resolve(projectRoot, "native/native_terminal_host/src/native_terminal_host.mm");
const addonOutput = resolve(projectRoot, "native/native_terminal_host/build/Release/native_terminal_host.node");
const ghosttyStaticLib = resolve(ghosttyDir, "zig-out/lib/libghostty.a");

function run(command, args, cwd = projectRoot, envOverrides = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: {
      ...process.env,
      ...envOverrides,
    },
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status ?? 1}`);
  }
}

function getMetalToolchainEnv() {
  if (process.platform !== "darwin") {
    return {};
  }

  const result = spawnSync("xcodebuild", ["-showComponent", "MetalToolchain", "-json"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
  });

  if (result.status !== 0 || !result.stdout) {
    return {};
  }

  try {
    const payload = JSON.parse(result.stdout);
    if (payload?.status === "installed" && typeof payload.toolchainIdentifier === "string") {
      return { TOOLCHAINS: payload.toolchainIdentifier };
    }
  } catch {
    // Fall through to default environment.
  }

  return {};
}

const metalToolchainEnv = getMetalToolchainEnv();

function needsRebuild(outputPath, inputs) {
  if (!existsSync(outputPath)) return true;
  const outputMtime = statSync(outputPath).mtimeMs;
  return inputs.some((input) => statSync(input).mtimeMs > outputMtime);
}

run(
  "zig",
  [
    "build",
    "-Dapp-runtime=none",
    "-Demit-lib-vt=false",
    "-Demit-xcframework=false",
    "-Demit-macos-app=false",
    "-Demit-docs=false",
    "-Demit-helpgen=false",
    "-Demit-exe=false",
  ],
  ghosttyDir,
  metalToolchainEnv,
);

if (!needsRebuild(addonOutput, [addonSource, ghosttyStaticLib])) {
  process.exit(0);
}

mkdirSync(dirname(addonOutput), { recursive: true });

const nodeExecPath = process.execPath;
const nodePrefix = dirname(dirname(nodeExecPath));
const nodeIncludeDir = resolve(nodePrefix, "include/node");

run("clang++", [
  "-std=c++20",
  "-x",
  "objective-c++",
  "-fobjc-arc",
  "-fvisibility=hidden",
  "-DNAPI_VERSION=10",
  "-I",
  nodeIncludeDir,
  "-I",
  resolve(ghosttyDir, "zig-out/include"),
  "-I",
  resolve(ghosttyDir, "include"),
  addonSource,
  "-x",
  "none",
  ghosttyStaticLib,
  "-framework",
  "AppKit",
  "-framework",
  "Carbon",
  "-framework",
  "CoreText",
  "-framework",
  "CoreGraphics",
  "-framework",
  "Foundation",
  "-framework",
  "Metal",
  "-framework",
  "QuartzCore",
  "-framework",
  "OpenGL",
  "-bundle",
  "-undefined",
  "dynamic_lookup",
  "-o",
  addonOutput,
]);
