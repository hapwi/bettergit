import { create } from "zustand";

const MAX_RECENT = 10;

// ---------------------------------------------------------------------------
// File-backed persistence via Electron IPC — survives dev restarts
// ---------------------------------------------------------------------------

function persistToFile(data: Record<string, unknown>) {
  window.electronAPI?.settings.save(data);
}


function loadFromLocalStorage(): { repos: string[]; terminalApp: string | null } {
  try {
    const repos = JSON.parse(localStorage.getItem("bettergit:recent-repos") ?? "[]") as string[];
    const terminalApp = localStorage.getItem("bettergit:terminal-app");
    return { repos, terminalApp };
  } catch {
    return { repos: [], terminalApp: null };
  }
}

function saveSettings(repos: string[], terminalApp: string | null) {
  // Save to both localStorage (fast sync read) and file (survives restarts)
  localStorage.setItem("bettergit:recent-repos", JSON.stringify(repos.slice(0, MAX_RECENT)));
  if (terminalApp) localStorage.setItem("bettergit:terminal-app", terminalApp);
  else localStorage.removeItem("bettergit:terminal-app");

  persistToFile({ recentRepos: repos.slice(0, MAX_RECENT), terminalApp });
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface AppStore {
  repoCwd: string | null;
  recentRepos: string[];
  terminalApp: string | null;
  gitBusyMap: Record<string, boolean>;
  gitResultMap: Record<string, "success" | "error" | null>;
  setRepoCwd: (cwd: string | null) => void;
  removeRecentRepo: (cwd: string) => void;
  reorderRepos: (from: number, to: number) => void;
  setTerminalApp: (app: string | null) => void;
  setGitBusy: (cwd: string, busy: boolean) => void;
  flashGitResult: (cwd: string, result: "success" | "error") => void;
}

// Sync load from localStorage for initial render
const initial = loadFromLocalStorage();

export const useAppStore = create<AppStore>((set, get) => ({
  repoCwd: initial.repos[0] ?? null,
  recentRepos: initial.repos,
  terminalApp: initial.terminalApp,
  gitBusyMap: {},
  gitResultMap: {},

  setRepoCwd: (cwd) => {
    set({ repoCwd: cwd });
    if (cwd) {
      const existing = get().recentRepos;
      if (!existing.includes(cwd)) {
        const recent = [...existing, cwd].slice(0, MAX_RECENT);
        set({ recentRepos: recent });
        saveSettings(recent, get().terminalApp);
      }
    }
  },

  removeRecentRepo: (cwd) => {
    const recent = get().recentRepos.filter((r) => r !== cwd);
    set({ recentRepos: recent });
    saveSettings(recent, get().terminalApp);
  },

  setTerminalApp: (app) => {
    set({ terminalApp: app });
    saveSettings(get().recentRepos, app);
  },

  reorderRepos: (from, to) => {
    const repos = [...get().recentRepos];
    const [moved] = repos.splice(from, 1);
    repos.splice(to, 0, moved);
    set({ recentRepos: repos });
    saveSettings(repos, get().terminalApp);
  },

  setGitBusy: (cwd, busy) => set((s) => ({
    gitBusyMap: { ...s.gitBusyMap, [cwd]: busy },
  })),

  flashGitResult: (cwd, result) => {
    set((s) => ({ gitResultMap: { ...s.gitResultMap, [cwd]: result } }));
    setTimeout(() => set((s) => ({ gitResultMap: { ...s.gitResultMap, [cwd]: null } })), 2500);
  },
}));

// Async: load from file and merge if localStorage was empty
window.electronAPI?.settings.load().then((file) => {
  fileSettings = file;
  const state = useAppStore.getState();
  const fileRepos = (file.recentRepos as string[] | undefined) ?? [];
  const fileTermApp = (file.terminalApp as string | null) ?? null;

  // If localStorage was empty but file has data, restore from file
  if (state.recentRepos.length === 0 && fileRepos.length > 0) {
    useAppStore.setState({
      recentRepos: fileRepos,
      repoCwd: fileRepos[0] ?? null,
      terminalApp: fileTermApp,
    });
    // Sync back to localStorage
    localStorage.setItem("bettergit:recent-repos", JSON.stringify(fileRepos));
    if (fileTermApp) localStorage.setItem("bettergit:terminal-app", fileTermApp);
  }
});
