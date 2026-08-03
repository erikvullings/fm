import m from 'mithril';

/** Common attributes accepted by every icon helper below. */
export interface IconAttrs {
  readonly size?: number;
  readonly className?: string;
}

function icon(viewBox: string, path: string, extraClass: string, attrs: IconAttrs | undefined) {
  const size = attrs?.size ?? 16;
  return m(
    `svg.fm-icon.${extraClass}${attrs?.className === undefined ? '' : `.${attrs.className}`}`,
    {
      'aria-hidden': 'true',
      viewBox,
      width: size,
      height: size,
    },
    m('path', { d: path, fill: 'currentColor' }),
  );
}

/** Material Design "edit" (pencil) glyph, for edit/rename affordances. */
export function editIcon(attrs?: IconAttrs) {
  return icon(
    '0 0 24 24',
    'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25ZM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82Z',
    'fm-icon-edit',
    attrs,
  );
}

/** Generic folder glyph, for directory entries. */
export function folderIcon(attrs?: IconAttrs) {
  return icon(
    '0 0 24 24',
    'M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2Z',
    'fm-icon-folder',
    attrs,
  );
}

/** Generic document glyph, for file entries. */
export function fileIcon(attrs?: IconAttrs) {
  return icon(
    '0 0 24 24',
    'M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6Zm7 1.5L18.5 9H14a1 1 0 0 1-1-1V3.5Z',
    'fm-icon-file',
    attrs,
  );
}

/** Symlink glyph (a document with a directional arrow), for symbolic links. */
export function symlinkIcon(attrs?: IconAttrs) {
  return icon(
    '0 0 24 24',
    'M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6Zm7 1.5L18.5 9H14a1 1 0 0 1-1-1V3.5ZM8.15 12.5h4.1v-1.65a.35.35 0 0 1 .6-.25l2.55 2.55a.35.35 0 0 1 0 .5l-2.55 2.55a.35.35 0 0 1-.6-.25V14.4h-4.1a.4.4 0 0 1-.4-.4v-1.1a.4.4 0 0 1 .4-.4Z',
    'fm-icon-symlink',
    attrs,
  );
}
