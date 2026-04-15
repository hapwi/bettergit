import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { autoUpdater } from "electron-updater";
import {
  createInitialUpdateState,
  getAutoUpdateDisabledReason,
  type DesktopUpdateActionResult,
  type DesktopUpdateState,
} from "./update";
import { stopServer } from "./server-manager";

export const UPDATE_STATE_CHANNEL = "desktop:update-state";
export const UPDATE_GET_STATE_CHANNEL = "desktop:update-get-state";
export const UPDATE_CHECK_CHANNEL = "desktop:update-check";
export const UPDATE_DOWNLOAD_CHANNEL = "desktop:update-download";
export const UPDATE_INSTALL_CHANNEL = "desktop:update-install";

const AUTO_UPDATE_STARTUP_DELAY_MS = 15_000;
const AUTO_UPDATE_POLL_INTERVAL_MS = 4 * 60 * 60 * 1000;

let updatePollTimer: ReturnType<typeof setInterval> | null = null;
let updateStartupTimer: ReturnType<typeof setTimeout> | null = null;
let updateCheckInFlight = false;
let updateDownloadInFlight = false;
let updateInstallInFlight = false;
let updaterConfigured = false;
let updateState: DesktopUpdateState = createInitialUpdateState(app.getVersion());

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

export function clearUpdateTimers(): void {
  if (updateStartupTimer) {
    clearTimeout(updateStartupTimer);
    updateStartupTimer = null;
  }
  if (updatePollTimer) {
    clearInterval(updatePollTimer);
    updatePollTimer = null;
  }
}

export async function checkForUpdates(reason: string): Promise<boolean> {
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

export async function downloadAvailableUpdate(): Promise<DesktopUpdateActionResult> {
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

export async function installDownloadedUpdate(setQuitting: () => void): Promise<DesktopUpdateActionResult> {
  if (!updaterConfigured || updateInstallInFlight || updateState.status !== "downloaded") {
    return { accepted: false, completed: false, state: updateState };
  }

  updateInstallInFlight = true;
  clearUpdateTimers();

  try {
    setQuitting();
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

export function getUpdateState(): DesktopUpdateState {
  return updateState;
}

export function configureAutoUpdater(): void {
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
