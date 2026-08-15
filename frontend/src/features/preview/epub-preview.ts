import DOMPurify from 'dompurify';

/** Resolves `href` (from an OPF manifest entry) against `baseDir` (the OPF file's own directory,
 * trailing-slash-terminated or empty for the archive root), collapsing `.`/`..` segments - a
 * minimal relative-path resolver so EPUB manifests that live in a subdirectory (the common case:
 * `OEBPS/content.opf` referencing `OEBPS/text/chapter1.xhtml` as `text/chapter1.xhtml`) resolve to
 * the correct in-archive path. */
export function resolveEpubPath(baseDir: string, href: string): string {
  const stack: string[] = [];
  for (const part of `${baseDir}${href}`.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function dirnameWithTrailingSlash(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index + 1);
}

/** Reads the OPF (package document) path out of an EPUB's `META-INF/container.xml`. */
export function parseEpubContainer(containerXml: string): string | undefined {
  const doc = new DOMParser().parseFromString(containerXml, 'application/xml');
  return doc.querySelector('rootfile')?.getAttribute('full-path') ?? undefined;
}

export interface EpubPackage {
  readonly title: string | undefined;
  /** In-archive paths of the spine's XHTML content documents, in reading order. */
  readonly chapterPaths: readonly string[];
}

/** Parses an EPUB's OPF package document: the manifest (id -> href, filtered to (X)HTML content
 * documents) and the spine (reading order, by manifest id), resolving every href against the
 * OPF's own directory so callers get archive-root-relative paths ready to fetch directly. */
export function parseEpubPackage(opfXml: string, opfPath: string): EpubPackage {
  const doc = new DOMParser().parseFromString(opfXml, 'application/xml');
  const baseDir = dirnameWithTrailingSlash(opfPath);
  const manifest = new Map<string, string>();
  for (const item of Array.from(doc.querySelectorAll('manifest > item'))) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const mediaType = item.getAttribute('media-type');
    if (id === null || href === null) continue;
    if (mediaType !== null && !mediaType.includes('html')) continue;
    manifest.set(id, resolveEpubPath(baseDir, href));
  }
  const chapterPaths: string[] = [];
  for (const itemref of Array.from(doc.querySelectorAll('spine > itemref'))) {
    const idref = itemref.getAttribute('idref');
    const path = idref === null ? undefined : manifest.get(idref);
    if (path !== undefined) chapterPaths.push(path);
  }
  const titleText = doc.getElementsByTagName('dc:title')[0]?.textContent?.trim();
  return { title: titleText === '' ? undefined : titleText, chapterPaths };
}

/** Sanitizes one chapter's raw XHTML for display. Strips scripts/styles/forms/embeds (never
 * executes anything from previewed content, task 0071) - relative image/CSS references are left
 * as-is and will simply not resolve (archive-internal resources aren't served over HTTP), a known
 * limitation of this "quick view" reader rather than a full EPUB renderer. */
export function sanitizeEpubChapterHtml(xhtml: string): string {
  return DOMPurify.sanitize(xhtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'svg', 'math', 'link'],
    FORBID_ATTR: ['style'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i,
  });
}
