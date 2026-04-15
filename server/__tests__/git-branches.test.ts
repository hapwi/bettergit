import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../git-exec", () => ({
  execGit: vi.fn(),
  requireOk: vi.fn((result: { code: number; stdout: string; stderr: string }, label: string) => {
    if (result.code !== 0) throw new Error(`${label} failed: ${result.stderr}`);
    return result.stdout;
  }),
}));

import { listBranches, getDefaultBranch, getCurrentBranch } from "../git-branches";
import { execGit } from "../git-exec";

const mockExecGit = vi.mocked(execGit);

function ok(stdout: string) {
  return { code: 0, stdout, stderr: "" };
}

function fail(stderr = "") {
  return { code: 1, stdout: "", stderr };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listBranches", () => {
  it("lists local branches with current marker", async () => {
    mockExecGit.mockImplementation(async (input) => {
      const args = input.args.join(" ");
      if (args.includes("branch --format")) return ok("*|main|\n |feature/foo|origin/feature/foo\n");
      if (args.includes("branch -r")) return ok("");
      if (args.includes("symbolic-ref")) return ok("origin/main\n");
      return ok("");
    });

    const branches = await listBranches({ cwd: "/repo" });
    expect(branches).toHaveLength(2);
    expect(branches[0]).toMatchObject({ name: "main", current: true, isDefault: true });
    expect(branches[1]).toMatchObject({ name: "feature/foo", current: false, upstream: "origin/feature/foo" });
  });

  it("includes remote-only branches", async () => {
    mockExecGit.mockImplementation(async (input) => {
      const args = input.args.join(" ");
      if (args.includes("branch --format")) return ok("*|main|\n");
      if (args.includes("branch -r")) return ok("origin/main\norigin/feature/remote-only\n");
      if (args.includes("symbolic-ref")) return ok("origin/main\n");
      return ok("");
    });

    const branches = await listBranches({ cwd: "/repo" });
    const remoteOnly = branches.find((b) => b.name === "origin/feature/remote-only");
    expect(remoteOnly).toBeDefined();
    expect(remoteOnly!.isRemote).toBe(true);
  });
});

describe("getDefaultBranch", () => {
  it("returns from symbolic-ref when available", async () => {
    mockExecGit.mockResolvedValue(ok("origin/main\n"));
    const branch = await getDefaultBranch({ cwd: "/repo" });
    expect(branch).toBe("main");
  });

  it("falls back to checking main/master", async () => {
    mockExecGit.mockImplementation(async (input) => {
      const args = input.args.join(" ");
      if (args.includes("symbolic-ref")) return fail();
      if (args.includes("branch --list")) return ok("  main\n");
      return ok("");
    });

    const branch = await getDefaultBranch({ cwd: "/repo" });
    expect(branch).toBe("main");
  });

  it("returns 'main' when no branches exist", async () => {
    mockExecGit.mockResolvedValue(fail());
    const branch = await getDefaultBranch({ cwd: "/repo" });
    expect(branch).toBe("main");
  });
});

describe("getCurrentBranch", () => {
  it("returns branch name", async () => {
    mockExecGit.mockResolvedValue(ok("feature/test\n"));
    const branch = await getCurrentBranch({ cwd: "/repo" });
    expect(branch).toBe("feature/test");
  });

  it("returns null on detached HEAD", async () => {
    mockExecGit.mockResolvedValue(ok("\n"));
    const branch = await getCurrentBranch({ cwd: "/repo" });
    expect(branch).toBeNull();
  });

  it("returns null on error", async () => {
    mockExecGit.mockResolvedValue(fail());
    const branch = await getCurrentBranch({ cwd: "/repo" });
    expect(branch).toBeNull();
  });
});
