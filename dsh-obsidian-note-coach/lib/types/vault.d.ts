import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { NoteCoachConfig, VaultIndex } from './types.js';
/** Parse a leading YAML frontmatter block; returns the record or {} on failure. */
export declare function parseFrontmatter(body: string): {
    frontmatter: Record<string, unknown>;
    rest: string;
};
/** Extract markdown structure from note text. */
export declare function parseNoteBody(body: string): {
    headings: string[];
    links: string[];
    tasks: {
        text: string;
        done: boolean;
    }[];
};
/**
 * Vault scanning and indexing service. The vault root is the session
 * workspace root (the folder the user selects in the GUI), so the same vault
 * opened on another machine resolves identically.
 */
export declare class NoteVaultService extends Service {
    private readonly config;
    constructor(ctx: Context, config: NoteCoachConfig);
    /** The vault root for one agent: its session header cwd (the workspace). */
    vaultRoot(agent: Agent | undefined): string;
    private target;
    /**
     * Recursively index the vault. `depthLimit` guards against runaway scans;
     * the default is generous for note vaults.
     */
    scan(root: string, signal?: AbortSignal, depthLimit?: number): Promise<VaultIndex>;
}
