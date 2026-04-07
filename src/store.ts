import { create } from "zustand";

const RECENT_REPOS_KEY = "bettergit:recent-repos";
const MAX_RECENT = 10;

function loadRecentRepos(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_REPOS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function saveRecentRepos(repos: string[]) {
  localStorage.setItem(RECENT_REPOS_KEY, JSON.stringify(repos.slice(0, MAX_RECENT)));
}

interface AppStore {
  repoCwd: string | null;
  recentRepos: string[];
  gitBusyMap: Record<string, boolean>;
  gitResultMap: Record<string, "success" | "error" | null>;
  setRepoCwd: (cwd: string | null) => void;
  removeRecentRepo: (cwd: string) => void;
  setGitBusy: (cwd: string, busy: boolean) => void;
  flashGitResult: (cwd: string, result: "success" | "error") => void;
}

const initialRecent = loadRecentRepos();

export const useAppStore = create<AppStore>((set, get) => ({
  repoCwd: initialRecent[0] ?? null,
  recentRepos: initialRecent,
  gitBusyMap: {},
  gitResultMap: {},

  setRepoCwd: (cwd) => {
    set({ repoCwd: cwd });
    if (cwd) {
      const existing = get().recentRepos;
      // Only add if not already in the list — don't reorder
      if (!existing.includes(cwd)) {
        const recent = [...existing, cwd].slice(0, MAX_RECENT);
        set({ recentRepos: recent });
        saveRecentRepos(recent);
      }
    }
  },

  removeRecentRepo: (cwd) => {
    const recent = get().recentRepos.filter((r) => r !== cwd);
    set({ recentRepos: recent });
    saveRecentRepos(recent);
  },

  setGitBusy: (cwd, busy) => set((s) => ({
    gitBusyMap: { ...s.gitBusyMap, [cwd]: busy },
  })),

  flashGitResult: (cwd, result) => {
    set((s) => ({ gitResultMap: { ...s.gitResultMap, [cwd]: result } }));
    setTimeout(() => set((s) => ({ gitResultMap: { ...s.gitResultMap, [cwd]: null } })), 2500);
  },
}));
