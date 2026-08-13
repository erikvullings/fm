import type m from 'mithril';
import {
  archiveIcon,
  audioIcon,
  fileIcon,
  folderIcon,
  type IconAttrs,
  imageIcon,
  pdfIcon,
  symlinkIcon,
  videoIcon,
} from '../../components/icons';
import type { EntryKind, EntrySummary } from '../../models';

/** Renders an icon for a resolved entry kind/extension; same shape as the `icons.ts` helpers. */
export type EntryIconRenderer = (attrs?: IconAttrs) => m.Children;

/**
 * Themeable icon-resolution registry (task 0085).
 *
 * A theme or plugin package can import {@link entryIconRegistry} directly
 * and mutate its maps (`.set` to add/replace, `.delete` to remove) to
 * customize the directory table's glyphs without editing `directory-table.ts`.
 */
export interface EntryIconRegistry {
  /** Icon for `directory`/`symlink`/`file` entries, before any extension/MIME match. */
  readonly kindIcons: Map<EntryKind, EntryIconRenderer>;
  /** Icon for `file` entries, keyed by lowercased extension without the leading dot. */
  readonly extensionIcons: Map<string, EntryIconRenderer>;
  /** Icon for `file` entries, keyed by exact file name, matched before {@link extensionIcons}. */
  readonly fileNameIcons: Map<string, EntryIconRenderer>;
  /** Icon for `file` entries with no extension match, keyed by a MIME type prefix (e.g. `image/`). */
  readonly mimePrefixIcons: Map<string, EntryIconRenderer>;
}

/** Extensions rendered as images by the icon registry and the preview/viewer features. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'];
const ARCHIVE_EXTENSIONS = ['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz'];
/** Extensions rendered as audio by the icon registry and the preview/viewer features. */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'];
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'];
const PDF_EXTENSIONS = ['pdf'];

function registerAll(
  map: Map<string, EntryIconRenderer>,
  keys: readonly string[],
  renderer: EntryIconRenderer,
): void {
  for (const key of keys) {
    map.set(key, renderer);
  }
}

/** Builds a fresh, independently mutable copy of the built-in default registry. */
export function createDefaultEntryIconRegistry(): EntryIconRegistry {
  const extensionIcons = new Map<string, EntryIconRenderer>();
  registerAll(extensionIcons, IMAGE_EXTENSIONS, imageIcon);
  registerAll(extensionIcons, ARCHIVE_EXTENSIONS, archiveIcon);
  registerAll(extensionIcons, AUDIO_EXTENSIONS, audioIcon);
  registerAll(extensionIcons, VIDEO_EXTENSIONS, videoIcon);
  registerAll(extensionIcons, PDF_EXTENSIONS, pdfIcon);

  const mimePrefixIcons = new Map<string, EntryIconRenderer>([
    ['image/', imageIcon],
    ['audio/', audioIcon],
    ['video/', videoIcon],
    ['application/pdf', pdfIcon],
    ['application/zip', archiveIcon],
  ]);

  const kindIcons = new Map<EntryKind, EntryIconRenderer>([
    ['directory', folderIcon],
    ['symlink', symlinkIcon],
    ['file', fileIcon],
  ]);

  return {
    kindIcons,
    extensionIcons,
    fileNameIcons: new Map<string, EntryIconRenderer>(),
    mimePrefixIcons,
  };
}

/**
 * The shared icon registry consumed by `directory-table.ts`. This is the
 * hard theme-extension point required by task 0085: replace or extend the
 * built-in icon set by mutating this singleton's maps at startup, e.g.
 * `entryIconRegistry.extensionIcons.set('psd', myPsdIcon)`.
 */
export const entryIconRegistry: EntryIconRegistry = createDefaultEntryIconRegistry();

/** Whether an entry has a more specific themed icon than its kind-level fallback. */
export function hasSpecificEntryIcon(
  entry: EntrySummary,
  registry: EntryIconRegistry = entryIconRegistry,
): boolean {
  const defaultKindRenderer =
    entry.kind === 'directory' ? folderIcon : entry.kind === 'symlink' ? symlinkIcon : fileIcon;
  if ((registry.kindIcons.get(entry.kind) ?? fileIcon) !== defaultKindRenderer) return true;
  if (entry.kind !== 'file') return false;
  if (registry.fileNameIcons.has(entry.name)) return true;
  const extension = entry.extension?.toLowerCase();
  if (extension !== undefined && registry.extensionIcons.has(extension)) return true;
  return (
    entry.mimeType !== undefined &&
    [...registry.mimePrefixIcons.keys()].some((prefix) => entry.mimeType?.startsWith(prefix))
  );
}

/** Restores `registry` to the built-in generic icon set, undoing any installed theme plugin. */
export function restoreDefaultIconTheme(registry: EntryIconRegistry = entryIconRegistry): void {
  const defaults = createDefaultEntryIconRegistry();
  registry.kindIcons.clear();
  for (const [kind, renderer] of defaults.kindIcons) {
    registry.kindIcons.set(kind, renderer);
  }
  registry.extensionIcons.clear();
  for (const [extension, renderer] of defaults.extensionIcons) {
    registry.extensionIcons.set(extension, renderer);
  }
  registry.fileNameIcons.clear();
  registry.mimePrefixIcons.clear();
  for (const [prefix, renderer] of defaults.mimePrefixIcons) {
    registry.mimePrefixIcons.set(prefix, renderer);
  }
}

/** Resolves the icon renderer for `entry` against `registry` (defaults to the shared singleton). */
export function resolveEntryIcon(
  entry: EntrySummary,
  registry: EntryIconRegistry = entryIconRegistry,
): EntryIconRenderer {
  if (entry.kind !== 'file') {
    return registry.kindIcons.get(entry.kind) ?? fileIcon;
  }
  const byFileName = registry.fileNameIcons.get(entry.name);
  if (byFileName !== undefined) {
    return byFileName;
  }
  const extension = entry.extension?.toLowerCase();
  const byExtension = extension === undefined ? undefined : registry.extensionIcons.get(extension);
  if (byExtension !== undefined) {
    return byExtension;
  }
  if (entry.mimeType !== undefined) {
    for (const [prefix, renderer] of registry.mimePrefixIcons) {
      if (entry.mimeType?.startsWith(prefix)) {
        return renderer;
      }
    }
  }
  return registry.kindIcons.get('file') ?? fileIcon;
}

/** Renders the themed icon shown ahead of the entry name in the directory table. */
export function entryIcon(entry: EntrySummary, attrs?: IconAttrs): m.Children {
  return resolveEntryIcon(entry)(attrs);
}
