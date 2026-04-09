import { useState, useRef, useEffect, useCallback } from "react"
import { useAppStore } from "@/store"
import { RepoSidebar } from "@/components/git/RepoSidebar"
import { GitPanel } from "@/components/git/GitPanel"
import { Dashboard } from "@/components/git/Dashboard"
import { WelcomeScreen } from "@/components/git/WelcomeScreen"
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  GitBranchIcon,
  SidebarLeftIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Terminal, FileDiff } from "lucide-react"
import { DiffViewer } from "@/components/git/DiffViewer"
import { TerminalPanel, type TerminalPanelHandle } from "@/components/terminal/TerminalPanel"

type ActiveTab = "dashboard" | "git" | "terminal"

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
  const [activeTab, setActiveTab] = useState<ActiveTab>("dashboard")
  const [isDiffOpen, setIsDiffOpen] = useState(false)
  const [terminalProjects, setTerminalProjects] = useState<Set<string>>(new Set())
  const repoCwd = useAppStore((s) => s.repoCwd)
  const terminalRefs = useRef(new Map<string, React.MutableRefObject<TerminalPanelHandle | null>>())
  const setTerminalHandle = (projectCwd: string, handle: TerminalPanelHandle | null) => {
    let existing = terminalRefs.current.get(projectCwd)
    if (!existing) {
      existing = { current: null }
      terminalRefs.current.set(projectCwd, existing)
    }
    existing.current = handle
  }

  const ensureTerminalReady = useCallback((projectCwd: string | null) => {
    if (!projectCwd) return
    setTerminalProjects((prev) => {
      if (prev.has(projectCwd)) return prev
      const next = new Set(prev)
      next.add(projectCwd)
      return next
    })
  }, [])

  useEffect(() => {
    if (activeTab !== "terminal" || !repoCwd) return
    const id = window.setTimeout(() => {
      ensureTerminalReady(repoCwd)
    }, 0)
    return () => window.clearTimeout(id)
  }, [activeTab, ensureTerminalReady, repoCwd])

  // Cmd+W: close pane/tab in terminal first, then close window
  useEffect(() => {
    const cleanup = window.electronAPI?.onClosePaneOrWindow(() => {
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
      // Switch to terminal tab if not already there
      if (activeTab !== "terminal") {
        setActiveTab("terminal")
      }
      ensureTerminalReady(repoCwd)
      // Defer action to next tick so terminal is mounted
      setTimeout(() => {
        if (!repoCwd) return
        const ref = terminalRefs.current.get(repoCwd)
        const t = ref?.current
        if (!t) return
        switch (action) {
          case "terminal:new-tab": t.addTab(); break
        }
      }, 0)
    })
    return cleanup
  }, [activeTab, ensureTerminalReady, repoCwd])

  return (
    <>
      <Toolbar
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab)
          if (tab === "terminal") {
            ensureTerminalReady(repoCwd)
          }
        }}
        onDiffOpen={() => setIsDiffOpen(true)}
      />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden pt-[52px]">
        <div className="relative min-h-0 flex-1">
          <div className={cn(
            "absolute inset-0 overflow-hidden",
            activeTab === "dashboard" ? "z-10" : "hidden"
          )}>
            <Dashboard />
          </div>
          <div className={cn(
            "absolute inset-0 overflow-hidden",
            activeTab === "git" ? "z-10" : "hidden"
          )}>
            <GitPanel />
          </div>
          {Array.from(terminalProjects).map((projectCwd) => (
            <div key={projectCwd} className={cn(
              "absolute inset-0 overflow-hidden",
              activeTab === "terminal" && repoCwd === projectCwd && !isDiffOpen ? "z-10" : "pointer-events-none invisible"
            )}>
              <TerminalPanel
                ref={(handle) => setTerminalHandle(projectCwd, handle)}
                cwd={projectCwd}
                isVisible={activeTab === "terminal" && repoCwd === projectCwd && !isDiffOpen}
              />
            </div>
          ))}
        </div>
      </main>
      <DiffViewer open={isDiffOpen} onOpenChange={setIsDiffOpen} />
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
      <RepoSidebar />
      <div className="relative z-[11] flex h-screen min-w-0 flex-1 flex-col overflow-hidden rounded-l-2xl bg-background text-foreground">
        <AppContent />
      </div>
    </SidebarProvider>
  )
}

export default App
