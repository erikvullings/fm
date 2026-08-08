import { describe, expect, it } from 'vitest';
import { editableLanguageForExtension } from './editor-language';

describe('editableLanguageForExtension', () => {
  it.each([
    ['txt', 'text'],
    ['md', 'markdown'],
    ['markdown', 'markdown'],
    ['xml', 'xml'],
    ['json', 'json'],
    ['geojson', 'json'],
  ])('maps %s', (extension, expected) =>
    expect(editableLanguageForExtension(extension)).toBe(expected),
  );
  it('leaves unsupported formats to the external editor', () =>
    expect(editableLanguageForExtension('pdf')).toBeUndefined());
});
