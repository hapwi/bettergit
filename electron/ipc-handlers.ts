import { dialog, ipcMain, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { TerminalSessionManager } from "./terminalSessionManager";
import type { DesktopUpdateActionResult, DesktopUpdateCheckResult, DesktopUpdateState } from "./update";
import { ensureServerRunning, restartServer } from "./server-manager";
import { loadSettings, saveSettings } from "./electron-settings";
import { detectInstalledTerminals } from "./terminal-detection";
import {
  UPDATE_GET_STATE_CHANNEL,
  UPDATE_CHECK_CHANNEL,
  UPDATE_DOWNLOAD_CHANNEL,
  UPDATE_INSTALL_CHANNEL,
  getUpdateState,
  checkForUpdates,
  downloadAvailableUpdate,
  installDownloadedUpdate,
} from "./updater";

export function registerIpcHandlers(deps: {
  getTerminalSessionManager: () => TerminalSessionManager | null;
  setAppIsQuitting: () => void;
}): void {
  // --- Dialog ---
  ipcMain.handle("dialog:openDirectory", async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Open Repository",
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // --- Shell ---
  ipcMain.handle("shell:openExternal", async (_event, url: string): Promise<void> => {
    await shell.openExternal(url);
  });

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

  // --- Server ---
  ipcMain.handle("server:getPort", async () => ensureServerRunning("renderer:getPort"));
  ipcMain.handle("server:restart", async () => restartServer("renderer:restart"));

  // --- Project ---
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

  // --- Terminal ---
  ipcMain.handle("terminal:openSession", (_event, input: {
    projectPath: string;
    tabId: string;
    cwd: string;
    cols: number;
    rows: number;
  }) => {
    const mgr = deps.getTerminalSessionManager();
    if (!mgr) throw new Error("Terminal manager is not ready");
    return mgr.open(input);
  });

  ipcMain.handle("terminal:writeToSession", (_event, input: {
    projectPath: string;
    tabId: string;
    data: string;
  }) => {
    const mgr = deps.getTerminalSessionManager();
    if (!mgr) throw new Error("Terminal manager is not ready");
    mgr.write(input.projectPath, input.tabId, input.data);
  });

  ipcMain.handle("terminal:resizeSession", (_event, input: {
    projectPath: string;
    tabId: string;
    cols: number;
    rows: number;
  }) => {
    const mgr = deps.getTerminalSessionManager();
    if (!mgr) throw new Error("Terminal manager is not ready");
    mgr.resize(input.projectPath, input.tabId, input.cols, input.rows);
  });

  ipcMain.handle("terminal:closeSession", (_event, input: {
    projectPath: string;
    tabId: string;
    deleteHistory?: boolean;
  }) => {
    const mgr = deps.getTerminalSessionManager();
    if (!mgr) return;
    mgr.closeSession(input.projectPath, input.tabId, input.deleteHistory !== false);
  });

  ipcMain.handle("terminal:closeProject", (_event, input: {
    projectPath: string;
    deleteHistory?: boolean;
  }) => {
    const mgr = deps.getTerminalSessionManager();
    if (!mgr) return;
    mgr.closeProject(input.projectPath, input.deleteHistory !== false);
  });

  ipcMain.handle("terminal:renameProject", (_event, input: {
    oldPath: string;
    newPath: string;
  }) => {
    const mgr = deps.getTerminalSessionManager();
    if (!mgr) return;
    mgr.renameProject(input.oldPath, input.newPath);
  });

  // --- Settings ---
  ipcMain.handle("settings:load", () => loadSettings());
  ipcMain.handle("settings:save", (_event, data: Record<string, unknown>) => {
    saveSettings(data);
  });

  // --- Updates ---
  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, async (): Promise<DesktopUpdateState> => getUpdateState());

  ipcMain.handle(UPDATE_CHECK_CHANNEL, async (): Promise<DesktopUpdateCheckResult> => {
    const checked = await checkForUpdates("manual");
    return { checked, state: getUpdateState() };
  });

  ipcMain.handle(UPDATE_DOWNLOAD_CHANNEL, async (): Promise<DesktopUpdateActionResult> => {
    return downloadAvailableUpdate();
  });

  ipcMain.handle(UPDATE_INSTALL_CHANNEL, async (): Promise<DesktopUpdateActionResult> => {
    return installDownloadedUpdate(deps.setAppIsQuitting);
  });
}
