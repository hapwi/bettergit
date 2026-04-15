export interface ExecInput {
  cwd: string;
  args: string[];
  timeoutMs?: number;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
