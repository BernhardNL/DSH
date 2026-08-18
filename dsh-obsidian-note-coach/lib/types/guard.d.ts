import type { Context } from '@deepseek-ai/cordis';
import type { NoteCoachConfig } from './types.js';
/**
 * Write-approval guard: every model-facing file rewrite (`write` / `edit`)
 * is routed through the approval seam before it may execute. Returning
 * `{ kind: 'ask' }` from `tools/pre-execute` makes the tools pipeline ask the
 * user automatically; a rejected call never reaches the tool body.
 *
 * Plugin-internal writes (note insertion, style profile, reports) go through
 * the fs provider directly and are NOT model-facing tool calls, so they are
 * not re-prompted — the user already approved those actions explicitly.
 */
export declare function installWriteGuard(ctx: Context, config: NoteCoachConfig): () => void;
