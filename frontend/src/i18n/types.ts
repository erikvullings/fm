/** A supported locale identifier (task 0098). */
export type Locale = 'en' | 'nl';

/** All supported locales, in the order they appear in the settings selector. */
export const LOCALES: readonly Locale[] = ['en', 'nl'];

/** The default and fallback locale. */
export const DEFAULT_LOCALE: Locale = 'en';

/** A single translation value: plain text, or a plural map with an `n` fallback. */
export type Entry = string | PluralEntry;

/** A count-dependent value: exact counts (0, 1, 2, …) plus an `n` fallback. */
export interface PluralEntry {
  readonly n: string;
  readonly [count: number]: string | undefined;
}

/**
 * The catalogue shape shared by every locale file. Every key that exists in
 * `EnglishCatalogue` must exist in every other locale catalogue (checked by
 * `src/i18n/i18n.test.ts`), and the typing of `t` is anchored to this shape.
 */
export interface EnglishCatalogue {
  /** Generic buttons and actions shared across surfaces. */
  button: Record<string, string>;

  /** Application shell, status bar, connection status, load states. */
  shell: Record<string, Entry>;

  /** Pane chrome: breadcrumbs, tabs, favourites. */
  pane: Record<string, Entry>;

  /** Localised titles for core action ids (core.* descriptors are English protocol values). */
  action: Record<string, string>;

  /** Settings editor. */
  settings: Record<string, Entry>;

  /** Operation centre, conflict dialog, creation dialogs. */
  operation: Record<string, Entry>;

  /** File viewer and content previews. */
  viewer: Record<string, Entry>;

  /** Common empty, error and warning states. */
  state: Record<string, Entry>;
}

/** A fully resolved catalogue for one locale. */
export type Catalogue = EnglishCatalogue;

/** Placeholder parameters for a single translation call. */
export type Params = Record<string, string | number>;

/**
 * A `translate.js` translator bound to one catalogue.
 *
 * Overloads ordered so the most specific (number/count) is checked first.
 */
export interface Translator {
  /** Lookup: `t('group', 'subKey', { params })` */
  (key: keyof EnglishCatalogue, subKey: string, params?: Params): string;
  /** Pluralisation: `t('group', 'pluralKey', count)` */
  (key: keyof EnglishCatalogue, subKey: string, count: number): string;
  /** Simple: `t('group', 'subKey')` */
  (key: keyof EnglishCatalogue, subKey: string): string;
  /** Lookup: `t('group', { params })` */
  (key: keyof EnglishCatalogue, params?: Params): string;
  /** VDOM-safe array output for interpolating vnodes. */
  arr(key: keyof EnglishCatalogue, subKey: string, params?: Params): unknown[];
  arr(key: keyof EnglishCatalogue, subKey: string, count: number): unknown[];
  arr(key: keyof EnglishCatalogue, subKey: string): unknown[];
  arr(key: keyof EnglishCatalogue, params?: Params): unknown[];
}
