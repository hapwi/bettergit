import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

const isDev = !app.isPackaged;

// ---------------------------------------------------------------------------
// Server process management
// ---------------------------------------------------------------------------

let serverProcess: ChildProcess | null = null;
let serverPort = 0;

async function findFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = (srv.address() as { port: number }).port;
      srv.close(() => resolve(port));
    });
  });
}

async function startServer(): Promise<number> {
  const requestedPort = await findFreePort();
  const serverEntry = isDev
    ? path.join(__dirname, "../dist-server/main.js")
    : path.join(__dirname, "../dist-server/main.js");

  serverProcess = spawn(process.execPath, [serverEntry], {
    // Match hapcode: in prod, use homedir as cwd so claude CLI can find credentials.
    // In dev, use the project root.
    cwd: isDev ? path.join(__dirname, "..") : os.homedir(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      BETTERGIT_SERVER_PORT: String(requestedPort),
      BETTERGIT_USER_DATA: app.getPath("userData"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Read the actual port from the server's stdout
  return new Promise((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error("Server startup timed out")), 10_000);

    serverProcess!.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = stdout.match(/BETTERGIT_SERVER_PORT=(\d+)/);
      if (match) {
        clearTimeout(timer);
        serverPort = parseInt(match[1], 10);
        resolve(serverPort);
      }
    });

    serverProcess!.stderr!.on("data", (chunk: Buffer) => {
      process.stderr.write(`[server] ${chunk.toString()}`);
    });

    serverProcess!.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    serverProcess!.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

function createWindow() {
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
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  try {
    await startServer();
    console.log(`[main] Server running on port ${serverPort}`);
  } catch (err) {
    console.error("[main] Failed to start server:", err);
  }
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    stopServer();
    app.quit();
  }
});

app.on("before-quit", () => {
  stopServer();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ---------------------------------------------------------------------------
// IPC handlers — only things requiring Electron APIs stay here
// ---------------------------------------------------------------------------

ipcMain.handle("dialog:openDirectory", async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({
    properties: ["openDirectory"],
    title: "Open Repository",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle("shell:openExternal", async (_event, url: string): Promise<void> => {
  await shell.openExternal(url);
});

ipcMain.handle("server:getPort", () => serverPort);
