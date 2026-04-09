import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { loadNativeTerminalAddon, type NativeTerminalBounds } from "./nativeTerminalHost";

// Resolve the user's full shell PATH before anything else — macOS GUI apps
// don't inherit the login shell's environment, so tools like git/gh/claude
// and provider auth sockets can disappear in packaged builds.
function syncShellEnvironment(): void {
  if (process.platform !== "darwin") return;
  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const marker = "__BETTERGIT_ENV__";
    const keys = ["PATH", "SSH_AUTH_SOCK"] as const;
    const command = keys.map(
      (key) => `printf '%s' '${marker}${key}='; printenv ${key}; printf '%s' '${marker}'`,
    ).join(";");
    const output = execFileSync(shell, ["-ilc", command], { encoding: "utf8", timeout: 5_000 });

    for (const key of keys) {
      const keyMarker = `${marker}${key}=`;
      const start = output.indexOf(keyMarker);
      if (start === -1) continue;
      const valueStart = start + keyMarker.length;
      const end = output.indexOf(marker, valueStart);
      if (end === -1) continue;
      const value = output.slice(valueStart, end).trim();
      if (value.length > 0) {
        process.env[key] = value;
      }
    }
  } catch {
    // Keep inherited environment if shell lookup fails.
  }
}

syncShellEnvironment();

const isDev = !app.isPackaged;

// ---------------------------------------------------------------------------
// Server process management
// ---------------------------------------------------------------------------

let serverProcess: ChildProcess | null = null;
let serverPort = 0;
let serverLogStream: fs.WriteStream | null = null;

function appendMainLog(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  if (serverLogStream) {
    serverLogStream.write(line);
  }
  process.stderr.write(line);
}

function ensurePackagedLogging(): void {
  if (!app.isPackaged || serverLogStream) return;
  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });
  serverLogStream = fs.createWriteStream(path.join(userDataDir, "server-child.log"), {
    flags: "a",
  });
}

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
  ensurePackagedLogging();
  const serverEntry = isDev
    ? path.join(__dirname, "../dist-server/main.mjs")
    : path.join(__dirname, "../dist-server/main.mjs");

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
      if (serverLogStream) serverLogStream.write(chunk);
      stdout += chunk.toString();
      const match = stdout.match(/BETTERGIT_SERVER_PORT=(\d+)/);
      if (match) {
        clearTimeout(timer);
        serverPort = parseInt(match[1], 10);
        resolve(serverPort);
      }
    });

    serverProcess!.stderr!.on("data", (chunk: Buffer) => {
      if (serverLogStream) serverLogStream.write(chunk);
      process.stderr.write(`[server] ${chunk.toString()}`);
    });

    serverProcess!.on("error", (err) => {
      clearTimeout(timer);
      appendMainLog(`server process error: ${err.message}`);
      reject(err);
    });

    serverProcess!.on("exit", (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timer);
        appendMainLog(`server exited before ready with code ${code}`);
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
  if (serverLogStream) {
    serverLogStream.end();
    serverLogStream = null;
  }
}

// ---------------------------------------------------------------------------
// Window management
// ---------------------------------------------------------------------------

function createWindow() {
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

  const nativeTerminalAddon = loadNativeTerminalAddon();
  if (nativeTerminalAddon) {
    nativeTerminalAddon.initializeHost(win.getNativeWindowHandle());
    win.on("focus", () => nativeTerminalAddon.setAppFocused(true));
    win.on("blur", () => nativeTerminalAddon.setAppFocused(false));
    win.on("closed", () => nativeTerminalAddon.shutdownHost());
  }
}

// ---------------------------------------------------------------------------
// Application menu — set once, not per-window
// ---------------------------------------------------------------------------

function setupApplicationMenu() {
  const sendToRenderer = (channel: string) => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) focused.webContents.send(channel);
  };

  const template: Electron.MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        {
          label: "New Terminal Tab",
          accelerator: "CmdOrCtrl+T",
          click: () => sendToRenderer("terminal:new-tab"),
        },
        { type: "separator" },
        {
          label: "Close",
          accelerator: "CmdOrCtrl+W",
          click: () => sendToRenderer("app:close-pane-or-window"),
        },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  setupApplicationMenu();

  try {
    await startServer();
    console.log(`[main] Server running on port ${serverPort}`);
  } catch (err) {
    console.error("[main] Failed to start server:", err);
    const message = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox(
      "BetterGit failed to start",
      `The bundled server did not start correctly.\n\n${message}\n\n` +
        `If this is a packaged build, check the server log in:\n${path.join(app.getPath("userData"), "server-child.log")}`,
    );
    app.quit();
    return;
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

const KNOWN_TERMINALS = ["Ghostty", "iTerm", "Warp", "Alacritty", "kitty", "Hyper", "Terminal"];
let cachedDetected: string[] | null = null;

function detectInstalledTerminals(): string[] {
  if (cachedDetected) return cachedDetected;
  if (process.platform !== "darwin") {
    cachedDetected = ["Terminal"];
    return cachedDetected;
  }
  const found: string[] = [];
  for (const app of KNOWN_TERMINALS) {
    try {
      execFileSync("open", ["-Ra", app], { stdio: "ignore" });
      found.push(app);
    } catch { /* not installed */ }
  }
  cachedDetected = found.length > 0 ? found : ["Terminal"];
  return cachedDetected;
}

ipcMain.handle("shell:detectTerminals", (): string[] => detectInstalledTerminals());

ipcMain.handle("shell:openTerminal", async (_event, dirPath: string, terminalApp?: string): Promise<void> => {
  if (process.platform === "darwin") {
    const app = terminalApp ?? detectInstalledTerminals()[0];
    spawn("open", ["-a", app, dirPath], { detached: true, stdio: "ignore" });
  } else if (process.platform === "win32") {
    spawn("cmd.exe", ["/c", "start", "cmd", "/K", `cd /d "${dirPath}"`], { detached: true, stdio: "ignore" });
  } else {
    for (const term of ["x-terminal-emulator", "gnome-terminal", "konsole", "xterm"]) {
      try {
        spawn(term, [], { cwd: dirPath, detached: true, stdio: "ignore" });
        break;
      } catch { /* try next */ }
    }
  }
});

ipcMain.handle("server:getPort", () => serverPort);

ipcMain.handle("terminal-host:isAvailable", () => loadNativeTerminalAddon() !== null);

ipcMain.handle("terminal-host:createSurface", (event, surfaceId: string, cwd: string) => {
  const addon = loadNativeTerminalAddon();
  if (!addon) return false;
  return addon.createSurface(surfaceId, cwd);
});

ipcMain.handle("terminal-host:destroySurface", (_event, surfaceId: string) => {
  const addon = loadNativeTerminalAddon();
  addon?.destroySurface(surfaceId);
});

ipcMain.handle(
  "terminal-host:setSurfaceBounds",
  (event, surfaceId: string, bounds: NativeTerminalBounds) => {
    const addon = loadNativeTerminalAddon();
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!addon || !win) return;
    const [, contentHeight] = win.getContentSize();
    addon.setSurfaceBounds(surfaceId, {
      x: bounds.x,
      y: contentHeight - bounds.y - bounds.height,
      width: bounds.width,
      height: bounds.height,
    });
  },
);

ipcMain.handle("terminal-host:setSurfaceBackground", (_event, surfaceId: string, color: string) => {
  const addon = loadNativeTerminalAddon();
  addon?.setSurfaceBackground(surfaceId, color);
});

ipcMain.handle("terminal-host:getResolvedAppearance", () => {
  const addon = loadNativeTerminalAddon();
  return addon?.getResolvedAppearance();
});

ipcMain.handle("terminal-host:setSurfaceVisible", (_event, surfaceId: string, visible: boolean) => {
  const addon = loadNativeTerminalAddon();
  addon?.setSurfaceVisible(surfaceId, visible);
});

ipcMain.handle("terminal-host:focusSurface", (_event, surfaceId: string) => {
  const addon = loadNativeTerminalAddon();
  addon?.focusSurface(surfaceId);
});

ipcMain.handle("terminal-host:splitSurface", (_event, surfaceId: string, direction: "right" | "down" | "left" | "up") => {
  const addon = loadNativeTerminalAddon();
  addon?.splitSurface(surfaceId, direction);
});

// ---------------------------------------------------------------------------
// Persistent settings — survives dev restarts (file-backed, not localStorage)
// ---------------------------------------------------------------------------

const settingsPath = path.join(app.getPath("userData"), "bettergit-settings.json");

function loadSettings(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    return {};
  }
}

function saveSettings(data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(data, null, 2));
}

ipcMain.handle("settings:load", () => loadSettings());
ipcMain.handle("settings:save", (_event, data: Record<string, unknown>) => {
  saveSettings(data);
});
