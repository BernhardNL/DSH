import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { JudgeThread, JudgeVerdict, NoteCoachConfig, NoteInsertion } from './types.js';
import type { NoteVaultService } from './vault.js';
import type { NoteStyleService } from './style.js';
import type { NoteWriterService } from './notes.js';
export interface JudgeOutcome {
    verdict: JudgeVerdict;
    /** Set when the user approved a note and one was written. */
    insertion?: NoteInsertion;
    /** Whether a note was offered (verdict correct / non-subjective). */
    offered: boolean;
    /** The judgment thread (for follow-up questions). */
    thread?: JudgeThread;
    /** Human-readable summary with separate 判断 / 理由 / 建议 / 推荐位置 sections. */
    summary: string;
}
export interface FollowUpOutcome {
    answer: string;
    thread: JudgeThread;
}
export interface OrganizeOutcome {
    /** Set when the user approved and the organized note was written. */
    insertion?: NoteInsertion;
    summary: string;
}
/**
 * Opinion judging flow: independent model judgment → structured output
 * (判断 / 理由 / 建议 / 推荐记录位置) → user-interactive recording prompt
 * (同意推荐位置，或用自然语言补充内容 / 指定位置) → note insertion.
 * A per-session thread keeps the reasoning open to continuous follow-up.
 */
export declare class NoteJudgeService extends Service {
    private readonly config;
    private readonly vault;
    private readonly style;
    private readonly writer;
    /** Per-session judgment threads for follow-up (capped, in-memory). */
    private readonly threads;
    constructor(ctx: Context, config: NoteCoachConfig, vault: NoteVaultService, style: NoteStyleService, writer: NoteWriterService);
    /**
     * Run the full judge flow for one stated opinion.
     * @param agent - the agent whose session/workspace owns the vault.
     * @param opinion - the user's words, verbatim.
     * @param context - optional surrounding conversation context.
     */
    judge(agent: Agent, opinion: string, context?: string, signal?: AbortSignal): Promise<JudgeOutcome>;
    /**
     * Answer a follow-up question about the latest judgment thread's reasoning.
     */
    followUp(agent: Agent, question: string, signal?: AbortSignal): Promise<FollowUpOutcome>;
    /**
     * Organize the session's whole thinking thread (original opinion + judgment
     * + all follow-up Q&A) into one note. Like the judge flow, it generates a
     * preview first and asks the user where to save (同意推荐位置 / 自定义 /
     * 放弃) before writing.
     */
    organizeThread(agent: Agent, signal?: AbortSignal): Promise<OrganizeOutcome>;
}
