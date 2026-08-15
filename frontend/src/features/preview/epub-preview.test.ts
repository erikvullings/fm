import { describe, expect, it } from 'vitest';
import {
  parseEpubContainer,
  parseEpubPackage,
  resolveEpubPath,
  sanitizeEpubChapterHtml,
} from './epub-preview';

describe('parseEpubContainer', () => {
  it('reads the OPF full-path from container.xml', () => {
    const xml = `<?xml version="1.0"?>
      <container>
        <rootfiles>
          <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
        </rootfiles>
      </container>`;
    expect(parseEpubContainer(xml)).toBe('OEBPS/content.opf');
  });

  it('returns undefined when no rootfile is present', () => {
    expect(parseEpubContainer('<container><rootfiles/></container>')).toBeUndefined();
  });
});

describe('resolveEpubPath', () => {
  it('joins a base directory and a relative href', () => {
    expect(resolveEpubPath('OEBPS/', 'text/chapter1.xhtml')).toBe('OEBPS/text/chapter1.xhtml');
  });

  it('collapses .. segments', () => {
    expect(resolveEpubPath('OEBPS/text/', '../images/cover.jpg')).toBe('OEBPS/images/cover.jpg');
  });

  it('resolves against the archive root when the base directory is empty', () => {
    expect(resolveEpubPath('', 'content.opf')).toBe('content.opf');
  });
});

describe('parseEpubPackage', () => {
  const opfXml = `<?xml version="1.0"?>
    <package xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>My Book</dc:title>
      </metadata>
      <manifest>
        <item id="ch1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
        <item id="cover" href="images/cover.jpg" media-type="image/jpeg"/>
        <item id="css" href="styles/main.css" media-type="text/css"/>
      </manifest>
      <spine>
        <itemref idref="ch1"/>
        <itemref idref="ch2"/>
      </spine>
    </package>`;

  it('extracts the title and resolves the spine to archive-relative chapter paths, in order', () => {
    const book = parseEpubPackage(opfXml, 'OEBPS/content.opf');
    expect(book.title).toBe('My Book');
    expect(book.chapterPaths).toEqual(['OEBPS/text/chapter1.xhtml', 'OEBPS/text/chapter2.xhtml']);
  });

  it('excludes non-(X)HTML manifest items (images, stylesheets) from the chapter list', () => {
    const book = parseEpubPackage(opfXml, 'OEBPS/content.opf');
    expect(book.chapterPaths.some((path) => path.includes('cover.jpg'))).toBe(false);
    expect(book.chapterPaths.some((path) => path.includes('main.css'))).toBe(false);
  });

  it('has no title when dc:title is absent', () => {
    const book = parseEpubPackage('<package><manifest/><spine/></package>', 'content.opf');
    expect(book.title).toBeUndefined();
    expect(book.chapterPaths).toEqual([]);
  });
});

describe('sanitizeEpubChapterHtml', () => {
  it('keeps ordinary content markup', () => {
    const html = sanitizeEpubChapterHtml('<p>Hello <em>world</em></p>');
    expect(html).toContain('Hello');
    expect(html).toContain('<em>world</em>');
  });

  it('strips scripts, embedded styles, and inline style attributes', () => {
    const html = sanitizeEpubChapterHtml(
      '<p style="color:red" onclick="evil()">Text</p><script>evil()</script><style>body{}</style>',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('onclick');
    expect(html).toContain('Text');
  });
});
