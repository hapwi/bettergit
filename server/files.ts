import fs from "node:fs/promises";
import path from "node:path";
import { runProcess } from "./env";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileEntry {
  name: string;
  path: string; // relative to repo root
  type: "file" | "directory";
  size?: number;
}

export interface ListDirectoryInput {
  cwd: string;
  relativePath?: string;
}

export interface ReadFileInput {
  cwd: string;
  relativePath: string;
}

export interface WriteFileInput {
  cwd: string;
  relativePath: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Names that should always be hidden regardless of .gitignore */
const ALWAYS_HIDDEN = new Set([".git", ".DS_Store", "Thumbs.db"]);

async function getIgnoredPaths(
  cwd: string,
  fullPaths: string[],
): Promise<Set<string>> {
  if (fullPaths.length === 0) return new Set();

  const relativePaths = fullPaths.map((fp) => path.relative(cwd, fp));
  const checkResult = await runProcess(
    "git",
    ["check-ignore", ...relativePaths],
    cwd,
    5_000,
  );

  const ignored = new Set<string>();
  if (checkResult.stdout.trim()) {
    for (const line of checkResult.stdout.trim().split("\n")) {
      if (line) ignored.add(line.trim());
    }
  }
  return ignored;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function listDirectory(
  input: ListDirectoryInput,
): Promise<FileEntry[]> {
  const { cwd, relativePath = "" } = input;
  const targetDir = relativePath
    ? path.resolve(cwd, relativePath)
    : cwd;

  // Verify the target is within the repo
  const resolvedTarget = path.resolve(targetDir);
  const resolvedCwd = path.resolve(cwd);
  if (!resolvedTarget.startsWith(resolvedCwd)) {
    throw new Error("Path traversal not allowed");
  }

  const dirents = await fs.readdir(targetDir, { withFileTypes: true });

  // Filter hidden entries
  const visible = dirents.filter((d) => !ALWAYS_HIDDEN.has(d.name));

  // Check gitignore for remaining entries
  const fullPaths = visible.map((d) => path.join(targetDir, d.name));
  const ignored = await getIgnoredPaths(cwd, fullPaths);

  const entries: FileEntry[] = [];
  for (const dirent of visible) {
    const rel = relativePath
      ? `${relativePath}/${dirent.name}`
      : dirent.name;

    // Skip if gitignored
    if (ignored.has(rel)) continue;

    const isDir = dirent.isDirectory();

    if (isDir) {
      entries.push({ name: dirent.name, path: rel, type: "directory" });
    } else {
      let size: number | undefined;
      try {
        const stat = await fs.stat(path.join(targetDir, dirent.name));
        size = stat.size;
      } catch {
        // ignore stat errors
      }
      entries.push({ name: dirent.name, path: rel, type: "file", size });
    }
  }

  // Sort: directories first, then alphabetically (case-insensitive)
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return entries;
}

export async function readFile(input: ReadFileInput): Promise<{
  content: string;
  size: number;
  isBinary: boolean;
  language: string;
}> {
  const { cwd, relativePath } = input;
  const fullPath = path.resolve(cwd, relativePath);

  // Path traversal check
  if (!fullPath.startsWith(path.resolve(cwd))) {
    throw new Error("Path traversal not allowed");
  }

  const stat = await fs.stat(fullPath);

  // Size limit: 5MB
  if (stat.size > 5 * 1024 * 1024) {
    return { content: "", size: stat.size, isBinary: true, language: "plaintext" };
  }

  const buffer = await fs.readFile(fullPath);

  // Binary detection: check for null bytes in first 8KB
  const checkSize = Math.min(buffer.length, 8192);
  let isBinary = false;
  for (let i = 0; i < checkSize; i++) {
    if (buffer[i] === 0) {
      isBinary = true;
      break;
    }
  }

  const language = detectLanguage(relativePath);

  if (isBinary) {
    return { content: "", size: stat.size, isBinary: true, language };
  }

  return {
    content: buffer.toString("utf-8"),
    size: stat.size,
    isBinary: false,
    language,
  };
}

export async function createFile(input: { cwd: string; relativePath: string }): Promise<{ ok: true }> {
  const fullPath = path.resolve(input.cwd, input.relativePath);
  if (!fullPath.startsWith(path.resolve(input.cwd))) {
    throw new Error("Path traversal not allowed");
  }
  // Ensure parent directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  // Create empty file (fail if exists)
  await fs.writeFile(fullPath, "", { flag: "wx" });
  return { ok: true };
}

export async function createDirectory(input: { cwd: string; relativePath: string }): Promise<{ ok: true }> {
  const fullPath = path.resolve(input.cwd, input.relativePath);
  if (!fullPath.startsWith(path.resolve(input.cwd))) {
    throw new Error("Path traversal not allowed");
  }
  await fs.mkdir(fullPath, { recursive: true });
  return { ok: true };
}

export async function deleteEntry(input: { cwd: string; relativePath: string }): Promise<{ ok: true }> {
  const fullPath = path.resolve(input.cwd, input.relativePath);
  if (!fullPath.startsWith(path.resolve(input.cwd))) {
    throw new Error("Path traversal not allowed");
  }
  await fs.rm(fullPath, { recursive: true });
  return { ok: true };
}

export async function renameEntry(input: { cwd: string; oldPath: string; newPath: string }): Promise<{ ok: true }> {
  const fullOld = path.resolve(input.cwd, input.oldPath);
  const fullNew = path.resolve(input.cwd, input.newPath);
  const resolvedCwd = path.resolve(input.cwd);
  if (!fullOld.startsWith(resolvedCwd) || !fullNew.startsWith(resolvedCwd)) {
    throw new Error("Path traversal not allowed");
  }
  // Ensure parent of new path exists
  await fs.mkdir(path.dirname(fullNew), { recursive: true });
  await fs.rename(fullOld, fullNew);
  return { ok: true };
}

export async function writeFile(input: WriteFileInput): Promise<{ ok: true }> {
  const { cwd, relativePath, content } = input;
  const fullPath = path.resolve(cwd, relativePath);

  // Path traversal check
  if (!fullPath.startsWith(path.resolve(cwd))) {
    throw new Error("Path traversal not allowed");
  }

  await fs.writeFile(fullPath, content, "utf-8");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Language detection for Monaco
// ---------------------------------------------------------------------------

const EXT_TO_LANGUAGE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".jsonc": "json",
  ".md": "markdown",
  ".mdx": "markdown",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".py": "python",
  ".rb": "ruby",
  ".rs": "rust",
  ".go": "go",
  ".java": "java",
  ".kt": "kotlin",
  ".swift": "swift",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".fish": "shell",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".svg": "xml",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".dockerfile": "dockerfile",
  ".lua": "lua",
  ".r": "r",
  ".dart": "dart",
  ".vue": "html",
  ".svelte": "html",
};

const FILENAME_TO_LANGUAGE: Record<string, string> = {
  Dockerfile: "dockerfile",
  Makefile: "makefile",
  Gemfile: "ruby",
  Rakefile: "ruby",
  ".gitignore": "plaintext",
  ".gitattributes": "plaintext",
  ".editorconfig": "ini",
  ".env": "plaintext",
  ".env.local": "plaintext",
};

function detectLanguage(filePath: string): string {
  const basename = path.basename(filePath);
  if (FILENAME_TO_LANGUAGE[basename]) return FILENAME_TO_LANGUAGE[basename];

  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_LANGUAGE[ext] ?? "plaintext";
}
