import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { MathConfig, QuestionAnalysis } from './types.js';
import type { ProjectMemoryService } from './memory.js';
/**
 * 题目分析服务：对每一问给出类型/模型/算法/工具/思路/子问题，并写入项目记忆。
 */
export declare class AnalysisService extends Service {
    private readonly config;
    private readonly memory;
    constructor(ctx: Context, config: MathConfig, memory: ProjectMemoryService);
    analyze(agent: Agent, root: string, signal?: AbortSignal): Promise<QuestionAnalysis[]>;
}
