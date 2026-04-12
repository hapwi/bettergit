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
  project: {
    renameDirectory: (currentPath: string, newName: string) => Promise<string>;
  };
  terminalHost: {
    isAvailable: () => Promise<boolean>;
    createSurface: (surfaceId: string, cwd: string) => Promise<boolean>;
    destroySurface: (surfaceId: string) => Promise<void>;
    closeFocusedSurface: (surfaceId: string) => Promise<boolean>;
    setSurfaceBounds: (
      surfaceId: string,
      bounds: { x: number; y: number; width: number; height: number },
    ) => Promise<void>;
    getResolvedAppearance: () => Promise<{ backgroundColor?: string; backgroundOpacity?: number } | undefined>;
    setSurfaceBackground: (surfaceId: string, color: string) => Promise<void>;
    setSurfaceVisible: (surfaceId: string, visible: boolean) => Promise<void>;
    focusSurface: (surfaceId: string) => Promise<void>;
    splitSurface: (surfaceId: string, direction: "right" | "down" | "left" | "up") => Promise<void>;
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
