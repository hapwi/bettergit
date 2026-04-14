export type DesktopUpdateStatus =
  | "idle"
  | "disabled"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "up-to-date"
  | "error";

export type DesktopUpdateErrorContext = "check" | "download" | "install" | null;

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: DesktopUpdateErrorContext;
}

export interface DesktopUpdateCheckResult {
  checked: boolean;
  state: DesktopUpdateState;
}

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export function createInitialUpdateState(
  currentVersion: string,
  enabled = false,
  message: string | null = null,
): DesktopUpdateState {
  return {
    enabled,
    status: enabled ? "idle" : "disabled",
    currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    checkedAt: null,
    message,
    errorContext: null,
  };
}

export function getAutoUpdateDisabledReason(input: {
  isPackaged: boolean;
  disabledByEnv: boolean;
  hasUpdateFeedConfig: boolean;
}): string | null {
  if (input.disabledByEnv) {
    return "Automatic updates are disabled by BETTERGIT_DISABLE_AUTO_UPDATE.";
  }
  if (!input.isPackaged) {
    return "Automatic updates are only available in packaged builds.";
  }
  if (!input.hasUpdateFeedConfig) {
    return "Automatic updates are not available because no update feed is configured.";
  }
  return null;
}
