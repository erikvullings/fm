import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { search, searchKeymap } from '@codemirror/search';
import { EditorSelection, EditorState, type Extension, StateEffect } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import m, { type FactoryComponent } from 'mithril';

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
      '.cm-panels': {
        backgroundColor: 'var(--fm-surface-elevated)',
        color: 'var(--fm-text)',
      },
      '.cm-panel input, .cm-panel button': {
        color: 'var(--fm-text)',
        backgroundColor: 'var(--fm-surface)',
        border: '1px solid var(--fm-border)',
      },
      '.cm-searchMatch': { backgroundColor: 'var(--fm-selection)' },
      '.cm-searchMatch-selected': { backgroundColor: 'var(--fm-accent)' },
    }),
    lineNumbers(),
    syntaxHighlighting(fmHighlightStyle, { fallback: true }),
    search(),
    keymap.of(searchKeymap),
    EditorState.readOnly.of(attrs.readOnly === true),
    // Always DOM-editable (contenteditable), even in read-only mode: `readOnly` above already
    // blocks every edit transaction, so this only controls whether the content is selectable.
    // Setting `editable: false` for the F3 viewer used to make `.cm-content` non-contenteditable,
    // which silently defeated the app's `user-select: text` override and made the viewed text
    // impossible to select/copy with the mouse.
    EditorView.editable.of(true),
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
        // Keeps these chords from bubbling to the app-wide keymap, which would otherwise
        // intercept them (save/undo/redo, and Mod-F for the in-editor find panel).
        if (
          (event.metaKey || event.ctrlKey) &&
          ['s', 'z', 'y', 'f'].includes(event.key.toLowerCase())
        )
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
