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
  platform: NodeJS.Platform;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
