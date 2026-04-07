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

interface ElectronAPI {
  git: {
    exec: (input: ExecInput) => Promise<ExecResult>;
  };
  gh: {
    exec: (input: ExecInput) => Promise<ExecResult>;
  };
  dialog: {
    openDirectory: () => Promise<string | null>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  project: {
    favicon: (cwd: string) => Promise<string | null>;
  };
  ai: {
    generateCommitMessage: (input: CommitMessageInput) => Promise<CommitMessageResult>;
    generatePrContent: (input: PrContentInput) => Promise<PrContentResult>;
    generateBranchName: (input: BranchNameInput) => Promise<BranchNameResult>;
    setModel: (model: string) => Promise<void>;
    getModel: () => Promise<string>;
    checkCli: (cli: string) => Promise<boolean>;
  };
  platform: NodeJS.Platform;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
