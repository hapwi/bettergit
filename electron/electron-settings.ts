import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

const settingsPath = path.join(app.getPath("userData"), "bettergit-settings.json");

export function loadSettings(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    return {};
  }
}

export function saveSettings(data: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  const next = { ...loadSettings(), ...data };
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2));
}
