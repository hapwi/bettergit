import { describe, expect, it } from "vitest";
import { getReleaseRunwayState } from "@/lib/git/release-runway";

describe("getReleaseRunwayState", () => {
  it("recomputes the release guidance from the provided current time", () => {
    const early = getReleaseRunwayState({
      latestTag: "v1.2.3",
      latestTagDate: "2026-04-01T00:00:00.000Z",
      commitsSinceLatestTag: 12,
      now: Date.parse("2026-04-10T00:00:00.000Z"),
    });

    const later = getReleaseRunwayState({
      latestTag: "v1.2.3",
      latestTagDate: "2026-04-01T00:00:00.000Z",
      commitsSinceLatestTag: 12,
      now: Date.parse("2026-04-15T00:00:00.000Z"),
    });

    expect(early.daysSince).toBe(9);
    expect(early.label).toBe("12 unreleased commits — consider a patch release.");
    expect(later.daysSince).toBe(14);
    expect(later.label).toBe("12 commits over 14d — a minor release is recommended.");
  });

  it("returns the no-release state when no tag exists", () => {
    expect(
      getReleaseRunwayState({
        latestTag: null,
        latestTagDate: null,
        commitsSinceLatestTag: 4,
      }),
    ).toEqual({
      daysSince: null,
      label: "No releases yet — consider tagging your first version.",
      tone: "text-muted-foreground",
    });
  });
});
