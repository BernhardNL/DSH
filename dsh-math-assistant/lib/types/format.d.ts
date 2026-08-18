import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { MathConfig, PaperFormatProfile } from './types.js';
import type { ProjectMemoryService } from './memory.js';
/**
 * 论文格式学习服务：从用户提供的严谨格式论文中提炼格式规范档案，
 * 供重排版/生成论文时套用（按项目隔离、随记忆持久化）。
 */
export declare class FormatService extends Service {
    private readonly config;
    private readonly memory;
    constructor(ctx: Context, config: MathConfig, memory: ProjectMemoryService);
    learn(agent: Agent, root: string, files: string[], signal?: AbortSignal): Promise<PaperFormatProfile>;
    load(root: string): Promise<PaperFormatProfile | undefined>;
    clear(root: string): Promise<void>;
    /** 渲染成可注入提示的文本。 */
    profileText(p: PaperFormatProfile | undefined): string;
}
