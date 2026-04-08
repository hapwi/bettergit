import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { useAppStore } from "@/store"
import { RepoSidebar } from "@/components/git/RepoSidebar"
import { GitPanel } from "@/components/git/GitPanel"
import { Dashboard } from "@/components/git/Dashboard"
import { WelcomeScreen } from "@/components/git/WelcomeScreen"
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import { gitStatusQueryOptions } from "@/lib/git/queries"
import {
  LayoutDashboard,
  GitBranchIcon,
  SidebarLeftIcon,
  GitPullRequestIcon,
} from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Terminal } from "lucide-react"

function Toolbar({
  activeTab,
  onTabChange,
}: {
  activeTab: "dashboard" | "git"
  onTabChange: (tab: "dashboard" | "git") => void
}) {
  const { toggleSidebar, state } = useSidebar()
  const isCollapsed = state === "collapsed"
  const repoCwd = useAppStore((s) => s.repoCwd)
  const terminalApp = useAppStore((s) => s.terminalApp)
  const repoName = repoCwd?.split("/").pop() ?? ""
  const { data: status } = useQuery(gitStatusQueryOptions(repoCwd))
  const changeCount = status?.workingTree.files.length ?? 0

  return (
    <div
      className="fixed inset-x-0 top-0 z-50 flex items-center gap-3 pr-4 transition-[padding] duration-200 ease-linear"
      style={{
        WebkitAppRegion: "drag",
        paddingLeft: isCollapsed ? 88 : "calc(var(--sidebar-width) + 16px)",
        height: 52,
      } as React.CSSProperties}
    >
      {/* Left: sidebar toggle + repo name + branch info */}
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
        {status?.branch && (
          <>
            <span className="text-muted-foreground/30">/</span>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <HugeiconsIcon icon={GitBranchIcon} className="size-3" />
              {status.branch}
            </span>
            <span className={cn(
              "flex items-center gap-1 text-xs",
              changeCount > 0 ? "text-amber-500" : "text-emerald-500",
            )}>
              <span className={cn(
                "size-1.5 rounded-full",
                changeCount > 0 ? "bg-amber-500" : "bg-emerald-500",
              )} />
              {changeCount > 0 ? `${changeCount} changes` : "Clean"}
            </span>
            {status.pr && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <HugeiconsIcon icon={GitPullRequestIcon} className="size-3 text-emerald-500" />
                #{status.pr.number}
              </span>
            )}
          </>
        )}
      </div>

      {/* Open in Terminal */}
      {repoCwd && (
        <button
          type="button"
          onClick={() => window.electronAPI?.shell.openTerminal(repoCwd, terminalApp ?? undefined)}
          className="ml-auto rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          title="Open in Terminal"
        >
          <Terminal className="size-[15px]" />
        </button>
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

  return (
    <>
      <Toolbar activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden pt-[52px]">
        {activeTab === "dashboard" && <Dashboard />}
        {activeTab === "git" && <GitPanel />}
      </main>
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
      <div className="relative z-[11] flex h-screen w-full flex-col overflow-hidden rounded-l-2xl bg-background text-foreground">
        <AppContent />
      </div>
    </SidebarProvider>
  )
}

export default App
