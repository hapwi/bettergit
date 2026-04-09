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
