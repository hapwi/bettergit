import fs from "node:fs/promises";
import path from "node:path";
import { runProcess } from "./env";
import type { FileEntry, ListDirectoryInput, ReadFileInput, WriteFileInput } from "../shared/files";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Names that should always be hidden regardless of .gitignore */
const ALWAYS_HIDDEN = new Set([".git", ".DS_Store", "Thumbs.db"]);
const BINARY_CHECK_BYTES = 8 * 1024;
const MAX_EDITABLE_FILE_BYTES = 2 * 1024 * 1024;

function isPathOutside(baseDir: string, candidatePath: string): boolean {
  const relative = path.relative(baseDir, candidatePath);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

async function resolveWithin(baseDir: string, relativePath = ""): Promise<string> {
  const resolvedBase = await fs.realpath(baseDir);
  const resolvedTarget = path.resolve(resolvedBase, relativePath);

  if (isPathOutside(resolvedBase, resolvedTarget)) {
    throw new Error("Path traversal not allowed");
  }

  let probe = resolvedTarget;
  while (true) {
    try {
      const realProbe = await fs.realpath(probe);
      if (isPathOutside(resolvedBase, realProbe)) {
        throw new Error("Path traversal not allowed");
      }
      return resolvedTarget;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") throw error;
      if (probe === resolvedBase) return resolvedTarget;
      probe = path.dirname(probe);
    }
  }
}

async function readSample(fullPath: string, size: number): Promise<Buffer> {
  const handle = await fs.open(fullPath, "r");
  try {
    const sampleSize = Math.min(size, BINARY_CHECK_BYTES);
    const buffer = Buffer.alloc(sampleSize);
    await handle.read(buffer, 0, sampleSize, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

function isBinaryBuffer(buffer: Buffer): boolean {
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function isMtimeMatch(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) < 1;
}

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
  const targetDir = await resolveWithin(cwd, relativePath);

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
  isTooLarge: boolean;
  language: string;
  mtimeMs: number;
}> {
  const { cwd, relativePath } = input;
  const fullPath = await resolveWithin(cwd, relativePath);

  const stat = await fs.stat(fullPath);
  const language = detectLanguage(relativePath);
  const sample = await readSample(fullPath, stat.size);
  const isBinary = isBinaryBuffer(sample);

  if (isBinary) {
    return {
      content: "",
      size: stat.size,
      isBinary: true,
      isTooLarge: false,
      language,
      mtimeMs: stat.mtimeMs,
    };
  }

  if (stat.size > MAX_EDITABLE_FILE_BYTES) {
    return {
      content: "",
      size: stat.size,
      isBinary: false,
      isTooLarge: true,
      language,
      mtimeMs: stat.mtimeMs,
    };
  }

  const buffer = await fs.readFile(fullPath);

  return {
    content: buffer.toString("utf-8"),
    size: stat.size,
    isBinary: false,
    isTooLarge: false,
    language,
    mtimeMs: stat.mtimeMs,
  };
}

export async function createFile(input: { cwd: string; relativePath: string }): Promise<{ ok: true }> {
  const fullPath = await resolveWithin(input.cwd, input.relativePath);
  // Ensure parent directory exists
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  // Create empty file (fail if exists)
  await fs.writeFile(fullPath, "", { flag: "wx" });
  return { ok: true };
}

export async function createDirectory(input: { cwd: string; relativePath: string }): Promise<{ ok: true }> {
  const fullPath = await resolveWithin(input.cwd, input.relativePath);
  await fs.mkdir(fullPath, { recursive: true });
  return { ok: true };
}

export async function deleteEntry(input: { cwd: string; relativePath: string }): Promise<{ ok: true }> {
  const fullPath = await resolveWithin(input.cwd, input.relativePath);
  await fs.rm(fullPath, { recursive: true });
  return { ok: true };
}

export async function renameEntry(input: { cwd: string; oldPath: string; newPath: string }): Promise<{ ok: true }> {
  const fullOld = await resolveWithin(input.cwd, input.oldPath);
  const fullNew = await resolveWithin(input.cwd, input.newPath);
  // Ensure parent of new path exists
  await fs.mkdir(path.dirname(fullNew), { recursive: true });
  await fs.rename(fullOld, fullNew);
  return { ok: true };
}

export async function writeFile(input: WriteFileInput): Promise<{ ok: true; mtimeMs: number }> {
  const { cwd, relativePath, content, expectedMtimeMs } = input;
  const fullPath = await resolveWithin(cwd, relativePath);
  const currentStat = await fs.stat(fullPath);

  if (
    typeof expectedMtimeMs === "number" &&
    !isMtimeMatch(currentStat.mtimeMs, expectedMtimeMs)
  ) {
    throw new Error("File changed on disk. Reload it before saving.");
  }

  await fs.writeFile(fullPath, content, "utf-8");
  const nextStat = await fs.stat(fullPath);
  return { ok: true, mtimeMs: nextStat.mtimeMs };
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
