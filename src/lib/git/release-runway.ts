export interface ReleaseRunwayStateInput {
  latestTag?: string | null;
  latestTagDate?: string | null;
  commitsSinceLatestTag: number;
  now?: number;
}

export interface ReleaseRunwayState {
  daysSince: number | null;
  label: string;
  tone: string;
}

export function getReleaseRunwayState({
  latestTag,
  latestTagDate,
  commitsSinceLatestTag,
  now = Date.now(),
}: ReleaseRunwayStateInput): ReleaseRunwayState {
  const daysSince = latestTagDate
    ? Math.floor((now - new Date(latestTagDate).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const hasTag = Boolean(latestTag);

  if (!hasTag) {
    return {
      daysSince,
      label: "No releases yet — consider tagging your first version.",
      tone: "text-muted-foreground",
    };
  }

  if (commitsSinceLatestTag === 0) {
    return {
      daysSince,
      label: "Fully released — no unreleased changes.",
      tone: "text-emerald-600 dark:text-emerald-400",
    };
  }

  if (commitsSinceLatestTag <= 3 && (daysSince === null || daysSince < 7)) {
    return {
      daysSince,
      label: "A few changes — no rush, but a patch release could be cut soon.",
      tone: "text-muted-foreground",
    };
  }

  if (commitsSinceLatestTag <= 10 || (daysSince !== null && daysSince < 14)) {
    return {
      daysSince,
      label: `${commitsSinceLatestTag} unreleased commits — consider a patch release.`,
      tone: "text-amber-700 dark:text-amber-400",
    };
  }

  if (commitsSinceLatestTag <= 30) {
    return {
      daysSince,
      label: `${commitsSinceLatestTag} commits over ${daysSince ?? "?"}d — a minor release is recommended.`,
      tone: "text-amber-700 dark:text-amber-400",
    };
  }

  return {
    daysSince,
    label: `${commitsSinceLatestTag} commits over ${daysSince ?? "?"}d — a minor or major release is overdue.`,
    tone: "text-rose-600 dark:text-rose-400",
  };
}
