import { useState, useRef, useEffect, lazy, Suspense } from "react"
import { useAppStore } from "@/store"
import { WelcomeScreen } from "@/components/git/WelcomeScreen"
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  GitBranchIcon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Terminal, FileDiff, FolderOpen } from "lucide-react"
import type { TerminalPanelHandle } from "@/components/terminal/TerminalPanel"
import type { FileViewerHandle } from "@/components/files/FileViewer"

const DiffViewer = lazy(async () => {
  const mod = await import("@/components/git/DiffViewer")
  return { default: mod.DiffViewer }
})

const Dashboard = lazy(async () => {
  const mod = await import("@/components/git/Dashboard")
  return { default: mod.Dashboard }
})

const GitPanel = lazy(async () => {
  const mod = await import("@/components/git/GitPanel")
  return { default: mod.GitPanel }
})

const RepoSidebar = lazy(async () => {
  const mod = await import("@/components/git/RepoSidebar")
  return { default: mod.RepoSidebar }
})

const TerminalPanel = lazy(async () => {
  const mod = await import("@/components/terminal/TerminalPanel")
  return { default: mod.TerminalPanel }
})

const FileViewer = lazy(async () => {
  const mod = await import("@/components/files/FileViewer")
  return { default: mod.FileViewer }
})

type ActiveTab = "dashboard" | "git" | "files" | "terminal"

function Toolbar({
  activeTab,
  onTabChange,
  onDiffOpen,
}: {
  activeTab: ActiveTab
  onTabChange: (tab: ActiveTab) => void
  onDiffOpen: () => void
}) {
  const { toggleSidebar, state } = useSidebar()
  const isCollapsed = state === "collapsed"
  const repoCwd = useAppStore((s) => s.repoCwd)
  const repoName = repoCwd?.split("/").pop() ?? ""

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-center gap-3 pr-4 transition-[padding] duration-200 ease-linear"
      style={{
        WebkitAppRegion: "drag",
        paddingLeft: isCollapsed ? 88 : "calc(var(--sidebar-width) + 16px)",
        height: 52,
      } as React.CSSProperties}
    >
      {/* Left: sidebar toggle + repo name */}
      <div className="flex items-center gap-2.5" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
        <button
          type="button"
          onClick={toggleSidebar}
          className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={SidebarLeftIcon} className="size-[18px]" />
        </button>
        {repoName && (
          <span className="text-sm font-semibold">{repoName}</span>
        )}
      </div>

      {/* Toolbar actions */}
      {repoCwd && (
        <div className="ml-auto flex items-center gap-0.5" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <button
            type="button"
            onClick={onDiffOpen}
            className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
            title="View diff"
          >
            <FileDiff className="size-[15px]" />
          </button>
        </div>
      )}

      {/* Right: view toggle */}
      <div
        className={cn("flex items-center gap-0.5 rounded-md border bg-muted/50 p-0.5", !repoCwd && "ml-auto")}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <button
          type="button"
          onClick={() => onTabChange("dashboard")}
          className={cn(
            "flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
            activeTab === "dashboard"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <HugeiconsIcon icon={LayoutDashboard} className="size-3" />
          Overview
        </button>
        <button
          type="button"
          onClick={() => onTabChange("git")}
          className={cn(
            "flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
            activeTab === "git"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <HugeiconsIcon icon={GitBranchIcon} className="size-3" />
          Git
        </button>
        <button
          type="button"
          onClick={() => onTabChange("files")}
          className={cn(
            "flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
            activeTab === "files"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <FolderOpen className="size-3" />
          Files
        </button>
        <button
          type="button"
          onClick={() => onTabChange("terminal")}
          className={cn(
            "flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
            activeTab === "terminal"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Terminal className="size-3" />
          Terminal
        </button>
      </div>
    </div>
  )
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("git")
  const [isDiffOpen, setIsDiffOpen] = useState(false)
  const repoCwd = useAppStore((s) => s.repoCwd)
  const terminalProjects = useAppStore((s) => s.terminalProjects)
  const ensureTerminalProject = useAppStore((s) => s.ensureTerminalProject)
  const addTerminalTab = useAppStore((s) => s.addTerminalTab)
  const removeTerminalProject = useAppStore((s) => s.removeTerminalProject)
  const fileViewerRef = useRef<FileViewerHandle | null>(null)
  const terminalRefs = useRef(new Map<string, React.MutableRefObject<TerminalPanelHandle | null>>())
  const setTerminalHandle = (projectCwd: string, handle: TerminalPanelHandle | null) => {
    let existing = terminalRefs.current.get(projectCwd)
    if (!existing) {
      existing = { current: null }
      terminalRefs.current.set(projectCwd, existing)
    }
    existing.current = handle
  }

  // Cmd+W: close active tab in files/terminal first, then close window
  useEffect(() => {
    const cleanup = window.electronAPI?.onClosePaneOrWindow(() => {
      if (activeTab === "files") {
        const handled = fileViewerRef.current?.closeActiveTab()
        if (handled) return
      }
      if (activeTab === "terminal" && repoCwd) {
        const ref = terminalRefs.current.get(repoCwd)
        if (ref?.current) {
          const handled = ref.current.closePaneOrTab()
          if (handled) return
        }
      }
      window.close()
    })
    return cleanup
  }, [activeTab, repoCwd])

  // Terminal shortcuts from the native menu
  useEffect(() => {
    const cleanup = window.electronAPI?.onTerminalAction((action) => {
      if (action !== "terminal:new-tab") return
      if (!repoCwd) return

      setActiveTab("terminal")

      if (!terminalProjects[repoCwd]) {
        ensureTerminalProject(repoCwd)
        return
      }

      addTerminalTab(repoCwd)
    })
    return cleanup
  }, [addTerminalTab, ensureTerminalProject, repoCwd, terminalProjects])

  const hasStartedTerminal = repoCwd ? Boolean(terminalProjects[repoCwd]) : false
  const activeTerminalProject = repoCwd ? terminalProjects[repoCwd] ?? null : null

  return (
    <>
      <Toolbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onDiffOpen={() => setIsDiffOpen(true)}
      />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden pt-[52px]">
        <div className="relative min-h-0 flex-1">
          <div className={cn(
            "absolute inset-0 overflow-hidden",
            activeTab === "dashboard" ? "z-10" : "hidden"
          )}>
            <Suspense fallback={null}>
              {activeTab === "dashboard" ? <Dashboard isActive /> : null}
            </Suspense>
          </div>
          <div className={cn(
            "absolute inset-0 overflow-hidden",
            activeTab === "git" ? "z-10" : "hidden"
          )}>
            <Suspense fallback={null}>
              {activeTab === "git" ? <GitPanel isActive /> : null}
            </Suspense>
          </div>
          <div className={cn(
            "absolute inset-0 overflow-hidden",
            activeTab === "files" ? "z-10" : "hidden"
          )}>
            <Suspense fallback={null}>
              <FileViewer ref={fileViewerRef} isActive={activeTab === "files"} />
            </Suspense>
          </div>
          {activeTab === "terminal" && repoCwd && !hasStartedTerminal && !isDiffOpen ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-6">
              <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-border/60 bg-card/80 p-8 text-center shadow-sm">
                <div className="rounded-full border border-border/60 bg-muted/50 p-3 text-muted-foreground">
                  <Terminal className="size-5" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">Start a terminal for this project</h2>
                  <p className="text-sm text-muted-foreground">
                    Terminal sessions now start explicitly and stay alive until you close them.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => repoCwd && ensureTerminalProject(repoCwd)}
                  className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
                >
                  Start Terminal
                </button>
              </div>
            </div>
          ) : null}
          <Suspense fallback={null}>
            {repoCwd && activeTerminalProject ? (
              <div key={repoCwd} className={cn(
                "absolute inset-0 overflow-hidden p-3",
                activeTab === "terminal" && !isDiffOpen ? "z-10" : "pointer-events-none invisible"
              )}>
                <TerminalPanel
                  ref={(handle) => setTerminalHandle(repoCwd, handle)}
                  cwd={repoCwd}
                  isVisible={activeTab === "terminal" && !isDiffOpen}
                  onAllTabsClosed={() => removeTerminalProject(repoCwd)}
                />
              </div>
            ) : null}
          </Suspense>
        </div>
      </main>
      <Suspense fallback={null}>
        <DiffViewer open={isDiffOpen} onOpenChange={setIsDiffOpen} />
      </Suspense>
    </>
  )
}

export function App() {
  const repoCwd = useAppStore((s) => s.repoCwd)

  if (!repoCwd) {
    return (
      <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
        <div
          className="h-11 shrink-0"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        />
        <WelcomeScreen />
      </div>
    )
  }

  return (
    <SidebarProvider className="overflow-hidden rounded-2xl bg-sidebar">
      <Suspense fallback={<div className="w-[var(--sidebar-width)] shrink-0 bg-sidebar" />}>
        <RepoSidebar />
      </Suspense>
      <div className="relative z-[11] flex h-screen min-w-0 flex-1 flex-col overflow-hidden rounded-l-2xl bg-background text-foreground">
        <AppContent />
      </div>
    </SidebarProvider>
  )
}

export default App
