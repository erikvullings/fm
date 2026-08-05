import 'mithril-materialized/core.css';
import 'mithril-materialized/forms.css';
import 'mithril-materialized/components.css';
import 'mithril-materialized/utilities.css';
import './themes/theme.css';
import './themes/mithril-materialized-procyon.css';

import m from 'mithril';

import { createFileManagerClient } from './api/client/create-client';
import { AppShell } from './app/app-shell';
import { resolveRuntimeKind } from './utilities/runtime';

const runtime = resolveRuntimeKind(import.meta.env.VITE_RUNTIME);
const client = createFileManagerClient(runtime);

const root = document.getElementById('app');
if (root === null) {
  throw new Error('index.html is missing the #app mount point');
}

m.mount(root, { view: () => m(AppShell, { runtime, client }) });

if (import.meta.hot !== undefined) {
  import.meta.hot.dispose(() => {
    m.mount(root, null);
    client.disconnect();
  });
}
