import type { BackendEvent, Operation, OperationFailure, OperationId } from '../../models';

export interface OperationCentreState {
  readonly byId: Readonly<Partial<Record<OperationId, Operation>>>;
  readonly failuresById: Readonly<Partial<Record<OperationId, OperationFailure>>>;
}

export function createOperationsState(operations: readonly Operation[] = []): OperationCentreState {
  return {
    byId: Object.fromEntries(operations.map((operation) => [operation.id, operation])),
    failuresById: {},
  };
}

/** Applies an event-stream batch atomically; the operation centre never polls. */
export function reduceOperationEvents(
  state: OperationCentreState,
  events: readonly BackendEvent[],
): OperationCentreState {
  const byId = { ...state.byId };
  const failuresById = { ...state.failuresById };
  for (const { payload } of events) {
    switch (payload.type) {
      case 'operation.created':
      case 'operation.completed':
        byId[payload.operation.id] = payload.operation;
        break;
      case 'operation.progress': {
        const current = byId[payload.operationId];
        if (current !== undefined) {
          byId[payload.operationId] = { ...current, progress: payload.progress };
        }
        break;
      }
      case 'operation.stateChanged': {
        const current = byId[payload.operationId];
        if (current !== undefined) {
          byId[payload.operationId] = { ...current, state: payload.state };
        }
        break;
      }
      case 'operation.failed': {
        const current = byId[payload.operationId];
        if (current !== undefined) {
          byId[payload.operationId] = { ...current, state: 'failed' };
          failuresById[payload.operationId] = {
            code: payload.code,
            message: payload.message,
            ...(payload.details === undefined ? {} : { details: payload.details }),
          };
        }
        break;
      }
      default:
        break;
    }
  }
  return { byId, failuresById };
}

export function dismissOperation(
  state: OperationCentreState,
  operationId: OperationId,
): OperationCentreState {
  const byId = { ...state.byId };
  const failuresById = { ...state.failuresById };
  delete byId[operationId];
  delete failuresById[operationId];
  return { byId, failuresById };
}
