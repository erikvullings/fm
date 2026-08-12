import m, { type FactoryComponent } from 'mithril';
import {
  FlatButton,
  ModalPanel,
  NumberInput,
  PasswordInput,
  Select,
  Switch,
  TextInput,
  toast,
} from 'mithril-materialized';

import './connection-editor.css';

import type {
  Connection,
  ConnectionConfiguration,
  ConnectionId,
  ConnectionKind,
  ConnectionSecretInput,
  HostKeyPolicy,
  HostKeyProbe,
  SshAuthenticationMethod,
} from '../../models';
import { defaultSshConfiguration } from '../../models/connection';
import {
  type ConnectionSaveDraft,
  type ConnectionSaveResult,
  connectionStatusGlyph,
  connectionStatusLabel,
  validateConnectionDraft,
} from './connections-model';

export interface ConnectionsManagerAttrs {
  readonly open: boolean;
  readonly connections: readonly Connection[];
  /** Reloads the current connection list from the backend on modal open. */
  readonly onRefresh: () => Promise<void>;
  readonly onClose: () => void;
  readonly onSave: (
    draft: ConnectionSaveDraft,
    editingId?: ConnectionId,
  ) => Promise<ConnectionSaveResult>;
  readonly onDelete: (id: ConnectionId) => Promise<void>;
  readonly onConnect: (id: ConnectionId) => Promise<Connection>;
  readonly onDisconnect: (id: ConnectionId) => Promise<Connection>;
  readonly onTest: (id: ConnectionId) => Promise<Connection>;
  /** Probes an SSH connection's presented host key (task 0104, spec §6.4). */
  readonly onProbeHostKey: (id: ConnectionId) => Promise<HostKeyProbe>;
  /** Accepts and persists a host-key fingerprint the user has just confirmed. */
  readonly onAcceptHostKey: (id: ConnectionId, fingerprint: string) => Promise<void>;
}

/**
 * Host/username/secret fields are technical identifiers, not prose: the
 * browser's autocorrect/autocapitalize/spell-check would otherwise silently
 * mangle values like `erik` -> `Erik` or flag `sftp.example.test` as
 * misspelled while the user is typing. `InputAttrs` extends Mithril's
 * `Attributes`, so these pass straight through to the underlying `<input>`.
 */
const TECHNICAL_TEXT_ATTRS = {
  autocomplete: 'off',
  autocapitalize: 'off',
  autocorrect: 'off',
  spellcheck: false,
} as const;

type ViewMode =
  | { readonly kind: 'list' }
  | { readonly kind: 'form'; readonly editingId?: ConnectionId };

interface FormState {
  name: string;
  configuration: ConnectionConfiguration;
  secretPassword: string;
  /** Whether the private-key field below is a filesystem path (the default,
   * matching how `ssh`'s own `IdentityFile` works and read fresh on every
   * dial - see `fm-application`'s `ssh.rs`) or pasted key content. */
  secretKeyMode: 'path' | 'paste';
  secretKeyPath: string;
  secretKey: string;
  secretPassphrase: string;
}

// Plain (non-`readonly`) arrays: `mithril-materialized`'s `Select` requires
// a mutable `InputOption<T>[]`, which a `readonly` array type is not
// assignable to.
function kindOptions(): { id: ConnectionKind; label: string }[] {
  return [
    { id: 'ssh', label: 'SSH' },
    { id: 'ftp', label: 'FTP (insecure)' },
    { id: 'ftps', label: 'FTP over TLS' },
    { id: 'oneDrive', label: 'OneDrive' },
    { id: 'webDav', label: 'WebDAV' },
    { id: 's3', label: 'S3-compatible' },
    { id: 'smb', label: 'SMB' },
  ];
}

function authenticationOptions(): { id: SshAuthenticationMethod; label: string }[] {
  return [
    { id: 'password', label: 'Password' },
    { id: 'privateKey', label: 'Private key' },
    { id: 'agent', label: 'SSH agent' },
  ];
}

function hostKeyPolicyOptions(): { id: HostKeyPolicy; label: string }[] {
  return [
    { id: 'promptOnFirstUse', label: 'Prompt on first use' },
    { id: 'requireKnownHost', label: 'Require already-known host' },
  ];
}

function defaultConfigurationFor(kind: ConnectionKind): ConnectionConfiguration {
  switch (kind) {
    case 'ssh':
      return defaultSshConfiguration();
    case 'ftp':
      return { kind: 'ftp', host: '', port: 21, username: '', startPath: null };
    case 'ftps':
      return { kind: 'ftps', host: '', port: 21, username: '', startPath: null };
    case 'oneDrive':
      return { kind: 'oneDrive', accountHint: null };
    case 'webDav':
      return { kind: 'webDav', baseUrl: '' };
    case 's3':
      return { kind: 's3', bucket: '', region: null, endpoint: null };
    case 'smb':
      return { kind: 'smb', server: '', share: '' };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

function emptyForm(): FormState {
  return {
    name: '',
    configuration: defaultSshConfiguration(),
    secretPassword: '',
    secretKeyMode: 'path',
    secretKeyPath: '',
    secretKey: '',
    secretPassphrase: '',
  };
}

function formFromConnection(connection: Connection): FormState {
  return {
    name: connection.name,
    // Secret fields are always write-only and never pre-filled from a
    // stored connection (task 0103's explicit requirement).
    configuration: connection.configuration,
    secretPassword: '',
    secretKeyMode: 'path',
    secretKeyPath: '',
    secretKey: '',
    secretPassphrase: '',
  };
}

/** Builds the write-only secret input for the current form state, or `undefined` if none was entered. */
function secretInputFrom(form: FormState): ConnectionSecretInput | undefined {
  if (form.configuration.kind === 'ftp' || form.configuration.kind === 'ftps') {
    return form.secretPassword.length === 0
      ? undefined
      : { kind: 'password', password: form.secretPassword };
  }
  if (form.configuration.kind !== 'ssh') return undefined;
  switch (form.configuration.authentication) {
    case 'password':
      return form.secretPassword.length === 0
        ? undefined
        : { kind: 'password', password: form.secretPassword };
    case 'privateKey':
      if (form.secretKeyMode === 'path') {
        return form.secretKeyPath.trim().length === 0
          ? undefined
          : {
              kind: 'privateKeyPath',
              path: form.secretKeyPath.trim(),
              passphrase: form.secretPassphrase.length === 0 ? null : form.secretPassphrase,
            };
      }
      return form.secretKey.length === 0
        ? undefined
        : {
            kind: 'privateKey',
            key: form.secretKey,
            passphrase: form.secretPassphrase.length === 0 ? null : form.secretPassphrase,
          };
    case 'agent':
      return undefined;
    default:
      return undefined;
  }
}

/** Clears secret fields from in-memory form state, e.g. immediately after a successful save. */
function clearSecretFields(form: FormState): void {
  form.secretPassword = '';
  form.secretKeyPath = '';
  form.secretKey = '';
  form.secretPassphrase = '';
}

function statusActionLabel(status: Connection['status']): string {
  return status === 'connected' || status === 'connecting' || status === 'reconnecting'
    ? 'Disconnect'
    : 'Connect';
}

interface HostKeyPrompt {
  readonly connectionId: ConnectionId;
  readonly probe: HostKeyProbe;
  /** Which action to retry automatically once the fingerprint is accepted. */
  readonly retry: 'connect' | 'test';
}

/**
 * TC-style connections manager (task 0103): a flat list of saved
 * connections with a status glyph and Connect/Test/Edit/Delete actions, plus
 * an inline add/edit form. Purely presentational - every mutation is
 * delegated to the `on*` callbacks, which the caller wires to
 * `connections-model.ts` and its own list state (spec §3 rule 1: components
 * depend only on the shared client through callbacks, never call it
 * directly).
 */
export const ConnectionsManager: FactoryComponent<ConnectionsManagerAttrs> = () => {
  let mode: ViewMode = { kind: 'list' };
  let form: FormState = emptyForm();
  let busy = false;
  let error: string | undefined;
  let success: string | undefined;
  let hostKeyPrompt: HostKeyPrompt | undefined;
  let hostKeyBusy = false;
  let wasOpen = false;

  function refreshConnections(attrs: ConnectionsManagerAttrs): void {
    busy = true;
    error = undefined;
    success = undefined;
    attrs.onRefresh().then(
      () => {
        busy = false;
        m.redraw();
      },
      (caught: unknown) => {
        busy = false;
        error = errorMessage(caught, 'Failed to refresh connections.');
        m.redraw();
      },
    );
  }

  function openCreateForm(): void {
    mode = { kind: 'form' };
    form = emptyForm();
    error = undefined;
    success = undefined;
  }

  function openEditForm(connection: Connection): void {
    mode = { kind: 'form', editingId: connection.id };
    form = formFromConnection(connection);
    error = undefined;
    success = undefined;
  }

  function backToList(): void {
    mode = { kind: 'list' };
    error = undefined;
    success = undefined;
  }

  function updateConfiguration(patch: Partial<ConnectionConfiguration>): void {
    form = {
      ...form,
      configuration: { ...form.configuration, ...patch } as ConnectionConfiguration,
    };
  }

  function errorMessage(caught: unknown, fallback: string): string {
    return caught instanceof Error ? caught.message : fallback;
  }

  function handleSave(attrs: ConnectionsManagerAttrs): void {
    if (mode.kind !== 'form') return;
    const validationErrors = validateConnectionDraft(form);
    if (validationErrors.length > 0) {
      error = validationErrors[0]?.message;
      return;
    }
    busy = true;
    error = undefined;
    success = undefined;
    attrs
      .onSave(
        {
          name: form.name,
          configuration: form.configuration,
          secret: secretInputFrom(form) ?? null,
        },
        mode.editingId,
      )
      .then((result) => {
        busy = false;
        if (!result.ok) {
          error = result.message;
        } else {
          clearSecretFields(form);
          backToList();
        }
        m.redraw();
      });
  }

  function handleDelete(attrs: ConnectionsManagerAttrs, connection: Connection): void {
    busy = true;
    success = undefined;
    attrs.onDelete(connection.id).then(
      () => {
        busy = false;
        m.redraw();
      },
      (caught: unknown) => {
        busy = false;
        error = errorMessage(caught, 'Failed to delete the connection.');
        m.redraw();
      },
    );
  }

  /**
   * A `connect`/`test` attempt against a host whose key was never accepted
   * (or has changed) does not throw - it comes back with a distinct
   * `hostKeyUnverified`/`hostKeyMismatch` status instead (spec §6.4's
   * mandatory explicit confirmation, never a silent accept or a silent
   * failure). Detect that here and fetch the fingerprint to show the user,
   * rather than treating the call as having simply "done nothing".
   */
  function checkForPendingHostKeyConfirmation(
    attrs: ConnectionsManagerAttrs,
    updated: Connection,
    retry: 'connect' | 'test',
  ): void {
    if (updated.status !== 'hostKeyUnverified' && updated.status !== 'hostKeyMismatch') return;
    attrs.onProbeHostKey(updated.id).then(
      (probe) => {
        hostKeyPrompt = { connectionId: updated.id, probe, retry };
        m.redraw();
      },
      (caught: unknown) => {
        error = errorMessage(caught, 'Failed to check the host key.');
        m.redraw();
      },
    );
  }

  function handleToggleConnection(attrs: ConnectionsManagerAttrs, connection: Connection): void {
    busy = true;
    error = undefined;
    success = undefined;
    const action =
      statusActionLabel(connection.status) === 'Disconnect'
        ? attrs.onDisconnect(connection.id)
        : attrs.onConnect(connection.id);
    action.then(
      (updated) => {
        busy = false;
        checkForPendingHostKeyConfirmation(attrs, updated, 'connect');
        m.redraw();
      },
      (caught: unknown) => {
        busy = false;
        error = errorMessage(caught, 'Failed to change the connection status.');
        m.redraw();
      },
    );
  }

  function handleTest(attrs: ConnectionsManagerAttrs, connection: Connection): void {
    busy = true;
    error = undefined;
    success = undefined;
    attrs.onTest(connection.id).then(
      (updated) => {
        busy = false;
        checkForPendingHostKeyConfirmation(attrs, updated, 'test');
        if (updated.status === 'connected') {
          success = `Connection test succeeded for ${updated.name}.`;
          toast({ html: success });
        }
        m.redraw();
      },
      (caught: unknown) => {
        busy = false;
        error = errorMessage(caught, 'Test failed.');
        m.redraw();
      },
    );
  }

  /**
   * Persists the fingerprint the user just confirmed, then automatically
   * retries the connect/test attempt that surfaced the prompt - the user
   * should not have to click Connect/Test a second time after trusting a
   * host key.
   */
  function handleAcceptHostKey(attrs: ConnectionsManagerAttrs): void {
    if (hostKeyPrompt === undefined) return;
    const { connectionId, probe, retry } = hostKeyPrompt;
    hostKeyBusy = true;
    attrs.onAcceptHostKey(connectionId, probe.fingerprint).then(
      () => {
        hostKeyBusy = false;
        hostKeyPrompt = undefined;
        m.redraw();
        const retryAction =
          retry === 'connect' ? attrs.onConnect(connectionId) : attrs.onTest(connectionId);
        retryAction.then(
          () => m.redraw(),
          (caught: unknown) => {
            error = errorMessage(caught, 'Host key accepted, but the connection attempt failed.');
            m.redraw();
          },
        );
      },
      (caught: unknown) => {
        hostKeyBusy = false;
        error = errorMessage(caught, 'Failed to accept the host key.');
        m.redraw();
      },
    );
  }

  /** Dismisses the prompt without accepting anything - the connection stays unverified. */
  function handleCancelHostKey(): void {
    hostKeyPrompt = undefined;
    m.redraw();
  }

  function renderHostKeyPrompt(attrs: ConnectionsManagerAttrs, connection: Connection) {
    if (hostKeyPrompt === undefined || hostKeyPrompt.connectionId !== connection.id)
      return undefined;
    const { probe } = hostKeyPrompt;
    const isMismatch = probe.status === 'mismatch';
    return m('.fm-hostkey-prompt', { role: 'alertdialog' }, [
      isMismatch
        ? m('p.fm-hostkey-warning', [
            '⚠ The host key for ',
            m('strong', connection.name),
            ' has changed since it was last accepted. This can mean the server was reinstalled, or that the connection is being intercepted.',
          ])
        : m('p', [
            'This is the first connection to ',
            m('strong', connection.name),
            '. Verify the fingerprint below out-of-band (e.g. with the server administrator) before trusting it.',
          ]),
      m('p.fm-hostkey-fingerprint', ['Presented: ', m('code', probe.fingerprint)]),
      isMismatch
        ? m('p.fm-hostkey-fingerprint', [
            'Previously accepted: ',
            m('code', probe.expectedFingerprint),
          ])
        : undefined,
      m('.fm-hostkey-actions', [
        m(FlatButton, {
          label: isMismatch ? 'Trust the new key anyway' : 'Trust this host key',
          disabled: hostKeyBusy,
          onclick: () => handleAcceptHostKey(attrs),
        }),
        m(FlatButton, {
          label: 'Cancel',
          disabled: hostKeyBusy,
          onclick: handleCancelHostKey,
        }),
      ]),
    ]);
  }

  function renderList(attrs: ConnectionsManagerAttrs) {
    return m('.fm-connections-list', [
      attrs.connections.length === 0
        ? m('p.fm-connections-empty', 'No saved connections yet.')
        : m(
            'ul.fm-connections-rows',
            attrs.connections.map((connection) =>
              m('li.fm-connections-row', { key: connection.id }, [
                m(
                  'span.fm-connections-status',
                  {
                    title: connectionStatusLabel(connection.status),
                    'aria-label': connectionStatusLabel(connection.status),
                  },
                  connectionStatusGlyph(connection.status),
                ),
                m('span.fm-connections-name', connection.name),
                m('span.fm-connections-kind', connection.kind),
                m('span.fm-connections-status-label', connectionStatusLabel(connection.status)),
                m('.fm-connections-actions', [
                  m(FlatButton, {
                    label: statusActionLabel(connection.status),
                    disabled: busy,
                    onclick: () => handleToggleConnection(attrs, connection),
                  }),
                  m(FlatButton, {
                    label: 'Test',
                    disabled: busy,
                    onclick: () => handleTest(attrs, connection),
                  }),
                  m(FlatButton, {
                    label: 'Edit',
                    disabled: busy,
                    onclick: () => openEditForm(connection),
                  }),
                  m(FlatButton, {
                    label: 'Delete',
                    disabled: busy,
                    onclick: () => handleDelete(attrs, connection),
                  }),
                ]),
                connection.status === 'failed' && connection.lastError != null
                  ? m('.fm-field-error.fm-connections-row-error', connection.lastError)
                  : undefined,
                renderHostKeyPrompt(attrs, connection),
              ]),
            ),
          ),
      m(FlatButton, {
        className: 'fm-connections-add',
        label: 'New connection…',
        onclick: openCreateForm,
      }),
      success === undefined ? undefined : m('.fm-field-success.fm-connections-success', success),
      error === undefined ? undefined : m('.fm-field-error', error),
    ]);
  }

  function renderSshFields(configuration: Extract<ConnectionConfiguration, { kind: 'ssh' }>) {
    return [
      m('.row', [
        m(TextInput, {
          className: 'col s8',
          label: 'Host',
          value: configuration.host,
          oninput: (value: string) => updateConfiguration({ host: value }),
          ...TECHNICAL_TEXT_ATTRS,
        }),
        m(NumberInput, {
          className: 'col s4',
          label: 'Port',
          value: configuration.port,
          min: 1,
          max: 65_535,
          oninput: (value: number) => updateConfiguration({ port: value }),
        }),
      ]),
      m('.row', [
        m(TextInput, {
          label: 'Username',
          value: configuration.username,
          oninput: (value: string) => updateConfiguration({ username: value }),
          ...TECHNICAL_TEXT_ATTRS,
        }),
      ]),
      m('.row', [
        m(TextInput, {
          label: 'Start folder (optional)',
          value: configuration.startPath ?? '',
          placeholder: configuration.username
            ? `/home/${configuration.username}`
            : '/home/username',
          helperText: 'Leave empty to use the default /home/<username>.',
          oninput: (value: string) => {
            const trimmed = value.trim();
            updateConfiguration({ startPath: trimmed.length === 0 ? null : trimmed });
          },
          ...TECHNICAL_TEXT_ATTRS,
        }),
      ]),
      m('.row', [
        m(Select<SshAuthenticationMethod>, {
          className: 'col s6',
          label: 'Authentication',
          options: authenticationOptions(),
          checkedId: configuration.authentication,
          onchange: (value: SshAuthenticationMethod[]) => {
            const next = value[0];
            if (next !== undefined) updateConfiguration({ authentication: next });
          },
        }),
        m(Select<HostKeyPolicy>, {
          className: 'col s6',
          label: 'Host key policy',
          options: hostKeyPolicyOptions(),
          checkedId: configuration.hostKeyPolicy,
          onchange: (value: HostKeyPolicy[]) => {
            const next = value[0];
            if (next !== undefined) updateConfiguration({ hostKeyPolicy: next });
          },
        }),
      ]),
      configuration.authentication === 'password'
        ? m('.row', [
            m(PasswordInput, {
              label: 'Password',
              value: form.secretPassword,
              placeholder: 'Leave blank to keep the stored password',
              oninput: (value: string) => {
                form.secretPassword = value;
              },
              ...TECHNICAL_TEXT_ATTRS,
            }),
          ])
        : undefined,
      configuration.authentication === 'privateKey'
        ? [
            m('.row', [
              m(Switch, {
                label: 'Provide the key as',
                left: 'File path',
                right: 'Pasted content',
                checked: form.secretKeyMode === 'paste',
                onchange: (checked: boolean) => {
                  form.secretKeyMode = checked ? 'paste' : 'path';
                },
              }),
            ]),
            form.secretKeyMode === 'path'
              ? m('.row', [
                  m(TextInput, {
                    label: 'Private key file path',
                    // Read fresh from disk on every connect/test, like ssh's own
                    // `IdentityFile` - never stored, matching `fm-application`'s
                    // `ssh.rs`. A relative `~/...` path is expanded on whichever
                    // host runs the backend (this machine for the desktop app,
                    // the fm-server host for browser mode).
                    helperText: 'Read from disk each time, like ssh - never stored.',
                    placeholder: '~/.ssh/id_ed25519 - leave blank to keep the stored key',
                    value: form.secretKeyPath,
                    oninput: (value: string) => {
                      form.secretKeyPath = value;
                    },
                    ...TECHNICAL_TEXT_ATTRS,
                  }),
                ])
              : m('.row', [
                  m(TextInput, {
                    label: 'Private key content',
                    placeholder: 'Leave blank to keep the stored key',
                    value: form.secretKey,
                    oninput: (value: string) => {
                      form.secretKey = value;
                    },
                    ...TECHNICAL_TEXT_ATTRS,
                  }),
                ]),
            m('.row', [
              m(PasswordInput, {
                label: 'Passphrase (optional)',
                value: form.secretPassphrase,
                oninput: (value: string) => {
                  form.secretPassphrase = value;
                },
                ...TECHNICAL_TEXT_ATTRS,
              }),
            ]),
          ]
        : undefined,
    ];
  }

  function renderMinimalFields(configuration: ConnectionConfiguration) {
    switch (configuration.kind) {
      case 'ftp':
      case 'ftps':
        return m('.row', [
          m(TextInput, {
            className: 'col s8',
            label: 'Host',
            value: configuration.host,
            oninput: (value: string) => updateConfiguration({ host: value }),
            ...TECHNICAL_TEXT_ATTRS,
          }),
          m(NumberInput, {
            className: 'col s4',
            label: 'Port',
            value: configuration.port,
            min: 1,
            max: 65_535,
            oninput: (value: number) => updateConfiguration({ port: value }),
          }),
          m(TextInput, {
            label: 'Username',
            value: configuration.username,
            oninput: (value: string) => updateConfiguration({ username: value }),
            ...TECHNICAL_TEXT_ATTRS,
          }),
          m(TextInput, {
            label: 'Start folder (optional)',
            value: configuration.startPath ?? '',
            oninput: (value: string) => updateConfiguration({ startPath: value || null }),
            ...TECHNICAL_TEXT_ATTRS,
          }),
          m(PasswordInput, {
            label: 'Password',
            placeholder: 'Leave blank to keep the stored password',
            value: form.secretPassword,
            oninput: (value: string) => {
              form.secretPassword = value;
            },
            ...TECHNICAL_TEXT_ATTRS,
          }),
          configuration.kind === 'ftp'
            ? m(
                '.fm-field-warning',
                { role: 'note' },
                'Insecure: FTP sends credentials and files without encryption.',
              )
            : undefined,
        ]);
      case 'oneDrive':
        return m('.row', [
          m(TextInput, {
            label: 'Account (optional)',
            value: configuration.accountHint ?? '',
            oninput: (value: string) =>
              updateConfiguration({ accountHint: value.length === 0 ? null : value }),
            ...TECHNICAL_TEXT_ATTRS,
          }),
        ]);
      case 'webDav':
        return m('.row', [
          m(TextInput, {
            label: 'Base URL',
            value: configuration.baseUrl,
            oninput: (value: string) => updateConfiguration({ baseUrl: value }),
            ...TECHNICAL_TEXT_ATTRS,
          }),
        ]);
      case 's3':
        return m('.row', [
          m(TextInput, {
            className: 'col s6',
            label: 'Bucket',
            value: configuration.bucket,
            oninput: (value: string) => updateConfiguration({ bucket: value }),
            ...TECHNICAL_TEXT_ATTRS,
          }),
          m(TextInput, {
            className: 'col s6',
            label: 'Region (optional)',
            value: configuration.region ?? '',
            oninput: (value: string) =>
              updateConfiguration({ region: value.length === 0 ? null : value }),
            ...TECHNICAL_TEXT_ATTRS,
          }),
          m(TextInput, {
            label: 'Endpoint (optional)',
            value: configuration.endpoint ?? '',
            oninput: (value: string) =>
              updateConfiguration({ endpoint: value.length === 0 ? null : value }),
            ...TECHNICAL_TEXT_ATTRS,
          }),
        ]);
      case 'smb':
        return m('.row', [
          m(TextInput, {
            className: 'col s6',
            label: 'Server',
            value: configuration.server,
            oninput: (value: string) => updateConfiguration({ server: value }),
            ...TECHNICAL_TEXT_ATTRS,
          }),
          m(TextInput, {
            className: 'col s6',
            label: 'Share',
            value: configuration.share,
            oninput: (value: string) => updateConfiguration({ share: value }),
            ...TECHNICAL_TEXT_ATTRS,
          }),
        ]);
      default:
        return undefined;
    }
  }

  function renderForm(editingId: ConnectionId | undefined) {
    return m('.fm-connection-form', [
      m('.row', [
        m(TextInput, {
          label: 'Name',
          value: form.name,
          oninput: (value: string) => {
            form.name = value;
          },
        }),
      ]),
      m('.row', [
        m(Select<ConnectionKind>, {
          label: 'Kind',
          // The protocol can't change after creation. `mithril-materialized`'s
          // `disabled` already blocks opening/keyboard interaction and sets
          // `tabindex="-1"` on `.select-wrapper` - it just never sets the
          // underlying `disabled` HTML attribute, so `mithril-materialized-procyon.css`
          // styles that `tabindex` signal directly instead of `:disabled`.
          disabled: editingId !== undefined,
          options: kindOptions(),
          checkedId: form.configuration.kind,
          onchange: (value: ConnectionKind[]) => {
            const next = value[0];
            if (next !== undefined) {
              form = { ...form, configuration: defaultConfigurationFor(next) };
            }
          },
        }),
      ]),
      form.configuration.kind === 'ssh'
        ? renderSshFields(form.configuration)
        : renderMinimalFields(form.configuration),
      error === undefined ? undefined : m('.fm-field-error', error),
    ]);
  }

  return {
    onbeforeupdate: ({ attrs }) => {
      if (attrs.open && !wasOpen) {
        mode = { kind: 'list' };
        hostKeyPrompt = undefined;
        hostKeyBusy = false;
        refreshConnections(attrs);
      }
      wasOpen = attrs.open;
      return true;
    },
    view: ({ attrs }) =>
      m(ModalPanel, {
        title: 'Connections',
        className: 'fm-connections-modal',
        description: mode.kind === 'list' ? renderList(attrs) : renderForm(mode.editingId),
        isOpen: attrs.open,
        closeOnEsc: true,
        onToggle: (open: boolean) => {
          if (!open) {
            backToList();
            attrs.onClose();
          }
        },
        buttons:
          mode.kind === 'list'
            ? [{ label: 'Close', onclick: attrs.onClose }]
            : [
                { label: 'Cancel', onclick: backToList },
                { label: 'Save', disabled: busy, onclick: () => handleSave(attrs) },
              ],
      }),
  };
};
