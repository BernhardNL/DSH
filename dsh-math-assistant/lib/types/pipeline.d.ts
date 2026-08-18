import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { MathConfig, PipelineStage } from './types.js';
import type { ProjectMemoryService } from './memory.js';
/**
 * 阶段显示服务：总体步骤设计 + 当前执行 + 推理简述。
 * 每次命令触发时规划并顺序执行阶段；每完成一阶段即保存记忆，
 * 页面可轮询 /math-status 获得实时进度。
 */
export declare class PipelineService extends Service {
    private readonly config;
    private readonly memory;
    constructor(ctx: Context, config: MathConfig, memory: ProjectMemoryService);
    status(root: string): Promise<{
        status: string;
        current: string;
        stages: PipelineStage[];
        plan: string;
    }>;
    /**
     * 规划并执行用户命令对应的流水线。
     * @returns 最终汇总文本（同时会写入聊天记录）。
     */
    run(agent: Agent, root: string, command: string, signal?: AbortSignal): Promise<string>;
    private saveAndValidate;
}
