import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../git-exec", () => ({
  execGit: vi.fn(),
  requireOk: vi.fn((result: { code: number; stdout: string; stderr: string }, label: string) => {
    if (result.code !== 0) throw new Error(`${label} failed: ${result.stderr}`);
    return result.stdout;
  }),
}));

vi.mock("../git-remote", () => ({
  hasOriginRemote: vi.fn(),
}));

vi.mock("../git-github", () => ({
  setGhDefaultBranch: vi.fn(),
}));

vi.mock("../git-status", () => ({
  getStatus: vi.fn(),
}));

import { renameMasterToMain } from "../git-setup";
import { execGit } from "../git-exec";
import { hasOriginRemote } from "../git-remote";
import { setGhDefaultBranch } from "../git-github";

const mockExecGit = vi.mocked(execGit);
const mockHasOriginRemote = vi.mocked(hasOriginRemote);
const mockSetGhDefaultBranch = vi.mocked(setGhDefaultBranch);

function ok(stdout = "") {
  return { code: 0, stdout, stderr: "" };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetGhDefaultBranch.mockResolvedValue(true);
});

describe("renameMasterToMain", () => {
  it("updates GitHub default branch before deleting remote master", async () => {
    mockHasOriginRemote.mockResolvedValue(true);
    mockExecGit.mockImplementation(async (input) => {
      const args = input.args.join(" ");
      if (args === "branch -m master main") return ok();
      if (args === "push -u origin main") return ok();
      if (args === "remote set-head origin main") return ok();
      if (args === "ls-remote --exit-code --heads origin master") return ok("abc\trefs/heads/master\n");
      if (args === "push origin --delete master") return ok();
      return ok();
    });

    await renameMasterToMain({ cwd: "/repo" });

    const deleteInvocationIndex = mockExecGit.mock.calls.findIndex(
      (call) => call[0].args.join(" ") === "push origin --delete master",
    );

    expect(mockSetGhDefaultBranch).toHaveBeenCalledWith({ cwd: "/repo", branch: "main" });
    expect(deleteInvocationIndex).toBeGreaterThan(-1);
    expect(mockSetGhDefaultBranch.mock.invocationCallOrder[0]).toBeLessThan(
      mockExecGit.mock.invocationCallOrder[deleteInvocationIndex],
    );
  });

  it("skips remote operations when origin is missing", async () => {
    mockHasOriginRemote.mockResolvedValue(false);
    mockExecGit.mockResolvedValue(ok());

    await renameMasterToMain({ cwd: "/repo" });

    expect(mockExecGit).toHaveBeenCalledTimes(1);
    expect(mockExecGit).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/repo",
      args: ["branch", "-m", "master", "main"],
    }));
    expect(mockSetGhDefaultBranch).not.toHaveBeenCalled();
  });

  it("skips deleting remote master when it does not exist", async () => {
    mockHasOriginRemote.mockResolvedValue(true);
    mockExecGit.mockImplementation(async (input) => {
      const args = input.args.join(" ");
      if (args === "ls-remote --exit-code --heads origin master") {
        return { code: 2, stdout: "", stderr: "" };
      }
      return ok();
    });

    await renameMasterToMain({ cwd: "/repo" });

    expect(mockExecGit).not.toHaveBeenCalledWith(expect.objectContaining({
      args: ["push", "origin", "--delete", "master"],
    }));
  });
});
