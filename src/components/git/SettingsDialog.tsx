import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { execGh } from "@/lib/git/exec";
import { useAppStore } from "@/store";
import { GitHubIcon, ClaudeIcon, CodexIcon } from "@/components/icons";

interface ServiceStatus {
  label: string;
  status: "checking" | "connected" | "disconnected";
  detail?: string;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
}

function StatusDot({ status }: { status: ServiceStatus["status"] }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === "connected" && "bg-emerald-500",
        status === "disconnected" && "bg-red-500",
        status === "checking" && "animate-pulse bg-amber-500",
      )}
    />
  );
}

const INITIAL_SERVICES: ServiceStatus[] = [
  { label: "GitHub CLI", status: "checking", icon: GitHubIcon },
  { label: "Claude Code", status: "checking", icon: ClaudeIcon },
  { label: "Codex", status: "checking", icon: CodexIcon },
];

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repoCwd = useAppStore((s) => s.repoCwd);
  const [services, setServices] = useState<ServiceStatus[]>(INITIAL_SERVICES);

  useEffect(() => {
    if (!open) return;
    setServices(INITIAL_SERVICES);

    const check = async () => {
      const cwd = repoCwd ?? ".";

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

      // Claude Code — check if the AI API is wired up in Electron
      const hasAiApi = !!window.electronAPI?.ai;
      const claude: ServiceStatus = {
        label: "Claude Code",
        status: hasAiApi ? "connected" : "disconnected",
        detail: hasAiApi ? "Available" : "Not configured",
        icon: ClaudeIcon,
      };

      // Codex — not yet integrated
      const codex: ServiceStatus = {
        label: "Codex",
        status: "disconnected",
        detail: "Not configured",
        icon: CodexIcon,
      };

      setServices([gh, claude, codex]);
    };

    void check();
  }, [open, repoCwd]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Service connections</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {services.map((svc) => (
            <div
              key={svc.label}
              className="flex items-center gap-3 rounded-lg border bg-card/50 px-4 py-3"
            >
              <svc.icon className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{svc.label}</p>
                {svc.detail && (
                  <p className="truncate text-xs text-muted-foreground">{svc.detail}</p>
                )}
              </div>
              <StatusDot status={svc.status} />
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
