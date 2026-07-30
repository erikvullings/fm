import merge from 'mergerino';
import m from 'mithril';
import Stream from 'mithril/stream';

import type { AppState } from './model';
import type { AppPatch } from './patch';

/** Platform scheduling boundary used by every state producer. */
export type RequestFrame = (callback: FrameRequestCallback) => number;

export interface AppStoreOptions {
  readonly requestFrame?: RequestFrame;
  readonly redraw?: () => void;
}

export type StateSelector<Selected> = (state: AppState) => Selected;
export type StateListener<Selected> = (selected: Selected) => void;

/** Public interface consumed by actions and Mithril components. */
export interface AppStore {
  getState(): AppState;
  update(patch: AppPatch): void;
  subscribe<Selected>(
    selector: StateSelector<Selected>,
    listener: StateListener<Selected>,
  ): () => void;
}

/** Applies one or more immutable patches immediately. */
export function applyAppPatches(state: AppState, ...patches: readonly AppPatch[]): AppState {
  return merge(state, ...patches) as AppState;
}

/**
 * Creates the Meiosis state loop. Updates queued in one animation frame are
 * merged into one snapshot publication followed by one Mithril redraw.
 */
export function createAppStore(initialState: AppState, options: AppStoreOptions = {}): AppStore {
  const requestFrame = options.requestFrame ?? requestAnimationFrame;
  const redraw = options.redraw ?? m.redraw;
  const patchBatches = Stream<readonly AppPatch[]>();
  const states = Stream.scan(
    (state, patches) => applyAppPatches(state, ...patches),
    initialState,
    patchBatches,
  );
  let pending: AppPatch[] = [];
  let framePending = false;

  function flush(): void {
    framePending = false;
    const patches = pending;
    pending = [];
    patchBatches(patches);
    redraw();
  }

  return {
    getState: () => states(),
    update: (patch) => {
      pending.push(patch);
      if (!framePending) {
        framePending = true;
        requestFrame(flush);
      }
    },
    subscribe: (selector, listener) => {
      let selected = selector(states());
      const subscription = states.map((state) => {
        const next = selector(state);
        if (!Object.is(next, selected)) {
          selected = next;
          listener(next);
        }
        return next;
      });
      return () => subscription.end(true);
    },
  };
}
