import type { Location } from './location';

/** A user-named provider-neutral favourite location. */
export interface FavouriteLocation {
  readonly label: string;
  readonly location: Location;
}

/** Versioned application-wide settings returned by both backend transports. */
export interface Settings {
  readonly schemaVersion: number;
  readonly theme: 'auto' | 'light' | 'dark';
  readonly language: 'en' | 'nl';
  readonly fontSize: number;
  readonly rowHeight: number;
  readonly dateFormat: 'short' | 'medium' | 'iso';
  readonly sizeFormat: 'binary' | 'decimal' | 'bytes';
  readonly showHiddenFiles: boolean;
  readonly confirmPermanentDelete: boolean;
  readonly defaultConflictPolicy: 'ask' | 'overwrite' | 'keepBoth' | 'skip';
  readonly operationConcurrency: number;
  readonly defaultPaneLayout: 'dual' | 'single';
  readonly defaultColumns: readonly string[];
  readonly keybindings: Readonly<Record<string, string>>;
  readonly enabledPlugins: readonly string[];
  readonly pluginSettings: Readonly<Record<string, unknown>>;
  readonly terminalCommand: string | null;
  readonly editorCommand: string | null;
  readonly defaultStartLocations: readonly string[];
  readonly favouriteLocations: readonly FavouriteLocation[];
  readonly recentLocationsByWorkspace: Readonly<Record<string, readonly Location[]>>;
  readonly iconTheme: string;
}
