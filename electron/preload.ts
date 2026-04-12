import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  dialog: {
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialog:openDirectory"),
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
    openTerminal: (dirPath: string, terminalApp?: string): Promise<void> => ipcRenderer.invoke("shell:openTerminal", dirPath, terminalApp),
    detectTerminals: (): Promise<string[]> => ipcRenderer.invoke("shell:detectTerminals"),
  },
  server: {
    getPort: (): Promise<number> => ipcRenderer.invoke("server:getPort"),
  },
  project: {
    renameDirectory: (currentPath: string, newName: string): Promise<string> =>
      ipcRenderer.invoke("project:renameDirectory", currentPath, newName),
  },
  terminalHost: {
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke("terminal-host:isAvailable"),
    createSurface: (surfaceId: string, cwd: string): Promise<boolean> =>
      ipcRenderer.invoke("terminal-host:createSurface", surfaceId, cwd),
    destroySurface: (surfaceId: string): Promise<void> =>
      ipcRenderer.invoke("terminal-host:destroySurface", surfaceId),
    closeFocusedSurface: (surfaceId: string): Promise<boolean> =>
      ipcRenderer.invoke("terminal-host:closeFocusedSurface", surfaceId),
    setSurfaceBounds: (
      surfaceId: string,
      bounds: { x: number; y: number; width: number; height: number },
    ): Promise<void> => ipcRenderer.invoke("terminal-host:setSurfaceBounds", surfaceId, bounds),
    getResolvedAppearance: (): Promise<{ backgroundColor?: string; backgroundOpacity?: number } | undefined> =>
      ipcRenderer.invoke("terminal-host:getResolvedAppearance"),
    setSurfaceBackground: (surfaceId: string, color: string): Promise<void> =>
      ipcRenderer.invoke("terminal-host:setSurfaceBackground", surfaceId, color),
    setSurfaceVisible: (surfaceId: string, visible: boolean): Promise<void> =>
      ipcRenderer.invoke("terminal-host:setSurfaceVisible", surfaceId, visible),
    focusSurface: (surfaceId: string): Promise<void> =>
      ipcRenderer.invoke("terminal-host:focusSurface", surfaceId),
    splitSurface: (surfaceId: string, direction: "right" | "down" | "left" | "up"): Promise<void> =>
      ipcRenderer.invoke("terminal-host:splitSurface", surfaceId, direction),
  },
  settings: {
    load: (): Promise<Record<string, unknown>> => ipcRenderer.invoke("settings:load"),
    save: (data: Record<string, unknown>): Promise<void> => ipcRenderer.invoke("settings:save", data),
  },
  onClosePaneOrWindow: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on("app:close-pane-or-window", handler);
    return () => { ipcRenderer.removeListener("app:close-pane-or-window", handler); };
  },
  onTerminalAction: (callback: (action: string) => void): (() => void) => {
    const channels = ["terminal:split-vertical", "terminal:split-horizontal", "terminal:new-tab"] as const;
    const handlers = channels.map((ch) => {
      const handler = () => callback(ch);
      ipcRenderer.on(ch, handler);
      return () => { ipcRenderer.removeListener(ch, handler); };
    });
    return () => handlers.forEach((h) => h());
  },
  platform: process.platform,
});
