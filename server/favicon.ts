import fs from "node:fs";
import path from "node:path";

const FAVICON_CANDIDATES = [
  "favicon.svg", "favicon.ico", "favicon.png",
  "public/favicon.svg", "public/favicon.ico", "public/favicon.png",
  "app/favicon.ico", "app/favicon.png", "app/icon.svg", "app/icon.png", "app/icon.ico",
  "src/favicon.ico", "src/favicon.svg", "src/app/favicon.ico", "src/app/icon.svg", "src/app/icon.png",
  "assets/icon.svg", "assets/icon.png", "assets/logo.svg", "assets/logo.png",
  "build/icon.png", "build/icon.svg", "resources/icon.png", "resources/icon.svg",
];

const ICON_SOURCE_FILES = [
  "index.html", "public/index.html",
  "app/routes/__root.tsx", "src/routes/__root.tsx",
  "app/root.tsx", "src/root.tsx", "src/index.html",
];

const LINK_ICON_HTML_RE =
  /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))[^>]*>/i;
const LINK_ICON_OBJ_RE =
  /(?=[^}]*\brel\s*:\s*["'](?:icon|shortcut icon)["'])(?=[^}]*\bhref\s*:\s*["']([^"'?]+))[^}]*/i;

const FAVICON_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function isPathWithinProject(projectCwd: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(projectCwd), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveProjectFavicon(cwd: string): Promise<string | null> {
  for (const candidate of FAVICON_CANDIDATES) {
    const full = path.join(cwd, candidate);
    if (!isPathWithinProject(cwd, full)) continue;
    try {
      const stat = await fs.promises.stat(full);
      if (stat.isFile()) return full;
    } catch {
      continue;
    }
  }

  for (const sourceFile of ICON_SOURCE_FILES) {
    const full = path.join(cwd, sourceFile);
    try {
      const content = await fs.promises.readFile(full, "utf8");
      const htmlMatch = content.match(LINK_ICON_HTML_RE);
      const href = htmlMatch?.[1] ?? content.match(LINK_ICON_OBJ_RE)?.[1];
      if (!href) continue;
      const clean = href.replace(/^\//, "");
      for (const resolved of [path.join(cwd, "public", clean), path.join(cwd, clean)]) {
        if (!isPathWithinProject(cwd, resolved)) continue;
        try {
          const stat = await fs.promises.stat(resolved);
          if (stat.isFile()) return resolved;
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

export async function getProjectFavicon(cwd: string): Promise<string | null> {
  const filePath = await resolveProjectFavicon(cwd);
  if (!filePath) return null;

  const ext = path.extname(filePath).toLowerCase();
  const mime = FAVICON_MIME[ext] ?? "application/octet-stream";
  const data = await fs.promises.readFile(filePath);
  return `data:${mime};base64,${data.toString("base64")}`;
}
