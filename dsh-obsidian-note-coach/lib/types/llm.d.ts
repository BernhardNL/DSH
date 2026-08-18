import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { NoteCoachConfig } from './types.js';
/** One-shot LLM call configuration (model/provider may fall back to the agent). */
export interface LlmTarget {
    provider?: string;
    model?: string;
    temperature: number;
    maxTokens: number;
}
/** Resolve the effective provider/model for one call, falling back to the agent. */
export declare function resolveLlmTarget(config: NoteCoachConfig, agent: Agent | undefined): {
    provider: string;
    model: string;
};
/**
 * Run one streaming completion and return the assembled plain text.
 * Used for judge, style-profile, report, and note-generation calls.
 */
export declare function completeText(ctx: Context, agent: Agent | undefined, target: LlmTarget, system: string, user: string, signal?: AbortSignal): Promise<string>;
/** Parse a JSON object out of an LLM answer that may be wrapped in prose/code fences. */
export declare function extractJson<T>(text: string): T | undefined;
