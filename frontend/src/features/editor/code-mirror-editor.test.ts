import m from 'mithril';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CodeMirrorEditor } from './code-mirror-editor';

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
});

afterEach(() => {
  m.mount(root, null);
  root.remove();
});

describe('CodeMirrorEditor', () => {
  it('stays DOM-editable (selectable) in read-only mode, even though edits are blocked', () => {
    m.mount(root, { view: () => m(CodeMirrorEditor, { content: 'hello world', readOnly: true }) });
    const content = root.querySelector('.cm-content');
    // `EditorView.editable` must stay true even for the read-only viewer - false would make
    // `.cm-content` non-contenteditable, which silently defeats the app's CSS `user-select: text`
    // override and makes the viewed text impossible to select/copy with the mouse (the actual bug
    // this guards against). Blocking edits is `EditorState.readOnly`'s job, not `editable`'s.
    expect(content?.getAttribute('contenteditable')).toBe('true');
  });

  it('is DOM-editable in normal (non-read-only) mode too', () => {
    m.mount(root, { view: () => m(CodeMirrorEditor, { content: 'hello world' }) });
    const content = root.querySelector('.cm-content');
    expect(content?.getAttribute('contenteditable')).toBe('true');
  });
});
