import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  external: ["electron"],
  outdir: "dist-electron",
  sourcemap: false,
  minify: false,
};

await Promise.all([
  build({
    ...common,
    entryPoints: ["electron/main.ts"],
    format: "cjs",
  }),
  build({
    ...common,
    entryPoints: ["electron/preload.ts"],
    format: "cjs",
  }),
]);
