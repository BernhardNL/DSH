import { Context, Service } from '@deepseek-ai/cordis';
export interface PushResult {
    ok: boolean;
    output: string[];
}
/**
 * GitHub push service. Stores the target repository URL in a vault-local state
 * file; pushing initializes git when needed, stages the vault, commits, and
 * pushes. Authentication relies on the user's existing git credentials
 * (SSH agent or HTTPS credential helper) — no tokens are stored here.
 */
export declare class NoteGitService extends Service {
    constructor(ctx: Context);
    private statePath;
    private loadState;
    private saveState;
    /** Record the target repository URL. */
    setRepo(root: string, url: string): Promise<string>;
    /** Push the vault to the configured repository. */
    push(root: string, message?: string, signal?: AbortSignal): Promise<PushResult>;
}
