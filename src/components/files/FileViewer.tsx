import { useState, useCallback, useRef, useEffect, useImperativeHandle, forwardRef, lazy, Suspense } from "react"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store"
import { readFile, writeFile, type FileContent } from "@/lib/files"
import { FileTree, FileTreeActions, type PendingAction } from "./FileTree"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { X, FileCode2, AlertTriangle } from "lucide-react"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpenFile {
  repoCwd: string
  path: string
  name: string
  originalContent: string
  language: string
  isBinary: boolean
  isTooLarge: boolean
  size: number
  mtimeMs: number
  isDirty: boolean
}

const FileEditor = lazy(async () => {
  const mod = await import("./FileEditor")
  return { default: mod.FileEditor }
})

// ---------------------------------------------------------------------------
// FileViewer
// ---------------------------------------------------------------------------

export interface FileViewerHandle {
  /** Close the active tab. Returns true if a tab was closed. */
  closeActiveTab: () => boolean
}

export const FileViewer = forwardRef<FileViewerHandle, { isActive?: boolean }>(function FileViewer({ isActive }, ref) {
  const repoCwd = useAppStore((s) => s.repoCwd)
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [treeWidth, setTreeWidth] = useState(220)
  const [pendingClosePath, setPendingClosePath] = useState<string | null>(null)
  const [expandAllVersion, setExpandAllVersion] = useState(0)
  const [collapseAllVersion, setCollapseAllVersion] = useState(0)
  const [pendingTreeAction, setPendingTreeAction] = useState<PendingAction | null>(null)
  const resizing = useRef(false)
  const tabBarRef = useRef<HTMLDivElement>(null)
  const requestCloseFileRef = useRef<(path: string) => void>(() => {})
  const draftContentsRef = useRef(new Map<string, string>())

  const getDraftKey = useCallback((fileRepoCwd: string, filePath: string) => {
    return `${fileRepoCwd}::${filePath}`
  }, [])

  const getCurrentContent = useCallback(
    (file: OpenFile) => {
      return draftContentsRef.current.get(getDraftKey(file.repoCwd, file.path)) ?? file.originalContent
    },
    [getDraftKey],
  )

  const remapPath = useCallback((candidatePath: string, oldPath: string, newPath: string) => {
    if (candidatePath === oldPath) return newPath
    if (candidatePath.startsWith(oldPath + "/")) {
      return `${newPath}${candidatePath.slice(oldPath.length)}`
    }
    return null
  }, [])

  const activeFile = openFiles.find((f) => f.path === activeFilePath) ?? null
  const pendingCloseFile = pendingClosePath
    ? openFiles.find((f) => f.path === pendingClosePath) ?? null
    : null

  useImperativeHandle(ref, () => ({
    closeActiveTab: () => {
      if (!activeFilePath) return false
      requestCloseFileRef.current(activeFilePath)
      return true
    },
  }))

  useEffect(() => {
    setOpenFiles([])
    setActiveFilePath(null)
    setLoading(false)
    setError(null)
    setSaving(false)
    setPendingClosePath(null)
    setPendingTreeAction(null)
    draftContentsRef.current.clear()
  }, [repoCwd])

  // ---------------------------------------------------------------------------
  // File operations
  // ---------------------------------------------------------------------------

  const openFile = useCallback(
    async (filePath: string) => {
      if (!repoCwd) return

      const existing = openFiles.find((f) => f.path === filePath)
      if (existing) {
        setActiveFilePath(filePath)
        return
      }

      setLoading(true)
      setError(null)
      try {
        const result: FileContent = await readFile(repoCwd, filePath)
        const name = filePath.split("/").pop() ?? filePath
        const file: OpenFile = {
          repoCwd,
          path: filePath,
          name,
          originalContent: result.content,
          language: result.language,
          isBinary: result.isBinary,
          isTooLarge: result.isTooLarge,
          size: result.size,
          mtimeMs: result.mtimeMs,
          isDirty: false,
        }
        draftContentsRef.current.set(getDraftKey(repoCwd, filePath), result.content)
        setOpenFiles((prev) => [...prev, file])
        setActiveFilePath(filePath)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to read file")
      } finally {
        setLoading(false)
      }
    },
    [repoCwd, openFiles, getDraftKey],
  )

  const forceCloseFile = useCallback(
    (filePath: string) => {
      setOpenFiles((prev) => {
        const closing = prev.find((f) => f.path === filePath)
        if (closing) {
          draftContentsRef.current.delete(getDraftKey(closing.repoCwd, closing.path))
        }
        const next = prev.filter((f) => f.path !== filePath)
        if (activeFilePath === filePath) {
          const idx = prev.findIndex((f) => f.path === filePath)
          const nextActive = next[Math.min(idx, next.length - 1)]?.path ?? null
          setActiveFilePath(nextActive)
        }
        return next
      })
    },
    [activeFilePath, getDraftKey],
  )

  const requestCloseFile = useCallback(
    (filePath: string) => {
      const file = openFiles.find((f) => f.path === filePath)
      if (file && file.isDirty) {
        setPendingClosePath(filePath)
      } else {
        forceCloseFile(filePath)
      }
    },
    [openFiles, forceCloseFile],
  )
  requestCloseFileRef.current = requestCloseFile

  const closeAllFiles = useCallback(() => {
    const hasDirty = openFiles.some((f) => f.isDirty)
    if (hasDirty) {
      setPendingClosePath("__all__")
    } else {
      setOpenFiles([])
      setActiveFilePath(null)
      draftContentsRef.current.clear()
    }
  }, [openFiles])

  const closeOtherFiles = useCallback(
    (keepPath: string) => {
      const others = openFiles.filter((f) => f.path !== keepPath)
      const hasDirty = others.some((f) => f.isDirty)
      if (hasDirty) {
        setPendingClosePath("__others__:" + keepPath)
      } else {
        setOpenFiles((prev) => {
          const keep = prev.find((f) => f.path === keepPath)
          const keepContent = keep ? getCurrentContent(keep) : null
          draftContentsRef.current.clear()
          if (keep && keepContent !== null) {
            draftContentsRef.current.set(getDraftKey(keep.repoCwd, keep.path), keepContent)
          }
          return prev.filter((f) => f.path === keepPath)
        })
        setActiveFilePath(keepPath)
      }
    },
    [openFiles, getCurrentContent, getDraftKey],
  )

  const handleFileDeleted = useCallback(
    (deletedPath: string) => {
      setOpenFiles((prev) => {
        // Close the exact file, or any file inside a deleted folder
        const next: OpenFile[] = []
        for (const file of prev) {
          const deleted = file.path === deletedPath || file.path.startsWith(deletedPath + "/")
          if (deleted) {
            draftContentsRef.current.delete(getDraftKey(file.repoCwd, file.path))
            continue
          }
          next.push(file)
        }
        if (next.length !== prev.length && activeFilePath) {
          const stillOpen = next.some((f) => f.path === activeFilePath)
          if (!stillOpen) {
            setActiveFilePath(next[next.length - 1]?.path ?? null)
          }
        }
        return next
      })
    },
    [activeFilePath, getDraftKey],
  )

  const updateContent = useCallback(
    (filePath: string, content: string) => {
      setOpenFiles((prev) => {
        let changed = false
        const next = prev.map((f) => {
          if (f.path !== filePath) return f

          draftContentsRef.current.set(getDraftKey(f.repoCwd, f.path), content)
          const isDirty = content !== f.originalContent
          if (isDirty === f.isDirty) return f

          changed = true
          return { ...f, isDirty }
        })
        return changed ? next : prev
      })
    },
    [getDraftKey],
  )

  const saveFile = useCallback(async () => {
    if (!repoCwd || !activeFile || activeFile.isBinary || activeFile.isTooLarge) return
    setSaving(true)
    try {
      const nextContent = getCurrentContent(activeFile)
      const result = await writeFile(
        repoCwd,
        activeFile.path,
        nextContent,
        activeFile.mtimeMs,
      )
      setOpenFiles((prev) =>
        prev.map((f) =>
          f.path === activeFile.path
            ? {
                ...f,
                originalContent: nextContent,
                mtimeMs: result.mtimeMs,
                isDirty: false,
              }
            : f,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file")
    } finally {
      setSaving(false)
    }
  }, [repoCwd, activeFile, getCurrentContent])

  const handleFileRenamed = useCallback(
    (oldPath: string, newPath: string) => {
      setOpenFiles((prev) =>
        prev.map((file) => {
          const remapped = remapPath(file.path, oldPath, newPath)
          if (!remapped) return file

          const currentDraftKey = getDraftKey(file.repoCwd, file.path)
          const nextDraftKey = getDraftKey(file.repoCwd, remapped)
          const draft = draftContentsRef.current.get(currentDraftKey)
          if (draft !== undefined) {
            draftContentsRef.current.delete(currentDraftKey)
            draftContentsRef.current.set(nextDraftKey, draft)
          }

          return {
            ...file,
            path: remapped,
            name: remapped.split("/").pop() ?? remapped,
          }
        }),
      )
      setActiveFilePath((prev) => (prev ? remapPath(prev, oldPath, newPath) ?? prev : prev))
    },
    [getDraftKey, remapPath],
  )

  const getDeleteWarning = useCallback(
    (entryPath: string) => {
      const dirtyMatches = openFiles.filter(
        (file) => file.isDirty && (file.path === entryPath || file.path.startsWith(entryPath + "/")),
      )
      if (dirtyMatches.length === 0) return null
      if (dirtyMatches.length === 1) {
        return `This will discard unsaved changes in "${dirtyMatches[0].name}".`
      }
      return `This will discard unsaved changes in ${dirtyMatches.length} open files.`
    },
    [openFiles],
  )

  // Scroll active tab into view
  useEffect(() => {
    if (!activeFilePath || !tabBarRef.current) return
    const tab = tabBarRef.current.querySelector(`[data-tab-path="${CSS.escape(activeFilePath)}"]`)
    tab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" })
  }, [activeFilePath])

  // ---------------------------------------------------------------------------
  // Resize
  // ---------------------------------------------------------------------------

  const handleMouseDown = useCallback(() => {
    resizing.current = true
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
  }, [])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!resizing.current) return
      setTreeWidth(Math.max(140, Math.min(450, e.clientX - 64)))
    }
    const handleMouseUp = () => {
      if (!resizing.current) return
      resizing.current = false
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    document.addEventListener("mousemove", handleMouseMove)
    document.addEventListener("mouseup", handleMouseUp)
    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
      document.removeEventListener("mouseup", handleMouseUp)
    }
  }, [])

  if (!repoCwd) return null

  return (
    <div className={cn("flex h-full overflow-hidden", !isActive && "hidden")}>
      {/* File tree sidebar */}
      <div
        className="flex shrink-0 flex-col bg-[#161616]"
        style={{ width: treeWidth }}
      >
        <div className="flex h-[35px] items-center justify-between px-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            Files
          </span>
          <FileTreeActions
            onNewFile={() => setPendingTreeAction({ type: "new-file", parentPath: "" })}
            onNewFolder={() => setPendingTreeAction({ type: "new-folder", parentPath: "" })}
            onExpandAll={() => setExpandAllVersion((v) => v + 1)}
            onCollapseAll={() => setCollapseAllVersion((v) => v + 1)}
          />
        </div>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <ScrollArea className="flex-1 overflow-auto">
              <FileTree
                cwd={repoCwd}
                selectedPath={activeFilePath}
                onSelect={openFile}
                expandAllVersion={expandAllVersion}
                collapseAllVersion={collapseAllVersion}
                refreshVersion={0}
                pendingAction={pendingTreeAction}
                onPendingAction={setPendingTreeAction}
                onDelete={handleFileDeleted}
                onRename={handleFileRenamed}
                getDeleteWarning={getDeleteWarning}
              />
            </ScrollArea>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => setPendingTreeAction({ type: "new-file", parentPath: "" })}>
              New File
            </ContextMenuItem>
            <ContextMenuItem onClick={() => setPendingTreeAction({ type: "new-folder", parentPath: "" })}>
              New Folder
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>

      {/* Resize handle */}
      <div
        className="w-px shrink-0 cursor-col-resize bg-white/[0.06] transition-colors hover:bg-white/[0.15]"
        onMouseDown={handleMouseDown}
      />

      {/* Editor area */}
      <div className="flex min-w-0 flex-1 flex-col bg-[#1a1a1a]">
        {/* Tab bar */}
        {openFiles.length > 0 && (
          <div
            ref={tabBarRef}
            role="tablist"
            aria-label="Open files"
            className="flex h-[35px] shrink-0 items-end overflow-x-auto overflow-y-hidden bg-[#161616] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {openFiles.map((file) => {
              const isDirty = file.isDirty
              const isFileActive = file.path === activeFilePath
              return (
                <ContextMenu key={file.path}>
                  <ContextMenuTrigger asChild>
                    <div
                      data-tab-path={file.path}
                      role="tab"
                      tabIndex={0}
                      aria-selected={isFileActive}
                      onClick={() => setActiveFilePath(file.path)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault()
                          setActiveFilePath(file.path)
                        }
                      }}
                      className={cn(
                        "group relative flex h-[32px] shrink-0 items-center gap-1.5 px-3 text-[12px] transition-colors",
                        isFileActive
                          ? "bg-[#1a1a1a] text-foreground"
                          : "text-muted-foreground/60 hover:text-muted-foreground",
                      )}
                    >
                      {isFileActive && (
                        <span className="absolute inset-x-0 top-0 h-px bg-primary/60" />
                      )}

                      <span className="max-w-[140px] truncate">{file.name}</span>

                      <span className="relative ml-1 flex size-5 items-center justify-center">
                        {isDirty && (
                          <span className="pointer-events-none absolute size-2 rounded-full bg-white/20 transition-opacity group-hover:opacity-0" />
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            requestCloseFile(file.path)
                          }}
                          className="relative z-10 flex size-5 items-center justify-center rounded opacity-0 transition-opacity hover:bg-white/10 group-hover:opacity-100"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => requestCloseFile(file.path)}>
                      Close
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => closeOtherFiles(file.path)} disabled={openFiles.length <= 1}>
                      Close Others
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={closeAllFiles} variant="destructive">
                      Close All
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </div>
        )}

        {/* No tabs — blank header to match height */}
        {openFiles.length === 0 && <div className="h-[35px] shrink-0 bg-[#161616]" />}

        {/* Editor content */}
        <div className="relative min-h-0 flex-1">
          {loading && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#1a1a1a]/90">
              <span className="text-[12px] text-muted-foreground/50">Loading...</span>
            </div>
          )}

          {error && (
            <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 bg-red-500/10 px-3 py-1.5 text-[12px] text-red-400">
              <AlertTriangle className="size-3.5" />
              {error}
              <button
                type="button"
                onClick={() => setError(null)}
                className="ml-auto text-[11px] text-red-400/60 hover:text-red-400"
              >
                dismiss
              </button>
            </div>
          )}

          {saving && (
            <div className="absolute right-3 top-2 z-20 rounded bg-white/5 px-2 py-0.5 text-[11px] text-muted-foreground/50">
              Saving...
            </div>
          )}

          {activeFile ? (
            activeFile.isBinary ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center text-muted-foreground/40">
                  <p className="text-[13px]">Binary file</p>
                  <p className="mt-0.5 text-[11px]">{formatSize(activeFile.size)}</p>
                </div>
              </div>
            ) : activeFile.isTooLarge ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center text-muted-foreground/40">
                  <p className="text-[13px]">File too large to edit inline</p>
                  <p className="mt-0.5 text-[11px]">{formatSize(activeFile.size)}</p>
                </div>
              </div>
            ) : (
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center text-[12px] text-muted-foreground/50">
                    Loading editor...
                  </div>
                }
              >
                <FileEditor
                  key={activeFile.path}
                  defaultValue={getCurrentContent(activeFile)}
                  language={activeFile.language}
                  onContentChange={(value) => updateContent(activeFile.path, value)}
                  onSave={saveFile}
                />
              </Suspense>
            )
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center text-muted-foreground/25">
                <FileCode2 className="mx-auto mb-2 size-8" />
                <p className="text-[12px]">Select a file to view</p>
              </div>
            </div>
          )}
        </div>

        {/* Status bar */}
        {activeFile && !activeFile.isBinary && !activeFile.isTooLarge && (
          <div className="flex h-[22px] items-center justify-between border-t border-white/[0.06] bg-[#161616] px-3 text-[11px] text-muted-foreground/40">
            <span>{activeFile.path}</span>
            <div className="flex items-center gap-4">
              <span>{activeFile.language}</span>
              <span>{formatSize(activeFile.size)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Discard changes confirmation */}
      <ConfirmDialog
        open={pendingClosePath !== null}
        onOpenChange={(open) => { if (!open) setPendingClosePath(null) }}
        title="Unsaved changes"
        description={
          pendingClosePath === "__all__"
            ? "Some open files have unsaved changes. Discard all changes and close?"
            : pendingClosePath?.startsWith("__others__:")
              ? "Some open files have unsaved changes. Discard changes and close them?"
              : `"${pendingCloseFile?.name ?? ""}" has unsaved changes. Do you want to discard them?`
        }
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="destructive"
        onConfirm={() => {
          if (pendingClosePath === "__all__") {
            setOpenFiles([])
            setActiveFilePath(null)
            draftContentsRef.current.clear()
          } else if (pendingClosePath?.startsWith("__others__:")) {
            const keepPath = pendingClosePath.slice("__others__:".length)
            setOpenFiles((prev) => {
              const next = prev.filter((f) => f.path === keepPath)
              const keep = prev.find((f) => f.path === keepPath)
              const keepContent = keep ? getCurrentContent(keep) : null
              draftContentsRef.current.clear()
              if (keep && keepContent !== null) {
                draftContentsRef.current.set(getDraftKey(keep.repoCwd, keep.path), keepContent)
              }
              return next
            })
            setActiveFilePath(keepPath)
          } else if (pendingClosePath) {
            const file = openFiles.find((f) => f.path === pendingClosePath)
            if (file) draftContentsRef.current.delete(getDraftKey(file.repoCwd, file.path))
            forceCloseFile(pendingClosePath)
          }
          setPendingClosePath(null)
        }}
      />
    </div>
  )
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
