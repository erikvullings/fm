/** A cumulative, clickable part of a filesystem path. */
export interface BreadcrumbSegment {
  readonly label: string;
  readonly path: string;
}

function posixSegments(path: string): readonly BreadcrumbSegment[] {
  if (path === '/') {
    return [{ label: '/', path: '/' }];
  }
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === '~') {
    return parts.map((label, index) => ({
      label,
      path: index === 0 ? '~' : `~/${parts.slice(1, index + 1).join('/')}`,
    }));
  }
  return [
    { label: '/', path: '/' },
    ...parts.map((label, index) => ({
      label,
      path: `/${parts.slice(0, index + 1).join('/')}`,
    })),
  ];
}

function windowsSegments(path: string): readonly BreadcrumbSegment[] {
  const separator = '\\';
  const parts = path.split(separator).filter(Boolean);
  if (path.startsWith('\\\\') && parts.length >= 2) {
    const root = `\\\\${parts[0]}\\${parts[1]}`;
    return [
      { label: root, path: root },
      ...parts.slice(2).map((label, index) => ({
        label,
        path: `${root}\\${parts.slice(2, index + 3).join('\\')}`,
      })),
    ];
  }
  const root = parts[0] ?? path;
  return [
    { label: root, path: root.endsWith(':') ? `${root}\\` : root },
    ...parts.slice(1).map((label, index) => ({
      label,
      path: `${root}\\${parts.slice(1, index + 2).join('\\')}`,
    })),
  ];
}

/** Produces cumulative breadcrumb targets for POSIX, drive-letter and UNC paths. */
export function breadcrumbSegments(path: string): readonly BreadcrumbSegment[] {
  return path.includes('\\') ? windowsSegments(path) : posixSegments(path);
}

/** Non-navigable, display-only breadcrumb for a `search://<providerId>/<searchId>` location,
 * e.g. `/ > search > local > *.svg` — falls back to the raw search id when the originating query
 * text isn't known. */
export function searchBreadcrumbSegments(
  uri: string,
  query: string | undefined,
): readonly BreadcrumbSegment[] {
  const withoutScheme = uri.slice('search://'.length);
  const separatorIndex = withoutScheme.indexOf('/');
  const providerId =
    separatorIndex === -1 ? withoutScheme : withoutScheme.slice(0, separatorIndex);
  const searchId = separatorIndex === -1 ? '' : withoutScheme.slice(separatorIndex + 1);
  return [
    { label: '/', path: '/' },
    { label: 'search', path: 'search' },
    { label: providerId, path: providerId },
    { label: query ?? searchId, path: query ?? searchId },
  ];
}
