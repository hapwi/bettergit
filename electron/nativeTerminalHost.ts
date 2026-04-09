import path from "node:path";
import { createRequire } from "node:module";

export interface NativeTerminalBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface NativeTerminalAddon {
  isAvailable(): boolean;
  initializeHost(windowHandle: Buffer): boolean;
  shutdownHost(): void;
  createSurface(surfaceId: string, cwd: string): boolean;
  destroySurface(surfaceId: string): void;
  setSurfaceBounds(surfaceId: string, bounds: NativeTerminalBounds): void;
  getResolvedAppearance(): { backgroundColor?: string; backgroundOpacity?: number } | undefined;
  setSurfaceBackground(surfaceId: string, color: string): void;
  setSurfaceVisible(surfaceId: string, visible: boolean): void;
  focusSurface(surfaceId: string): void;
  splitSurface(surfaceId: string, direction: "right" | "down" | "left" | "up"): void;
  setAppFocused(focused: boolean): void;
}

let cachedAddon: NativeTerminalAddon | null = null;
let cachedFailure: string | null = null;

export function loadNativeTerminalAddon(): NativeTerminalAddon | null {
  if (cachedAddon) return cachedAddon;
  if (cachedFailure) return null;
  if (process.platform !== "darwin") {
    cachedFailure = "native terminal host is only supported on macOS";
    return null;
  }

  try {
    const require = createRequire(__filename);
    const addonPath = path.join(__dirname, "../native/native_terminal_host/build/Release/native_terminal_host.node");
    cachedAddon = require(addonPath) as NativeTerminalAddon;
    return cachedAddon;
  } catch (error) {
    cachedFailure = error instanceof Error ? error.message : String(error);
    return null;
  }
}

export function getNativeTerminalHostFailure(): string | null {
  return cachedFailure;
}
