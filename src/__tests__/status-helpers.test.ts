import { describe, it, expect } from "vitest";
import {
  getWorkingTreeDisplayStatusLabel,
  getWorkingTreeDisplayStatusPriority,
} from "../lib/git/status";
import type { WorkingTreeDisplayStatus } from "../../shared/git";

describe("getWorkingTreeDisplayStatusLabel", () => {
  const cases: Array<[WorkingTreeDisplayStatus, string]> = [
    ["A", "Added"],
    ["C", "Conflict"],
    ["D", "Deleted"],
    ["M", "Modified"],
    ["R", "Renamed"],
    ["U", "Untracked"],
  ];

  it.each(cases)("returns '%s' → '%s'", (status, label) => {
    expect(getWorkingTreeDisplayStatusLabel(status)).toBe(label);
  });
});

describe("getWorkingTreeDisplayStatusPriority", () => {
  it("ranks C > D > R > A > M > U", () => {
    const c = getWorkingTreeDisplayStatusPriority("C");
    const d = getWorkingTreeDisplayStatusPriority("D");
    const r = getWorkingTreeDisplayStatusPriority("R");
    const a = getWorkingTreeDisplayStatusPriority("A");
    const m = getWorkingTreeDisplayStatusPriority("M");
    const u = getWorkingTreeDisplayStatusPriority("U");
    expect(c).toBeGreaterThan(d);
    expect(d).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(a);
    expect(a).toBeGreaterThan(m);
    expect(m).toBeGreaterThan(u);
  });
});
