/**
 * Pending-interaction bridge store.
 *
 * The DSH shell renders question/approval dialogs inside the conversation
 * column — invisible under the note-coach full-screen page. This module lets
 * the page render its OWN dialogs: a hidden session-scoped bridge component
 * subscribes to the conversation snapshot's `pending` list and publishes the
 * `PendingWait` carriers here; the page reads them with
 * `useSyncExternalStore` and answers via `wait.respond()`.
 */

/** Minimal structural view of one pending interaction carrier. */
export interface PendingEntry {
  sessionId: string;
  kind: 'approval' | 'question';
  /** Opaque render identity (`<prefix>:<rpcId>`), stable across replay. */
  key: string;
  /** Domain fields of the requested frame (approvalId/toolName/reason or questions). */
  payload: Record<string, unknown>;
  /** Send the answer; the envelope rpcId is backfilled by the carrier. */
  respond(result: { ok: boolean; value?: unknown; error?: unknown }): Promise<unknown>;
}

type AnyWait = {
  kind?: string;
  sessionId?: string;
  key?: string;
  payload?: Record<string, unknown>;
  respond?: (result: { ok: boolean; value?: unknown }) => Promise<unknown>;
};

const pendingBySession = new Map<string, PendingEntry[]>();
const listeners = new Set<() => void>();

/** Last-published signature per session, so redundant bridge broadcasts are skipped. */
const lastSignature = new Map<string, string>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Bridge entry point: publish one session's pending interactions. */
export function publishPending(sessionId: string, pending: readonly AnyWait[]): void {
  const entries: PendingEntry[] = [];
  for (const wait of pending) {
    if (wait.kind !== 'approval' && wait.kind !== 'question') continue;
    if (!wait.sessionId || !wait.key || !wait.payload || typeof wait.respond !== 'function') continue;
    entries.push({
      sessionId: wait.sessionId,
      kind: wait.kind,
      key: wait.key,
      payload: wait.payload,
      // MUST keep `this` bound: PendingWait.respond reads a private member
      // (#settled), so the raw method reference would throw
      // "Cannot read private member #settled" when called later.
      respond: (result) => wait.respond(result),
    });
  }
  // Skip when nothing changed (same keys in same order): the session snapshot
  // can re-emit identical pending lists while the agent waits.
  const signature = entries.map((e) => `${e.kind}:${e.key}`).join('|');
  if (lastSignature.get(sessionId) === signature) return;
  lastSignature.set(sessionId, signature);
  pendingBySession.set(sessionId, entries);
  emit();
}

/** React store subscription. */
export function subscribePending(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Optimistically remove one pending entry (used when the user answers/cancels
 * in the page). If the host actually rejects the answer, the bridge will
 * republish the entry and the dialog returns.
 */
export function removePending(sessionId: string, key: string): void {
  const entries = pendingBySession.get(sessionId);
  if (!entries) return;
  const next = entries.filter((e) => e.key !== key);
  pendingBySession.set(sessionId, next);
  lastSignature.set(sessionId, next.map((e) => `${e.kind}:${e.key}`).join('|'));
  emit();
}

/** Snapshot for one session (a fresh array per call; stable enough for useSyncExternalStore). */
export function getPending(sessionId: string | undefined): PendingEntry[] {
  if (!sessionId) return EMPTY;
  return pendingBySession.get(sessionId) ?? EMPTY;
}

const EMPTY: PendingEntry[] = [];
