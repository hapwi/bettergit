/**
 * Frontend API client for file operations.
 */
import { serverFetch } from "./server";
import { pauseHmr, resumeHmr } from "./hmr";

export interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

export interface FileContent {
  content: string;
  size: number;
  isBinary: boolean;
  isTooLarge: boolean;
  language: string;
  mtimeMs: number;
}

/** Wrap a mutation in HMR pause/resume so Vite doesn't reload the app. */
async function withHmrPause<T>(fn: () => Promise<T>): Promise<T> {
  await pauseHmr();
  try {
    return await fn();
  } finally {
    await resumeHmr();
  }
}

export async function listDirectory(
  cwd: string,
  relativePath = "",
): Promise<FileEntry[]> {
  return serverFetch("/api/files/list", { cwd, relativePath });
}

export async function readFile(
  cwd: string,
  relativePath: string,
): Promise<FileContent> {
  return serverFetch("/api/files/read", { cwd, relativePath });
}

export async function writeFile(
  cwd: string,
  relativePath: string,
  content: string,
  expectedMtimeMs?: number | null,
): Promise<{ ok: true; mtimeMs: number }> {
  return withHmrPause(() =>
    serverFetch("/api/files/write", {
      cwd,
      relativePath,
      content,
      expectedMtimeMs,
    }),
  );
}

export async function createFile(
  cwd: string,
  relativePath: string,
): Promise<{ ok: true }> {
  return withHmrPause(() =>
    serverFetch("/api/files/create", { cwd, relativePath }),
  );
}

export async function createDirectory(
  cwd: string,
  relativePath: string,
): Promise<{ ok: true }> {
  return withHmrPause(() =>
    serverFetch("/api/files/mkdir", { cwd, relativePath }),
  );
}

export async function deleteEntry(
  cwd: string,
  relativePath: string,
): Promise<{ ok: true }> {
  return withHmrPause(() =>
    serverFetch("/api/files/delete", { cwd, relativePath }),
  );
}

export async function renameEntry(
  cwd: string,
  oldPath: string,
  newPath: string,
): Promise<{ ok: true }> {
  return withHmrPause(() =>
    serverFetch("/api/files/rename", { cwd, oldPath, newPath }),
  );
}
