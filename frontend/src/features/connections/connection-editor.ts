import m, { type FactoryComponent } from 'mithril';
import { FlatButton, ModalPanel, NumberInput, Select, TextInput } from 'mithril-materialized';

import type {
  Connection,
  ConnectionConfiguration,
  ConnectionId,
  ConnectionKind,
  ConnectionSecretInput,
  CreateConnectionRequest,
  HostKeyPolicy,
  SshAuthenticationMethod,
  UpdateConnectionRequest,
} from '../../models';
import { defaultSshConfiguration } from '../../models/connection';
import {
  connectionStatusGlyph,
  connectionStatusLabel,
  validateConnectionDraft,
} from './connections-model';

export interface ConnectionsManagerAttrs {
  readonly open: boolean;
  readonly connections: readonly Connection[];
  readonly onClose: () => void;
  readonly onCreate: (request: CreateConnectionRequest) => Promise<void>;
  readonly onUpdate: (id: ConnectionId, request: UpdateConnectionRequest) => Promise<void>;
  readonly onDelete: (id: ConnectionId) => Promise<void>;
  readonly onConnect: (id: ConnectionId) => Promise<void>;
  readonly onDisconnect: (id: ConnectionId) => Promise<void>;
  readonly onTest: (id: ConnectionId) => Promise<void>;
}

type ViewMode =
  | { readonly kind: 'list' }
  | { readonly kind: 'form'; readonly editingId?: ConnectionId };

interface FormState {
  name: string;
  configuration: ConnectionConfiguration;
  secretPassword: string;
  secretKey: string;
  secretPassphrase: string;
}

// Plain (non-`readonly`) arrays: `mithril-materialized`'s `Select` requires
// a mutable `InputOption<T>[]`, which a `readonly` array type is not
// assignable to.
function kindOptions(): { id: ConnectionKind; label: string }[] {
  return [
    { id: 'ssh', label: 'SSH' },
    { id: 'ftp', label: 'FTP' },
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
      return { kind: 'ftp', host: '', port: 21, username: '' };
    case 'ftps':
      return { kind: 'ftps', host: '', port: 21, username: '' };
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
    secretKey: '',
    secretPassphrase: '',
  };
}

/** Builds the write-only secret input for the current form state, or `undefined` if none was entered. */
function secretInputFrom(form: FormState): ConnectionSecretInput | undefined {
  if (form.configuration.kind !== 'ssh') return undefined;
  switch (form.configuration.authentication) {
    case 'password':
      return form.secretPassword.length === 0
        ? undefined
        : { kind: 'password', password: form.secretPassword };
    case 'privateKey':
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
  form.secretKey = '';
  form.secretPassphrase = '';
}

function statusActionLabel(status: Connection['status']): string {
  return status === 'connected' || status === 'connecting' || status === 'reconnecting'
    ? 'Disconnect'
    : 'Connect';
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

  function openCreateForm(): void {
    mode = { kind: 'form' };
    form = emptyForm();
    error = undefined;
  }

  function openEditForm(connection: Connection): void {
    mode = { kind: 'form', editingId: connection.id };
    form = formFromConnection(connection);
    error = undefined;
  }

  function backToList(): void {
    mode = { kind: 'list' };
    error = undefined;
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
    const request: CreateConnectionRequest = {
      name: form.name,
      kind: form.configuration.kind,
      configuration: form.configuration,
      secret: secretInputFrom(form) ?? null,
    };
    const save =
      mode.editingId === undefined
        ? attrs.onCreate(request)
        : attrs.onUpdate(mode.editingId, request);
    save.then(
      () => {
        clearSecretFields(form);
        busy = false;
        backToList();
        m.redraw();
      },
      (caught: unknown) => {
        busy = false;
        error = errorMessage(caught, 'Failed to save the connection.');
        m.redraw();
      },
    );
  }

  function handleDelete(attrs: ConnectionsManagerAttrs, connection: Connection): void {
    busy = true;
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

  function handleToggleConnection(attrs: ConnectionsManagerAttrs, connection: Connection): void {
    busy = true;
    const action =
      statusActionLabel(connection.status) === 'Disconnect'
        ? attrs.onDisconnect(connection.id)
        : attrs.onConnect(connection.id);
    action.then(
      () => {
        busy = false;
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
    attrs.onTest(connection.id).then(
      () => {
        busy = false;
        m.redraw();
      },
      (caught: unknown) => {
        busy = false;
        error = errorMessage(caught, 'Test failed.');
        m.redraw();
      },
    );
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
              ]),
            ),
          ),
      m(FlatButton, {
        className: 'fm-connections-add',
        label: 'New connection…',
        onclick: openCreateForm,
      }),
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
          onchange: (value: string) => updateConfiguration({ host: value }),
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
          className: 'col s12',
          label: 'Username',
          value: configuration.username,
          onchange: (value: string) => updateConfiguration({ username: value }),
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
            m(TextInput, {
              className: 'col s12',
              label: 'Password',
              type: 'password',
              value: form.secretPassword,
              placeholder: 'Leave blank to keep the stored password',
              oninput: (value: string) => {
                form.secretPassword = value;
              },
            }),
          ])
        : undefined,
      configuration.authentication === 'privateKey'
        ? m('.row', [
            m(TextInput, {
              className: 'col s12',
              label: 'Private key',
              placeholder: 'Leave blank to keep the stored key',
              value: form.secretKey,
              oninput: (value: string) => {
                form.secretKey = value;
              },
            }),
            m(TextInput, {
              className: 'col s12',
              label: 'Passphrase (optional)',
              type: 'password',
              value: form.secretPassphrase,
              oninput: (value: string) => {
                form.secretPassphrase = value;
              },
            }),
          ])
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
            onchange: (value: string) => updateConfiguration({ host: value }),
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
            className: 'col s12',
            label: 'Username',
            value: configuration.username,
            onchange: (value: string) => updateConfiguration({ username: value }),
          }),
        ]);
      case 'oneDrive':
        return m('.row', [
          m(TextInput, {
            className: 'col s12',
            label: 'Account (optional)',
            value: configuration.accountHint ?? '',
            onchange: (value: string) =>
              updateConfiguration({ accountHint: value.length === 0 ? null : value }),
          }),
        ]);
      case 'webDav':
        return m('.row', [
          m(TextInput, {
            className: 'col s12',
            label: 'Base URL',
            value: configuration.baseUrl,
            onchange: (value: string) => updateConfiguration({ baseUrl: value }),
          }),
        ]);
      case 's3':
        return m('.row', [
          m(TextInput, {
            className: 'col s6',
            label: 'Bucket',
            value: configuration.bucket,
            onchange: (value: string) => updateConfiguration({ bucket: value }),
          }),
          m(TextInput, {
            className: 'col s6',
            label: 'Region (optional)',
            value: configuration.region ?? '',
            onchange: (value: string) =>
              updateConfiguration({ region: value.length === 0 ? null : value }),
          }),
          m(TextInput, {
            className: 'col s12',
            label: 'Endpoint (optional)',
            value: configuration.endpoint ?? '',
            onchange: (value: string) =>
              updateConfiguration({ endpoint: value.length === 0 ? null : value }),
          }),
        ]);
      case 'smb':
        return m('.row', [
          m(TextInput, {
            className: 'col s6',
            label: 'Server',
            value: configuration.server,
            onchange: (value: string) => updateConfiguration({ server: value }),
          }),
          m(TextInput, {
            className: 'col s6',
            label: 'Share',
            value: configuration.share,
            onchange: (value: string) => updateConfiguration({ share: value }),
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
          className: 'col s12',
          label: 'Name',
          value: form.name,
          onchange: (value: string) => {
            form.name = value;
          },
        }),
      ]),
      m('.row', [
        m(Select<ConnectionKind>, {
          className: 'col s12',
          label: 'Kind',
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
