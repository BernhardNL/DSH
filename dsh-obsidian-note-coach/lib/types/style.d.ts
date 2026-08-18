import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { NoteCoachConfig, NoteStyle, OpinionMemoryEntry, VaultIndex } from './types.js';
/**
 * Style learning and portability service.
 *
 * - The style profile is a vault-local, portable JSON file: copy the vault (or
 *   just this file) to another machine and DSH restores the writing style.
 * - Value hygiene: the profile schema carries ONLY mechanical conventions.
 *   Opinions/values live in a volatile ledger that is purged on TTL and on
 *   startup, so no stance ever persists or biases later judgments.
 */
export declare class NoteStyleService extends Service {
    private readonly config;
    constructor(ctx: Context, config: NoteCoachConfig);
    /** Absolute path of the style profile inside the vault. */
    private stylePath;
    private memoryPath;
    /** Load and sanitize the portable style profile; returns undefined when absent. */
    loadStyle(root: string): Promise<NoteStyle | undefined>;
    /** Sanitize a parsed profile: keep only allowed keys with correct shapes. */
    sanitize(input: Record<string, unknown>): NoteStyle | undefined;
    /** Persist the profile atomically. */
    saveStyle(root: string, style: NoteStyle): Promise<void>;
    /**
     * Learn the user's writing style from the vault index. Always runs even when
     * a previous profile exists (the requirement), then merges: a fresh LLM
     * extraction overwrites mechanical fields, never value content (none exists).
     */
    learnStyle(agent: Agent, index: VaultIndex, signal?: AbortSignal): Promise<NoteStyle>;
    /** Load the volatile ledger, purging entries older than the TTL. */
    loadMemory(root: string, now?: number): Promise<OpinionMemoryEntry[]>;
    /** Append one opinion memory entry (short, user-worded, no extrapolation). */
    rememberOpinion(root: string, opinion: string, verdict: string): Promise<void>;
    /** Wipe the volatile ledger entirely (startup + on demand). */
    clearMemory(root: string): Promise<void>;
    private saveMemory;
}
