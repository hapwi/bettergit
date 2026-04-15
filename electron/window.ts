import { app, BrowserWindow, shell } from "electron";
import path from "node:path";

const isDev = !app.isPackaged;

export function createWindow(): void {
  const devServerUrl = process.env.BETTERGIT_DEV_SERVER_URL ?? "http://localhost:5173";
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: process.platform === "darwin" ? "#00000000" : "#0a0a0a",
    ...(process.platform === "darwin"
      ? {
          transparent: true,
          vibrancy: "under-window" as const,
          visualEffectState: "active" as const,
        }
      : {}),
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once("ready-to-show", () => win.show());

  if (isDev) {
    win.loadURL(devServerUrl);
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}
