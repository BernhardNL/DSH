import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { MathConfig } from './types.js';
import type { ProjectMemoryService } from './memory.js';
/**
 * 论文生成服务：从项目记忆汇编论文（Markdown+LaTeX 公式+统计图），
 * 用 pandoc 转成规范 Word（公式转 Word 原生公式，图片嵌入）。
 * 支持带修改要求重新生成（可修改已写论文）。
 */
export declare class PaperService extends Service {
    private readonly config;
    private readonly memory;
    constructor(ctx: Context, config: MathConfig, memory: ProjectMemoryService);
    generate(agent: Agent, root: string, extraReqs?: string, signal?: AbortSignal): Promise<string>;
    /**
     * 重排版已有论文：读取源论文文件（docx/pdf/txt），通读并补充公式
     * （把【待展开】等占位替换为完整 LaTeX 公式），输出新的 Word。
     */
    repaper(agent: Agent, root: string, sourceFile: string, extraReqs?: string, signal?: AbortSignal): Promise<string>;
    /**
     * docx 源论文原位重排：保留原文档全部内容（OMML 公式、表格、图片、目录、样式），
     * 仅在公式占位符处插入 LaTeX→OMML 公式；有格式档案且要求"按格式重排"时顺带套用标题样式。
     */
    private repaperDocx;
    /** 全文逐块重排（不限块数；每块独立短请求；中途可取消；失败块保留原文）。 */
    private reformatAll;
    /** 重排后自检：确定性检查 + 抽样 LLM 复核。 */
    private selfCheck;
    private saveCheckReport;
}
/** 请求取消某项目的重排。 */
export declare function requestCancel(root: string): void;
/** 清空取消标记（重排完成/取消后自动调用，也可手动）。 */
export declare function clearCancel(root: string): void;
