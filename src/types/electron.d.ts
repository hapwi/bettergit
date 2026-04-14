interface ElectronAPI {
  updates: {
    getState: () => Promise<{
      enabled: boolean;
      status:
        | "idle"
        | "disabled"
        | "checking"
        | "available"
        | "downloading"
        | "downloaded"
        | "up-to-date"
        | "error";
      currentVersion: string;
      availableVersion: string | null;
      downloadedVersion: string | null;
      downloadPercent: number | null;
      checkedAt: string | null;
      message: string | null;
      errorContext: "check" | "download" | "install" | null;
    }>;
    check: () => Promise<{
      checked: boolean;
      state: Awaited<ReturnType<ElectronAPI["updates"]["getState"]>>;
    }>;
    download: () => Promise<{
      accepted: boolean;
      completed: boolean;
      state: Awaited<ReturnType<ElectronAPI["updates"]["getState"]>>;
    }>;
    install: () => Promise<{
      accepted: boolean;
      completed: boolean;
      state: Awaited<ReturnType<ElectronAPI["updates"]["getState"]>>;
    }>;
    onState: (
      callback: (state: Awaited<ReturnType<ElectronAPI["updates"]["getState"]>>) => void,
    ) => () => void;
  };
  terminal: {
    openSession: (input: {
      projectPath: string;
      tabId: string;
      cwd: string;
      cols: number;
      rows: number;
    }) => Promise<{
      projectPath: string;
      tabId: string;
      cwd: string;
      status: "starting" | "running" | "exited" | "error";
      pid: number | null;
      history: string;
      exitCode: number | null;
      exitSignal: number | null;
      updatedAt: string;
    }>;
    writeToSession: (input: { projectPath: string; tabId: string; data: string }) => Promise<void>;
    resizeSession: (input: { projectPath: string; tabId: string; cols: number; rows: number }) => Promise<void>;
    closeSession: (input: { projectPath: string; tabId: string; deleteHistory?: boolean }) => Promise<void>;
    closeProject: (input: { projectPath: string; deleteHistory?: boolean }) => Promise<void>;
    renameProject: (input: { oldPath: string; newPath: string }) => Promise<void>;
    onEvent: (callback: (event: {
      projectPath: string;
      tabId: string;
      createdAt: string;
      type: "output" | "exited" | "error";
      data?: string;
      exitCode?: number | null;
      exitSignal?: number | null;
      message?: string;
    }) => void) => () => void;
  };
  dialog: {
    openDirectory: () => Promise<string | null>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
    openTerminal: (dirPath: string, terminalApp?: string) => Promise<void>;
    detectTerminals: () => Promise<string[]>;
  };
  server: {
    getPort: () => Promise<number>;
    restart: () => Promise<number>;
  };
  project: {
    renameDirectory: (currentPath: string, newName: string) => Promise<string>;
  };
  settings: {
    load: () => Promise<Record<string, unknown>>;
    save: (data: Record<string, unknown>) => Promise<void>;
  };
  onClosePaneOrWindow: (callback: () => void) => () => void;
  onTerminalAction: (callback: (action: string) => void) => () => void;
  platform: NodeJS.Platform;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
