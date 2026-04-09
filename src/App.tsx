import { useState, useRef, useEffect } from "react"
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
  const [terminalMounted, setTerminalMounted] = useState(false)
  const repoCwd = useAppStore((s) => s.repoCwd)
  const terminalRef = useRef<TerminalPanelHandle>(null)

  // Lazy-mount: only render the terminal once it's been activated
  if (activeTab === "terminal" && !terminalMounted) {
    setTerminalMounted(true)
  }

  // Cmd+W: close pane/tab in terminal first, then close window
  useEffect(() => {
    const cleanup = window.electronAPI?.onClosePaneOrWindow(() => {
      if (activeTab === "terminal" && terminalRef.current) {
        const handled = terminalRef.current.closePaneOrTab()
        if (handled) return
      }
      window.close()
    })
    return cleanup
  }, [activeTab])

  // Cmd+D / Cmd+Shift+D / Cmd+T: terminal split & tab shortcuts
  useEffect(() => {
    const cleanup = window.electronAPI?.onTerminalAction((action) => {
      // Switch to terminal tab if not already there
      if (activeTab !== "terminal") {
        setActiveTab("terminal")
        if (!terminalMounted) setTerminalMounted(true)
      }
      // Defer action to next tick so terminal is mounted
      setTimeout(() => {
        const t = terminalRef.current
        if (!t) return
        switch (action) {
          case "terminal:split-vertical": t.splitVertical(); break
          case "terminal:split-horizontal": t.splitHorizontal(); break
          case "terminal:new-tab": t.addTab(); break
        }
      }, 0)
    })
    return cleanup
  }, [activeTab, terminalMounted])

  return (
    <>
      <Toolbar activeTab={activeTab} onTabChange={setActiveTab} onDiffOpen={() => setIsDiffOpen(true)} />
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
          {terminalMounted && repoCwd && (
            <div className={cn(
              "absolute inset-0 overflow-hidden",
              activeTab === "terminal" ? "z-10" : "pointer-events-none invisible"
            )}>
              <TerminalPanel ref={terminalRef} cwd={repoCwd} isVisible={activeTab === "terminal"} />
            </div>
          )}
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
