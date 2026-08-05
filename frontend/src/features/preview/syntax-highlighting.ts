import hljs from 'highlight.js/lib/common';

/**
 * Extensions common in this codebase that highlight.js's bundled "common" language set doesn't
 * already register as an alias (most extensions - `py`, `rs`, `yml`, `md`, etc. - work directly
 * via {@link hljs.getLanguage} without needing an entry here).
 */
const EXTRA_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
  geojson: 'json',
  jsonc: 'json',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
};

/**
 * Resolves a highlight.js language identifier for `extension`, if one is registered - either
 * directly (highlight.js's own alias list, e.g. `py`/`rs`/`yml`/`md`) or via
 * {@link EXTRA_LANGUAGE_ALIASES}. Using highlight.js's own registered languages as the source of
 * truth means the viewer's syntax-highlighted extension list only ever needs to grow when
 * highlight.js adds a language, not via a hand-maintained list here.
 */
export function languageForExtension(extension: string | undefined): string | undefined {
  if (extension === undefined) return undefined;
  const lower = extension.toLowerCase();
  const alias = EXTRA_LANGUAGE_ALIASES[lower] ?? lower;
  return hljs.getLanguage(alias) === undefined ? undefined : alias;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Renders `text` as safe HTML, syntax-highlighted for `language` when given. Falls back to
 * (HTML-escaped) plain text when `language` is `undefined` - highlight.js's own output is already
 * HTML-escaped, so only the plain-text fallback needs manual escaping here.
 */
export function highlightToHtml(text: string, language: string | undefined): string {
  if (language === undefined) return escapeHtml(text);
  return hljs.highlight(text, { language, ignoreIllegals: true }).value;
}

/**
 * Wraps the `[start, end)` character range of `root`'s text content in `<mark
 * class="fm-file-viewer-highlight">` elements, for the active search match (task 0088) - done by
 * walking the DOM after highlight.js has already produced its `<span>` tree, rather than slicing
 * the raw string, so the match can straddle multiple syntax-highlighting spans without corrupting
 * markup. Collects the affected text nodes before mutating, since a `TreeWalker` misbehaves if the
 * tree changes mid-walk.
 */
export function wrapRangeInHighlightMark(root: HTMLElement, start: number, end: number): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    textNodes.push(node as Text);
  }
  let offset = 0;
  for (const node of textNodes) {
    const text = node.textContent ?? '';
    const nodeStart = offset;
    const nodeEnd = offset + text.length;
    offset = nodeEnd;
    const overlapStart = Math.max(start, nodeStart) - nodeStart;
    const overlapEnd = Math.min(end, nodeEnd) - nodeStart;
    if (overlapStart >= overlapEnd) continue;
    const parent = node.parentNode;
    if (parent === null) continue;
    const before = text.slice(0, overlapStart);
    const mark = document.createElement('mark');
    mark.className = 'fm-file-viewer-highlight';
    mark.textContent = text.slice(overlapStart, overlapEnd);
    const after = text.slice(overlapEnd);
    if (before !== '') parent.insertBefore(document.createTextNode(before), node);
    parent.insertBefore(mark, node);
    if (after !== '') parent.insertBefore(document.createTextNode(after), node);
    parent.removeChild(node);
  }
}
