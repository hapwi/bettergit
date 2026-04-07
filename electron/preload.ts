import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  dialog: {
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke("dialog:openDirectory"),
  },
  shell: {
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),
  },
  server: {
    getPort: (): Promise<number> => ipcRenderer.invoke("server:getPort"),
  },
  platform: process.platform,
});
