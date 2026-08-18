/**
 * Shared types for the Obsidian note coach plugin.
 *
 * Value-hygiene contract: `NoteStyle` (the portable style profile) contains
 * ONLY mechanical writing conventions — never opinions, values, or stances.
 * Opinion memory lives in the volatile per-session ledger and is purged
 * periodically (see `memoryRetentionDays`).
 */
export {};
