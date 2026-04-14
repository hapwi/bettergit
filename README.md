<div align="center">
  <img src="./build/bettergit-logo.png" alt="BetterGit" width="140" />

  <h1>BetterGit</h1>

  <p><strong>A desktop Git workspace for people who want Git to feel fast, visual, and usable.</strong></p>

  <p>BetterGit combines repo awareness, branch and PR workflows, inline Git actions, a built-in terminal, and optional AI assistance in one focused desktop app.</p>

  <p>
    <img src="https://img.shields.io/badge/Electron-desktop-191919?style=for-the-badge&logo=electron&logoColor=white" alt="Electron" />
    <img src="https://img.shields.io/badge/React-19-111827?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React 19" />
    <img src="https://img.shields.io/badge/TypeScript-typed-1f6feb?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/GitHub-PR%20aware-24292f?style=for-the-badge&logo=github&logoColor=white" alt="GitHub PR aware" />
    <img src="https://img.shields.io/badge/AI-optional-7c3aed?style=for-the-badge" alt="AI optional" />
  </p>
</div>

## What is BetterGit?

BetterGit is a desktop app for working with Git repositories without bouncing between a dozen terminal commands, browser tabs, and context switches.

It is built for the day-to-day workflow around shipping code:

- understand repo state quickly
- commit cleanly
- branch safely
- push and open PRs faster
- keep a terminal available when you need raw control
- use AI for commit messages, PR content, and branch names when helpful

This repo contains the full Electron app, the React frontend, and the local server layer that powers Git operations and AI-assisted actions.

## Why use it?

Most Git tools are either too thin, too noisy, or too abstracted from how developers actually work.

BetterGit is opinionated in a more practical direction:

- **One workspace, not three.** Repo overview, Git actions, diffs, PR context, and terminal live together.
- **Fast path for common work.** Commit, push, open PR, switch branches, pull, merge, and cleanup are treated like first-class actions.
- **PR-aware workflow.** Open PR context and release/pre-release flows are part of the app instead of something you reconstruct manually.
- **Safer default-branch behavior.** The app nudges work off `main` when that is the right move.
- **Optional AI, not AI theater.** If you have Claude Code or Codex installed, BetterGit can generate commit messages, PR copy, and branch names. If you do not, the core Git workflow still stands on its own.
- **Still close to real Git.** There is a built-in terminal for when you want raw control, not a sealed-off abstraction.

## What it does today

### Repo overview

- dashboard with commit activity, code-change history, contributor signals, and PR visibility
- recent commits and branch-aware status
- quick visibility into repo health without running a stack of commands

### Git workflow

- status-driven action panel
- commit flows with file selection
- push and PR creation flows
- branch switching, deletion, and merge dialogs
- stacked/release-oriented workflow helpers
- repository setup helpers like main-branch normalization and initial setup actions

### Terminal built in

- project-scoped terminal tabs inside the app
- terminal sessions stay attached to the repo you are working on
- fast escape hatch when you want direct shell control

### GitHub-aware features

- open PR visibility for the current branch
- merged/open PR awareness in the dashboard
- GitHub CLI integration checks in settings

### AI-assisted authoring

- generate commit messages
- generate PR titles and bodies
- generate branch names
- choose Claude or Codex models from app settings

## Who this is for

BetterGit is a good fit if you:

- live in Git every day and want less ceremony around common actions
- want a cleaner branch-to-PR workflow
- like terminal power but do not want terminal-only ergonomics
- want optional AI assistance without turning the whole app into an AI shell
- want a more polished, repo-focused desktop experience than a generic Git GUI

## Quick start

### Requirements

- [Bun](https://bun.sh/)
- Git
- GitHub CLI (`gh`) for GitHub-connected workflows
- Optional: `claude` or `codex` CLI for AI generation inside the app

### Install

```bash
bun install
```

### Run the desktop app in development

```bash
bun run dev:electron
```

### Build

```bash
bun run build
```

### Package

```bash
bun run dist
```

## AI setup

AI features are optional.

BetterGit checks for local CLI availability and can use:

- Claude Code via `claude`
- OpenAI Codex via `codex`

When configured, the app can help with:

- commit message generation
- PR content generation
- branch name generation

If neither CLI is installed, BetterGit still works as a full Git desktop app.

## Tech stack

- Electron
- React 19
- TypeScript
- Vite
- TanStack Query
- shadcn/ui
- xterm.js

## Project status

BetterGit is an active product-style desktop app, not a starter template. The current codebase already includes the core repo workflow, GitHub-aware behavior, terminal integration, and optional AI-assisted writing flows.

## Contributing

If you want to improve the Git workflow, desktop UX, PR flow, or AI authoring experience, open an issue or send a PR.
