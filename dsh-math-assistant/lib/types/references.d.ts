import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { MathConfig, RefEntry } from './types.js';
import type { ProjectMemoryService } from './memory.js';
/**
 * 文献参考服务：为关键建模/算法步骤收集参考文献并校验链接可达性。
 */
export declare class ReferencesService extends Service {
    private readonly config;
    private readonly memory;
    constructor(ctx: Context, config: MathConfig, memory: ProjectMemoryService);
    collect(agent: Agent, root: string, topic: string, signal?: AbortSignal): Promise<RefEntry[]>;
}
