import { loadTracesAndObservations } from '../langfuse-service.js';
import { buildSessionSnapshot, findObservation, type McpSessionSnapshot, type McpSpanDetail } from '../mcp/serialize.js';
import { resolveActiveSpanIds, type PanelUiState } from '../panel-state.js';

/** Loaded session data enriched with optional active panel context. */
export interface SessionContext {
  sessionId: string;
  snapshot: McpSessionSnapshot;
  panelState?: PanelUiState;
  activeSpanDetail: McpSpanDetail | null;
}

/** Loads trace data and resolves the span the user is viewing in the panel. */
export async function loadSessionContext(
  sessionId: string,
  panelState?: PanelUiState,
): Promise<SessionContext | null> {
  const result = await loadTracesAndObservations(sessionId);
  if (!result) { return null; }

  const snapshot = buildSessionSnapshot(sessionId, result.fullTraces, result.observations);
  let activeSpanDetail: McpSpanDetail | null = null;

  if (panelState) {
    const { traceId, observationId } = resolveActiveSpanIds(panelState);
    if (traceId && observationId) {
      activeSpanDetail = findObservation(traceId, observationId, result.fullTraces);
    }
  }

  return { sessionId, snapshot, panelState, activeSpanDetail };
}
