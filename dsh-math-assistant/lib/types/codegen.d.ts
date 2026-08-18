import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { MathConfig } from './types.js';
import type { ProjectMemoryService } from './memory.js';
/**
 * 代码生成服务：按请求生成 python 代码 → 语法/冒烟验证 → 弹窗确认 → 写入工作区。
 */
export declare class CodeGenService extends Service {
    private readonly config;
    private readonly memory;
    constructor(ctx: Context, config: MathConfig, memory: ProjectMemoryService);
    generate(agent: Agent, root: string, request: string, signal?: AbortSignal): Promise<string>;
}
