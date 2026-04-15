import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub globals before store module loads — vi.hoisted runs before imports
const { mockStorage } = vi.hoisted(() => {
  const store: Record<string, string> = {};
  const mockStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const key of Object.keys(store)) delete store[key]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  };
  // @ts-ignore stubbing global
  globalThis.localStorage = mockStorage;
  // @ts-ignore stubbing global
  globalThis.document = { visibilityState: "visible" };
  // @ts-ignore stubbing global
  globalThis.window = {
    localStorage: mockStorage,
    electronAPI: undefined,
    addEventListener: () => {},
    removeEventListener: () => {},
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  return { mockStorage };
});

import { useAppStore } from "../store";

beforeEach(() => {
  mockStorage.clear();
  vi.clearAllMocks();
  useAppStore.setState({
    repoCwd: null,
    recentProjects: [],
    terminalApp: null,
    terminalProjects: {},
    gitBusyMap: {},
    gitResultMap: {},
    dismissedSetupCards: {},
    githubFolder: null,
  });
});

describe("setRepoCwd", () => {
  it("adds project to recentProjects when new", () => {
    useAppStore.getState().setRepoCwd("/repo/a");
    const state = useAppStore.getState();
    expect(state.repoCwd).toBe("/repo/a");
    expect(state.recentProjects).toEqual([{ path: "/repo/a", pinned: false }]);
  });

  it("does not duplicate existing project", () => {
    useAppStore.getState().setRepoCwd("/repo/a");
    useAppStore.getState().setRepoCwd("/repo/a");
    expect(useAppStore.getState().recentProjects).toHaveLength(1);
  });

  it("adds multiple projects", () => {
    useAppStore.getState().setRepoCwd("/repo/a");
    useAppStore.getState().setRepoCwd("/repo/b");
    expect(useAppStore.getState().recentProjects).toHaveLength(2);
  });
});

describe("removeRecentRepo", () => {
  it("removes project and switches to next available", () => {
    useAppStore.getState().setRepoCwd("/repo/a");
    useAppStore.getState().setRepoCwd("/repo/b");
    useAppStore.getState().removeRecentRepo("/repo/b");
    const state = useAppStore.getState();
    expect(state.recentProjects).toHaveLength(1);
    expect(state.repoCwd).toBe("/repo/a");
  });

  it("sets repoCwd to null when last project removed", () => {
    useAppStore.getState().setRepoCwd("/repo/a");
    useAppStore.getState().removeRecentRepo("/repo/a");
    expect(useAppStore.getState().repoCwd).toBeNull();
  });
});

describe("togglePinnedRepo", () => {
  it("pins an unpinned project", () => {
    useAppStore.getState().setRepoCwd("/repo/a");
    useAppStore.getState().togglePinnedRepo("/repo/a");
    const project = useAppStore.getState().recentProjects.find((p) => p.path === "/repo/a");
    expect(project?.pinned).toBe(true);
  });

  it("unpins a pinned project", () => {
    useAppStore.getState().setRepoCwd("/repo/a");
    useAppStore.getState().togglePinnedRepo("/repo/a");
    useAppStore.getState().togglePinnedRepo("/repo/a");
    const project = useAppStore.getState().recentProjects.find((p) => p.path === "/repo/a");
    expect(project?.pinned).toBe(false);
  });

  it("moves pinned repos to front", () => {
    useAppStore.getState().setRepoCwd("/repo/a");
    useAppStore.getState().setRepoCwd("/repo/b");
    useAppStore.getState().setRepoCwd("/repo/c");
    useAppStore.getState().togglePinnedRepo("/repo/c");
    const projects = useAppStore.getState().recentProjects;
    expect(projects[0].path).toBe("/repo/c");
    expect(projects[0].pinned).toBe(true);
  });
});

describe("renameRecentRepo", () => {
  it("updates path in recentProjects", () => {
    useAppStore.getState().setRepoCwd("/old/path");
    useAppStore.getState().renameRecentRepo("/old/path", "/new/path");
    const state = useAppStore.getState();
    expect(state.recentProjects[0].path).toBe("/new/path");
  });

  it("updates repoCwd when it matches old path", () => {
    useAppStore.getState().setRepoCwd("/old/path");
    useAppStore.getState().renameRecentRepo("/old/path", "/new/path");
    expect(useAppStore.getState().repoCwd).toBe("/new/path");
  });

  it("updates terminalProjects key", () => {
    useAppStore.getState().setRepoCwd("/old/path");
    useAppStore.getState().ensureTerminalProject("/old/path");
    useAppStore.getState().renameRecentRepo("/old/path", "/new/path");
    const state = useAppStore.getState();
    expect(state.terminalProjects["/new/path"]).toBeDefined();
    expect(state.terminalProjects["/old/path"]).toBeUndefined();
  });
});

describe("dismissSetupCard / restoreSetupCard", () => {
  it("dismisses and restores a setup card", () => {
    useAppStore.getState().setRepoCwd("/repo");
    useAppStore.getState().dismissSetupCard("/repo", "welcome");
    expect(useAppStore.getState().isSetupCardDismissed("/repo", "welcome")).toBe(true);
    useAppStore.getState().restoreSetupCard("/repo", "welcome");
    expect(useAppStore.getState().isSetupCardDismissed("/repo", "welcome")).toBe(false);
  });
});

describe("gitBusy / flashGitResult", () => {
  it("tracks busy state per cwd", () => {
    useAppStore.getState().setGitBusy("/repo", true);
    expect(useAppStore.getState().gitBusyMap["/repo"]).toBe(true);
    useAppStore.getState().setGitBusy("/repo", false);
    expect(useAppStore.getState().gitBusyMap["/repo"]).toBe(false);
  });

  it("tracks result per cwd", () => {
    useAppStore.getState().flashGitResult("/repo", "success");
    expect(useAppStore.getState().gitResultMap["/repo"]).toBe("success");
  });
});
