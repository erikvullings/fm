# Plugin API reference

Plugins declare a versioned `plugin.toml`. API version `1` supports only action contributions
(which also supply context-menu and command-palette entries), custom columns, and metadata
extraction. Plugins cannot inject JavaScript or arbitrary WebView UI.

```toml
id = "example.copy-path"
name = "Copy Path"
version = "0.1.0"
api_version = "1"
description = "Copies a selected path"
entrypoint = "plugin.lua"

[permissions]
selected_entry_metadata = true
clipboard_write = true

[contributions]
actions = true
```

Every permission defaults to denied. The explicit keys are `selected_entry_metadata`,
`selected_entry_content_read`, `filesystem_read` (root list), `filesystem_write` (root list),
`clipboard_read`, `clipboard_write`, `network` (host allow-list), `process_spawn`,
`notifications`, and `settings_storage`. Unknown keys and unsupported `api_version` values reject
the manifest. Discovery leaves invalid manifests disabled and returns their diagnostic through the
plugin listing rather than preventing startup.

The initial runtime is restricted Lua. Wasmtime plus the WebAssembly Component Model remains the
distributable target; no native Rust dynamic-library ABI is exposed. See ADR
[0006](../decisions/0006-plugin-runtime-selection.md).

## Lua entrypoint contract and isolation

An entrypoint returns a Lua table. When `contributions.actions = true`, its `actions` field must be
a function returning an array of `{ id, title, description }` action tables. An action table may
also set `requires_single_selection = true` to advertise that it only makes sense when exactly one
entry is selected; the host derives the action's context requirements from this flag and
re-validates them server-side before invoking the action, so the command palette and context menu
disable/hide the action automatically when the requirement is not met. Enabled contributions are
automatically exposed through the shared action registry, so the command palette and context
menus receive them through their normal registry refresh.

### Invoking actions: the `invoke` contract

When an action fires, the host calls the entrypoint's `invoke(action_id)` function with the
action's id as its sole argument. Two host calls are available while `invoke` runs, both
permission-gated:

- `host.selected_entry_metadata()` returns the caller-supplied selection as an array of
  `{ name, uri }` tables (requires the `selected_entry_metadata` permission). The caller already
  knows the current selection's name and file URI (from pane state), so this is the data it passed
  in when invoking the action — the host does not resolve an opaque entry id back to metadata.
- `host.clipboard_write(text)` stages `text` for the host to copy to the clipboard (requires the
  `clipboard_write` permission). The actual OS/browser clipboard write is the caller's
  responsibility (the backend cannot write to a browser client's clipboard); the host publishes a
  success notification and returns `text` as `clipboardText` on the action result so the caller
  can perform it. Calling this without the permission fails visibly with a `PermissionDenied`
  error instead of silently no-op'ing.

The sample plugin `plugins/sample-copy-markdown-path/` implements this contract: it declares
`sample.copyMarkdownPath` with `requires_single_selection = true`, then builds a Markdown link
`[name](uri)` from the selection, Markdown-escaping the name and percent-encoding the URI, before
calling `host.clipboard_write`.

Each call creates a fresh Lua state with only table, string, math, and UTF-8 libraries. `io`,
`os`, `package`, `debug`, process launch, filesystem and network APIs are absent. The optional
`host.selected_entry_metadata()` call is explicitly permission-checked. Calls are bounded by a
100 ms timeout, 100,000 instruction budget, and 4 MiB Lua memory limit. Failures are logged under
the plugin id, create a non-blocking warning notification, and cannot crash the host. Three
consecutive failures auto-disable a plugin; enabling it again clears that automatic disablement.
The runtime keeps the newest 100 diagnostics per plugin for the diagnostics view.

When `contributions.columns = true`, the entrypoint's `columns` field must be a
function returning `{ id, title }` declarations. Column declarations are data only;
the host owns rendering and maps the `sample.fileAge` sample to its compact age
formatter and raw modification-timestamp sort key. This uses no per-row filesystem
calls. A failed or timed-out column declaration is omitted from the plugin listing,
so its table cells remain empty and the directory table continues working.
