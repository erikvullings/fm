import { describe, expect, it } from 'vitest';

import {
  highlightToHtml,
  languageForExtension,
  wrapRangeInHighlightMark,
} from './syntax-highlighting';

describe('languageForExtension', () => {
  it('returns undefined when there is no extension', () => {
    expect(languageForExtension(undefined)).toBeUndefined();
  });

  it('resolves highlight.js aliases directly, case-insensitively', () => {
    expect(languageForExtension('py')).toBe('py');
    expect(languageForExtension('RS')).toBe('rs');
    expect(languageForExtension('yml')).toBe('yml');
    expect(languageForExtension('md')).toBe('md');
    expect(languageForExtension('ts')).toBe('ts');
  });

  it('resolves extra aliases not registered by highlight.js itself', () => {
    expect(languageForExtension('geojson')).toBe('json');
    expect(languageForExtension('tsx')).toBe('typescript');
    expect(languageForExtension('mjs')).toBe('javascript');
  });

  it('returns undefined for an unregistered extension', () => {
    expect(languageForExtension('not-a-real-extension')).toBeUndefined();
  });
});

describe('highlightToHtml', () => {
  it('HTML-escapes plain text when no language is given', () => {
    expect(highlightToHtml('<script>alert(1)</script>', undefined)).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('wraps recognised tokens in highlight.js span classes', () => {
    const html = highlightToHtml('def greet():\n    return "hi"', 'python');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-string');
  });

  it('never lets file content escape the highlighted output unescaped', () => {
    const html = highlightToHtml('<img src=x onerror=alert(1)>', 'json');
    expect(html).not.toContain('<img');
  });
});

describe('wrapRangeInHighlightMark', () => {
  function root(html: string): HTMLElement {
    const element = document.createElement('pre');
    element.innerHTML = html;
    return element;
  }

  it('wraps a plain-text range in a single mark', () => {
    const element = root('hello world');
    wrapRangeInHighlightMark(element, 6, 11);
    const mark = element.querySelector('.fm-file-viewer-highlight');
    expect(mark?.textContent).toBe('world');
    expect(element.textContent).toBe('hello world');
  });

  it('wraps a range that spans multiple syntax-highlighting spans', () => {
    const element = root(
      '<span class="hljs-keyword">def</span> <span class="hljs-title">go</span>',
    );
    wrapRangeInHighlightMark(element, 2, 5);
    const marks = element.querySelectorAll('.fm-file-viewer-highlight');
    expect(marks.length).toBe(3);
    expect(Array.from(marks, (mark) => mark.textContent).join('')).toBe('f g');
    expect(element.textContent).toBe('def go');
  });
});
