import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getGhAuthStatus } from "@/lib/git/github";
import { useAppStore } from "@/store";
import { GitHubIcon, ClaudeIcon, CodexIcon } from "@/components/icons";
import { ArrowLeft02Icon, AiMagicIcon, Folder01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

interface ServiceStatus {
  label: string;
  status: "checking" | "connected" | "disconnected";
  detail?: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
}

function StatusDot({ status, className }: { status: ServiceStatus["status"]; className?: string }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === "connected" && "bg-emerald-500",
        status === "disconnected" && "bg-red-500",
        status === "checking" && "animate-pulse bg-amber-500",
        className,
      )}
    />
  );
}

const AI_MODELS = [
  { value: "claude-haiku-4-5", label: "Haiku 4.5", group: "Claude" },
  { value: "claude-sonnet-4-6", label: "Sonnet 4.6", group: "Claude" },
  { value: "claude-opus-4-6", label: "Opus 4.6", group: "Claude" },
  { value: "gpt-5.4", label: "GPT-5.4", group: "Codex" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 Mini", group: "Codex" },
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", group: "Codex" },
  { value: "gpt-5.2-codex", label: "GPT-5.2 Codex", group: "Codex" },
] as const;

type ElectronUpdates = NonNullable<Window["electronAPI"]>["updates"];
type DesktopUpdateState = Awaited<ReturnType<ElectronUpdates["getState"]>>;
type DesktopUpdateCheckResult = Awaited<ReturnType<ElectronUpdates["check"]>>;
type DesktopUpdateActionResult = Awaited<ReturnType<ElectronUpdates["download"]>>;

function resolveDesktopUpdateAction(state: DesktopUpdateState | null): "check" | "download" | "install" {
  if (!state || !state.enabled) return "check";
  if (state.status === "available") return "download";
  if (state.status === "downloaded") return "install";
  if (state.status === "error" && state.errorContext === "download" && state.availableVersion) {
    return "download";
  }
  if (state.status === "error" && state.errorContext === "install" && state.downloadedVersion) {
    return "install";
  }
  return "check";
}

function getDesktopUpdateStatusLabel(state: DesktopUpdateState | null): string {
  if (!state) return "Unavailable";
  switch (state.status) {
    case "checking":
      return "Checking";
    case "available":
      return "Available";
    case "downloading":
      return "Downloading";
    case "downloaded":
      return "Ready";
    case "up-to-date":
      return "Current";
    case "error":
      return "Error";
    case "disabled":
      return "Disabled";
    default:
      return "Idle";
  }
}

function getDesktopUpdateDescription(state: DesktopUpdateState | null): string {
  if (!state) {
    return "Updates unavailable";
  }
  if (!state.enabled) {
    return "Packaged builds only";
  }
  if (state.status === "available" && state.availableVersion) {
    return `Download v${state.availableVersion}`;
  }
  if (state.status === "downloading") {
    return `Downloading v${state.availableVersion ?? "update"}`;
  }
  if (state.status === "downloaded") {
    return `Install v${state.downloadedVersion ?? state.availableVersion ?? "update"}`;
  }
  if (state.status === "up-to-date") {
    return "No update ready";
  }
  if (state.status === "error") {
    return state.message ?? "Update failed";
  }
  return `Current v${state.currentVersion}`;
}

function getDesktopUpdateSummary(state: DesktopUpdateState | null): string {
  if (!state) return "Updates unavailable";
  if (!state.enabled) return "Packaged builds only";
  if (state.status === "available" && state.availableVersion) {
    return `v${state.availableVersion} available`;
  }
  if (state.status === "downloading") {
    if (typeof state.downloadPercent === "number") {
      return `${Math.floor(Math.min(100, state.downloadPercent))}% downloaded`;
    }
    return "Downloading update";
  }
  if (state.status === "downloaded") {
    return `v${state.downloadedVersion ?? state.availableVersion ?? "update"} downloaded`;
  }
  if (state.status === "up-to-date") {
    return `You are on v${state.currentVersion}`;
  }
  if (state.status === "error") {
    return state.message ?? "Update failed";
  }
  if (state.status === "checking") {
    return "Checking for updates";
  }
  return `v${state.currentVersion}`;
}

function getDesktopUpdateMeta(state: DesktopUpdateState | null): string {
  if (!state) return "No update feed";
  if (!state.enabled) return state.message ?? "Automatic updates unavailable";
  if (state.status === "available" && state.availableVersion) {
    return `Current v${state.currentVersion}`;
  }
  if (state.status === "downloaded") {
    return "Restart app to install";
  }
  if (state.status === "downloading" && state.availableVersion) {
    return `Downloading v${state.availableVersion}`;
  }
  if (state.status === "error") {
    return state.errorContext === "download" ? "Retry download" : "Check again";
  }
  return state.checkedAt
    ? `Checked ${new Date(state.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
    : "Never checked";
}

function getDesktopUpdateButtonLabel(state: DesktopUpdateState | null): string {
  const action = resolveDesktopUpdateAction(state);
  if (!state?.enabled) return "Check for updates";
  if (action === "download") return "Download update";
  if (action === "install") return "Restart to install";
  if (state.status === "checking") return "Checking...";
  return "Check for updates";
}

// Cache connection results across dialog opens
let cachedServices: ServiceStatus[] | null = null;

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repoCwd = useAppStore((s) => s.repoCwd);
  const githubFolder = useAppStore((s) => s.githubFolder);
  const setGithubFolder = useAppStore((s) => s.setGithubFolder);
  const { online } = useNetworkStatus();
  const [view, setView] = useState<"main" | "connections">("main");
  const [services, setServices] = useState<ServiceStatus[]>(cachedServices ?? []);
  const [selectedModel, setSelectedModel] = useState("claude-haiku-4-5");
  const [updateState, setUpdateState] = useState<DesktopUpdateState | null>(null);
  const checkedRef = useRef(false);

  const connectedCount = services.filter((s) => s.status === "connected").length;
  const totalCount = services.length || 3;
  const allChecking = services.length === 0 || services.every((s) => s.status === "checking");

  const checkConnections = useCallback(async () => {
    if (!online) {
      const offlineServices: ServiceStatus[] = [
        { label: "GitHub CLI", status: "disconnected", detail: "Offline", icon: GitHubIcon },
        { label: "Claude Code", status: "disconnected", detail: "Offline", icon: ClaudeIcon },
        { label: "Codex", status: "disconnected", detail: "Offline", icon: CodexIcon },
      ];
      setServices(offlineServices);
      cachedServices = offlineServices;
      return;
    }

    const initial: ServiceStatus[] = [
      { label: "GitHub CLI", status: "checking", icon: GitHubIcon },
      { label: "Claude Code", status: "checking", icon: ClaudeIcon },
      { label: "Codex", status: "checking", icon: CodexIcon },
    ];
    setServices(initial);

    const cwd = repoCwd ?? ".";
    const { serverFetch } = await import("@/lib/server");

    // GitHub CLI
    let gh: ServiceStatus;
    try {
      const status = await getGhAuthStatus(cwd);
      gh = {
        label: "GitHub CLI",
        status: status.connected ? "connected" : "disconnected",
        detail: status.detail,
        icon: GitHubIcon,
      };
    } catch {
      gh = { label: "GitHub CLI", status: "disconnected", detail: "gh CLI not found", icon: GitHubIcon };
    }

    // Claude Code CLI
    let claude: ServiceStatus;
    try {
      const { available } = await serverFetch<{ available: boolean }>("/api/ai/check-cli?cli=claude");
      claude = {
        label: "Claude Code",
        status: available ? "connected" : "disconnected",
        detail: available ? "CLI available" : "Run: npm i -g @anthropic-ai/claude-code",
        icon: ClaudeIcon,
      };
    } catch {
      claude = { label: "Claude Code", status: "disconnected", detail: "Not found", icon: ClaudeIcon };
    }

    // Codex CLI
    let codex: ServiceStatus;
    try {
      const { available } = await serverFetch<{ available: boolean }>("/api/ai/check-cli?cli=codex");
      codex = {
        label: "Codex",
        status: available ? "connected" : "disconnected",
        detail: available ? "CLI available" : "Run: npm i -g @openai/codex",
        icon: CodexIcon,
      };
    } catch {
      codex = { label: "Codex", status: "disconnected", detail: "Not found", icon: CodexIcon };
    }

    const result = [gh, claude, codex];
    setServices(result);
    cachedServices = result;
  }, [repoCwd, online]);

  useEffect(() => {
    if (!open) {
      setView("main");
      return;
    }

    // Load model
    import("@/lib/server").then(({ serverFetch }) =>
      serverFetch<{ model: string }>("/api/ai/model").then((res) => setSelectedModel(res.model)),
    ).catch(() => {});

    // Only check connections once per session (or if no cache)
    if (!checkedRef.current || !cachedServices) {
      checkedRef.current = true;
      void checkConnections();
    }
  }, [open, checkConnections]);

  useEffect(() => {
    if (!open) return;

    const updates = window.electronAPI?.updates;
    if (!updates) {
      setUpdateState(null);
      return;
    }

    let active = true;
    void updates.getState().then((state) => {
      if (active) setUpdateState(state);
    }).catch(() => {
      if (active) setUpdateState(null);
    });

    const cleanup = updates.onState((state) => {
      if (active) setUpdateState(state);
    });

    return () => {
      active = false;
      cleanup();
    };
  }, [open]);

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    void import("@/lib/server").then(({ serverFetch }) =>
      serverFetch("/api/ai/set-model", { model }),
    );
  };

  const claudeModels = AI_MODELS.filter((m) => m.group === "Claude");
  const codexModels = AI_MODELS.filter((m) => m.group === "Codex");
  const updateButtonAction = resolveDesktopUpdateAction(updateState);
  const updateButtonDisabled =
    updateState?.status === "checking" || updateState?.status === "downloading";

  const handleUpdateAction = async () => {
    const updates = window.electronAPI?.updates;
    if (!updates) {
      toast.error("Updates are unavailable in this build.");
      return;
    }

    try {
      if (updateButtonAction === "download") {
        const result: DesktopUpdateActionResult = await updates.download();
        setUpdateState(result.state);
        if (!result.accepted) return;
        if (!result.completed && result.state.message) {
          toast.error(result.state.message);
          return;
        }
        toast.success("Update downloaded. Restart BetterGit to install it.");
        return;
      }

      if (updateButtonAction === "install") {
        const version = updateState?.downloadedVersion ?? updateState?.availableVersion ?? "the latest version";
        const confirmed = window.confirm(
          `Install ${version} and restart BetterGit?\n\nAny running terminal sessions will be interrupted.`,
        );
        if (!confirmed) return;

        const result: DesktopUpdateActionResult = await updates.install();
        setUpdateState(result.state);
        if (!result.accepted && result.state.message) {
          toast.error(result.state.message);
        }
        return;
      }

      const result: DesktopUpdateCheckResult = await updates.check();
      setUpdateState(result.state);
      if (!result.checked) {
        toast.error(result.state.message ?? "Updates are unavailable in this build.");
        return;
      }
      if (result.state.status === "up-to-date") {
        toast.success(`BetterGit ${result.state.currentVersion} is up to date.`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update action failed.");
    }
  };

  if (view === "connections") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setView("main")}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <HugeiconsIcon icon={ArrowLeft02Icon} className="size-4" />
              </button>
              <DialogTitle>Connections</DialogTitle>
            </div>
            <DialogDescription>Service status</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            {services.map((svc) => (
              <div
                key={svc.label}
                className="flex items-center gap-3 rounded-xl px-4 py-3"
              >
                <svc.icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{svc.label}</p>
                  {svc.detail && (
                    <p className="text-[11px] text-muted-foreground">{svc.detail}</p>
                  )}
                </div>
                <StatusDot status={svc.status} />
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              cachedServices = null;
              void checkConnections();
            }}
          >
            Refresh
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Connections and AI configuration</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Connections card */}
          <button
            type="button"
            className="flex items-center gap-3 rounded-xl border bg-card/50 px-4 py-3 text-left transition-colors hover:bg-accent/30"
            onClick={() => setView("connections")}
          >
            <div className="flex gap-1">
              {(services.length > 0 ? services : Array.from({ length: 3 }, () => ({ status: "checking" as const }))).map((svc, i) => (
                <StatusDot key={i} status={svc.status} />
              ))}
            </div>
            <span className="flex-1 text-sm font-medium">Connections</span>
            <span className="text-xs text-muted-foreground">
              {allChecking ? "..." : `${connectedCount}/${totalCount}`}
            </span>
          </button>

          {/* Model selector */}
          <div className="flex flex-col gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">Git</p>
              <p className="text-xs text-muted-foreground">
                Configure the model used for commit messages, PR titles, and branch names.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-xl border bg-card/50 px-3 py-2.5">
              <HugeiconsIcon icon={AiMagicIcon} className="size-4 shrink-0 text-muted-foreground" />
              <p className="shrink-0 text-sm font-medium">Text model</p>
              <Select value={selectedModel} onValueChange={handleModelChange}>
                <SelectTrigger size="sm" className="ml-auto text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Claude</SelectLabel>
                    {claudeModels.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>Codex</SelectLabel>
                    {codexModels.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* GitHub folder */}
          <div className="flex flex-col gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">GitHub</p>
              <p className="text-xs text-muted-foreground">
                Where repos cloned from GitHub will be saved.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-xl border bg-card/50 px-3 py-2.5">
              <HugeiconsIcon icon={Folder01Icon} className="size-4 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="min-w-0 flex-1 text-left text-sm"
                onClick={async () => {
                  const path = await window.electronAPI?.dialog.openDirectory();
                  if (path) setGithubFolder(path);
                }}
              >
                {githubFolder ? (
                  <span className="block truncate font-medium" title={githubFolder}>
                    {(() => {
                      const parts = githubFolder.split("/").filter(Boolean);
                      if (parts.length <= 3) return githubFolder;
                      return "…/" + parts.slice(-3).join("/");
                    })()}
                  </span>
                ) : (
                  <span className="text-muted-foreground">Choose folder…</span>
                )}
              </button>
              {githubFolder && (
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => setGithubFolder(null)}
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="size-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">Application</p>
            <div className="rounded-xl border bg-card/40 px-3.5 py-3">
              <div className="flex items-start gap-3">
                <div className={cn(
                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
                  updateState?.status === "available" || updateState?.status === "downloaded"
                    ? "bg-emerald-500/12 text-emerald-500"
                    : updateState?.status === "downloading" || updateState?.status === "checking"
                      ? "bg-amber-500/12 text-amber-500"
                      : updateState?.status === "error"
                        ? "bg-red-500/12 text-red-500"
                        : "bg-muted/80 text-muted-foreground",
                )}>
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="size-3.5">
                    <path d="M7.25 10.25a.75.75 0 0 0 1.5 0V4.56l1.72 1.72a.75.75 0 1 0 1.06-1.06l-3-3a.75.75 0 0 0-1.06 0l-3 3a.75.75 0 0 0 1.06 1.06l1.72-1.72v5.69Z" />
                    <path d="M3.5 9.75a.75.75 0 0 0-1.5 0v1.5A2.75 2.75 0 0 0 4.75 14h6.5A2.75 2.75 0 0 0 14 11.25v-1.5a.75.75 0 0 0-1.5 0v1.5c0 .69-.56 1.25-1.25 1.25h-6.5c-.69 0-1.25-.56-1.25-1.25v-1.5Z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">App updates</p>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "h-5 rounded-full border px-1.5 text-[10px] font-medium",
                        updateState?.status === "up-to-date" && "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                        updateState?.status === "available" && "border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400",
                        updateState?.status === "downloaded" && "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                        updateState?.status === "error" && "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400",
                        (updateState?.status === "downloading" || updateState?.status === "checking") && "border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                        (!updateState || updateState.status === "disabled" || updateState.status === "idle") && "border-border bg-muted/70 text-muted-foreground",
                      )}
                    >
                      {getDesktopUpdateStatusLabel(updateState)}
                    </Badge>
                    {updateState?.currentVersion && (
                      <span className="ml-auto rounded-md bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        v{updateState.currentVersion}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs font-medium text-foreground/90">
                    {getDesktopUpdateSummary(updateState)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {getDesktopUpdateMeta(updateState)}
                  </p>
                </div>
              </div>
              {updateState?.status === "downloading" && typeof updateState.downloadPercent === "number" && (
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted/80">
                  <div
                    className="h-full rounded-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.floor(updateState.downloadPercent))}%` }}
                  />
                </div>
              )}
              <div className="mt-3 flex items-center gap-2 border-t border-border/50 pt-3">
                <span className="min-w-0 truncate text-[10px] text-muted-foreground/60">
                  {getDesktopUpdateDescription(updateState)}
                </span>
                <Button
                  size="sm"
                  variant={updateButtonAction === "install" ? "default" : "outline"}
                  className="ml-auto h-7 rounded-lg px-2.5 text-xs"
                  disabled={updateButtonDisabled}
                  onClick={() => void handleUpdateAction()}
                >
                  {getDesktopUpdateButtonLabel(updateState)}
                </Button>
              </div>
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
