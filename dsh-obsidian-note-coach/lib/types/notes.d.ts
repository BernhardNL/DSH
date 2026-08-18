import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { NoteCoachConfig, NoteInsertion, NoteStyle, VaultIndex } from './types.js';
/**
 * Note insertion service: picks the right folder and filename from the learned
 * style, generates content from the user's words, and writes it through the
 * fs provider directly (a plugin-internal write, so the model-facing write
 * guard does not re-prompt — the user already approved the note).
 */
/** Write options shared by note-generation calls. */
export interface NoteWriteOptions {
    suggestedFolder?: string;
    suggestedTitle?: string;
    recommendedLocation?: string;
    /** User-specified location (folder or rel path), from the interactive prompt. */
    userLocation?: string;
    /** User-supplied natural-language content to merge into the note. */
    supplement?: string;
}
export declare class NoteWriterService extends Service {
    private readonly config;
    constructor(ctx: Context, config: NoteCoachConfig);
    /**
     * Generate the note content WITHOUT writing (used to preview the note's
     * format and content before asking the user to confirm).
     */
    previewNote(agent: Agent, index: VaultIndex, style: NoteStyle, opinion: string, opts?: NoteWriteOptions, signal?: AbortSignal): Promise<{
        folder: string;
        title: string;
        content: string;
    }>;
    insertNote(agent: Agent, index: VaultIndex, style: NoteStyle, opinion: string, opts?: NoteWriteOptions, signal?: AbortSignal): Promise<NoteInsertion>;
    /** Write an already-generated note to the vault. */
    writeGenerated(index: VaultIndex, generated: {
        folder: string;
        title: string;
        content: string;
    }): Promise<NoteInsertion>;
    private generateContent;
}
export declare function parseWriterAnswer(answer: string): {
    title?: string;
    folder?: string;
    content?: string;
};
