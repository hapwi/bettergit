import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from "react"
import { Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"

const TERMINAL_SHELL_BG = "#3b3d46"

interface TerminalTab {
  id: string
  title: string
}

let tabCounter = 0

function NativeTerminalInstance({
  surfaceId,
  cwd,
  isActive,
  backgroundColor,
}: {
  surfaceId: string
  cwd: string
  isActive: boolean
  backgroundColor: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [created, setCreated] = useState(false)

  const syncBounds = useCallback(() => {
    if (!created) return
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return
    void window.electronAPI?.terminalHost.setSurfaceBounds(surfaceId, {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    })
  }, [created, surfaceId])

  useEffect(() => {
    let cancelled = false
    window.electronAPI?.terminalHost.createSurface(surfaceId, cwd).then((ok) => {
      if (!cancelled) {
        setCreated(ok)
      }
    }).catch(() => {
      if (!cancelled) {
        setCreated(false)
      }
    })

    return () => {
      cancelled = true
      setCreated(false)
      void window.electronAPI?.terminalHost.destroySurface(surfaceId)
    }
  }, [cwd, surfaceId])

  useEffect(() => {
    if (!created) return
    syncBounds()
    void window.electronAPI?.terminalHost.setSurfaceBackground(surfaceId, backgroundColor)
    void window.electronAPI?.terminalHost.setSurfaceVisible(surfaceId, isActive)
    if (isActive) {
      void window.electronAPI?.terminalHost.focusSurface(surfaceId)
    }
  }, [backgroundColor, created, isActive, surfaceId, syncBounds])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(() => {
      syncBounds()
    })
    observer.observe(container)
    window.addEventListener("resize", syncBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", syncBounds)
    }
  }, [syncBounds])

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

export const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(function TerminalPanel({ cwd, isVisible, onAllTabsClosed }, ref) {
  const [tabs, setTabs] = useState<TerminalTab[]>(() => {
    const id = String(++tabCounter)
    return [{ id, title: "Terminal" }]
  })
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id)
  const [cardBg, setCardBg] = useState(TERMINAL_SHELL_BG)
  const [nativeHostAvailable, setNativeHostAvailable] = useState<boolean | null>(null)
  const hadTabsRef = useRef(tabs.length > 0)

  useEffect(() => {
    let cancelled = false

    const host = window.electronAPI?.terminalHost
    if (!host) {
      setNativeHostAvailable(false)
      return
    }

    Promise.all([
      host.isAvailable().catch(() => false),
      host.getResolvedAppearance().catch(() => undefined),
    ]).then(([available, appearance]) => {
      if (cancelled) return
      setNativeHostAvailable(available)
      if (appearance?.backgroundColor) {
        setCardBg(appearance.backgroundColor)
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  const addTab = useCallback(() => {
    const id = String(++tabCounter)
    setTabs((prev) => {
      const next = [...prev, { id, title: `Terminal ${prev.length + 1}` }]
      return next
    })
    setActiveTabId(id)
  }, [])

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const next = prev.filter((tab) => tab.id !== id)
        if (next.length === 0) {
          setActiveTabId("")
          return []
        }
        if (activeTabId === id) {
          setActiveTabId(next[next.length - 1].id)
        }
        return next.map((tab, index) => ({
          ...tab,
          title: index === 0 ? "Terminal" : `Terminal ${index + 1}`,
        }))
      })
    },
    [activeTabId],
  )

  useEffect(() => {
    if (tabs.length > 0) {
      hadTabsRef.current = true
      return
    }
    if (!hadTabsRef.current) return
    hadTabsRef.current = false
    onAllTabsClosed?.()
  }, [onAllTabsClosed, tabs.length])

  const closePaneOrTab = useCallback((): boolean => {
    if (!activeTabId || tabs.length === 0) return false

    const host = window.electronAPI?.terminalHost
    if (!host) {
      closeTab(activeTabId)
      return true
    }

    void host.closeFocusedSurface(activeTabId).then((closedPane) => {
      if (!closedPane) {
        closeTab(activeTabId)
      }
    }).catch(() => {
      closeTab(activeTabId)
    })

    return true
  }, [activeTabId, closeTab, tabs.length])

  const splitVertical = useCallback(() => {
    if (!activeTabId) return
    void window.electronAPI?.terminalHost.splitSurface(activeTabId, "right")
  }, [activeTabId])

  const splitHorizontal = useCallback(() => {
    if (!activeTabId) return
    void window.electronAPI?.terminalHost.splitSurface(activeTabId, "down")
  }, [activeTabId])

  useImperativeHandle(ref, () => ({ closePaneOrTab, splitVertical, splitHorizontal, addTab }), [closePaneOrTab, splitVertical, splitHorizontal, addTab])

  const renderBody = () => {
    if (tabs.length === 0) {
      return (
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
      )
    }

    if (nativeHostAvailable === null) {
      return (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-white/40">
          Initializing native terminal...
        </div>
      )
    }

    if (!nativeHostAvailable) {
      return (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm text-center text-sm text-white/50">
            Terminal is available only in the macOS desktop app with the native Ghostty host.
          </div>
        </div>
      )
    }

    return tabs.map((tab) => (
      <NativeTerminalInstance
        key={tab.id}
        surfaceId={tab.id}
        cwd={cwd}
        isActive={isVisible && activeTabId === tab.id}
        backgroundColor={cardBg}
      />
    ))
  }

  return (
    <div className="flex h-full w-full flex-col bg-background p-4">
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.08] shadow-2xl"
        style={{ backgroundColor: cardBg }}
      >
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
                  onClick={(event) => {
                    event.stopPropagation()
                    closeTab(tab.id)
                  }}
                  className="rounded p-0.5 opacity-0 transition-opacity hover:bg-white/[0.08] group-hover:opacity-100"
                >
                  <X className="size-2.5" />
                </span>
              </button>
            ))}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
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

        <div className="relative m-2 mt-0 min-h-0 flex-1 overflow-hidden rounded-b-[11px]">
          {renderBody()}
        </div>
      </div>
    </div>
  )
})
