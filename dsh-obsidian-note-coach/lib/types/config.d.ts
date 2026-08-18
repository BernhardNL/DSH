import type { NoteCoachConfig } from './types.js';
/**
 * Merge a partial input config over the defaults. The loader may pass any
 * subset; unknown keys are ignored so a future plugin version stays
 * backward compatible with older stored configs.
 */
export declare function resolveConfig(input?: unknown): NoteCoachConfig;
