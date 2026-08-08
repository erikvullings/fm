import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorSelection, EditorState, type Extension, StateEffect } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import m, { type FactoryComponent } from 'mithril';
import { tags } from '@lezer/highlight';

const fmHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.bool, tags.null], color: 'var(--fm-accent)' },
  { tag: [tags.string, tags.regexp], color: 'var(--fm-success)' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--fm-warning)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--fm-text-muted)' },
  { tag: [tags.heading, tags.typeName, tags.className], color: 'var(--fm-accent)' },
  { tag: [tags.link, tags.url], color: 'var(--fm-accent)', textDecoration: 'underline' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.invalid, color: 'var(--fm-error)' },
]);

export interface CodeMirrorEditorAttrs {
  readonly content: string;
  readonly language?: Extension;
  readonly readOnly?: boolean;
  readonly extensions?: readonly Extension[];
  readonly onChange?: (content: string) => void;
  readonly selection?: { readonly from: number; readonly to: number };
}

export const CodeMirrorEditor: FactoryComponent<CodeMirrorEditorAttrs> = () => {
  let view: EditorView | undefined;
  let currentContent = '';
  const extensions = (attrs: CodeMirrorEditorAttrs): Extension[] => [
    EditorView.theme({
      '&': {
        backgroundColor: 'var(--fm-surface)',
        color: 'var(--fm-text)',
        fontFamily: 'var(--fm-font-family)',
        fontSize: '0.8em',
      },
      '.cm-content': { caretColor: 'var(--fm-accent)' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fm-accent)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'var(--fm-selection)',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--fm-surface)',
        color: 'var(--fm-text-muted)',
        borderRightColor: 'var(--fm-border)',
      },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--fm-hover)' },
      '.cm-activeLineGutter': { color: 'var(--fm-text)' },
    }),
    lineNumbers(),
    syntaxHighlighting(fmHighlightStyle, { fallback: true }),
    EditorState.readOnly.of(attrs.readOnly === true),
    EditorView.editable.of(attrs.readOnly !== true),
    ...(attrs.readOnly === true
      ? []
      : [
        history(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
      ]),
    ...(attrs.language === undefined ? [] : [attrs.language]),
    ...(attrs.extensions ?? []),
    EditorView.domEventHandlers({
      keydown: (event) => {
        if ((event.metaKey || event.ctrlKey) && ['s', 'z', 'y'].includes(event.key.toLowerCase()))
          event.stopPropagation();
        return false;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      currentContent = update.state.doc.toString();
      attrs.onChange?.(currentContent);
    }),
  ];
  return {
    view: () => m('.fm-code-mirror'),
    oncreate: ({ dom, attrs }) => {
      currentContent = attrs.content;
      view = new EditorView({
        state: EditorState.create({ doc: attrs.content, extensions: extensions(attrs) }),
        parent: dom as HTMLElement,
      });
    },
    onbeforeupdate: ({ attrs }) => {
      if (view === undefined) return false;
      view.dispatch({ effects: StateEffect.reconfigure.of(extensions(attrs)) });
      if (attrs.content !== currentContent) {
        currentContent = attrs.content;
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: attrs.content } });
      }
      if (attrs.selection !== undefined && attrs.selection.to <= view.state.doc.length) {
        const range = document.createRange();
        view.dispatch({
          selection: EditorSelection.range(attrs.selection.from, attrs.selection.to),
          ...(typeof range.getClientRects === 'function'
            ? { effects: EditorView.scrollIntoView(attrs.selection.from, { y: 'center' }) }
            : {}),
        });
      }
      return false;
    },
    onremove: () => {
      view?.destroy();
      view = undefined;
    },
  };
};
