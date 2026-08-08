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
    ['toml', 'toml'],
    ['yaml', 'yaml'],
    ['yml', 'yaml'],
    ['ini', 'properties'],
    ['properties', 'properties'],
    ['sh', 'shell'],
  ])('maps %s', (extension, expected) =>
    expect(editableLanguageForExtension(extension)).toBe(expected),
  );
  it.each([
    [undefined, '.env', 'properties'],
    [undefined, '.env.local', 'properties'],
    [undefined, '.editorconfig', 'properties'],
    [undefined, '.gitignore', 'text'],
    [undefined, 'Dockerfile', 'shell'],
  ])('detects filename %s/%s', (extension, fileName, expected) =>
    expect(editableLanguageForExtension(extension, fileName)).toBe(expected),
  );

  it('treats an unknown extension as plain text so content validation decides editability', () =>
    expect(editableLanguageForExtension('unknown')).toBe('text'));
});
