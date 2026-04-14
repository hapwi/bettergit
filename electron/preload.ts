import { contextBridge, ipcRenderer } from "electron";

const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";

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
    restart: (): Promise<number> => ipcRenderer.invoke("server:restart"),
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
  updates: {
    getState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
    check: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
    download: () => ipcRenderer.invoke(UPDATE_DOWNLOAD_CHANNEL),
    install: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
    onState: (callback: (state: unknown) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
      ipcRenderer.on(UPDATE_STATE_CHANNEL, handler);
      return () => {
        ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, handler);
      };
    },
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
