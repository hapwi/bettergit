import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useMemo, useState } from "react";
import { Rows3, Columns2, WrapText, X, ChevronRight } from "lucide-react";
import { useAppStore } from "@/store";
import { gitDiffPatchQueryOptions } from "@/lib/git/queries";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { DiffWorkerPoolProvider } from "./DiffWorkerPoolProvider";

type DiffRenderMode = "unified" | "split";

const DIFF_UNSAFE_CSS = `
:host,
[data-diffs-header],
[data-diff],
[data-file],
[data-error-wrapper],
[data-virtualizer-buffer] {
  --diffs-bg: var(--background) !important;
  --diffs-light-bg: var(--background) !important;
  --diffs-dark-bg: var(--background) !important;
  --diffs-token-light-bg: transparent !important;
  --diffs-token-dark-bg: transparent !important;
  --diffs-font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace !important;
  --diffs-font-size: 12px !important;
  --diffs-line-height: 20px !important;

  --diffs-bg-context-override: var(--background) !important;
  --diffs-bg-hover-override: color-mix(in srgb, var(--background) 94%, var(--foreground)) !important;
  --diffs-bg-separator-override: color-mix(in srgb, var(--background) 95%, var(--foreground)) !important;
  --diffs-bg-buffer-override: var(--background) !important;

  --diffs-bg-addition-override: color-mix(in srgb, var(--background) 90%, #22c55e) !important;
  --diffs-bg-addition-number-override: color-mix(in srgb, var(--background) 85%, #22c55e) !important;
  --diffs-bg-addition-hover-override: color-mix(in srgb, var(--background) 82%, #22c55e) !important;
  --diffs-bg-addition-emphasis-override: color-mix(in srgb, var(--background) 75%, #22c55e) !important;

  --diffs-bg-deletion-override: color-mix(in srgb, var(--background) 90%, #ef4444) !important;
  --diffs-bg-deletion-number-override: color-mix(in srgb, var(--background) 85%, #ef4444) !important;
  --diffs-bg-deletion-hover-override: color-mix(in srgb, var(--background) 82%, #ef4444) !important;
  --diffs-bg-deletion-emphasis-override: color-mix(in srgb, var(--background) 75%, #ef4444) !important;

  --diffs-gutter-color: color-mix(in srgb, var(--foreground) 30%, transparent) !important;

  background-color: var(--background) !important;
  color: var(--foreground) !important;
}

[data-file-info] {
  background-color: color-mix(in srgb, var(--background) 92%, var(--foreground)) !important;
  border-block-color: color-mix(in srgb, var(--border) 60%, transparent) !important;
  color: var(--foreground) !important;
  font-family: inherit !important;
  font-size: 12px !important;
}

[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  background-color: color-mix(in srgb, var(--background) 92%, var(--foreground)) !important;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent) !important;
}

[data-separator] {
  background-color: color-mix(in srgb, var(--background) 95%, var(--foreground)) !important;
  color: color-mix(in srgb, var(--foreground) 50%, transparent) !important;
  font-size: 11px !important;
  margin-top: 2px !important;
}
`;

function countFileDiffStats(fileDiff: FileDiffMetadata): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of fileDiff.hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  return { additions, deletions };
}

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

function DiffViewerContent({ open }: { open: boolean }) {
  const repoCwd = useAppStore((s) => s.repoCwd);
  const [renderMode, setRenderMode] = useState<DiffRenderMode>("unified");
  const [wordWrap, setWordWrap] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  const toggleFileExpanded = useCallback((key: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const resolvedTheme = document.documentElement.classList.contains("light")
    ? "light"
    : "dark";
  const diffThemeName = resolvedTheme === "light" ? "pierre-light" : "pierre-dark";

  const { data: patch, isLoading } = useQuery(
    gitDiffPatchQueryOptions(repoCwd, open),
  );

  const renderableFiles = useMemo(() => {
    if (!patch) return [];
    const normalized = patch.trim();
    if (normalized.length === 0) return [];
    try {
      const parsed = parsePatchFiles(normalized, `diff-viewer:${normalized.length}`);
      const files = parsed.flatMap((p) => p.files);
      return [...files].sort((a: FileDiffMetadata, b: FileDiffMetadata) =>
        resolveFileDiffPath(a).localeCompare(resolveFileDiffPath(b), undefined, {
          numeric: true,
          sensitivity: "base",
        }),
      );
    } catch {
      return [];
    }
  }, [patch]);

  const totalStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const f of renderableFiles) {
      const s = countFileDiffStats(f);
      additions += s.additions;
      deletions += s.deletions;
    }
    return { additions, deletions };
  }, [renderableFiles]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <DrawerTitle className="text-sm">Local Changes</DrawerTitle>
          {renderableFiles.length > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground">
              {renderableFiles.length} file{renderableFiles.length !== 1 ? "s" : ""}
              <span className="mx-1.5 text-muted-foreground/40">·</span>
              <span className="text-emerald-500">+{totalStats.additions}</span>
              <span className="mx-0.5 text-muted-foreground/40">/</span>
              <span className="text-red-500">−{totalStats.deletions}</span>
            </span>
          )}
          <DrawerDescription className="sr-only">
            Diff view of local uncommitted changes
          </DrawerDescription>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 rounded-md border bg-muted/50 p-0.5">
            <button
              type="button"
              onClick={() => setRenderMode("unified")}
              className={cn(
                "flex items-center rounded-[5px] p-1.5 transition-colors",
                renderMode === "unified"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label="Unified diff view"
            >
              <Rows3 className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setRenderMode("split")}
              className={cn(
                "flex items-center rounded-[5px] p-1.5 transition-colors",
                renderMode === "split"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              aria-label="Split diff view"
            >
              <Columns2 className="size-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setWordWrap(!wordWrap)}
            className={cn(
              "rounded-md p-1.5 transition-colors",
              wordWrap
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
            aria-label={wordWrap ? "Disable line wrapping" : "Enable line wrapping"}
          >
            <WrapText className="size-3.5" />
          </button>
          <DrawerClose className="rounded-md p-1.5 text-muted-foreground transition-colors hover:text-foreground">
            <X className="size-3.5" />
          </DrawerClose>
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden" data-vaul-no-drag>
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground/70">
            Loading diff...
          </div>
        ) : renderableFiles.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground/70">
            No local changes
          </div>
        ) : (
          <Virtualizer
            className="h-full min-h-0 overflow-auto px-2 pb-2"
            style={{ scrollbarWidth: "none" } as React.CSSProperties}
            config={{
              overscrollSize: 600,
              intersectionObserverMargin: 1200,
            }}
          >
            {renderableFiles.map((fileDiff: FileDiffMetadata) => {
              const filePath = resolveFileDiffPath(fileDiff);
              const fileKey = buildFileDiffRenderKey(fileDiff);
              const themedKey = `${fileKey}:${resolvedTheme}`;
              const isExpanded = expandedFiles.has(fileKey);
              return (
                <div key={themedKey} className="mb-2 rounded-md border border-border/40 first:mt-2 last:mb-0"
                  style={{ contain: "paint" }}
                >
                  <button
                    type="button"
                    onClick={() => toggleFileExpanded(fileKey)}
                    className="sticky top-0 z-10 flex w-full items-center gap-2 bg-background px-3 py-2 text-left text-xs transition-colors hover:bg-muted"
                  >
                    <ChevronRight className={cn(
                      "size-3 shrink-0 text-muted-foreground transition-transform",
                      isExpanded && "rotate-90",
                    )} />
                    <span className="min-w-0 flex-1 truncate font-mono">{filePath}</span>
                    {(() => {
                      const stats = countFileDiffStats(fileDiff);
                      return (
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          <span className="text-emerald-500">+{stats.additions}</span>
                          <span className="mx-1 text-muted-foreground/40">/</span>
                          <span className="text-red-500">−{stats.deletions}</span>
                        </span>
                      );
                    })()}
                  </button>
                  {isExpanded && (
                    <div className="border-t border-border/40">
                    <FileDiff
                      fileDiff={fileDiff}
                      options={{
                        diffStyle: renderMode === "split" ? "split" : "unified",
                        lineDiffType: "none",
                        overflow: wordWrap ? "wrap" : "scroll",
                        theme: diffThemeName,
                        themeType: resolvedTheme as "light" | "dark",
                        unsafeCSS: DIFF_UNSAFE_CSS + "\n[data-diffs-header] { display: none !important; }",
                      }}
                    />
                    </div>
                  )}
                </div>
              );
            })}
          </Virtualizer>
        )}
      </div>
    </div>
  );
}

export function DiffViewer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[80vh] max-h-[96vh]">
        <div className="min-h-0 flex-1 overflow-hidden">
          <DiffWorkerPoolProvider>
            <DiffViewerContent open={open} />
          </DiffWorkerPoolProvider>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
