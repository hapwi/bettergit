import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../git-exec", () => ({
  execGit: vi.fn(),
}));

import { getStatus } from "../git-status";
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

describe("getStatus", () => {
  it("returns isRepo: false when git status fails", async () => {
    mockExecGit.mockResolvedValue(fail("not a git repository"));
    const result = await getStatus({ cwd: "/tmp" });
    expect(result.isRepo).toBe(false);
    expect(result.branch).toBeNull();
    expect(result.hasWorkingTreeChanges).toBe(false);
  });

  it("parses clean repo correctly", async () => {
    mockExecGit.mockImplementation(async (input) => {
      const args = input.args.join(" ");
      if (args.includes("status --porcelain")) {
        return ok("# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n");
      }
      if (args.includes("rev-parse --verify HEAD")) return ok("abc123\n");
      if (args === "remote") return ok("origin\n");
      return ok("");
    });

    const result = await getStatus({ cwd: "/repo" });
    expect(result.isRepo).toBe(true);
    expect(result.branch).toBe("main");
    expect(result.hasWorkingTreeChanges).toBe(false);
    expect(result.hasCommits).toBe(true);
    expect(result.hasOriginRemote).toBe(true);
    expect(result.hasUpstream).toBe(true);
    expect(result.aheadCount).toBe(0);
    expect(result.behindCount).toBe(0);
    expect(result.workingTree.files).toHaveLength(0);
  });

  it("detects detached HEAD", async () => {
    mockExecGit.mockImplementation(async (input) => {
      const args = input.args.join(" ");
      if (args.includes("status --porcelain")) {
        return ok("# branch.head (detached)\n");
      }
      if (args.includes("rev-parse --verify HEAD")) return ok("abc123\n");
      if (args === "remote") return ok("");
      return ok("");
    });

    const result = await getStatus({ cwd: "/repo" });
    expect(result.isDetached).toBe(true);
    expect(result.branch).toBeNull();
  });

  it("parses ahead/behind counts", async () => {
    mockExecGit.mockImplementation(async (input) => {
      const args = input.args.join(" ");
      if (args.includes("status --porcelain")) {
        return ok("# branch.head feature\n# branch.upstream origin/feature\n# branch.ab +3 -1\n");
      }
      if (args.includes("rev-parse --verify HEAD")) return ok("abc\n");
      if (args === "remote") return ok("origin\n");
      return ok("");
    });

    const result = await getStatus({ cwd: "/repo" });
    expect(result.aheadCount).toBe(3);
    expect(result.behindCount).toBe(1);
  });

  it("parses modified file", async () => {
    mockExecGit.mockImplementation(async (input) => {
      const args = input.args.join(" ");
      if (args.includes("status --porcelain")) {
        return ok("# branch.head main\n1 .M N... 100644 100644 100644 abc def src/app.ts\n");
      }
      if (args.includes("rev-parse --verify HEAD")) return ok("abc\n");
      if (args === "remote") return ok("origin\n");
      if (args.includes("diff --numstat HEAD")) return ok("10\t2\tsrc/app.ts\n");
      if (args.includes("diff --numstat --no-index")) return ok("");
      return ok("");
    });

    const result = await getStatus({ cwd: "/repo" });
    expect(result.hasWorkingTreeChanges).toBe(true);
    expect(result.workingTree.files).toHaveLength(1);
    expect(result.workingTree.files[0].path).toBe("src/app.ts");
    expect(result.workingTree.files[0].displayStatus).toBe("M");
    expect(result.workingTree.files[0].insertions).toBe(10);
    expect(result.workingTree.files[0].deletions).toBe(2);
  });

  it("parses untracked file", async () => {
    mockExecGit.mockImplementation(async (input) => {
      const args = input.args.join(" ");
      if (args.includes("status --porcelain")) {
        return ok("# branch.head main\n? newfile.ts\n");
      }
      if (args.includes("rev-parse --verify HEAD")) return ok("abc\n");
      if (args === "remote") return ok("");
      if (args.includes("diff --numstat HEAD")) return ok("");
      if (args.includes("diff --numstat --no-index")) return ok("15\t0\tnewfile.ts\n");
      return ok("");
    });

    const result = await getStatus({ cwd: "/repo" });
    expect(result.workingTree.files).toHaveLength(1);
    expect(result.workingTree.files[0].displayStatus).toBe("U");
    expect(result.workingTree.files[0].insertions).toBe(15);
  });

  it("parses renamed file (type 2 line)", async () => {
    mockExecGit.mockImplementation(async (input) => {
      const args = input.args.join(" ");
      if (args.includes("status --porcelain")) {
        return ok("# branch.head main\n2 R. N... 100644 100644 100644 abc def R100\tnew.ts\told.ts\n");
      }
      if (args.includes("rev-parse --verify HEAD")) return ok("abc\n");
      if (args === "remote") return ok("");
      if (args.includes("diff --numstat HEAD")) return ok("0\t0\tnew.ts\n");
      return ok("");
    });

    const result = await getStatus({ cwd: "/repo" });
    expect(result.workingTree.files).toHaveLength(1);
    expect(result.workingTree.files[0].displayStatus).toBe("R");
    expect(result.workingTree.files[0].originalPath).toBe("old.ts");
  });

  it("detects no commits (empty repo)", async () => {
    mockExecGit.mockImplementation(async (input) => {
      const args = input.args.join(" ");
      if (args.includes("status --porcelain")) return ok("# branch.head main\n");
      if (args.includes("rev-parse --verify HEAD")) return fail("unknown revision");
      if (args === "remote") return ok("");
      return ok("");
    });

    const result = await getStatus({ cwd: "/repo" });
    expect(result.hasCommits).toBe(false);
    expect(result.hasOriginRemote).toBe(false);
  });

  it("sums insertions and deletions across files", async () => {
    mockExecGit.mockImplementation(async (input) => {
      const args = input.args.join(" ");
      if (args.includes("status --porcelain")) {
        return ok("# branch.head main\n1 .M N... 100644 100644 100644 a b file1.ts\n1 .M N... 100644 100644 100644 c d file2.ts\n");
      }
      if (args.includes("rev-parse --verify HEAD")) return ok("abc\n");
      if (args === "remote") return ok("");
      if (args.includes("diff --numstat HEAD")) return ok("5\t3\tfile1.ts\n10\t1\tfile2.ts\n");
      return ok("");
    });

    const result = await getStatus({ cwd: "/repo" });
    expect(result.workingTree.insertions).toBe(15);
    expect(result.workingTree.deletions).toBe(4);
    expect(result.workingTree.files).toHaveLength(2);
  });
});
