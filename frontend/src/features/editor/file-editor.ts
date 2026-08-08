import { linter } from '@codemirror/lint';
import m, { type Component } from 'mithril';
import { CodeMirrorEditor } from './code-mirror-editor';
import { jsonParseLinter, languageExtension } from './editor-language';
import type { FileEditorController, FileEditorState } from './file-editor-controller';
import './file-editor.css';

export interface FileEditorAttrs {
  readonly state: FileEditorState;
  readonly controller: FileEditorController;
  readonly onClose: () => void;
}

export const FileEditor: Component<FileEditorAttrs> = {
  view: ({ attrs }) => {
    const { state, controller } = attrs;
    if (state.status === 'loading')
      return m('section.fm-file-editor', m('.fm-file-editor-message', 'Loading…'));
    if (state.status === 'error')
      return m('section.fm-file-editor', [
        m('.fm-file-editor-message', state.message),
        m('button', { onclick: attrs.onClose }, 'Close'),
      ]);
    return m('section.fm-file-editor', { 'aria-label': `Editing ${state.entry.name}` }, [
      m('header.fm-file-editor-header', [
        m('strong', state.entry.name),
        state.dirty ? m('span.fm-file-editor-dirty', { title: 'Unsaved changes' }, '●') : undefined,
        m('span.fm-file-editor-spacer'),
        state.language === 'json'
          ? m('button', { type: 'button', onclick: () => controller.formatJson() }, 'Format JSON')
          : undefined,
        state.language === 'markdown'
          ? m(
              'button',
              {
                type: 'button',
                'aria-pressed': state.previewVisible,
                onclick: () => controller.togglePreview(),
              },
              'Preview',
            )
          : undefined,
        m(
          'button',
          {
            type: 'button',
            disabled: !state.dirty || state.saving,
            onclick: () => void controller.save(),
          },
          state.saving ? 'Saving…' : 'Save',
        ),
        m(
          'button',
          {
            type: 'button',
            'aria-label': 'Close editor',
            onclick: () => {
              if (controller.requestClose()) attrs.onClose();
            },
          },
          '×',
        ),
      ]),
      state.error ? m('.fm-file-editor-error', { role: 'alert' }, state.error) : undefined,
      state.conflict
        ? m(
            '.fm-file-editor-conflict',
            { role: 'alertdialog', 'aria-label': 'File changed on disk' },
            [
              m('span', 'This file changed after it was opened.'),
              m('button', { onclick: () => void controller.reload() }, 'Reload'),
              m('button', { onclick: () => void controller.save(true) }, 'Overwrite'),
              m(
                'button',
                {
                  onclick: () => {
                    const uri = window.prompt('Save as URI');
                    if (uri !== null && uri.trim() !== '') void controller.save(false, uri.trim());
                  },
                },
                'Save As…',
              ),
              m('button', { onclick: () => controller.cancelClose() }, 'Cancel'),
            ],
          )
        : undefined,
      m('.fm-file-editor-content', [
        m(CodeMirrorEditor, {
          content: state.content,
          language: languageExtension(state.language),
          extensions: state.language === 'json' ? [linter(jsonParseLinter())] : [],
          onChange: (content) => controller.setContent(content),
        }),
        state.language === 'markdown' && state.previewVisible
          ? m('.fm-file-editor-preview', { innerHTML: state.previewHtml ?? '' })
          : undefined,
      ]),
      state.closePending
        ? m('.fm-file-editor-close-dialog', { role: 'dialog', 'aria-label': 'Unsaved changes' }, [
            m('span', 'Save changes before closing?'),
            m(
              'button',
              {
                onclick: async () => {
                  if (await controller.save()) attrs.onClose();
                },
              },
              'Save',
            ),
            m('button', { onclick: attrs.onClose }, 'Discard'),
            m('button', { onclick: () => controller.cancelClose() }, 'Cancel'),
          ])
        : undefined,
    ]);
  },
};
