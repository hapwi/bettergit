import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { execGh } from "@/lib/git/exec";
import { useAppStore } from "@/store";
import { GitHubIcon, ClaudeIcon, CodexIcon } from "@/components/icons";
import { ArrowLeft02Icon, AiMagicIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Terminal } from "lucide-react";

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
  const terminalApp = useAppStore((s) => s.terminalApp);
  const setTerminalApp = useAppStore((s) => s.setTerminalApp);
  const [view, setView] = useState<"main" | "connections">("main");
  const [services, setServices] = useState<ServiceStatus[]>(cachedServices ?? []);
  const [selectedModel, setSelectedModel] = useState("claude-haiku-4-5");
  const [detectedTerminals, setDetectedTerminals] = useState<string[]>([]);
  const checkedRef = useRef(false);

  const connectedCount = services.filter((s) => s.status === "connected").length;
  const totalCount = services.length || 3;
  const allChecking = services.length === 0 || services.every((s) => s.status === "checking");

  const checkConnections = useCallback(async () => {
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
      const result = await execGh(cwd, ["auth", "status"]);
      const output = result.stdout + result.stderr;
      if (result.code === 0 || output.includes("Logged in")) {
        const match = output.match(/Logged in to (.+?) account (.+?)[\s(]/);
        gh = {
          label: "GitHub CLI",
          status: "connected",
          detail: match ? `${match[2]} on ${match[1]}` : "Authenticated",
          icon: GitHubIcon,
        };
      } else {
        gh = { label: "GitHub CLI", status: "disconnected", detail: "Run: gh auth login", icon: GitHubIcon };
      }
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
  }, [repoCwd]);

  useEffect(() => {
    if (!open) {
      setView("main");
      return;
    }

    // Load model
    import("@/lib/server").then(({ serverFetch }) =>
      serverFetch<{ model: string }>("/api/ai/model").then((res) => setSelectedModel(res.model)),
    ).catch(() => {});

    // Detect installed terminals
    window.electronAPI?.shell.detectTerminals().then(setDetectedTerminals).catch(() => {});

    // Only check connections once per session (or if no cache)
    if (!checkedRef.current || !cachedServices) {
      checkedRef.current = true;
      void checkConnections();
    }
  }, [open, checkConnections]);

  const handleModelChange = (model: string) => {
    setSelectedModel(model);
    void import("@/lib/server").then(({ serverFetch }) =>
      serverFetch("/api/ai/set-model", { model }),
    );
  };

  const claudeModels = AI_MODELS.filter((m) => m.group === "Claude");
  const codexModels = AI_MODELS.filter((m) => m.group === "Codex");

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
              <select
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                className="ml-auto rounded-lg border bg-background px-2 py-1.5 text-xs outline-none"
              >
                <optgroup label="Claude">
                  {claudeModels.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Codex">
                  {codexModels.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          {/* Terminal selector */}
          {detectedTerminals.length > 0 && (
            <div className="flex flex-col gap-2">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/50">General</p>
                <p className="text-xs text-muted-foreground">
                  Choose which terminal app opens when you click "Open in Terminal".
                </p>
              </div>
              <div className="flex items-center gap-3 rounded-xl border bg-card/50 px-3 py-2.5">
                <Terminal className="size-4 shrink-0 text-muted-foreground" />
                <p className="shrink-0 text-sm font-medium">Terminal</p>
                <select
                  value={terminalApp ?? detectedTerminals[0]}
                  onChange={(e) => setTerminalApp(e.target.value)}
                  className="ml-auto rounded-lg border bg-background px-2 py-1.5 text-xs outline-none"
                >
                  {detectedTerminals.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
