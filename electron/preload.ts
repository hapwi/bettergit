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
  terminal: {
    openSession: (input: {
      projectPath: string;
      tabId: string;
      cwd: string;
      cols: number;
      rows: number;
    }) => ipcRenderer.invoke("terminal:openSession", input),
    writeToSession: (input: { projectPath: string; tabId: string; data: string }) =>
      ipcRenderer.invoke("terminal:writeToSession", input),
    resizeSession: (input: { projectPath: string; tabId: string; cols: number; rows: number }) =>
      ipcRenderer.invoke("terminal:resizeSession", input),
    closeSession: (input: { projectPath: string; tabId: string; deleteHistory?: boolean }) =>
      ipcRenderer.invoke("terminal:closeSession", input),
    closeProject: (input: { projectPath: string; deleteHistory?: boolean }) =>
      ipcRenderer.invoke("terminal:closeProject", input),
    renameProject: (input: { oldPath: string; newPath: string }) =>
      ipcRenderer.invoke("terminal:renameProject", input),
    onEvent: (callback: (event: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
      ipcRenderer.on("terminal:event", handler);
      return () => {
        ipcRenderer.removeListener("terminal:event", handler);
      };
    },
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
