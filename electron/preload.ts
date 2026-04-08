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
  platform: process.platform,
});
