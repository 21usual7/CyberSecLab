// CodeEditor — CodeMirror with a tiny stream highlighter for our asm, plus a
// gutter marker on the line currently being fetched and underlines on lines the
// static analyzer flagged.

import { StreamLanguage } from '@codemirror/language'
import { EditorView, Decoration, gutter, GutterMarker } from '@codemirror/view'
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state'
import CodeMirror from '@uiw/react-codemirror'
import { useEffect, useMemo, useRef } from 'react'
import type { Annotation } from '../engine/analyzer'
import { INSTRUCTIONS } from '../engine/isa'

const MNEMONICS = new Set(Object.keys(INSTRUCTIONS))
const REGS = new Set([
  'rax',
  'rbx',
  'rcx',
  'rdx',
  'rsi',
  'rdi',
  'r8',
  'r9',
])

const asmLang = StreamLanguage.define({
  token(stream) {
    if (stream.eatSpace()) return null
    if (stream.match(/;.*/) || stream.match(/\/\/.*/)) return 'comment'
    if (stream.match(/^\.[a-z]+/i)) return 'meta' // .data / .text
    if (stream.match(/^[A-Za-z_]\w*:/)) return 'labelName'
    if (stream.match(/^0x[0-9a-f]+|^0b[01]+|^\d+/i)) return 'number'
    const w = stream.match(/^[A-Za-z_]\w*/) as RegExpMatchArray | null
    if (w) {
      const lo = w[0].toLowerCase()
      if (MNEMONICS.has(lo)) return 'keyword'
      if (REGS.has(lo)) return 'variableName'
      return 'propertyName'
    }
    stream.next()
    return null
  },
})

const theme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: 'var(--text)' },
    '.cm-content': { caretColor: 'var(--accent)' },
    '.cm-gutters': {
      backgroundColor: 'var(--panel-2)',
      color: 'var(--text-dim)',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.tok-keyword': { color: 'var(--accent)', fontWeight: '600' },
    '.tok-variableName': { color: 'var(--accent-2)' },
    '.tok-number': { color: 'var(--spec)' },
    '.tok-comment': { color: 'var(--text-dim)', fontStyle: 'italic' },
    '.tok-meta': { color: 'var(--ok)' },
    '.tok-labelName': { color: 'var(--text-hi)', fontWeight: '600' },
    '.cm-gadget-line': {
      textDecoration: 'underline wavy var(--danger)',
      textDecorationSkipInk: 'none',
    },
    '.cm-mit-line': {
      textDecoration: 'underline wavy var(--ok)',
    },
    '.cm-fetch-marker': { color: 'var(--accent)' },
  },
  { dark: true },
)

const highlightStyle = EditorView.baseTheme({})

// --- current-fetch gutter marker ---
const setFetchLine = StateEffect.define<number>()
class FetchMarker extends GutterMarker {
  override toDOM() {
    const s = document.createElement('span')
    s.textContent = '▶'
    s.className = 'cm-fetch-marker'
    return s
  }
}
const fetchField = StateField.define<number>({
  create: () => -1,
  update(val, tr) {
    for (const e of tr.effects) if (e.is(setFetchLine)) return e.value
    return val
  },
})
const fetchGutter = gutter({
  class: 'cm-fetchgutter',
  lineMarker(view, line) {
    const ln = view.state.field(fetchField)
    if (ln < 0) return null
    const lineObj = view.state.doc.lineAt(line.from)
    return lineObj.number === ln ? new FetchMarker() : null
  },
  initialSpacer: () => new FetchMarker(),
})

// --- analyzer underlines ---
const setAnno = StateEffect.define<Annotation[]>()
const annoField = StateField.define({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setAnno)) {
        const b = new RangeSetBuilder<Decoration>()
        const anns = [...e.value].sort((a, z) => a.line - z.line)
        for (const a of anns) {
          const line = tr.state.doc.line(Math.min(a.line, tr.state.doc.lines))
          b.add(
            line.from,
            line.from,
            Decoration.line({
              class: a.severity === 'gadget' ? 'cm-gadget-line' : 'cm-mit-line',
            }),
          )
        }
        return b.finish()
      }
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f),
})

export interface CodeEditorProps {
  value: string
  onChange: (v: string) => void
  fetchLine: number
  annotations: Annotation[]
  readOnly?: boolean
}

export function CodeEditor({
  value,
  onChange,
  fetchLine,
  annotations,
  readOnly,
}: CodeEditorProps) {
  const extensions = useMemo(
    () => [asmLang, theme, highlightStyle, fetchField, fetchGutter, annoField],
    [],
  )
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setFetchLine.of(fetchLine) })
  }, [fetchLine])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setAnno.of(annotations) })
  }, [annotations])

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme="dark"
      editable={!readOnly}
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={(view) => {
        viewRef.current = view
        view.dispatch({
          effects: [setFetchLine.of(fetchLine), setAnno.of(annotations)],
        })
      }}
      basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: false }}
    />
  )
}
