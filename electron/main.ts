import { app, BrowserWindow, dialog, powerMonitor } from "electron";
import path from "node:path";
import { TerminalSessionManager } from "./terminalSessionManager";
import { syncShellEnvironment } from "./shell-env";
import { ensureServerRunning, stopServer, setAppIsQuitting, getServerPort } from "./server-manager";
import { configureAutoUpdater, clearUpdateTimers } from "./updater";
import { createWindow } from "./window";
import { setupApplicationMenu } from "./menu";
import { saveSettings } from "./electron-settings";
import { registerIpcHandlers } from "./ipc-handlers";

// Resolve shell PATH before anything else
syncShellEnvironment();

let terminalSessionManager: TerminalSessionManager | null = null;

function markAppIsQuitting(): void {
  setAppIsQuitting(true);
}

// Register IPC handlers (must happen before app.whenReady)
registerIpcHandlers({
  getTerminalSessionManager: () => terminalSessionManager,
  setAppIsQuitting: markAppIsQuitting,
});

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
        console.error(`[main] resume server check failed: ${message}`);
      });
    });
    powerMonitor.on("unlock-screen", () => {
      void ensureServerRunning("unlock-screen").catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[main] unlock server check failed: ${message}`);
      });
    });

    await ensureServerRunning("app-ready");
    console.log(`[main] Server running on port ${getServerPort()}`);
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
    markAppIsQuitting();
    stopServer();
    app.quit();
  }
});

app.on("before-quit", () => {
  markAppIsQuitting();
  clearUpdateTimers();
  terminalSessionManager?.shutdown();
  stopServer();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
