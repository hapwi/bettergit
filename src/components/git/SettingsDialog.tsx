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

interface ServiceStatus {
  label: string;
  status: "checking" | "connected" | "disconnected";
  detail?: string;
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

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repoCwd = useAppStore((s) => s.repoCwd);
  const [services, setServices] = useState<ServiceStatus[]>([
    { label: "GitHub CLI", status: "checking" },
    { label: "Claude AI", status: "checking" },
  ]);

  useEffect(() => {
    if (!open) return;

    const checkServices = async () => {
      // Check GitHub CLI auth
      let ghStatus: ServiceStatus;
      try {
        const cwd = repoCwd ?? ".";
        const result = await execGh(cwd, ["auth", "status"]);
        if (result.code === 0) {
          const match = result.stdout.match(/Logged in to (.+?) account (.+?) /);
          ghStatus = {
            label: "GitHub CLI",
            status: "connected",
            detail: match ? `${match[2]} on ${match[1]}` : "Authenticated",
          };
        } else {
          ghStatus = { label: "GitHub CLI", status: "disconnected", detail: "Not authenticated" };
        }
      } catch {
        ghStatus = { label: "GitHub CLI", status: "disconnected", detail: "gh not found" };
      }

      // Check Claude AI
      let claudeStatus: ServiceStatus;
      try {
        const api = window.electronAPI;
        if (api) {
          // Try a minimal AI call to check connectivity
          const result = await api.ai.generateBranchName({ message: "test" });
          claudeStatus = {
            label: "Claude AI",
            status: result.branch ? "connected" : "disconnected",
            detail: "API connected",
          };
        } else {
          claudeStatus = { label: "Claude AI", status: "disconnected", detail: "Electron API unavailable" };
        }
      } catch {
        claudeStatus = { label: "Claude AI", status: "disconnected", detail: "API key missing or invalid" };
      }

      setServices([ghStatus, claudeStatus]);
    };

    void checkServices();
  }, [open, repoCwd]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Service connections</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {services.map((svc) => (
            <div
              key={svc.label}
              className="flex items-center gap-3 rounded-lg border bg-card/50 px-4 py-3"
            >
              <StatusDot status={svc.status} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{svc.label}</p>
                {svc.detail && (
                  <p className="truncate text-xs text-muted-foreground">{svc.detail}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
