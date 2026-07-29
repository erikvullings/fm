/// <reference types="vite/client" />

/**
 * Build-time configuration injected by Vite.
 *
 * `VITE_RUNTIME` selects the transport the frontend talks to. It is validated
 * by `resolveRuntimeKind` and consumed by the client factory in task 0011.
 */
interface ImportMetaEnv {
  readonly VITE_RUNTIME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
