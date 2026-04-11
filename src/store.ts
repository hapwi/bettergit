import { create } from "zustand";

const MAX_RECENT = 10;
const RECENT_PROJECTS_STORAGE_KEY = "bettergit:recent-projects";
const LEGACY_RECENT_REPOS_STORAGE_KEY = "bettergit:recent-repos";
const TERMINAL_APP_STORAGE_KEY = "bettergit:terminal-app";

export interface RecentProject {
  path: string;
  pinned: boolean;
}

// ---------------------------------------------------------------------------
// File-backed persistence via Electron IPC — survives dev restarts
// ---------------------------------------------------------------------------

function persistToFile(data: Record<string, unknown>) {
  window.electronAPI?.settings.save(data);
}

function isRecentProject(value: unknown): value is RecentProject {
  return typeof value === "object" && value !== null &&
    typeof (value as RecentProject).path === "string";
}

function orderProjects(projects: RecentProject[]): RecentProject[] {
  return [
    ...projects.filter((project) => project.pinned),
    ...projects.filter((project) => !project.pinned),
  ];
}

function normalizeProjects(projects: RecentProject[]): RecentProject[] {
  const deduped = new Map<string, RecentProject>();

  for (const project of projects) {
    const trimmedPath = project.path.trim();
    if (!trimmedPath) continue;
    deduped.set(trimmedPath, { path: trimmedPath, pinned: Boolean(project.pinned) });
  }

  return orderProjects([...deduped.values()]).slice(0, MAX_RECENT);
}

function parseStoredProjects(value: unknown): RecentProject[] {
  if (!Array.isArray(value)) return [];

  return normalizeProjects(value.flatMap((entry) => {
    if (typeof entry === "string") {
      return [{ path: entry, pinned: false }];
    }
    if (isRecentProject(entry)) {
      return [{ path: entry.path, pinned: Boolean(entry.pinned) }];
    }
    return [];
  }));
}

function stripProjectPath<T>(map: Record<string, T>, pathToRemove: string): Record<string, T> {
  if (!(pathToRemove in map)) return map;
  const next = { ...map };
  delete next[pathToRemove];
  return next;
}

function renameProjectPath<T>(map: Record<string, T>, oldPath: string, newPath: string): Record<string, T> {
  if (!(oldPath in map)) return map;
  const next = { ...map };
  const value = next[oldPath];
  delete next[oldPath];
  next[newPath] = value;
  return next;
}

function findLastPinnedIndex(projects: RecentProject[]): number {
  for (let index = projects.length - 1; index >= 0; index -= 1) {
    if (projects[index]?.pinned) return index;
  }
  return -1;
}

function loadFromLocalStorage(): { projects: RecentProject[]; terminalApp: string | null } {
  try {
    const recentProjects = parseStoredProjects(
      JSON.parse(localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY) ?? "null"),
    );
    const fallbackRepos = parseStoredProjects(
      JSON.parse(localStorage.getItem(LEGACY_RECENT_REPOS_STORAGE_KEY) ?? "[]"),
    );
    const terminalApp = localStorage.getItem(TERMINAL_APP_STORAGE_KEY);
    return {
      projects: recentProjects.length > 0 ? recentProjects : fallbackRepos,
      terminalApp,
    };
  } catch {
    return { projects: [], terminalApp: null };
  }
}

function saveSettings(projects: RecentProject[], terminalApp: string | null) {
  const normalizedProjects = normalizeProjects(projects);
  const recentRepos = normalizedProjects.map((project) => project.path);

  // Save to both localStorage (fast sync read) and file (survives restarts)
  localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(normalizedProjects));
  localStorage.setItem(LEGACY_RECENT_REPOS_STORAGE_KEY, JSON.stringify(recentRepos));
  if (terminalApp) localStorage.setItem(TERMINAL_APP_STORAGE_KEY, terminalApp);
  else localStorage.removeItem(TERMINAL_APP_STORAGE_KEY);

  persistToFile({ recentProjects: normalizedProjects, recentRepos, terminalApp });
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface AppStore {
  repoCwd: string | null;
  recentProjects: RecentProject[];
  terminalApp: string | null;
  gitBusyMap: Record<string, boolean>;
  gitResultMap: Record<string, "success" | "error" | null>;
  setRepoCwd: (cwd: string | null) => void;
  removeRecentRepo: (cwd: string) => void;
  reorderRepos: (activePath: string, overPath: string) => void;
  renameRecentRepo: (oldPath: string, newPath: string) => void;
  togglePinnedRepo: (cwd: string) => void;
  setTerminalApp: (app: string | null) => void;
  setGitBusy: (cwd: string, busy: boolean) => void;
  flashGitResult: (cwd: string, result: "success" | "error") => void;
}

// Sync load from localStorage for initial render
const initial = loadFromLocalStorage();

export const useAppStore = create<AppStore>((set, get) => ({
  repoCwd: initial.projects[0]?.path ?? null,
  recentProjects: initial.projects,
  terminalApp: initial.terminalApp,
  gitBusyMap: {},
  gitResultMap: {},

  setRepoCwd: (cwd) => {
    set({ repoCwd: cwd });
    if (cwd) {
      const existing = get().recentProjects;
      if (!existing.some((project) => project.path === cwd)) {
        const recent = normalizeProjects([...existing, { path: cwd, pinned: false }]);
        set({ recentProjects: recent });
        saveSettings(recent, get().terminalApp);
      }
    }
  },

  removeRecentRepo: (cwd) => {
    const recent = get().recentProjects.filter((project) => project.path !== cwd);
    const nextRepoCwd = get().repoCwd === cwd ? recent[0]?.path ?? null : get().repoCwd;
    set((state) => ({
      repoCwd: nextRepoCwd,
      recentProjects: recent,
      gitBusyMap: stripProjectPath(state.gitBusyMap, cwd),
      gitResultMap: stripProjectPath(state.gitResultMap, cwd),
    }));
    saveSettings(recent, get().terminalApp);
  },

  setTerminalApp: (app) => {
    set({ terminalApp: app });
    saveSettings(get().recentProjects, app);
  },

  reorderRepos: (activePath, overPath) => {
    const projects = [...get().recentProjects];
    const oldIndex = projects.findIndex((project) => project.path === activePath);
    const newIndex = projects.findIndex((project) => project.path === overPath);
    if (oldIndex === -1 || newIndex === -1) return;

    const activeProject = projects[oldIndex];
    const overProject = projects[newIndex];
    if (!activeProject || !overProject || activeProject.pinned !== overProject.pinned) return;

    const [moved] = projects.splice(oldIndex, 1);
    projects.splice(newIndex, 0, moved);
    const normalizedProjects = normalizeProjects(projects);
    set({ recentProjects: normalizedProjects });
    saveSettings(normalizedProjects, get().terminalApp);
  },

  renameRecentRepo: (oldPath, newPath) => {
    const normalizedPath = newPath.trim();
    if (!normalizedPath || oldPath === normalizedPath) return;

    const projects = get().recentProjects.map((project) =>
      project.path === oldPath ? { ...project, path: normalizedPath } : project
    );
    const normalizedProjects = normalizeProjects(projects);
    set((state) => ({
      repoCwd: state.repoCwd === oldPath ? normalizedPath : state.repoCwd,
      recentProjects: normalizedProjects,
      gitBusyMap: renameProjectPath(state.gitBusyMap, oldPath, normalizedPath),
      gitResultMap: renameProjectPath(state.gitResultMap, oldPath, normalizedPath),
    }));
    saveSettings(normalizedProjects, get().terminalApp);
  },

  togglePinnedRepo: (cwd) => {
    const projects = [...get().recentProjects];
    const currentIndex = projects.findIndex((project) => project.path === cwd);
    if (currentIndex === -1) return;

    const [project] = projects.splice(currentIndex, 1);
    const updatedProject = { ...project, pinned: !project.pinned };

    if (updatedProject.pinned) {
      const lastPinnedIndex = findLastPinnedIndex(projects);
      projects.splice(lastPinnedIndex + 1, 0, updatedProject);
    } else {
      const lastPinnedIndex = findLastPinnedIndex(projects);
      projects.splice(lastPinnedIndex + 1, 0, updatedProject);
    }

    const normalizedProjects = normalizeProjects(projects);
    set({ recentProjects: normalizedProjects });
    saveSettings(normalizedProjects, get().terminalApp);
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
  const state = useAppStore.getState();
  const fileProjects = parseStoredProjects(file.recentProjects);
  const fallbackFileRepos = parseStoredProjects(file.recentRepos);
  const recentProjects = fileProjects.length > 0 ? fileProjects : fallbackFileRepos;
  const fileTermApp = (file.terminalApp as string | null) ?? null;

  // If localStorage was empty but file has data, restore from file
  if (state.recentProjects.length === 0 && recentProjects.length > 0) {
    useAppStore.setState({
      recentProjects,
      repoCwd: recentProjects[0]?.path ?? null,
      terminalApp: fileTermApp,
    });
    // Sync back to localStorage
    localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(recentProjects));
    localStorage.setItem(
      LEGACY_RECENT_REPOS_STORAGE_KEY,
      JSON.stringify(recentProjects.map((project) => project.path)),
    );
    if (fileTermApp) localStorage.setItem(TERMINAL_APP_STORAGE_KEY, fileTermApp);
  }
});
