import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { MathConfig, DataSummary } from './types.js';
import type { ProjectMemoryService } from './memory.js';
/**
 * 数据处理服务：读取 txt/csv/xlsx，做基础处理并展示结果。
 * - 固定脚本给出基本信息（行数/列/类型/描述统计/缺失值）
 * - 用户可指定"显示什么结果"（displaySpec），由 LLM 生成对应 pandas 代码执行
 * - 结果写入项目记忆（数据摘要），供其他模块（流水线/论文）使用
 */
export declare class DataService extends Service {
    private readonly config;
    private readonly memory;
    constructor(ctx: Context, config: MathConfig, memory: ProjectMemoryService);
    process(agent: Agent, root: string, fileName: string, displaySpec?: string, signal?: AbortSignal): Promise<DataSummary>;
}
