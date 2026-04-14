import { useRef, useCallback, useEffect } from "react"
import Editor, { type OnMount, type BeforeMount } from "@monaco-editor/react"
import type { editor as MonacoEditor } from "monaco-editor"

// ---------------------------------------------------------------------------
// Custom theme matching the app's dark palette
// ---------------------------------------------------------------------------

const BETTERGIT_THEME = "bettergit-dark"

const defineTheme: BeforeMount = (monaco) => {
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

  monaco.editor.defineTheme(BETTERGIT_THEME, {
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
      theme={BETTERGIT_THEME}
      beforeMount={defineTheme}
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
