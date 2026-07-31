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
