interface ElectronAPI {
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
