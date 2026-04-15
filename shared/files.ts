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
  expectedMtimeMs?: number | null;
}
