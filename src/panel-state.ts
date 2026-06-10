/** UI state reported from the trace viewer webview for MCP and export. */
export interface PanelUiState {
  sessionId: string;
  focusedTraceIndex: number | null;
  focusedTraceId: string | null;
  expandedObservationIds: string[];
  lastInteractedObservationId: string | null;
  lastInteractedTraceId: string | null;
}

/** Returns the observation ID the user is most likely inspecting in the panel. */
export function resolveActiveObservationId(state: PanelUiState): string | null {
  if (state.lastInteractedObservationId) {
    return state.lastInteractedObservationId;
  }
  if (state.expandedObservationIds.length > 0) {
    return state.expandedObservationIds[state.expandedObservationIds.length - 1] ?? null;
  }
  return null;
}

/** Returns the trace ID associated with the active observation selection. */
export function resolveActiveTraceId(state: PanelUiState): string | null {
  if (state.lastInteractedTraceId) {
    return state.lastInteractedTraceId;
  }
  return state.focusedTraceId;
}

/** Resolves trace and observation IDs from panel state for detail lookup. */
export function resolveActiveSpanIds(state: PanelUiState): {
  traceId: string | null;
  observationId: string | null;
} {
  return {
    traceId: resolveActiveTraceId(state),
    observationId: resolveActiveObservationId(state),
  };
}
