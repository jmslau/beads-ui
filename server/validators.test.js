import { describe, expect, test } from 'vitest';
import { validateSubscribeListPayload } from './validators.js';

describe('validateSubscribeListPayload — subscription types', () => {
  test('accepts all-issues-including-closed (backs Issues search over closed)', () => {
    // Regression: the Issues search / Closed-inclusive filter widens to this
    // type. It must be on the server allowlist or the subscribe-list request is
    // rejected with "payload.type must be one of …" and the list fails to load.
    const res = validateSubscribeListPayload({
      id: 'tab:issues',
      type: 'all-issues-including-closed'
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.spec.type).toBe('all-issues-including-closed');
    }
  });

  test('still rejects an unknown subscription type', () => {
    const res = validateSubscribeListPayload({
      id: 'tab:issues',
      type: 'totally-made-up'
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('bad_request');
      expect(res.message).toMatch(/payload\.type must be one of/);
    }
  });
});
