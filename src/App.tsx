import { useState } from "react"
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

function Toolbar({
  activeTab,
  onTabChange,
  onDiffOpen,
}: {
  activeTab: "dashboard" | "git"
  onTabChange: (tab: "dashboard" | "git") => void
  onDiffOpen: () => void
}) {
  const { toggleSidebar, state } = useSidebar()
  const isCollapsed = state === "collapsed"
  const repoCwd = useAppStore((s) => s.repoCwd)
  const terminalApp = useAppStore((s) => s.terminalApp)
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
          <button
            type="button"
            onClick={() => window.electronAPI?.shell.openTerminal(repoCwd, terminalApp ?? undefined)}
            className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
            title="Open in Terminal"
          >
            <Terminal className="size-[15px]" />
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
      </div>
    </div>
  )
}

function AppContent() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "git">("dashboard")
  const [isDiffOpen, setIsDiffOpen] = useState(false)

  return (
    <>
      <Toolbar activeTab={activeTab} onTabChange={setActiveTab} onDiffOpen={() => setIsDiffOpen(true)} />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden pt-[52px]">
        {activeTab === "dashboard" && <Dashboard />}
        {activeTab === "git" && <GitPanel />}
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
