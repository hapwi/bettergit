import { app, BrowserWindow, dialog, ipcMain, Menu, powerMonitor, shell } from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { autoUpdater } from "electron-updater";
import { TerminalSessionManager } from "./terminalSessionManager";
import {
  createInitialUpdateState,
  getAutoUpdateDisabledReason,
  type DesktopUpdateActionResult,
  type DesktopUpdateCheckResult,
  type DesktopUpdateState,
} from "./update";

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
const UPDATE_STATE_CHANNEL = "desktop:update-state";
const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
const UPDATE_CHECK_CHANNEL = "desktop:update-check";
const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
const UPDATE_INSTALL_CHANNEL = "desktop:update-install";
const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Server process management
// ---------------------------------------------------------------------------

let serverProcess: ChildProcess | null = null;
let serverPort = 0;
let serverLogStream: fs.WriteStream | null = null;
let serverStartPromise: Promise<number> | null = null;
let serverRestartTimer: ReturnType<typeof setTimeout> | null = null;
let terminalSessionManager: TerminalSessionManager | null = null;
let updatePollTimer: ReturnType<typeof setInterval> | null = null;
let updateStartupTimer: ReturnType<typeof setTimeout> | null = null;
let updateCheckInFlight = false;
let updateDownloadInFlight = false;
let updateInstallInFlight = false;
let updaterConfigured = false;
let updateState: DesktopUpdateState = createInitialUpdateState(app.getVersion());
let appIsQuitting = false;

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

function clearServerRestartTimer(): void {
  if (!serverRestartTimer) return;
  clearTimeout(serverRestartTimer);
  serverRestartTimer = null;
}

function isServerProcessAlive(processRef: ChildProcess | null = serverProcess): boolean {
  return Boolean(processRef && !processRef.killed && processRef.exitCode === null);
}

function scheduleServerRestart(reason: string): void {
  if (appIsQuitting || serverStartPromise || serverRestartTimer) return;
  appendMainLog(`scheduling server restart (${reason})`);
  serverRestartTimer = setTimeout(() => {
    serverRestartTimer = null;
    void ensureServerRunning(`restart:${reason}`).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      appendMainLog(`server restart failed (${reason}): ${message}`);
    });
  }, 1_000);
  serverRestartTimer.unref();
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

  const child = spawn(process.execPath, [serverEntry], {
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
  serverProcess = child;

  // Read the actual port from the server's stdout
  return new Promise((resolve, reject) => {
    let stdout = "";
    let ready = false;
    const timer = setTimeout(() => reject(new Error("Server startup timed out")), 10_000);

    child.stdout!.on("data", (chunk: Buffer) => {
      if (serverLogStream) serverLogStream.write(chunk);
      stdout += chunk.toString();
      const match = stdout.match(/BETTERGIT_SERVER_PORT=(\d+)/);
      if (match) {
        clearTimeout(timer);
        serverPort = parseInt(match[1], 10);
        ready = true;
        resolve(serverPort);
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      if (serverLogStream) serverLogStream.write(chunk);
      process.stderr.write(`[server] ${chunk.toString()}`);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (serverProcess === child) {
        serverProcess = null;
        serverPort = 0;
      }
      appendMainLog(`server process error: ${err.message}`);
      scheduleServerRestart(`error:${err.message}`);
      reject(err);
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (serverProcess === child) {
        serverProcess = null;
        serverPort = 0;
      }
      const detail = code !== null ? `code ${code}` : signal ? `signal ${signal}` : "unknown";
      appendMainLog(`server process exited (${detail})`);
      if (!ready) {
        reject(new Error(`Server exited with ${detail}`));
      }
      if (!appIsQuitting) {
        scheduleServerRestart(`exit:${detail}`);
      }
    });
  });
}

function stopServer() {
  clearServerRestartTimer();
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  serverPort = 0;
  if (serverLogStream) {
    serverLogStream.end();
    serverLogStream = null;
  }
}

async function ensureServerRunning(reason: string): Promise<number> {
  clearServerRestartTimer();

  if (isServerProcessAlive() && serverPort !== 0) {
    return serverPort;
  }
  if (serverStartPromise) {
    return serverStartPromise;
  }

  appendMainLog(`starting server (${reason})`);
  serverStartPromise = startServer()
    .finally(() => {
      serverStartPromise = null;
    });
  return serverStartPromise;
}

async function restartServer(reason: string): Promise<number> {
  appendMainLog(`restarting server (${reason})`);
  stopServer();
  return ensureServerRunning(`forced:${reason}`);
}

function readAppUpdateYml(): Record<string, string> | null {
  try {
    const ymlPath = app.isPackaged
      ? path.join(process.resourcesPath, "app-update.yml")
      : path.join(app.getAppPath(), "dev-app-update.yml");
    const raw = fs.readFileSync(ymlPath, "utf-8");
    const entries: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match?.[1] && match[2]) {
        entries[match[1]] = match[2].trim();
      }
    }
    return entries.provider ? entries : null;
  } catch {
    return null;
  }
}

function emitUpdateState(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    window.webContents.send(UPDATE_STATE_CHANNEL, updateState);
  }
}

function setUpdateState(patch: Partial<DesktopUpdateState>): void {
  updateState = { ...updateState, ...patch };
  emitUpdateState();
}

function getUpdateDisabledReason(): string | null {
  return getAutoUpdateDisabledReason({
    isPackaged: app.isPackaged,
    disabledByEnv: process.env.BETTERGIT_DISABLE_AUTO_UPDATE === "1",
    hasUpdateFeedConfig: readAppUpdateYml() !== null,
  });
}

function clearUpdateTimers(): void {
  if (updateStartupTimer) {
    clearTimeout(updateStartupTimer);
    updateStartupTimer = null;
  }
  if (updatePollTimer) {
    clearInterval(updatePollTimer);
    updatePollTimer = null;
  }
}

async function checkForUpdates(reason: string): Promise<boolean> {
  if (!updaterConfigured || updateCheckInFlight || updateDownloadInFlight || updateInstallInFlight) {
    return false;
  }

  updateCheckInFlight = true;
  setUpdateState({
    status: "checking",
    message: null,
    errorContext: null,
  });

  try {
    console.info(`[desktop-updater] Checking for updates (${reason})...`);
    await autoUpdater.checkForUpdates();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateState({
      status: "error",
      checkedAt: new Date().toISOString(),
      message,
      errorContext: "check",
    });
    console.error(`[desktop-updater] Failed to check for updates: ${message}`);
    return false;
  } finally {
    updateCheckInFlight = false;
  }
}

async function downloadAvailableUpdate(): Promise<DesktopUpdateActionResult> {
  if (!updaterConfigured || updateDownloadInFlight || updateState.status !== "available") {
    return { accepted: false, completed: false, state: updateState };
  }

  updateDownloadInFlight = true;
  setUpdateState({
    status: "downloading",
    message: null,
    errorContext: null,
    downloadPercent: 0,
  });

  try {
    await autoUpdater.downloadUpdate();
    return { accepted: true, completed: true, state: updateState };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setUpdateState({
      status: "error",
      message,
      errorContext: "download",
    });
    console.error(`[desktop-updater] Failed to download update: ${message}`);
    return { accepted: true, completed: false, state: updateState };
  } finally {
    updateDownloadInFlight = false;
  }
}

async function installDownloadedUpdate(): Promise<DesktopUpdateActionResult> {
  if (!updaterConfigured || updateInstallInFlight || updateState.status !== "downloaded") {
    return { accepted: false, completed: false, state: updateState };
  }

  updateInstallInFlight = true;
  clearUpdateTimers();

  try {
    appIsQuitting = true;
    stopServer();
    autoUpdater.quitAndInstall();
    return { accepted: true, completed: false, state: updateState };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateInstallInFlight = false;
    setUpdateState({
      status: "error",
      message,
      errorContext: "install",
    });
    console.error(`[desktop-updater] Failed to install update: ${message}`);
    return { accepted: true, completed: false, state: updateState };
  }
}

function configureAutoUpdater(): void {
  const disabledReason = getUpdateDisabledReason();
  if (disabledReason) {
    updateState = createInitialUpdateState(app.getVersion(), false, disabledReason);
    emitUpdateState();
    return;
  }

  const githubToken =
    process.env.BETTERGIT_UPDATE_GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || "";
  const appUpdateYml = readAppUpdateYml();

  updateState = createInitialUpdateState(app.getVersion(), true);
  updaterConfigured = true;

  if (githubToken && appUpdateYml?.provider === "github") {
    autoUpdater.setFeedURL({
      ...appUpdateYml,
      provider: "github" as const,
      private: true,
      token: githubToken,
    });
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("update-available", (info) => {
    setUpdateState({
      status: "available",
      availableVersion: info.version,
      downloadedVersion: null,
      downloadPercent: null,
      checkedAt: new Date().toISOString(),
      message: null,
      errorContext: null,
    });
    console.info(`[desktop-updater] Update available: ${info.version}`);
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateState({
      status: "up-to-date",
      availableVersion: null,
      downloadedVersion: null,
      downloadPercent: null,
      checkedAt: new Date().toISOString(),
      message: null,
      errorContext: null,
    });
    console.info("[desktop-updater] No updates available.");
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateState({
      status: "downloading",
      downloadPercent: progress.percent,
      message: null,
      errorContext: null,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    updateDownloadInFlight = false;
    setUpdateState({
      status: "downloaded",
      availableVersion: info.version,
      downloadedVersion: info.version,
      downloadPercent: 100,
      checkedAt: new Date().toISOString(),
      message: null,
      errorContext: null,
    });
    console.info(`[desktop-updater] Update downloaded: ${info.version}`);
  });

  autoUpdater.on("error", (error) => {
    const message = error instanceof Error ? error.message : String(error);
    const errorContext = updateInstallInFlight
      ? "install"
      : updateDownloadInFlight
        ? "download"
        : "check";
    updateDownloadInFlight = false;
    updateInstallInFlight = false;
    setUpdateState({
      status: "error",
      checkedAt: new Date().toISOString(),
      message,
      errorContext,
    });
    console.error(`[desktop-updater] Updater error: ${message}`);
  });

  emitUpdateState();

  updateStartupTimer = setTimeout(() => {
    updateStartupTimer = null;
    void checkForUpdates("startup");
  }, AUTO_UPDATE_STARTUP_DELAY_MS);
  updateStartupTimer.unref();

  updatePollTimer = setInterval(() => {
    void checkForUpdates("poll");
  }, AUTO_UPDATE_POLL_INTERVAL_MS);
  updatePollTimer.unref();
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
  // Terminal tabs and PTY history are runtime-only. Clear legacy persisted
  // state from older builds before creating the first window.
  saveSettings({ terminalProjects: {}, terminalSessions: {} });
  terminalSessionManager = new TerminalSessionManager();
  terminalSessionManager.subscribe((event) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("terminal:event", event);
    }
  });

  try {
    powerMonitor.on("resume", () => {
      void ensureServerRunning("power-resume").catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        appendMainLog(`resume server check failed: ${message}`);
      });
    });
    powerMonitor.on("unlock-screen", () => {
      void ensureServerRunning("unlock-screen").catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        appendMainLog(`unlock server check failed: ${message}`);
      });
    });

    await ensureServerRunning("app-ready");
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
  configureAutoUpdater();
  createWindow();
});

app.on("window-all-closed", () => {
  terminalSessionManager?.shutdown();
  if (process.platform !== "darwin") {
    appIsQuitting = true;
    stopServer();
    app.quit();
  }
});

app.on("before-quit", () => {
  appIsQuitting = true;
  clearUpdateTimers();
  terminalSessionManager?.shutdown();
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

ipcMain.handle("server:getPort", async () => ensureServerRunning("renderer:getPort"));
ipcMain.handle("server:restart", async () => restartServer("renderer:restart"));

ipcMain.handle("project:renameDirectory", (_event, currentPath: string, newName: string): string => {
  const trimmedName = newName.trim();
  if (!trimmedName) {
    throw new Error("Project name cannot be empty.");
  }
  if (trimmedName === "." || trimmedName === "..") {
    throw new Error("Choose a valid project name.");
  }
  if (
    trimmedName.includes(path.sep) ||
    trimmedName.includes(path.posix.sep) ||
    trimmedName.includes(path.win32.sep)
  ) {
    throw new Error("Project name cannot contain path separators.");
  }
  if (!fs.existsSync(currentPath)) {
    throw new Error("The project folder no longer exists.");
  }

  const nextPath = path.join(path.dirname(currentPath), trimmedName);
  if (nextPath === currentPath) {
    return currentPath;
  }
  if (fs.existsSync(nextPath)) {
    throw new Error("A folder with that name already exists.");
  }

  fs.renameSync(currentPath, nextPath);
  return nextPath;
});

ipcMain.handle("terminal:openSession", (_event, input: {
  projectPath: string;
  tabId: string;
  cwd: string;
  cols: number;
  rows: number;
}) => {
  if (!terminalSessionManager) throw new Error("Terminal manager is not ready");
  return terminalSessionManager.open(input);
});

ipcMain.handle("terminal:writeToSession", (_event, input: {
  projectPath: string;
  tabId: string;
  data: string;
}) => {
  if (!terminalSessionManager) throw new Error("Terminal manager is not ready");
  terminalSessionManager.write(input.projectPath, input.tabId, input.data);
});

ipcMain.handle("terminal:resizeSession", (_event, input: {
  projectPath: string;
  tabId: string;
  cols: number;
  rows: number;
}) => {
  if (!terminalSessionManager) throw new Error("Terminal manager is not ready");
  terminalSessionManager.resize(input.projectPath, input.tabId, input.cols, input.rows);
});

ipcMain.handle("terminal:closeSession", (_event, input: {
  projectPath: string;
  tabId: string;
  deleteHistory?: boolean;
}) => {
  if (!terminalSessionManager) return;
  terminalSessionManager.closeSession(input.projectPath, input.tabId, input.deleteHistory !== false);
});

ipcMain.handle("terminal:closeProject", (_event, input: {
  projectPath: string;
  deleteHistory?: boolean;
}) => {
  if (!terminalSessionManager) return;
  terminalSessionManager.closeProject(input.projectPath, input.deleteHistory !== false);
});

ipcMain.handle("terminal:renameProject", (_event, input: {
  oldPath: string;
  newPath: string;
}) => {
  if (!terminalSessionManager) return;
  terminalSessionManager.renameProject(input.oldPath, input.newPath);
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
  const next = { ...loadSettings(), ...data };
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2));
}

ipcMain.handle("settings:load", () => loadSettings());
ipcMain.handle("settings:save", (_event, data: Record<string, unknown>) => {
  saveSettings(data);
});

ipcMain.handle(UPDATE_GET_STATE_CHANNEL, async (): Promise<DesktopUpdateState> => updateState);

ipcMain.handle(UPDATE_CHECK_CHANNEL, async (): Promise<DesktopUpdateCheckResult> => {
  if (!updaterConfigured) {
    return { checked: false, state: updateState };
  }
  const checked = await checkForUpdates("manual");
  return { checked, state: updateState };
});

ipcMain.handle(UPDATE_DOWNLOAD_CHANNEL, async (): Promise<DesktopUpdateActionResult> => {
  return downloadAvailableUpdate();
});

ipcMain.handle(UPDATE_INSTALL_CHANNEL, async (): Promise<DesktopUpdateActionResult> => {
  return installDownloadedUpdate();
});
