import { useRef, useCallback, useEffect, useMemo } from "react"
import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react"
import type { editor as MonacoEditor } from "monaco-editor"
import { useTheme } from "@/components/theme-provider"

// ---------------------------------------------------------------------------
// Custom themes matching the app's palette
// ---------------------------------------------------------------------------

const DARK_THEME = "bettergit-dark"
const LIGHT_THEME = "bettergit-light"

const defineThemes: BeforeMount = (monaco) => {
  // Disable built-in diagnostics — Monaco doesn't know about project tsconfig,
  // path aliases, or installed types, so it shows false positives.
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true,
  })
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true,
  })

  monaco.editor.defineTheme(DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6a737d", fontStyle: "italic" },
      { token: "keyword", foreground: "c586c0" },
      { token: "string", foreground: "ce9178" },
      { token: "number", foreground: "b5cea8" },
      { token: "type", foreground: "4ec9b0" },
    ],
    colors: {
      "editor.background": "#1a1a1a",
      "editor.foreground": "#d4d4d4",
      "editorLineNumber.foreground": "#555555",
      "editorLineNumber.activeForeground": "#888888",
      "editor.lineHighlightBackground": "#ffffff08",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#264f78",
      "editorCursor.foreground": "#d4d4d4",
      "editorIndentGuide.background": "#ffffff0d",
      "editorIndentGuide.activeBackground": "#ffffff1a",
      "editorWidget.background": "#252525",
      "editorWidget.border": "#ffffff10",
      "editorSuggestWidget.background": "#252525",
      "editorHoverWidget.background": "#252525",
      "editor.inactiveSelectionBackground": "#264f7840",
      "editorBracketMatch.background": "#ffffff10",
      "editorBracketMatch.border": "#ffffff20",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#ffffff12",
      "scrollbarSlider.hoverBackground": "#ffffff20",
      "scrollbarSlider.activeBackground": "#ffffff30",
    },
  })

  monaco.editor.defineTheme(LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6a737d", fontStyle: "italic" },
      { token: "keyword", foreground: "af00db" },
      { token: "string", foreground: "a31515" },
      { token: "number", foreground: "098658" },
      { token: "type", foreground: "267f99" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#1a1a1a",
      "editorLineNumber.foreground": "#b0b0b0",
      "editorLineNumber.activeForeground": "#6e6e6e",
      "editor.lineHighlightBackground": "#00000006",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#add6ff",
      "editorCursor.foreground": "#1a1a1a",
      "editorIndentGuide.background": "#0000000d",
      "editorIndentGuide.activeBackground": "#0000001a",
      "editorWidget.background": "#f5f5f5",
      "editorWidget.border": "#e0e0e0",
      "editorSuggestWidget.background": "#f5f5f5",
      "editorHoverWidget.background": "#f5f5f5",
      "editor.inactiveSelectionBackground": "#add6ff60",
      "editorBracketMatch.background": "#00000010",
      "editorBracketMatch.border": "#00000020",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#00000012",
      "scrollbarSlider.hoverBackground": "#00000020",
      "scrollbarSlider.activeBackground": "#00000030",
    },
  })
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface FileEditorProps {
  /** Initial content — only used on mount (editor is uncontrolled after that) */
  defaultValue: string
  language: string
  onContentChange: (value: string) => void
  onSave: () => void
}

export function FileEditor({
  defaultValue,
  language,
  onContentChange,
  onSave,
}: FileEditorProps) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
  const onSaveRef = useRef(onSave)
  const { theme } = useTheme()

  const resolvedTheme = useMemo(() => {
    if (theme === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    }
    return theme
  }, [theme])

  const monacoTheme = resolvedTheme === "dark" ? DARK_THEME : LIGHT_THEME

  // Update live editor theme when user toggles
  useEffect(() => {
    if (editorRef.current) {
      const monaco = (window as unknown as Record<string, unknown>).monaco as typeof import("monaco-editor") | undefined
      monaco?.editor.setTheme(monacoTheme)
    }
  }, [monacoTheme])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSaveRef.current()
      })

      editor.focus()
    },
    [],
  )

  return (
    <Editor
      height="100%"
      language={language}
      defaultValue={defaultValue}
      theme={monacoTheme}
      beforeMount={defineThemes}
      onChange={(value) => onContentChange(value ?? "")}
      onMount={handleMount}
      options={{
        fontSize: 13,
        lineHeight: 20,
        fontFamily: "'GeistMono', 'SF Mono', 'Fira Code', 'Menlo', monospace",
        fontLigatures: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: "line",
        renderLineHighlightOnlyWhenFocus: true,
        smoothScrolling: true,
        cursorSmoothCaretAnimation: "on",
        cursorBlinking: "smooth",
        tabSize: 2,
        wordWrap: "on",
        automaticLayout: true,
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: true, indentation: true, highlightActiveIndentation: true },
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
        lineNumbersMinChars: 4,
        glyphMargin: false,
        folding: true,
        foldingHighlight: false,
        scrollbar: {
          verticalScrollbarSize: 8,
          horizontalScrollbarSize: 8,
          useShadows: false,
        },
        stickyScroll: { enabled: false },
      }}
    />
  )
}
