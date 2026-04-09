import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react"
import { Restty, getBuiltinTheme } from "restty"
import type { GhosttyTheme } from "restty"
import { Plus, X, Columns2, Rows2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { serverFetch } from "@/lib/server"

function themeColorToHex(color: { r: number; g: number; b: number } | undefined): string | null {
  if (!color) return null
  const hex = (n: number) => n.toString(16).padStart(2, "0")
  return `#${hex(color.r)}${hex(color.g)}${hex(color.b)}`
}

// ---------------------------------------------------------------------------
// WebSocket PtyTransport — one per pane (including splits)
// ---------------------------------------------------------------------------

function createWsPtyTransport(serverPort: number, cwd: string) {
  let ws: WebSocket | null = null
  let connected = false
  let sessionId: string | null = null
  let destroyed = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function connectWs(callbacks: {
    onConnect?: () => void
    onDisconnect?: () => void
    onData?: (data: string) => void
    onExit?: (code: number) => void
  }) {
    if (destroyed) return

    ws = new WebSocket(`ws://127.0.0.1:${serverPort}/ws/pty?cwd=${encodeURIComponent(cwd)}`)

    ws.onopen = () => {
      ws!.send(JSON.stringify({ type: "create", cwd }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case "created":
            sessionId = msg.sessionId
            connected = true
            callbacks.onConnect?.()
            break
          case "output":
            callbacks.onData?.(msg.data)
            break
          case "exit":
            connected = false
            callbacks.onExit?.(msg.code ?? 0)
            callbacks.onDisconnect?.()
            break
        }
      } catch { /* ignore */ }
    }

    ws.onclose = () => {
      const wasConnected = connected
      connected = false
      sessionId = null
      ws = null
      callbacks.onDisconnect?.()
      // Reconnect if the socket dropped unexpectedly (was connected and we
      // haven't been intentionally destroyed). Creates a fresh PTY session.
      if (wasConnected && !destroyed) {
        reconnectTimer = setTimeout(() => connectWs(callbacks), 500)
      }
    }
  }

  return {
    async connect(options: { callbacks: Parameters<typeof connectWs>[0] }) {
      connectWs(options.callbacks)
    },

    disconnect() {
      destroyed = true
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      if (ws && sessionId) {
        try { ws.send(JSON.stringify({ type: "destroy", sessionId })) } catch { /* */ }
      }
      ws?.close()
      ws = null
      connected = false
      sessionId = null
    },

    sendInput(data: string) {
      if (!connected || !ws || !sessionId) return false
      ws.send(JSON.stringify({ type: "input", sessionId, data }))
      return true
    },

    resize(cols: number, rows: number) {
      if (!connected || !ws || !sessionId) return false
      ws.send(JSON.stringify({ type: "resize", sessionId, cols, rows }))
      return true
    },

    isConnected: () => connected,
    destroy() { this.disconnect() },
  }
}

// ---------------------------------------------------------------------------
// Ghostty config
// ---------------------------------------------------------------------------

interface GhosttyConfig {
  theme: string | null
  fontFamily: string | null
  fontSize: number | null
  background: string | null
  foreground: string | null
  raw: Record<string, string>
}

let cachedConfig: GhosttyConfig | null = null
const MAX_SCROLLBACK_BYTES = 2_000_000
let resttyScrollbarWorkaroundInstalled = false

function installResttyScrollbarWorkaround() {
  if (resttyScrollbarWorkaroundInstalled || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return
  }

  const originalMatchMedia = window.matchMedia.bind(window)
  window.matchMedia = ((query: string) => {
    const result = originalMatchMedia(query)
    if (query.trim() !== "(any-pointer: coarse)") {
      return result
    }

    return {
      ...result,
      matches: true,
      media: query,
      onchange: result.onchange,
      addListener: result.addListener ? result.addListener.bind(result) : undefined,
      removeListener: result.removeListener ? result.removeListener.bind(result) : undefined,
      addEventListener: result.addEventListener.bind(result),
      removeEventListener: result.removeEventListener.bind(result),
      dispatchEvent: result.dispatchEvent.bind(result),
    } as MediaQueryList
  }) as typeof window.matchMedia

  resttyScrollbarWorkaroundInstalled = true
}

async function loadGhosttyConfig(): Promise<GhosttyConfig> {
  if (cachedConfig) return cachedConfig
  try {
    cachedConfig = await serverFetch<GhosttyConfig>("/api/ghostty-config")
    return cachedConfig
  } catch {
    return { theme: null, fontFamily: null, fontSize: null, background: null, foreground: null, raw: {} }
  }
}

// ---------------------------------------------------------------------------
// Single terminal tab — one Restty with split support
// ---------------------------------------------------------------------------

interface TerminalTab {
  id: string
  title: string
}

let tabCounter = 0

function TerminalInstance({
  cwd,
  isActive,
  serverPort,
  ghosttyConfig,
  resttyRef,
}: {
  cwd: string
  isActive: boolean
  serverPort: number
  ghosttyConfig: GhosttyConfig | null
  resttyRef: React.MutableRefObject<Restty | null>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const layoutFrameRef = useRef<number | null>(null)

  const cancelScheduledLayoutSync = useCallback(() => {
    if (layoutFrameRef.current !== null) {
      cancelAnimationFrame(layoutFrameRef.current)
      layoutFrameRef.current = null
    }
  }, [])

  const scheduleLayoutSync = useCallback((focusActivePane = false) => {
    cancelScheduledLayoutSync()
    layoutFrameRef.current = requestAnimationFrame(() => {
      layoutFrameRef.current = null
      const restty = resttyRef.current
      if (!restty) return
      restty.forEachPane((pane) => {
        pane.updateSize(true)
      })
      if (focusActivePane) {
        restty.activePane()?.focus()
      }
    })
  }, [cancelScheduledLayoutSync, resttyRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container || !serverPort || !ghosttyConfig) return

    installResttyScrollbarWorkaround()

    let destroyed = false
    const fontSize = ghosttyConfig.fontSize ?? 16

    // Resolve the theme once for all panes in this instance
    let resolvedTheme: GhosttyTheme | null = null
    if (ghosttyConfig.theme) resolvedTheme = getBuiltinTheme(ghosttyConfig.theme)
    if (!resolvedTheme) resolvedTheme = getBuiltinTheme("GitHub Dark")

    const restty = new Restty({
      root: container,
      autoInit: false,
      defaultContextMenu: false,
      searchUi: false,
      shortcuts: false,
      onLayoutChanged: () => {
        scheduleLayoutSync()
      },
      // Factory: called for each pane (initial + every split)
      appOptions: () => ({
        ptyTransport: createWsPtyTransport(serverPort, cwd),
        fontSize,
        fontSizeMode: "height" as const,
        autoResize: true,
        attachWindowEvents: true,
        // Keep long-running sessions responsive instead of letting scrollback
        // grow until the native scroll host and renderer bog down.
        maxScrollbackBytes: MAX_SCROLLBACK_BYTES,
      }),
      onPaneCreated: (pane) => {
        pane.app.init().then(() => {
          if (destroyed) return
          if (resolvedTheme) pane.app.applyTheme(resolvedTheme)
          pane.app.connectPty()
          pane.app.focus()
        })
      },
    })
    resttyRef.current = restty

    return () => {
      destroyed = true
      cancelScheduledLayoutSync()
      restty.destroy()
      resttyRef.current = null
    }
  }, [cancelScheduledLayoutSync, cwd, ghosttyConfig, resttyRef, scheduleLayoutSync, serverPort])

  // Pause/resume when visibility changes
  useEffect(() => {
    const restty = resttyRef.current
    if (!restty) return

    restty.forEachPane((pane) => {
      pane.setPaused(!isActive)
    })

    if (!isActive) {
      cancelScheduledLayoutSync()
      restty.activePane()?.blur()
      return
    }

    scheduleLayoutSync(true)
  }, [cancelScheduledLayoutSync, isActive, resttyRef, scheduleLayoutSync])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(() => {
      if (!isActive) return
      scheduleLayoutSync()
    })

    observer.observe(container)
    return () => observer.disconnect()
  }, [isActive, scheduleLayoutSync])

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute inset-0",
        !isActive && "pointer-events-none invisible",
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// TerminalPanel — multi-tab container with split support
// ---------------------------------------------------------------------------

export interface TerminalPanelHandle {
  closePaneOrTab: () => boolean
  splitVertical: () => void
  splitHorizontal: () => void
  addTab: () => void
}

interface TerminalPanelProps {
  cwd: string
  isVisible: boolean
}

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel({ cwd, isVisible }, ref) {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => {
    const id = String(++tabCounter)
    return [{ id, title: "Terminal" }]
  })
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id)
  const [serverPort, setServerPort] = useState(0)
  const [ghosttyConfig, setGhosttyConfig] = useState<GhosttyConfig | null>(null)
  const [cardBg, setCardBg] = useState("#0d1117")

  // One restty ref per tab
  const resttyRefs = useRef(new Map<string, React.MutableRefObject<Restty | null>>())

  function getResttyRef(tabId: string) {
    let ref = resttyRefs.current.get(tabId)
    if (!ref) {
      ref = { current: null }
      resttyRefs.current.set(tabId, ref)
    }
    return ref
  }

  // Load server port + Ghostty config once
  useEffect(() => {
    window.electronAPI?.server.getPort().then((port) => setServerPort(port))
    loadGhosttyConfig().then((config) => {
      setGhosttyConfig(config)
      let resolvedTheme: GhosttyTheme | null = null
      if (config.theme) resolvedTheme = getBuiltinTheme(config.theme)
      if (!resolvedTheme) resolvedTheme = getBuiltinTheme("GitHub Dark")
      const bg = themeColorToHex(resolvedTheme?.colors?.background as { r: number; g: number; b: number } | undefined)
      if (bg) setCardBg(bg)
      else if (config.background) setCardBg(config.background)
    })
  }, [])

  const addTab = useCallback(() => {
    const id = String(++tabCounter)
    const num = tabs.length + 1
    setTabs((prev) => [...prev, { id, title: `Terminal ${num}` }])
    setActiveTabId(id)
  }, [tabs.length])

  const closeTab = useCallback(
    (id: string) => {
      // Don't delete the restty ref here — the TerminalInstance's cleanup
      // effect handles destroying the Restty instance. Eagerly deleting the
      // ref before React unmounts the component can leave the active tab's
      // ref temporarily missing, causing blank terminals.
      setTabs((prev) => {
        const next = prev.filter((t) => t.id !== id)
        if (next.length === 0) {
          setActiveTabId("")
          return []
        }
        if (activeTabId === id) {
          setActiveTabId(next[next.length - 1].id)
        }
        // Renumber titles
        return next.map((t, i) => ({
          ...t,
          title: i === 0 ? "Terminal" : `Terminal ${i + 1}`,
        }))
      })
    },
    [activeTabId],
  )

  // Clean up stale restty refs after tabs are removed and components unmount
  useEffect(() => {
    const tabIds = new Set(tabs.map((t) => t.id))
    for (const id of resttyRefs.current.keys()) {
      if (!tabIds.has(id)) {
        resttyRefs.current.delete(id)
      }
    }
  }, [tabs])

  // Expose closePaneOrTab to parent via ref
  const closePaneOrTab = useCallback((): boolean => {
    const resttyRefObj = resttyRefs.current.get(activeTabId)
    const restty = resttyRefObj?.current

    // First try to close a split pane within the active tab
    if (restty) {
      const panes = restty.getPanes()
      if (panes.length > 1) {
        const active = restty.getActivePane()
        if (active) {
          restty.closePane(active.id)
          return true
        }
      }
    }

    // Close the active tab
    if (tabs.length >= 1) {
      closeTab(activeTabId)
      return true
    }

    // Nothing left to close — signal to caller
    return false
  }, [activeTabId, tabs.length, closeTab])

  const splitVertical = useCallback(() => {
    const ref = resttyRefs.current.get(activeTabId)
    ref?.current?.splitActivePane("vertical")
  }, [activeTabId])

  const splitHorizontal = useCallback(() => {
    const ref = resttyRefs.current.get(activeTabId)
    ref?.current?.splitActivePane("horizontal")
  }, [activeTabId])

  useImperativeHandle(ref, () => ({ closePaneOrTab, splitVertical, splitHorizontal, addTab }), [closePaneOrTab, splitVertical, splitHorizontal, addTab])

  return (
    <div className="flex h-full w-full flex-col bg-background p-4">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.08] shadow-2xl"
        style={{ backgroundColor: cardBg }}
      >
        {/* Tab bar */}
        <div className="flex shrink-0 items-center gap-1 px-3 pt-2 pb-1">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTabId(tab.id)}
                className={cn(
                  "group flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  activeTabId === tab.id
                    ? "bg-white/[0.08] text-white/80"
                    : "text-white/30 hover:text-white/50",
                )}
              >
                <span className="truncate">{tab.title}</span>
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); closeTab(tab.id) }}
                  className="rounded p-0.5 opacity-0 transition-opacity hover:bg-white/[0.08] group-hover:opacity-100"
                >
                  <X className="size-2.5" />
                </span>
              </button>
            ))}
          </div>

          {/* Split + add buttons */}
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={splitVertical}
              className="rounded-md p-1 text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/60"
              title="Split right"
            >
              <Columns2 className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={splitHorizontal}
              className="rounded-md p-1 text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/60"
              title="Split down"
            >
              <Rows2 className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={addTab}
              className="rounded-md p-1 text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/60"
              title="New terminal"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Terminal instances */}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-b-[11px] m-2 mt-0">
          {tabs.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <button
                type="button"
                onClick={addTab}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm text-white/30 transition-colors hover:bg-white/[0.06] hover:text-white/50"
              >
                <Plus className="size-4" />
                New Terminal
              </button>
            </div>
          ) : (
            tabs.map((tab) => (
              <TerminalInstance
                key={tab.id}
                cwd={cwd}
                isActive={isVisible && activeTabId === tab.id}
                serverPort={serverPort}
                ghosttyConfig={ghosttyConfig}
                resttyRef={getResttyRef(tab.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
})
