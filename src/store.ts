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
  setRepoCwd: (cwd: string | null) => void;
  removeRecentRepo: (cwd: string) => void;
}

const initialRecent = loadRecentRepos();

export const useAppStore = create<AppStore>((set, get) => ({
  repoCwd: initialRecent[0] ?? null,
  recentRepos: initialRecent,

  setRepoCwd: (cwd) => {
    set({ repoCwd: cwd });
    if (cwd) {
      const recent = [cwd, ...get().recentRepos.filter((r) => r !== cwd)].slice(0, MAX_RECENT);
      set({ recentRepos: recent });
      saveRecentRepos(recent);
    }
  },

  removeRecentRepo: (cwd) => {
    const recent = get().recentRepos.filter((r) => r !== cwd);
    set({ recentRepos: recent });
    saveRecentRepos(recent);
  },
}));
