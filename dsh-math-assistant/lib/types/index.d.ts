import { Context } from '@deepseek-ai/cordis';
export * from './types.js';
export { ProjectMemoryService } from './memory.js';
export { AnalysisService } from './analysis.js';
export { PipelineService } from './pipeline.js';
export { DataService } from './data.js';
export { CodeGenService } from './codegen.js';
export { ReferencesService } from './references.js';
export { PaperService } from './paper.js';
export { FormatService } from './format.js';
/**
 * dsh-math-assistant — 数学建模助手。
 *
 * 独立页面（/math-assistant）：先选工作区（建模项目文件夹），六区块：
 * 题目分析 / 需求与提问 / 阶段显示 / 文献参考 / 程序 / 数据。
 * 项目记忆按工作区隔离持久化；一键 pandoc 生成规范 Word 论文。
 */
declare function mathAssistant(ctx: Context, input?: unknown): () => void;
declare namespace mathAssistant {
    var inject: string[];
}
export default mathAssistant;
