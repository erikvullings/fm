import 'mithril-materialized/index.css';
import './themes/theme.css';

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
