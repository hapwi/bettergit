import { contextBridge, ipcRenderer } from "electron";

interface ExecInput {
  cwd: string;
  args: string[];
  timeoutMs?: number;
}

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface CommitMessageInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  includeBranch?: boolean;
}

interface CommitMessageResult {
  subject: string;
  body: string;
  branch?: string;
}

interface PrContentInput {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
}

interface PrContentResult {
  title: string;
  body: string;
}

interface BranchNameInput {
  message: string;
}

interface BranchNameResult {
  branch: string;
}

contextBridge.exposeInMainWorld("electronAPI", {
  git: {
    exec: (input: ExecInput): Promise<ExecResult> => ipcRenderer.invoke("git:exec", input),
  },
  gh: {
    exec: (input: ExecInput): Promise<ExecResult> => ipcRenderer.invoke("gh:exec", input),
  },
  dialog: {
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialog:openDirectory"),
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
  },
  ai: {
    generateCommitMessage: (input: CommitMessageInput): Promise<CommitMessageResult> =>
      ipcRenderer.invoke("ai:generateCommitMessage", input),
    generatePrContent: (input: PrContentInput): Promise<PrContentResult> =>
      ipcRenderer.invoke("ai:generatePrContent", input),
    generateBranchName: (input: BranchNameInput): Promise<BranchNameResult> =>
      ipcRenderer.invoke("ai:generateBranchName", input),
  },
  platform: process.platform,
});
