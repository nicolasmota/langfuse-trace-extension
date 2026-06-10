import { describe, it, expect } from 'vitest';
import { resolveActiveObservationId, resolveActiveTraceId } from '../panel-state.js';

describe('panel-state', () => {
  const base = {
    sessionId: 's1',
    focusedTraceIndex: 0,
    focusedTraceId: 'trace-1',
    expandedObservationIds: ['obs-a', 'obs-b'],
    lastInteractedObservationId: null,
    lastInteractedTraceId: null,
  };

  it('prefers last interacted observation', () => {
    expect(resolveActiveObservationId({
      ...base,
      lastInteractedObservationId: 'obs-z',
    })).toBe('obs-z');
  });

  it('falls back to last expanded observation', () => {
    expect(resolveActiveObservationId(base)).toBe('obs-b');
  });

  it('prefers last interacted trace id', () => {
    expect(resolveActiveTraceId({
      ...base,
      lastInteractedTraceId: 'trace-9',
    })).toBe('trace-9');
  });
});
