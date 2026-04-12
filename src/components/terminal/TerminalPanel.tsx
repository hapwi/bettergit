import { FitAddon } from "@xterm/addon-fit"
import { Terminal as XTermTerminal, type ITheme } from "@xterm/xterm"
import { Plus, X } from "lucide-react"
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react"

import { type TerminalProjectState, useAppStore } from "@/store"
import { cn } from "@/lib/utils"

function normalizeComputedColor(value: string | null | undefined, fallback: string): string {
  const normalizedValue = value?.trim().toLowerCase()
  if (
    !normalizedValue ||
    normalizedValue === "transparent" ||
    normalizedValue === "rgba(0, 0, 0, 0)" ||
    normalizedValue === "rgba(0 0 0 / 0)"
  ) {
    return fallback
  }
  return value ?? fallback
}

function terminalThemeFromApp(mountElement?: HTMLElement | null): ITheme {
  const isDark = document.documentElement.classList.contains("dark")
  const fallbackBackground = isDark ? "rgb(14, 18, 24)" : "rgb(255, 255, 255)"
  const fallbackForeground = isDark ? "rgb(237, 241, 247)" : "rgb(28, 33, 41)"
  const surface =
    mountElement?.closest("[data-terminal-surface]") ??
    mountElement?.closest("[data-terminal-panel-body]") ??
    document.body
  const surfaceStyles = getComputedStyle(surface)
  const bodyStyles = getComputedStyle(document.body)
  const background = normalizeComputedColor(
    surfaceStyles.backgroundColor,
    normalizeComputedColor(bodyStyles.backgroundColor, fallbackBackground),
  )
  const foreground = normalizeComputedColor(
    surfaceStyles.color,
    normalizeComputedColor(bodyStyles.color, fallbackForeground),
  )

  if (isDark) {
    return {
      background,
      foreground,
      cursor: "rgb(180, 203, 255)",
      selectionBackground: "rgba(180, 203, 255, 0.25)",
      black: "rgb(24, 30, 38)",
      red: "rgb(255, 122, 142)",
      green: "rgb(134, 231, 149)",
      yellow: "rgb(244, 205, 114)",
      blue: "rgb(137, 190, 255)",
      magenta: "rgb(208, 176, 255)",
      cyan: "rgb(124, 232, 237)",
      white: "rgb(210, 218, 230)",
      brightBlack: "rgb(110, 120, 136)",
      brightRed: "rgb(255, 168, 180)",
      brightGreen: "rgb(176, 245, 186)",
      brightYellow: "rgb(255, 224, 149)",
      brightBlue: "rgb(174, 210, 255)",
      brightMagenta: "rgb(229, 203, 255)",
      brightCyan: "rgb(167, 244, 247)",
      brightWhite: "rgb(244, 247, 252)",
    }
  }

  return {
    background,
    foreground,
    cursor: "rgb(38, 56, 78)",
    selectionBackground: "rgba(37, 63, 99, 0.2)",
    black: "rgb(44, 53, 66)",
    red: "rgb(191, 70, 87)",
    green: "rgb(60, 126, 86)",
    yellow: "rgb(146, 112, 35)",
    blue: "rgb(72, 102, 163)",
    magenta: "rgb(132, 86, 149)",
    cyan: "rgb(53, 127, 141)",
    white: "rgb(210, 215, 223)",
    brightBlack: "rgb(112, 123, 140)",
    brightRed: "rgb(212, 95, 112)",
    brightGreen: "rgb(85, 148, 111)",
    brightYellow: "rgb(173, 133, 45)",
    brightBlue: "rgb(91, 124, 194)",
    brightMagenta: "rgb(153, 107, 172)",
    brightCyan: "rgb(70, 149, 164)",
    brightWhite: "rgb(236, 240, 246)",
  }
}

function writeSystemMessage(terminal: XTermTerminal, message: string): void {
  terminal.write(`\r\n[terminal] ${message}\r\n`)
}

function writeTerminalSnapshot(terminal: XTermTerminal, history: string): void {
  terminal.write("\u001bc")
  if (history.length > 0) {
    terminal.write(history)
  }
}

interface TerminalViewportProps {
  projectPath: string
  cwd: string
  tabId: string
  isActive: boolean
}

function TerminalViewport({ projectPath, cwd, tabId, isActive }: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<XTermTerminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  const fitAndResize = useCallback(() => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    if (!terminal || !fitAddon) return

    try {
      fitAddon.fit()
    } catch {
      return
    }

    void window.electronAPI?.terminal.resizeSession({
      projectPath,
      tabId,
      cols: terminal.cols,
      rows: terminal.rows,
    }).catch(() => undefined)
  }, [projectPath, tabId])

  useEffect(() => {
    const mount = containerRef.current
    const terminalApi = window.electronAPI?.terminal
    if (!mount || !terminalApi) return

    const fitAddon = new FitAddon()
    const terminal = new XTermTerminal({
      cursorBlink: true,
      lineHeight: 1.2,
      fontSize: 12,
      scrollback: 5_000,
      fontFamily: '"SF Mono", "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
      theme: terminalThemeFromApp(mount),
    })

    terminal.loadAddon(fitAddon)
    terminal.open(mount)
    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    const unsubscribeEvents = terminalApi.onEvent((event) => {
      if (event.projectPath !== projectPath || event.tabId !== tabId) return
      if (event.type === "output" && event.data) {
        terminal.write(event.data)
        return
      }
      if (event.type === "error" && event.message) {
        writeSystemMessage(terminal, event.message)
        return
      }
      if (event.type === "exited") {
        const details = [
          typeof event.exitCode === "number" ? `code ${event.exitCode}` : null,
          typeof event.exitSignal === "number" ? `signal ${event.exitSignal}` : null,
        ]
          .filter((value): value is string => value !== null)
          .join(", ")
        writeSystemMessage(
          terminal,
          details.length > 0 ? `Process exited (${details})` : "Process exited",
        )
      }
    })

    const inputDisposable = terminal.onData((data) => {
      void terminalApi.writeToSession({ projectPath, tabId, data }).catch((error) => {
        writeSystemMessage(
          terminal,
          error instanceof Error ? error.message : "Terminal write failed",
        )
      })
    })

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            fitAndResize()
          })
    resizeObserver?.observe(mount)
    window.addEventListener("resize", fitAndResize)

    const themeObserver = new MutationObserver(() => {
      const activeTerminal = terminalRef.current
      if (!activeTerminal) return
      activeTerminal.options.theme = terminalThemeFromApp(containerRef.current)
      activeTerminal.refresh(0, activeTerminal.rows - 1)
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    })

    const boot = window.setTimeout(() => {
      fitAndResize()
      void terminalApi
        .openSession({
          projectPath,
          tabId,
          cwd,
          cols: terminal.cols,
          rows: terminal.rows,
        })
        .then((snapshot) => {
          writeTerminalSnapshot(terminal, snapshot.history)
          if (isActive) {
            terminal.focus()
          }
        })
        .catch((error) => {
          writeSystemMessage(
            terminal,
            error instanceof Error ? error.message : "Failed to open terminal",
          )
        })
    }, 20)

    return () => {
      window.clearTimeout(boot)
      unsubscribeEvents()
      inputDisposable.dispose()
      resizeObserver?.disconnect()
      window.removeEventListener("resize", fitAndResize)
      themeObserver.disconnect()
      terminalRef.current = null
      fitAddonRef.current = null
      terminal.dispose()
    }
  }, [cwd, fitAndResize, isActive, projectPath, tabId])

  useEffect(() => {
    if (!isActive) return
    const frame = window.requestAnimationFrame(() => {
      fitAndResize()
      terminalRef.current?.focus()
    })
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [fitAndResize, isActive])

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute inset-x-3 bottom-3 top-12 overflow-hidden rounded-[18px]",
        !isActive && "pointer-events-none invisible",
      )}
    />
  )
}

export interface TerminalPanelHandle {
  closePaneOrTab: () => boolean
  splitVertical: () => void
  splitHorizontal: () => void
  addTab: () => void
}

interface TerminalPanelProps {
  cwd: string
  isVisible: boolean
  onAllTabsClosed?: () => void
}

function activeTabIdFromPanel(panelState: TerminalProjectState | null): string | null {
  if (!panelState) return null
  if (panelState.activeTabId && panelState.tabIds.includes(panelState.activeTabId)) {
    return panelState.activeTabId
  }
  return panelState.tabIds[0] ?? null
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel(
  { cwd, isVisible, onAllTabsClosed },
  ref,
) {
  const panelState = useAppStore((s) => s.terminalProjects[cwd] ?? null)
  const addTerminalTab = useAppStore((s) => s.addTerminalTab)
  const closeTerminalTab = useAppStore((s) => s.closeTerminalTab)
  const setActiveTerminalTab = useAppStore((s) => s.setActiveTerminalTab)
  const hadTabsRef = useRef(Boolean(panelState && panelState.tabIds.length > 0))

  const activeTabId = activeTabIdFromPanel(panelState)
  const projectName = cwd.split("/").filter(Boolean).pop() ?? cwd

  useEffect(() => {
    const hasTabs = Boolean(panelState && panelState.tabIds.length > 0)
    if (hasTabs) {
      hadTabsRef.current = true
      return
    }
    if (!hadTabsRef.current) return
    hadTabsRef.current = false
    onAllTabsClosed?.()
  }, [onAllTabsClosed, panelState])

  const closePaneOrTab = useCallback((): boolean => {
    if (!activeTabId) return false
    closeTerminalTab(cwd, activeTabId)
    return true
  }, [activeTabId, closeTerminalTab, cwd])

  const addTab = useCallback(() => {
    addTerminalTab(cwd)
  }, [addTerminalTab, cwd])

  useImperativeHandle(
    ref,
    () => ({
      closePaneOrTab,
      splitVertical: () => undefined,
      splitHorizontal: () => undefined,
      addTab,
    }),
    [addTab, closePaneOrTab],
  )

  if (!panelState || panelState.tabIds.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <button
          type="button"
          onClick={addTab}
          className="flex items-center gap-2 rounded-lg border border-dashed border-border/70 bg-card/60 px-5 py-3 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-muted/60 hover:text-foreground"
        >
          <Plus className="size-4" />
          New Terminal
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/50 shadow-sm">
      <div className="flex min-h-14 shrink-0 items-center gap-3 border-b border-border/60 px-4">
        <div className="min-w-0 shrink-0">
          <p className="truncate text-sm font-semibold text-foreground">{projectName}</p>
          <p className="truncate text-[11px] text-muted-foreground">{cwd}</p>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
          {panelState.tabIds.map((tabId, index) => {
            const isTabActive = activeTabId === tabId
            const label = index === 0 ? "Terminal" : `Terminal ${index + 1}`
            return (
              <div
                key={tabId}
                className={cn(
                  "group flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition-colors",
                  isTabActive
                    ? "border-border bg-background text-foreground"
                    : "border-transparent bg-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <button
                  type="button"
                  onClick={() => setActiveTerminalTab(cwd, tabId)}
                  className="truncate font-medium"
                >
                  {label}
                </button>
                <button
                  type="button"
                  onClick={() => closeTerminalTab(cwd, tabId)}
                  className="rounded p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={`Close ${label}`}
                >
                  <X className="size-3" />
                </button>
              </div>
            )
          })}
        </div>

        <div className="shrink-0">
          <button
            type="button"
            onClick={addTab}
            className="rounded-md border border-border/70 bg-background/80 p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="New terminal tab"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>

      <div
        data-terminal-panel-body
        className="min-h-0 flex-1 overflow-hidden p-3"
      >
        <div
          data-terminal-surface
          className="relative h-full min-h-0 overflow-hidden rounded-xl border border-border/70 bg-[#0b0d10]"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-9 border-b border-white/5 bg-white/[0.02]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-9 items-center px-4 text-[11px] font-medium text-white/45">
            {activeTabId ? `~/ ${projectName}` : "Terminal"}
          </div>
          {panelState.tabIds.map((tabId) => (
            <TerminalViewport
              key={tabId}
              projectPath={cwd}
              cwd={cwd}
              tabId={tabId}
              isActive={isVisible && activeTabId === tabId}
            />
          ))}
        </div>
      </div>
    </div>
  )
})
