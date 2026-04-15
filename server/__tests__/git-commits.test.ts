import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../git-exec", () => ({
  execGit: vi.fn(),
  requireOk: vi.fn((result: { code: number; stdout: string; stderr: string }, label: string) => {
    if (result.code !== 0) throw new Error(`${label} failed: ${result.stderr}`);
    return result.stdout;
  }),
}));

import { getLog } from "../git-commits";
import { execGit } from "../git-exec";

const mockExecGit = vi.mocked(execGit);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getLog", () => {
  it("parses commit log entries", async () => {
    mockExecGit.mockResolvedValue({
      code: 0,
      stdout: [
        "abc123|abc1|Fix authentication bug|Updated token refresh|Alice|2024-01-15 10:30:00 +0000|2 hours ago",
        "def456|def4|Add dashboard chart|Added recharts integration|Bob|2024-01-14 09:00:00 +0000|1 day ago",
      ].join("\n"),
      stderr: "",
    });

    const entries = await getLog({ cwd: "/repo", count: 10 });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      sha: "abc123",
      shortSha: "abc1",
      subject: "Fix authentication bug",
      body: "Updated token refresh",
      author: "Alice",
      date: "2024-01-15 10:30:00 +0000",
      relativeDate: "2 hours ago",
    });
  });

  it("returns empty array on failure", async () => {
    mockExecGit.mockResolvedValue({ code: 1, stdout: "", stderr: "fatal" });
    await expect(getLog({ cwd: "/repo" })).rejects.toThrow("git log failed");
  });

  it("uses default count of 50", async () => {
    mockExecGit.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await getLog({ cwd: "/repo" });
    expect(mockExecGit).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(["--max-count=50"]),
      }),
    );
  });

  it("passes branch filter when provided", async () => {
    mockExecGit.mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    await getLog({ cwd: "/repo", branch: "feature/test" });
    expect(mockExecGit).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(["feature/test"]),
      }),
    );
  });
});
