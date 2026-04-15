import { useState, useCallback, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"
import {
  listDirectory,
  createFile,
  createDirectory,
  deleteEntry,
  renameEntry,
  type FileEntry,
} from "@/lib/files"
import {
  getWorkingTreeDisplayStatusLabel,
  type WorkingTreeDisplayStatus,
  type WorkingTreeStatusDecoration,
} from "@/lib/git/status"
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  ChevronsDownUp,
  ChevronsUpDown,
  FilePlus,
  FolderPlus,
} from "lucide-react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

// ---------------------------------------------------------------------------
// File-type icon — tiny colored dot by extension
// ---------------------------------------------------------------------------

const EXT_COLORS: Record<string, string> = {
  ts: "bg-blue-400",
  tsx: "bg-blue-400",
  js: "bg-yellow-400",
  jsx: "bg-yellow-400",
  mjs: "bg-yellow-400",
  json: "bg-yellow-600",
  md: "bg-gray-400",
  mdx: "bg-gray-400",
  css: "bg-purple-400",
  scss: "bg-pink-400",
  html: "bg-orange-400",
  py: "bg-green-400",
  rs: "bg-orange-500",
  go: "bg-cyan-400",
  yml: "bg-red-400",
  yaml: "bg-red-400",
  toml: "bg-gray-500",
  sh: "bg-green-500",
  svg: "bg-orange-300",
  lock: "bg-gray-600",
  gitignore: "bg-gray-600",
}

function getExtDot(name: string): string | null {
  const parts = name.split(".")
  if (parts.length < 2) return null
  const ext = parts.pop()?.toLowerCase() ?? ""
  return EXT_COLORS[ext] ?? null
}

function isDotfile(name: string): boolean {
  return name.startsWith(".")
}

// ---------------------------------------------------------------------------
// Inline input for creating / renaming
// ---------------------------------------------------------------------------

function InlineInput({
  depth,
  defaultValue,
  placeholder,
  onSubmit,
  onCancel,
}: {
  depth: number
  defaultValue?: string
  placeholder: string
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const submitted = useRef(false)

  useEffect(() => {
    // Delay focus so the context menu closing doesn't steal it
    const raf = requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      if (defaultValue) {
        const dotIndex = defaultValue.lastIndexOf(".")
        el.setSelectionRange(0, dotIndex > 0 ? dotIndex : defaultValue.length)
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [defaultValue])

  const finish = (value: string | undefined) => {
    if (submitted.current) return
    submitted.current = true
    if (value) onSubmit(value)
    else onCancel()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation()
    if (e.key === "Enter") {
      finish(ref.current?.value.trim())
    }
    if (e.key === "Escape") {
      submitted.current = true
      onCancel()
    }
  }

  return (
    <div
      className="flex items-center py-[1px]"
      style={{ paddingLeft: depth * 6 + 8 + 14 + 5 }}
    >
      <input
        ref={ref}
        type="text"
        defaultValue={defaultValue}
        placeholder={placeholder}
        onKeyDown={handleKeyDown}
        onBlur={() => finish(ref.current?.value.trim())}
        className="w-full rounded-sm border border-primary/40 bg-white/[0.04] px-1.5 py-[2px] text-[13px] leading-[20px] text-foreground outline-none placeholder:text-muted-foreground/30"
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tree node
// ---------------------------------------------------------------------------

type PendingAction =
  | { type: "new-file"; parentPath: string }
  | { type: "new-folder"; parentPath: string }
  | { type: "rename"; entryPath: string; currentName: string }

function gitStatusBadgeClasses(status: WorkingTreeDisplayStatus): string {
  switch (status) {
    case "A":
      return "text-emerald-400"
    case "C":
      return "text-orange-400"
    case "D":
      return "text-red-400"
    case "M":
      return "text-amber-400"
    case "R":
      return "text-violet-400"
    case "U":
      return "text-sky-400"
  }
}

function GitStatusBadge({ decoration }: { decoration: WorkingTreeStatusDecoration }) {
  return (
    <span
      title={`${getWorkingTreeDisplayStatusLabel(decoration.displayStatus)} (${decoration.rawStatus})`}
      className={cn(
        "pointer-events-none absolute right-2 top-1/2 inline-flex w-4 -translate-y-1/2 items-center justify-center font-mono text-[11px] font-semibold leading-none",
        gitStatusBadgeClasses(decoration.displayStatus),
      )}
    >
      {decoration.displayStatus}
    </span>
  )
}

interface TreeNodeProps {
  entry: FileEntry
  cwd: string
  depth: number
  selectedPath: string | null
  gitDecorations: ReadonlyMap<string, WorkingTreeStatusDecoration>
  onSelect: (path: string) => void
  expandAllVersion: number
  collapseAllVersion: number
  pendingAction: PendingAction | null
  onPendingAction: (action: PendingAction | null) => void
  onMutate: () => void
  /** Called after a file/folder is deleted, with the deleted path */
  onDelete: (deletedPath: string) => void
  /** Called after a file/folder is renamed */
  onRename: (oldPath: string, newPath: string) => void
  /** Optional warning text for deleting a path with open unsaved files */
  getDeleteWarning: (entryPath: string) => string | null
}

function TreeNode({
  entry,
  cwd,
  depth,
  selectedPath,
  gitDecorations,
  onSelect,
  expandAllVersion,
  collapseAllVersion,
  pendingAction,
  onPendingAction,
  onMutate,
  onDelete,
  onRename,
  getDeleteWarning,
}: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false)
  const [children, setChildren] = useState<FileEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteWarning, setDeleteWarning] = useState<string | null>(null)
  const mountedExpandVersion = useRef(expandAllVersion)
  const mountedCollapseVersion = useRef(collapseAllVersion)

  const isSelected = selectedPath === entry.path
  const isDir = entry.type === "directory"
  const dotfile = isDotfile(entry.name)
  const extDot = !isDir ? getExtDot(entry.name) : null
  const gitDecoration = gitDecorations.get(entry.path)

  // Pending action for this directory's children
  const hasPendingChild =
    pendingAction &&
    (pendingAction.type === "new-file" || pendingAction.type === "new-folder") &&
    pendingAction.parentPath === entry.path

  const isRenaming =
    pendingAction?.type === "rename" && pendingAction.entryPath === entry.path

  // Auto-expand when a new file/folder is being created inside this dir
  useEffect(() => {
    if (hasPendingChild && !expanded) {
      setExpanded(true)
      if (children === null) {
        setLoading(true)
        listDirectory(cwd, entry.path)
          .then((result) => setChildren(result))
          .catch(() => setChildren([]))
          .finally(() => setLoading(false))
      }
    }
  }, [hasPendingChild, expanded, children, cwd, entry.path])

  // Expand all
  useEffect(() => {
    if (expandAllVersion === mountedExpandVersion.current) return
    mountedExpandVersion.current = expandAllVersion
    if (!isDir) return
    setExpanded(true)
    if (children === null) {
      setLoading(true)
      listDirectory(cwd, entry.path)
        .then((result) => setChildren(result))
        .catch(() => setChildren([]))
        .finally(() => setLoading(false))
    }
  }, [expandAllVersion, isDir, children, cwd, entry.path])

  // Collapse all
  useEffect(() => {
    if (collapseAllVersion === mountedCollapseVersion.current) return
    mountedCollapseVersion.current = collapseAllVersion
    if (isDir) setExpanded(false)
  }, [collapseAllVersion, isDir])

  const refreshChildren = useCallback(async () => {
    if (!isDir) return
    try {
      const result = await listDirectory(cwd, entry.path)
      setChildren(result)
    } catch {
      setChildren([])
    }
  }, [isDir, cwd, entry.path])

  const toggle = useCallback(async () => {
    if (!isDir) {
      onSelect(entry.path)
      return
    }
    const nextExpanded = !expanded
    setExpanded(nextExpanded)
    if (nextExpanded && children === null) {
      setLoading(true)
      try {
        const result = await listDirectory(cwd, entry.path)
        setChildren(result)
      } catch {
        setChildren([])
      } finally {
        setLoading(false)
      }
    }
  }, [isDir, expanded, children, cwd, entry.path, onSelect])

  const handleNewFile = () => {
    onPendingAction({ type: "new-file", parentPath: entry.path })
  }

  const handleNewFolder = () => {
    onPendingAction({ type: "new-folder", parentPath: entry.path })
  }

  const handleRename = () => {
    onPendingAction({ type: "rename", entryPath: entry.path, currentName: entry.name })
  }

  const handleDelete = () => {
    setDeleteWarning(getDeleteWarning(entry.path))
    setDeleteConfirm(true)
  }

  const confirmDelete = async () => {
    try {
      await deleteEntry(cwd, entry.path)
      onDelete(entry.path)
      onMutate()
    } catch (err) {
      console.error("[FileTree]", err)
    }
  }

  const handleCreateSubmit = async (name: string) => {
    if (!pendingAction) return
    const newPath = entry.path ? `${entry.path}/${name}` : name
    try {
      if (pendingAction.type === "new-file") {
        await createFile(cwd, newPath)
      } else {
        await createDirectory(cwd, newPath)
      }
      await refreshChildren()
      onMutate()
      if (pendingAction.type === "new-file") {
        onSelect(newPath)
      }
    } catch (err) {
      console.error("[FileTree]", err)
    }
    onPendingAction(null)
  }

  const handleRenameSubmit = async (newName: string) => {
    if (newName === entry.name) {
      onPendingAction(null)
      return
    }
    const parentDir = entry.path.includes("/")
      ? entry.path.slice(0, entry.path.lastIndexOf("/"))
      : ""
    const newPath = parentDir ? `${parentDir}/${newName}` : newName
    try {
      await renameEntry(cwd, entry.path, newPath)
      onRename(entry.path, newPath)
      onMutate()
    } catch (err) {
      console.error("[FileTree]", err)
    }
    onPendingAction(null)
  }

  if (isRenaming) {
    return (
      <InlineInput
        depth={depth}
        defaultValue={entry.name}
        placeholder="New name"
        onSubmit={handleRenameSubmit}
        onCancel={() => onPendingAction(null)}
      />
    )
  }

  const nodeButton = (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "group relative flex w-full items-center gap-[5px] overflow-hidden py-[2px] pr-7 text-left text-[13px] leading-[22px] transition-colors",
        isSelected
          ? "bg-white/[0.08] text-foreground"
          : "text-foreground/70 hover:bg-white/[0.04] hover:text-foreground/90",
        dotfile && !isSelected && "text-foreground/40",
      )}
      style={{ paddingLeft: depth * 6 + 8 }}
    >
      {isDir ? (
        expanded ? (
          <ChevronDown className="size-[14px] shrink-0 text-muted-foreground/50" />
        ) : (
          <ChevronRight className="size-[14px] shrink-0 text-muted-foreground/50" />
        )
      ) : (
        <span className="w-[14px] shrink-0" />
      )}

      {isDir ? (
        expanded ? (
          <FolderOpen className="size-[14px] shrink-0 text-muted-foreground/60" />
        ) : (
          <Folder className="size-[14px] shrink-0 text-muted-foreground/60" />
        )
      ) : extDot ? (
        <span className={cn("size-[6px] shrink-0 rounded-full", extDot)} />
      ) : (
        <span className="size-[6px] shrink-0 rounded-full bg-muted-foreground/30" />
      )}

      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      {gitDecoration && <GitStatusBadge decoration={gitDecoration} />}
    </button>
  )

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>{nodeButton}</ContextMenuTrigger>
        <ContextMenuContent>
          {isDir && (
            <>
              <ContextMenuItem onClick={handleNewFile}>New File</ContextMenuItem>
              <ContextMenuItem onClick={handleNewFolder}>New Folder</ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onClick={handleRename}>Rename</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleDelete} variant="destructive">
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isDir && expanded && (
        <div>
          {/* Inline input for new file/folder inside this directory */}
          {hasPendingChild && (
            <InlineInput
              depth={depth + 1}
              placeholder={pendingAction.type === "new-file" ? "filename" : "folder name"}
              onSubmit={handleCreateSubmit}
              onCancel={() => onPendingAction(null)}
            />
          )}
          {loading && (
            <div
              className="py-0.5 text-[11px] text-muted-foreground/30"
              style={{ paddingLeft: (depth + 1) * 6 + 30 }}
            >
              ...
            </div>
          )}
          {children?.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              cwd={cwd}
              depth={depth + 1}
              selectedPath={selectedPath}
              gitDecorations={gitDecorations}
              onSelect={onSelect}
              expandAllVersion={expandAllVersion}
              collapseAllVersion={collapseAllVersion}
              pendingAction={pendingAction}
              onPendingAction={onPendingAction}
              onMutate={onMutate}
              onDelete={onDelete}
              onRename={onRename}
              getDeleteWarning={getDeleteWarning}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirm}
        onOpenChange={(open) => {
          setDeleteConfirm(open)
          if (!open) setDeleteWarning(null)
        }}
        title={`Delete ${isDir ? "folder" : "file"}`}
        description={
          deleteWarning
            ? `Permanently delete "${entry.name}"${isDir ? " and all its contents" : ""}? ${deleteWarning}`
            : `Permanently delete "${entry.name}"${isDir ? " and all its contents" : ""}?`
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="destructive"
        onConfirm={async () => {
          await confirmDelete()
          setDeleteWarning(null)
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// FileTree
// ---------------------------------------------------------------------------

interface FileTreeProps {
  cwd: string
  selectedPath: string | null
  gitDecorations: ReadonlyMap<string, WorkingTreeStatusDecoration>
  onSelect: (path: string) => void
  expandAllVersion: number
  collapseAllVersion: number
  /** Bumped externally to force a refresh of root entries */
  refreshVersion: number
  pendingAction: PendingAction | null
  onPendingAction: (action: PendingAction | null) => void
  /** Called when a file/folder is deleted */
  onDelete: (deletedPath: string) => void
  /** Called when a file/folder is renamed */
  onRename: (oldPath: string, newPath: string) => void
  /** Optional warning text for deleting a path with open unsaved files */
  getDeleteWarning: (entryPath: string) => string | null
}

export type { PendingAction }

export function FileTree({
  cwd,
  selectedPath,
  gitDecorations,
  onSelect,
  expandAllVersion,
  collapseAllVersion,
  refreshVersion,
  pendingAction,
  onPendingAction,
  onDelete,
  onRename,
  getDeleteWarning,
}: FileTreeProps) {
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [initialLoading, setInitialLoading] = useState(true)

  const loadEntries = useCallback(() => {
    listDirectory(cwd)
      .then((result) => {
        setEntries(result)
        setInitialLoading(false)
      })
      .catch(() => {
        setEntries([])
        setInitialLoading(false)
      })
  }, [cwd])

  useEffect(() => {
    loadEntries()
  }, [loadEntries, refreshVersion])

  // Root-level pending action (new file/folder at root)
  const hasRootPending =
    pendingAction &&
    (pendingAction.type === "new-file" || pendingAction.type === "new-folder") &&
    pendingAction.parentPath === ""

  const handleRootCreate = async (name: string) => {
    if (!pendingAction) return
    try {
      if (pendingAction.type === "new-file") {
        await createFile(cwd, name)
      } else {
        await createDirectory(cwd, name)
      }
      loadEntries()
      if (pendingAction.type === "new-file") {
        onSelect(name)
      }
    } catch (err) {
      console.error("[FileTree]", err)
    }
    onPendingAction(null)
  }

  if (initialLoading) {
    return (
      <div className="px-3 py-4 text-[12px] text-muted-foreground/40">
        Loading...
      </div>
    )
  }

  if (entries.length === 0 && !hasRootPending) {
    return (
      <div className="px-3 py-4 text-[12px] text-muted-foreground/40">
        Empty
      </div>
    )
  }

  return (
    <div className="py-0.5">
      {hasRootPending && (
        <InlineInput
          depth={0}
          placeholder={pendingAction.type === "new-file" ? "filename" : "folder name"}
          onSubmit={handleRootCreate}
          onCancel={() => onPendingAction(null)}
        />
      )}
      {entries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          cwd={cwd}
          depth={0}
          selectedPath={selectedPath}
          gitDecorations={gitDecorations}
          onSelect={onSelect}
          expandAllVersion={expandAllVersion}
          collapseAllVersion={collapseAllVersion}
          pendingAction={pendingAction}
          onPendingAction={onPendingAction}
          onMutate={loadEntries}
          onDelete={onDelete}
          onRename={onRename}
          getDeleteWarning={getDeleteWarning}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toolbar buttons for explorer header
// ---------------------------------------------------------------------------

export function FileTreeActions({
  onNewFile,
  onNewFolder,
  onExpandAll,
  onCollapseAll,
}: {
  onNewFile: () => void
  onNewFolder: () => void
  onExpandAll: () => void
  onCollapseAll: () => void
}) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        onClick={onNewFile}
        title="New file"
        className="rounded p-1 text-muted-foreground/40 transition-colors hover:bg-white/[0.06] hover:text-muted-foreground"
      >
        <FilePlus className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onNewFolder}
        title="New folder"
        className="rounded p-1 text-muted-foreground/40 transition-colors hover:bg-white/[0.06] hover:text-muted-foreground"
      >
        <FolderPlus className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onExpandAll}
        title="Expand all"
        className="rounded p-1 text-muted-foreground/40 transition-colors hover:bg-white/[0.06] hover:text-muted-foreground"
      >
        <ChevronsUpDown className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={onCollapseAll}
        title="Collapse all"
        className="rounded p-1 text-muted-foreground/40 transition-colors hover:bg-white/[0.06] hover:text-muted-foreground"
      >
        <ChevronsDownUp className="size-3.5" />
      </button>
    </div>
  )
}
