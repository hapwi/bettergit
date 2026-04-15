import { create } from "zustand";
const RECENT_PROJECTS_STORAGE_KEY = "bettergit:recent-projects";
const LEGACY_RECENT_REPOS_STORAGE_KEY = "bettergit:recent-repos";
const TERMINAL_APP_STORAGE_KEY = "bettergit:terminal-app";
const TERMINAL_PROJECTS_STORAGE_KEY = "bettergit:terminal-projects";
const DISMISSED_CARDS_STORAGE_KEY = "bettergit:dismissed-setup-cards";
const GITHUB_FOLDER_STORAGE_KEY = "bettergit:github-folder";

export interface RecentProject {
  path: string;
  pinned: boolean;
}

export interface TerminalProjectState {
  tabIds: string[];
  activeTabId: string | null;
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

  return orderProjects([...deduped.values()]);
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

function createTerminalTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultTerminalProjectState(): TerminalProjectState {
  const tabId = createTerminalTabId();
  return {
    tabIds: [tabId],
    activeTabId: tabId,
  };
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

function parseDismissedCards(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object") return {};
  const result: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(value)) {
    if (Array.isArray(val)) {
      result[key] = val.filter((v): v is string => typeof v === "string");
    }
  }
  return result;
}

function loadFromLocalStorage(): {
  projects: RecentProject[];
  terminalApp: string | null;
  terminalProjects: Record<string, TerminalProjectState>;
  dismissedSetupCards: Record<string, string[]>;
  githubFolder: string | null;
} {
  try {
    const recentProjects = parseStoredProjects(
      JSON.parse(localStorage.getItem(RECENT_PROJECTS_STORAGE_KEY) ?? "null"),
    );
    const fallbackRepos = parseStoredProjects(
      JSON.parse(localStorage.getItem(LEGACY_RECENT_REPOS_STORAGE_KEY) ?? "[]"),
    );
    const terminalApp = localStorage.getItem(TERMINAL_APP_STORAGE_KEY);
    const githubFolder = localStorage.getItem(GITHUB_FOLDER_STORAGE_KEY);
    const dismissedSetupCards = parseDismissedCards(
      JSON.parse(localStorage.getItem(DISMISSED_CARDS_STORAGE_KEY) ?? "{}"),
    );
    return {
      projects: recentProjects.length > 0 ? recentProjects : fallbackRepos,
      terminalApp,
      terminalProjects: {},
      dismissedSetupCards,
      githubFolder,
    };
  } catch {
    return { projects: [], terminalApp: null, terminalProjects: {}, dismissedSetupCards: {}, githubFolder: null };
  }
}

function saveSettings(
  projects: RecentProject[],
  terminalApp: string | null,
  _terminalProjects: Record<string, TerminalProjectState>,
  dismissedSetupCards?: Record<string, string[]>,
  githubFolder?: string | null,
) {
  const normalizedProjects = normalizeProjects(projects);
  const recentRepos = normalizedProjects.map((project) => project.path);

  // Save to both localStorage (fast sync read) and file (survives restarts)
  localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(normalizedProjects));
  localStorage.setItem(LEGACY_RECENT_REPOS_STORAGE_KEY, JSON.stringify(recentRepos));
  localStorage.removeItem(TERMINAL_PROJECTS_STORAGE_KEY);
  if (terminalApp) localStorage.setItem(TERMINAL_APP_STORAGE_KEY, terminalApp);
  else localStorage.removeItem(TERMINAL_APP_STORAGE_KEY);
  if (dismissedSetupCards !== undefined) {
    localStorage.setItem(DISMISSED_CARDS_STORAGE_KEY, JSON.stringify(dismissedSetupCards));
  }
  if (githubFolder !== undefined) {
    if (githubFolder) localStorage.setItem(GITHUB_FOLDER_STORAGE_KEY, githubFolder);
    else localStorage.removeItem(GITHUB_FOLDER_STORAGE_KEY);
  }

  persistToFile({ recentProjects: normalizedProjects, recentRepos, terminalApp, dismissedSetupCards, githubFolder });
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface AppStore {
  repoCwd: string | null;
  recentProjects: RecentProject[];
  terminalApp: string | null;
  terminalProjects: Record<string, TerminalProjectState>;
  gitBusyMap: Record<string, boolean>;
  gitResultMap: Record<string, "success" | "error" | null>;
  setRepoCwd: (cwd: string | null) => void;
  removeRecentRepo: (cwd: string) => void;
  reorderRepos: (activePath: string, overPath: string) => void;
  renameRecentRepo: (oldPath: string, newPath: string) => void;
  togglePinnedRepo: (cwd: string) => void;
  setTerminalApp: (app: string | null) => void;
  ensureTerminalProject: (cwd: string) => void;
  addTerminalTab: (cwd: string) => string;
  closeTerminalTab: (cwd: string, tabId: string) => void;
  setActiveTerminalTab: (cwd: string, tabId: string) => void;
  removeTerminalProject: (cwd: string) => void;
  dismissedSetupCards: Record<string, string[]>;
  dismissSetupCard: (cwd: string, cardId: string) => void;
  restoreSetupCard: (cwd: string, cardId: string) => void;
  isSetupCardDismissed: (cwd: string, cardId: string) => boolean;
  githubFolder: string | null;
  setGithubFolder: (folder: string | null) => void;
  setGitBusy: (cwd: string, busy: boolean) => void;
  flashGitResult: (cwd: string, result: "success" | "error") => void;
}

// Sync load from localStorage for initial render
const initial = loadFromLocalStorage();
localStorage.removeItem(TERMINAL_PROJECTS_STORAGE_KEY);

export const useAppStore = create<AppStore>((set, get) => ({
  repoCwd: initial.projects[0]?.path ?? null,
  recentProjects: initial.projects,
  terminalApp: initial.terminalApp,
  terminalProjects: initial.terminalProjects,
  gitBusyMap: {},
  gitResultMap: {},
  dismissedSetupCards: initial.dismissedSetupCards,
  githubFolder: initial.githubFolder,

  setRepoCwd: (cwd) => {
    if (!cwd) {
      set({ repoCwd: null });
      return;
    }

    set({ repoCwd: cwd });

    const existingProjects = get().recentProjects;
    if (!existingProjects.some((project) => project.path === cwd)) {
      const recentProjects = normalizeProjects([
        ...existingProjects,
        { path: cwd, pinned: false },
      ]);
      set({ recentProjects });
      saveSettings(recentProjects, get().terminalApp, get().terminalProjects);
    }
  },

  removeRecentRepo: (cwd) => {
    const recent = get().recentProjects.filter((project) => project.path !== cwd);
    const nextRepoCwd = get().repoCwd === cwd ? recent[0]?.path ?? null : get().repoCwd;
    set((state) => ({
      repoCwd: nextRepoCwd,
      recentProjects: recent,
      terminalProjects: stripProjectPath(state.terminalProjects, cwd),
      gitBusyMap: stripProjectPath(state.gitBusyMap, cwd),
      gitResultMap: stripProjectPath(state.gitResultMap, cwd),
    }));
    void window.electronAPI?.terminal.closeProject({ projectPath: cwd, deleteHistory: true });
    saveSettings(recent, get().terminalApp, stripProjectPath(get().terminalProjects, cwd));
  },

  setTerminalApp: (app) => {
    set({ terminalApp: app });
    saveSettings(get().recentProjects, app, get().terminalProjects);
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
    saveSettings(normalizedProjects, get().terminalApp, get().terminalProjects);
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
      terminalProjects: renameProjectPath(state.terminalProjects, oldPath, normalizedPath),
      gitBusyMap: renameProjectPath(state.gitBusyMap, oldPath, normalizedPath),
      gitResultMap: renameProjectPath(state.gitResultMap, oldPath, normalizedPath),
    }));
    void window.electronAPI?.terminal.renameProject({ oldPath, newPath: normalizedPath });
    saveSettings(
      normalizedProjects,
      get().terminalApp,
      renameProjectPath(get().terminalProjects, oldPath, normalizedPath),
    );
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
    saveSettings(normalizedProjects, get().terminalApp, get().terminalProjects);
  },

  ensureTerminalProject: (cwd) => {
    const existing = get().terminalProjects[cwd];
    if (existing) {
      if (get().repoCwd !== cwd) {
        set({ repoCwd: cwd });
      }
      return;
    }

    const nextTerminalProjects = {
      ...get().terminalProjects,
      [cwd]: createDefaultTerminalProjectState(),
    };
    set({ terminalProjects: nextTerminalProjects, repoCwd: cwd });
    saveSettings(get().recentProjects, get().terminalApp, nextTerminalProjects);
  },

  addTerminalTab: (cwd) => {
    const nextTabId = createTerminalTabId();
    const existing = get().terminalProjects[cwd] ?? createDefaultTerminalProjectState();
    const nextTerminalProjects = {
      ...get().terminalProjects,
      [cwd]: {
        tabIds: [...existing.tabIds, nextTabId],
        activeTabId: nextTabId,
      },
    };
    set({ terminalProjects: nextTerminalProjects, repoCwd: cwd });
    saveSettings(get().recentProjects, get().terminalApp, nextTerminalProjects);
    return nextTabId;
  },

  closeTerminalTab: (cwd, tabId) => {
    const existing = get().terminalProjects[cwd];
    if (!existing || !existing.tabIds.includes(tabId)) return;

    const nextTabIds = existing.tabIds.filter((id) => id !== tabId);
    const nextTerminalProjects = { ...get().terminalProjects };
    if (nextTabIds.length === 0) {
      delete nextTerminalProjects[cwd];
    } else {
      nextTerminalProjects[cwd] = {
        tabIds: nextTabIds,
        activeTabId:
          existing.activeTabId === tabId
            ? (nextTabIds[nextTabIds.length - 1] ?? null)
            : existing.activeTabId,
      };
    }

    set({ terminalProjects: nextTerminalProjects });
    void window.electronAPI?.terminal.closeSession({ projectPath: cwd, tabId, deleteHistory: true });
    saveSettings(get().recentProjects, get().terminalApp, nextTerminalProjects);
  },

  setActiveTerminalTab: (cwd, tabId) => {
    const existing = get().terminalProjects[cwd];
    if (!existing || !existing.tabIds.includes(tabId) || existing.activeTabId === tabId) return;
    const nextTerminalProjects = {
      ...get().terminalProjects,
      [cwd]: {
        ...existing,
        activeTabId: tabId,
      },
    };
    set({ terminalProjects: nextTerminalProjects });
    saveSettings(get().recentProjects, get().terminalApp, nextTerminalProjects);
  },

  removeTerminalProject: (cwd) => {
    const existing = get().terminalProjects[cwd];
    if (!existing) return;
    const nextTerminalProjects = stripProjectPath(get().terminalProjects, cwd);
    set({ terminalProjects: nextTerminalProjects });
    void window.electronAPI?.terminal.closeProject({ projectPath: cwd, deleteHistory: true });
    saveSettings(get().recentProjects, get().terminalApp, nextTerminalProjects);
  },

  dismissSetupCard: (cwd, cardId) => {
    const current = get().dismissedSetupCards;
    const cards = current[cwd] ?? [];
    if (cards.includes(cardId)) return;
    const next = { ...current, [cwd]: [...cards, cardId] };
    set({ dismissedSetupCards: next });
    saveSettings(get().recentProjects, get().terminalApp, get().terminalProjects, next);
  },

  restoreSetupCard: (cwd, cardId) => {
    const current = get().dismissedSetupCards;
    const cards = current[cwd];
    if (!cards || !cards.includes(cardId)) return;
    const filtered = cards.filter((id) => id !== cardId);
    const next = { ...current, [cwd]: filtered };
    if (filtered.length === 0) delete next[cwd];
    set({ dismissedSetupCards: next });
    saveSettings(get().recentProjects, get().terminalApp, get().terminalProjects, next);
  },

  isSetupCardDismissed: (cwd, cardId) => {
    return (get().dismissedSetupCards[cwd] ?? []).includes(cardId);
  },

  setGithubFolder: (folder) => {
    set({ githubFolder: folder });
    saveSettings(get().recentProjects, get().terminalApp, get().terminalProjects, undefined, folder);
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

  const fileGithubFolder = (file.githubFolder as string | null) ?? null;

  // If localStorage was empty but file has data, restore from file
  if (state.recentProjects.length === 0 && recentProjects.length > 0) {
    useAppStore.setState({
      recentProjects,
      repoCwd: recentProjects[0]?.path ?? null,
      terminalApp: fileTermApp,
      terminalProjects: {},
      githubFolder: fileGithubFolder,
    });
    // Sync back to localStorage
    localStorage.setItem(RECENT_PROJECTS_STORAGE_KEY, JSON.stringify(recentProjects));
    localStorage.setItem(
      LEGACY_RECENT_REPOS_STORAGE_KEY,
      JSON.stringify(recentProjects.map((project) => project.path)),
    );
    if (fileTermApp) localStorage.setItem(TERMINAL_APP_STORAGE_KEY, fileTermApp);
    if (fileGithubFolder) localStorage.setItem(GITHUB_FOLDER_STORAGE_KEY, fileGithubFolder);
    return;
  }

  if (!state.githubFolder && fileGithubFolder) {
    useAppStore.setState({ githubFolder: fileGithubFolder });
    localStorage.setItem(GITHUB_FOLDER_STORAGE_KEY, fileGithubFolder);
  }
});
