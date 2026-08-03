import m from 'mithril';
import type { IconAttrs } from '../components/icons';
import {
  createDefaultEntryIconRegistry,
  type EntryIconRegistry,
  type EntryIconRenderer,
  entryIconRegistry,
} from '../features/directory-table/entry-icons';

/**
 * Catppuccin (Mocha flavor) directory-entry icon theme (task 0092).
 *
 * Vendored from https://github.com/catppuccin/vscode-icons (MIT licensed, Copyright (c) 2023
 * Catppuccin, Copyright (c) 2023 thang-nm — see that repository's LICENSE file for the full
 * text) — a curated subset of the `icons/mocha/*.svg` sources, reproduced verbatim below rather
 * than imported as an asset, since the upstream project distributes them as a VS Code extension,
 * not an npm package.
 */

/** Builds an `EntryIconRenderer` from one vendored icon's inner SVG markup (`<path>`/`<g>`). */
function trustedIcon(innerMarkup: string, extraClass: string): EntryIconRenderer {
  return (attrs?: IconAttrs): m.Children => {
    const size = attrs?.size ?? 16;
    return m(
      `svg.fm-icon.fm-icon-catppuccin.${extraClass}${
        attrs?.className === undefined ? '' : `.${attrs.className}`
      }`,
      {
        'aria-hidden': 'true',
        viewBox: '0 0 16 16',
        width: size,
        height: size,
      },
      // Safe: `innerMarkup` is a hardcoded constant vendored at build time, never user input.
      m.trust(innerMarkup),
    );
  };
}

const folderIcon = trustedIcon(
  '<path fill="none" stroke="#cdd6f4" stroke-linecap="round" stroke-linejoin="round" d="M4.5 4.5H12c.83 0 1.5.67 1.5 1.5v6c0 .83-.67 1.5-1.5 1.5H2A1.5 1.5 0 01.5 12V3.5a1 1 0 011-1h5a1 1 0 011 1v1" />',
  'fm-icon-folder',
);
const fileIcon = trustedIcon(
  '<path fill="none" stroke="#cdd6f4" stroke-linecap="round" stroke-linejoin="round" d="M13.5 6.5v6a2 2 0 01-2 2h-7a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h4.01m-.01 0 5 5h-4a1 1 0 01-1-1z" />',
  'fm-icon-file',
);
const symlinkIcon = trustedIcon(
  '<path fill="none" stroke="#cdd6f4" stroke-linecap="round" stroke-linejoin="round" d="m 15.5,6.5 v 6 c 0,1.104569 -0.895431,2 -2,2 h -7 c -1.1045695,0 -2,-0.895431 -2,-2 m 0,-9 c 0,-1.1 0.9,-2 2,-2 h 4.01 m -0.01,0 5,5 h -4 c -0.552285,0 -1,-0.4477153 -1,-1 z" />' +
    '<path fill="none" stroke="#7f849c" stroke-linecap="round" stroke-linejoin="round" d="M 0.49999899,14.503201 V 10.788914 C 0.49999818,9.2504047 1.675251,8.0031963 3.124999,8.0031963 H 7" />' +
    '<path fill="none" stroke="#7f849c" stroke-linecap="round" stroke-linejoin="round" d="m 4.499999,10.500001 2.625,-2.5000018 -2.625,-2.5000002" />',
  'fm-icon-symlink',
);
const typescriptIcon = trustedIcon(
  '<g fill="none" stroke="#89b4fa" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 1.5h8A2.5 2.5 0 0114.5 4v8a2.5 2.5 0 01-2.5 2.5H4A2.5 2.5 0 011.5 12V4A2.5 2.5 0 014 1.5" />' +
    '<path d="M12.5 8.75c0-.69-.54-1.25-1.2-1.25h-.6c-.66 0-1.2.56-1.2 1.25S10.04 10 10.7 10h.6c.66 0 1.2.56 1.2 1.25s-.54 1.25-1.2 1.25h-.6c-.66 0-1.2-.56-1.2-1.25m-3-3.75v5M5 7.5h3" />' +
    '</g>',
  'fm-icon-typescript',
);
const typescriptReactIcon = trustedIcon(
  '<g fill="none" stroke="#89b4fa" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M8 11.3c4.14 0 7.5-1.28 7.5-2.86S12.14 5.58 8 5.58.5 6.86.5 8.44s3.36 2.87 7.5 2.87Z" />' +
    '<path d="M5.52 9.87c2.07 3.6 4.86 5.86 6.23 5.07 1.37-.8.8-4.34-1.27-7.93S5.62 1.16 4.25 1.95s-.8 4.34 1.27 7.92" />' +
    '<path d="M5.52 7.01c-2.07 3.59-2.64 7.14-1.27 7.93s4.16-1.48 6.23-5.07c2.07-3.58 2.64-7.13 1.27-7.92-1.37-.8-4.16 1.47-6.23 5.06" />' +
    '<path d="M8.5 8.44a.5.5 0 01-.5.5.5.5 0 01-.5-.5.5.5 0 01.5-.5.5.5 0 01.5.5" />' +
    '</g>',
  'fm-icon-typescript-react',
);
const javascriptIcon = trustedIcon(
  '<g fill="none" stroke="#f9e2af" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4.5 11c0 .828427.6715729 1.5 1.5 1.5.8284271 0 1.5-.671573 1.5-1.5V7.5M12.5 8.75C12.5 8.05964406 11.9627417 7.5 11.3 7.5L10.7 7.5C10.0372583 7.5 9.5 8.05964406 9.5 8.75 9.5 9.44035594 10.0372583 10 10.7 10L11.3 10C11.9627417 10 12.5 10.5596441 12.5 11.25 12.5 11.9403559 11.9627417 12.5 11.3 12.5L10.7 12.5C10.0372583 12.5 9.5 11.9403559 9.5 11.25" />' +
    '<path d="m 4,1.5 h 8 c 1.385,0 2.5,1.115 2.5,2.5 v 8 c 0,1.385 -1.115,2.5 -2.5,2.5 H 4 C 2.615,14.5 1.5,13.385 1.5,12 V 4 C 1.5,2.615 2.615,1.5 4,1.5 Z" />' +
    '</g>',
  'fm-icon-javascript',
);
const javascriptReactIcon = trustedIcon(
  '<g fill="none" stroke="#89dceb" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M8 10.8c4.14 0 7.5-1.25 7.5-2.8S12.14 5.2 8 5.2.5 6.45.5 8s3.36 2.8 7.5 2.8" />' +
    '<path d="M5.52 9.4c2.07 3.5 4.86 5.72 6.23 4.95 1.37-.78.8-4.24-1.27-7.75C8.41 3.1 5.62.88 4.25 1.65c-1.37.78-.8 4.24 1.27 7.75" />' +
    '<path d="M5.52 6.6c-2.07 3.5-2.64 6.97-1.27 7.75 1.37.77 4.16-1.45 6.23-4.95s2.64-6.97 1.27-7.75C10.38.88 7.59 3.1 5.52 6.6" />' +
    '<path d="M8.5 8a.5.5 0 01-.5.5.5.5 0 01-.5-.5.5.5 0 01.5-.5.5.5 0 01.5.5" />' +
    '</g>',
  'fm-icon-javascript-react',
);
const jsonIcon = trustedIcon(
  '<path fill="none" stroke="#f9e2af" stroke-linecap="round" stroke-linejoin="round" d="M4.5 2.5H4c-.75 0-1.5.75-1.5 1.5v2c0 1.1-1 2-1.83 2 .83 0 1.83.9 1.83 2v2c0 .75.75 1.5 1.5 1.5h.5m7-11h.5c.75 0 1.5.75 1.5 1.5v2c0 1.1 1 2 1.83 2-.83 0-1.83.9-1.83 2v2c0 .74-.75 1.5-1.5 1.5h-.5m-6.5-3a.5.5 0 100-1 .5.5 0 000 1m3 0a.5.5 0 100-1 .5.5 0 000 1m3 0a.5.5 0 100-1 .5.5 0 000 1" />',
  'fm-icon-json',
);
const markdownIcon = trustedIcon(
  '<path fill="none" stroke="#74c7ec" stroke-linecap="round" stroke-linejoin="round" d="m9.25 8.25 2.25 2.25 2.25-2.25M3.5 11V5.5l2.04 3 1.96-3V11m4-.5V5M1.65 2.5h12.7c.59 0 1.15.49 1.15 1v9c0 .51-.56 1-1.15 1H1.65c-.59 0-1.15-.49-1.15-1V3.58c0-.5.56-1.08 1.15-1.08" />',
  'fm-icon-markdown',
);
const htmlIcon = trustedIcon(
  '<g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    '<path stroke="#fab387" d="M1.5 1.5h13L13 13l-5 2-5-2z" />' +
    '<path stroke="#cdd6f4" d="M11 4.5H5l.25 3h5.5l-.25 3-2.5 1-2.5-1-.08-1" />' +
    '</g>',
  'fm-icon-html',
);
const cssIcon = trustedIcon(
  '<g fill="none" stroke="#cba6f7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="m4 1.5h8c1.38 0 2.5 1.12 2.5 2.5v8c0 1.38-1.12 2.5-2.5 2.5h-8c-1.38 0-2.5-1.12-2.5-2.5v-8c0-1.38 1.12-2.5 2.5-2.5z" />' +
    '<path stroke-width=".814" d="m 10.240861,11.529149 c 0,0.58011 0.437448,1.039154 0.96002,1.035371 l 0.451635,-0.0032 c 0.522572,-0.0036 0.949379,-0.451477 0.949379,-1.032848 0,-0.581372 -0.426807,-1.065638 -0.949379,-1.065638 l -0.451635,3.4e-5 c -0.522572,3.9e-5 -0.949379,-0.4855273 -0.949379,-1.0656374 0,-0.5801104 0.426807,-1.0378931 0.949379,-1.0378931 l 0.451635,2.825e-4 c 0.522572,3.267e-4 0.951743,0.4577827 0.951743,1.0378931 M 6.8003972,11.529149 c 0,0.58011 0.4374474,1.039154 0.9600196,1.035371 l 0.46464,-0.0032 c 0.5225722,-0.0035 0.9363738,-0.451477 0.9363738,-1.031587 0,-0.580111 -0.4090724,-1.065638 -0.9316446,-1.065638 l -0.4693692,3.4e-5 c -0.5225722,3.8e-5 -0.949379,-0.4855272 -0.949379,-1.0656373 0,-0.5801104 0.4268068,-1.0378931 0.949379,-1.0378931 h 0.4516348 c 0.5225722,0 0.9635665,0.4577827 0.9635665,1.0378931 M 3.4072246,11.529149 c 0,0.58011 0.4374474,1.051765 0.9600196,1.051765 H 4.818879 c 0.5225722,0 0.949379,-0.456521 0.949379,-1.037893 m 0.01129,-2.1312747 c 0,-0.5801103 -0.4374474,-1.037893 -0.9600196,-1.037893 L 4.3678939,8.3741358 C 3.8453217,8.3744624 3.4078743,8.8420074 3.4078743,9.4233788 v 2.1186642" />' +
    '</g>',
  'fm-icon-css',
);
const yamlIcon = trustedIcon(
  '<path fill="none" stroke="#f38ba8" stroke-linecap="round" stroke-linejoin="round" d="M2.5 1.5h3l3 4 3-4h3l-9 13h-3L7 8z" />',
  'fm-icon-yaml',
);
const tomlIcon = trustedIcon(
  '<path fill="none" stroke="#eba0ac" stroke-linecap="round" stroke-linejoin="round" d="M3.5 1.5h-2v13h2m9-13h2v13h-2m-8-11h7v3h-2v6h-3v-6h-2z" />',
  'fm-icon-toml',
);
const rustIcon = trustedIcon(
  '<g fill="none" stroke="#fab387" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M15.5 9.5Q8 13.505.5 9.5l1-1-1-2 2-.5V4.5h2l.5-2 1.5 1 1.5-2 1.5 2 1.5-1 .5 2h2V6l2 .5-1 2z" />' +
    '<path d="M6.5 7.5a1 1 0 01-1 1 1 1 0 01-1-1 1 1 0 011-1 1 1 0 011 1m5 0a1 1 0 01-1 1 1 1 0 01-1-1 1 1 0 011-1 1 1 0 011 1M4 11.02c-.67.37-1.5.98-1.5 2.23s1.22 1.22 2 1.25v-2M12 11c.67.37 1.5 1 1.5 2.25s-1.22 1.22-2 1.25v-2" />' +
    '</g>',
  'fm-icon-rust',
);
const pythonIcon = trustedIcon(
  '<g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    '<path stroke="#89b4fa" d="M8.5 5.5h-3m6 0V3c0-.8-.7-1.5-1.5-1.5H7c-.8 0-1.5.7-1.5 1.5v2.5H3c-.8 0-1.5.7-1.5 1.5v2c0 .8.7 1.5 1.48 1.5" />' +
    '<path stroke="#f9e2af" d="M10.5 10.5h-3m-3 0V13c0 .8.7 1.5 1.5 1.5h3c.8 0 1.5-.7 1.5-1.5v-2.5H13c.8 0 1.5-.7 1.5-1.5V7c0-.8-.7-1.5-1.48-1.5H11.5c0 1.5 0 2-1 2h-2" />' +
    '<path stroke="#89b4fa" d="M2.98 10.5H4.5c0-1.5 0-2 1-2h2M7.5 3.5v0" />' +
    '<path stroke="#f9e2af" d="m 8.5,12.5 v 0" />' +
    '</g>',
  'fm-icon-python',
);
const xmlIcon = trustedIcon(
  '<path fill="none" stroke="#fab387" stroke-linecap="round" stroke-linejoin="round" d="M4.5 4.5 1 8 4.5 11.5M11.5 4.5 15 8 11.5 11.5M9.5 2 6.5 14" />',
  'fm-icon-xml',
);
const csvIcon = trustedIcon(
  '<path fill="none" stroke="#a6e3a1" stroke-linecap="round" stroke-linejoin="round" d="M1.5 3.5c0-.54.48-1 1.08-1H6.5l1.54 1h5.38c.6 0 1.08.44 1.08.98l-.09 9.04c0 .54-.48.98-1.08.98H2.58c-.6 0-1.08-.44-1.08-.98zm2 4v4m3-4v4m3-4v4m3-4v4m-9 0h9m-9-2h9m-9-2h9" />',
  'fm-icon-csv',
);
const gitIcon = trustedIcon(
  '<g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    '<path stroke="#cdd6f4" d="M8.5 10.5a1 1 0 01-1 1 1 1 0 01-1-1 1 1 0 011-1 1 1 0 011 1m0-6a1 1 0 01-1 1 1 1 0 01-1-1 1 1 0 011-1 1 1 0 011 1m3 3a1 1 0 01-1 1 1 1 0 01-1-1 1 1 0 011-1 1 1 0 011 1m-4-2v4m-1-6-1-1m4 4-1-1" />' +
    '<path stroke="#fab387" d="m9.06 1.06 5.88 5.88a1.5 1.5 0 010 2.12l-5.88 5.88a1.5 1.5 0 01-2.12 0L1.06 9.06a1.5 1.5 0 010-2.12l5.88-5.88a1.5 1.5 0 012.12 0" />' +
    '</g>',
  'fm-icon-git',
);
const lockIcon = trustedIcon(
  '<path fill="none" stroke="#7f849c" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.744" d="m12.36 7.104c0.4817 0 0.8722 0.3903 0.8722 0.8717v5.23c0 0.4814-0.3905 0.8717-0.8722 0.8717h-8.721c-0.4817 0-0.8722-0.3903-0.8722-0.8717v-5.23c0-0.4814 0.3905-0.8717 0.8722-0.8717zm-6.977 0v-2.616c0-1.445 1.172-2.616 2.617-2.616 1.445 0 2.617 1.171 2.617 2.616v2.616" />',
  'fm-icon-lock',
);
const logIcon = trustedIcon(
  '<g fill="none" stroke="#cdd6f4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4.5 3.5h9v11h-9z" />' +
    '<path d="M11.5 3.45V1.5h-9v11h1.95m3.05-5h3m-3 3h3" />' +
    '</g>',
  'fm-icon-log',
);
const fontIcon = trustedIcon(
  '<path fill="none" stroke="#f2cdcd" stroke-linecap="round" stroke-linejoin="round" d="m7 5 4 8.5h2.5L8 2.5l-4.5 11m-1 0h2m5 0h5m-9-4H9" />',
  'fm-icon-font',
);
const imageIcon = trustedIcon(
  '<g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
    '<path stroke="#f9e2af" d="M11.5 6A1.5 1.5 0 0110 7.5 1.5 1.5 0 018.5 6 1.5 1.5 0 0110 4.5 1.5 1.5 0 0111.5 6" />' +
    '<path stroke="#a6e3a1" d="M7.5 13.5 11 10c.5-.5 1.5-.5 2 0l1.5 1.5" />' +
    '<path stroke="#a6e3a1" d="m1.5 9.5 2-2C4 7 5 7 5.5 7.5l4 4" />' +
    '<path stroke="#74c7ec" d="M3 2.5h10c.83 0 1.5.67 1.5 1.5v8c0 .83-.67 1.5-1.5 1.5H3A1.5 1.5 0 011.5 12V4c0-.83.67-1.5 1.5-1.5" />' +
    '</g>',
  'fm-icon-image',
);
const audioIcon = trustedIcon(
  '<g fill="none" stroke="#eba0ac" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M5.5 12.5a2 2 0 01-2 2 2 2 0 01-2-2 2 2 0 012-2 2 2 0 012 2m9-2a2 2 0 01-2 2 2 2 0 01-2-2 2 2 0 012-2 2 2 0 012 2" />' +
    '<path d="M5.5 12.5V5c0-.54.44-1.21 1.35-1.5l6.3-2c.9 0 1.35.88 1.35 1.5v7.58m-9-3.08 9-3" />' +
    '</g>',
  'fm-icon-audio',
);
const videoIcon = trustedIcon(
  '<g fill="none" stroke="#74c7ec" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M3 2.5h10c.83 0 1.5.67 1.5 1.5v9c0 .83-.67 1.5-1.5 1.5H3A1.5 1.5 0 011.5 13V4c0-.83.67-1.5 1.5-1.5m-1.5 3h13" />' +
    '<path d="m3.5 5.5 2-3m1.5 3 2-3m1.5 3 2-3M6.5 8v4l4-2z" />' +
    '</g>',
  'fm-icon-video',
);
const pdfIcon = trustedIcon(
  '<path fill="none" stroke="#f38ba8" stroke-linecap="round" stroke-linejoin="round" d="M2.8 14.34c1.81-1.25 3.02-3.16 3.91-5.5.9-2.33 1.86-4.33 1.44-6.63-.06-.36-.57-.73-.83-.7-1.02.06-.95 1.21-.85 1.9.24 1.71 1.56 3.7 2.84 5.56 1.27 1.87 2.32 2.16 3.78 2.26.5.03 1.25-.14 1.37-.58.77-2.8-9.02-.54-12.28 2.08-.4.33-.86 1-.6 1.46.2.36.87.4 1.23.15h0Z" />',
  'fm-icon-pdf',
);
const zipIcon = trustedIcon(
  '<path fill="none" stroke="#cdd6f4" stroke-linejoin="round" d="m5.5 10v1m1-2v1m-1-2v1m1-2v1m-1-2v1m1-2v1m-1-2v1m0-3v1m1 0v1m7 2.5v6c0 1.105-0.8954 2-2 2h-7c-1.105 0-2-0.8954-2-2v-9c0-1.1 0.9-2 2-2h4.01m-0.01 0 5 5h-4c-0.5523 0-1-0.4477-1-1z" />',
  'fm-icon-zip',
);
const textIcon = trustedIcon(
  '<g fill="none" stroke="#cdd6f4" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M13.5 6.5v6a2 2 0 01-2 2h-7a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h4.01" />' +
    '<path d="m8.5 1.5 5 5h-4a1 1 0 01-1-1zm-3 10h5m-5-3h5m-5-3h1" />' +
    '</g>',
  'fm-icon-text',
);

const EXTENSION_ICONS: Readonly<Record<string, EntryIconRenderer>> = {
  ts: typescriptIcon,
  mts: typescriptIcon,
  cts: typescriptIcon,
  tsx: typescriptReactIcon,
  js: javascriptIcon,
  mjs: javascriptIcon,
  cjs: javascriptIcon,
  jsx: javascriptReactIcon,
  json: jsonIcon,
  jsonc: jsonIcon,
  md: markdownIcon,
  markdown: markdownIcon,
  html: htmlIcon,
  htm: htmlIcon,
  css: cssIcon,
  yaml: yamlIcon,
  yml: yamlIcon,
  toml: tomlIcon,
  rs: rustIcon,
  py: pythonIcon,
  pyw: pythonIcon,
  xml: xmlIcon,
  csv: csvIcon,
  gitignore: gitIcon,
  gitattributes: gitIcon,
  gitmodules: gitIcon,
  gitconfig: gitIcon,
  lock: lockIcon,
  log: logIcon,
  ttf: fontIcon,
  otf: fontIcon,
  woff: fontIcon,
  woff2: fontIcon,
  txt: textIcon,
};

const MIME_PREFIX_ICONS: Readonly<Record<string, EntryIconRenderer>> = {
  'image/': imageIcon,
  'audio/': audioIcon,
  'video/': videoIcon,
  'application/pdf': pdfIcon,
  'application/zip': zipIcon,
};

/** Overwrites `registry`'s maps with the Catppuccin theme (default: the shared singleton). */
export function installCatppuccinIconTheme(registry: EntryIconRegistry = entryIconRegistry): void {
  registry.kindIcons.set('directory', folderIcon);
  registry.kindIcons.set('symlink', symlinkIcon);
  registry.kindIcons.set('file', fileIcon);
  for (const [extension, renderer] of Object.entries(EXTENSION_ICONS)) {
    registry.extensionIcons.set(extension, renderer);
  }
  for (const [prefix, renderer] of Object.entries(MIME_PREFIX_ICONS)) {
    registry.mimePrefixIcons.set(prefix, renderer);
  }
}

/** Restores `registry` to the built-in generic icon set (undoes {@link installCatppuccinIconTheme}). */
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
  registry.mimePrefixIcons.clear();
  for (const [prefix, renderer] of defaults.mimePrefixIcons) {
    registry.mimePrefixIcons.set(prefix, renderer);
  }
}
