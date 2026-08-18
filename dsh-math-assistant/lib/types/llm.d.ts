import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
/** 解析有效 provider/model（跟随会话默认）。 */
export declare function resolveLlmTarget(agent: Agent | undefined): {
    provider: string;
    model: string;
};
/** 一次流式补全，返回纯文本。 */
export declare function completeText(ctx: Context, agent: Agent | undefined, system: string, user: string, opts?: {
    temperature?: number;
    maxTokens?: number;
}, signal?: AbortSignal): Promise<string>;
/** 从 LLM 输出中提取 JSON 对象（容忍围栏/散文包裹）。 */
export declare function extractJson<T>(text: string): T | undefined;
