import { linter } from '@codemirror/lint';
import m, { type Component } from 'mithril';
import { FlatButton, IconButton } from 'mithril-materialized';
import { closeIcon } from '../../components/tabler-icons';
import { tooltip } from '../../components/tooltip';
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
        m(FlatButton, { label: 'Close', onclick: attrs.onClose }),
      ]);
    return m('section.fm-file-editor', { 'aria-label': `Editing ${state.entry.name}` }, [
      m('header.fm-file-editor-header', [
        m('strong', state.entry.name),
        state.dirty ? m('span.fm-file-editor-dirty', { title: 'Unsaved changes' }, '●') : undefined,
        m('span.fm-file-editor-spacer'),
        state.language === 'json'
          ? m(FlatButton, { label: 'Format JSON', onclick: () => controller.formatJson() })
          : undefined,
        state.language === 'markdown'
          ? m(FlatButton, {
              label: state.previewVisible ? 'Edit' : 'Preview',
              'aria-pressed': state.previewVisible,
              onclick: () => controller.togglePreview(),
            })
          : undefined,
        m(FlatButton, {
          label: state.saving ? 'Saving…' : 'Save',
          disabled: !state.dirty || state.saving,
          onclick: () => void controller.save(),
        }),
        tooltip(
          'Close editor',
          m(
            IconButton,
            {
              className: 'fm-file-editor-close',
              'aria-label': 'Close editor',
              onclick: () => {
                if (controller.requestClose()) attrs.onClose();
              },
            },
            closeIcon({ size: 13 }),
          ),
        ),
      ]),
      state.error ? m('.fm-file-editor-error', { role: 'alert' }, state.error) : undefined,
      state.conflict
        ? m(
            '.fm-file-editor-conflict',
            { role: 'alertdialog', 'aria-label': 'File changed on disk' },
            [
              m('span', 'This file changed after it was opened.'),
              m(FlatButton, { label: 'Reload', onclick: () => void controller.reload() }),
              m(FlatButton, { label: 'Overwrite', onclick: () => void controller.save(true) }),
              m(FlatButton, {
                label: 'Save As…',
                onclick: () => {
                  const uri = window.prompt('Save as URI');
                  if (uri !== null && uri.trim() !== '') void controller.save(false, uri.trim());
                },
              }),
              m(FlatButton, { label: 'Cancel', onclick: () => controller.cancelClose() }),
            ],
          )
        : undefined,
      m(
        '.fm-file-editor-content',
        state.language === 'markdown' && state.previewVisible
          ? m('.fm-file-editor-preview', { innerHTML: state.previewHtml ?? '' })
          : m(CodeMirrorEditor, {
              content: state.content,
              language: languageExtension(state.language),
              extensions: state.language === 'json' ? [linter(jsonParseLinter())] : [],
              onChange: (content) => controller.setContent(content),
            }),
      ),
      state.closePending
        ? m('.fm-file-editor-close-dialog', { role: 'dialog', 'aria-label': 'Unsaved changes' }, [
            m('span', 'Save changes before closing?'),
            m(FlatButton, {
              label: 'Save',
              onclick: async () => {
                if (await controller.save()) attrs.onClose();
              },
            }),
            m(FlatButton, { label: 'Discard', onclick: attrs.onClose }),
            m(FlatButton, { label: 'Cancel', onclick: () => controller.cancelClose() }),
          ])
        : undefined,
    ]);
  },
};
