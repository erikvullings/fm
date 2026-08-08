import { json, jsonParseLinter } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { StreamLanguage } from '@codemirror/language';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import type { Extension } from '@codemirror/state';

export type EditableLanguage =
  | 'text'
  | 'markdown'
  | 'xml'
  | 'json'
  | 'toml'
  | 'yaml'
  | 'properties'
  | 'shell';

export function editableLanguageForExtension(
  extension: string | undefined,
  fileName = '',
): EditableLanguage {
  const lowerName = fileName.toLowerCase();
  if (lowerName === '.env' || lowerName.startsWith('.env.') || lowerName === '.editorconfig')
    return 'properties';
  if (lowerName === 'dockerfile') return 'shell';
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
    case 'toml':
      return 'toml';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'ini':
    case 'cfg':
    case 'conf':
    case 'properties':
      return 'properties';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell';
    default:
      return 'text';
  }
}

export function languageExtension(language: EditableLanguage): Extension {
  if (language === 'json') return json();
  if (language === 'markdown') return markdown();
  if (language === 'xml') return xml();
  if (language === 'toml') return StreamLanguage.define(toml);
  if (language === 'yaml') return StreamLanguage.define(yaml);
  if (language === 'properties') return StreamLanguage.define(properties);
  if (language === 'shell') return StreamLanguage.define(shell);
  return [];
}

export { jsonParseLinter };
