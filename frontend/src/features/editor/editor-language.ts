import { json, jsonParseLinter } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import type { Extension } from '@codemirror/state';

export type EditableLanguage = 'text' | 'markdown' | 'xml' | 'json';

export function editableLanguageForExtension(
  extension: string | undefined,
): EditableLanguage | undefined {
  switch (extension?.toLowerCase()) {
    case 'txt':
      return 'text';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'xml':
      return 'xml';
    case 'json':
    case 'geojson':
      return 'json';
    default:
      return undefined;
  }
}

export function languageExtension(language: EditableLanguage): Extension {
  if (language === 'json') return json();
  if (language === 'markdown') return markdown();
  if (language === 'xml') return xml();
  return [];
}

export { jsonParseLinter };
