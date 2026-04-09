/**
 * Branch name sanitization utilities — ported from hapcode's @t3tools/shared/git.
 */

export function sanitizeBranchFragment(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/['"`]/g, "")
    .replace(/^[./\s_-]+|[./\s_-]+$/g, "");

  const branchFragment = normalized
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/+/g, "/")
    .replace(/-+/g, "-")
    .replace(/^[./_-]+|[./_-]+$/g, "")
    .slice(0, 64)
    .replace(/[./_-]+$/g, "");

  return branchFragment.length > 0 ? branchFragment : "update";
}

const BRANCH_TYPE_PREFIXES = [
  "feature/", "fix/", "bug/", "chore/", "refactor/", "hotfix/", "docs/", "test/", "style/",
];

export function sanitizeFeatureBranchName(raw: string): string {
  const sanitized = sanitizeBranchFragment(raw);
  if (BRANCH_TYPE_PREFIXES.some((p) => sanitized.startsWith(p))) {
    return sanitized;
  }
  return `feature/${sanitized}`;
}

export function resolveAutoFeatureBranchName(
  existingBranchNames: readonly string[],
  preferredBranch?: string,
): string {
  const preferred = preferredBranch?.trim();
  const resolvedBase = sanitizeFeatureBranchName(
    preferred && preferred.length > 0 ? preferred : "feature/update",
  );
  const existingNames = new Set(existingBranchNames.map((b) => b.toLowerCase()));

  if (!existingNames.has(resolvedBase)) return resolvedBase;

  let suffix = 2;
  while (existingNames.has(`${resolvedBase}-${suffix}`)) {
    suffix += 1;
  }
  return `${resolvedBase}-${suffix}`;
}
