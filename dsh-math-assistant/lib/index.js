import { resolveConfig } from './config.js';
import { ProjectMemoryService } from './memory.js';
import { AnalysisService } from './analysis.js';
import { PipelineService } from './pipeline.js';
import { DataService } from './data.js';
import { CodeGenService } from './codegen.js';
import { ReferencesService } from './references.js';
import { PaperService } from './paper.js';
import { FormatService } from './format.js';
import { registerCommands } from './commands.js';
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
export default function mathAssistant(ctx, input) {
    const config = resolveConfig(input);
    if (!config.enabled)
        return () => undefined;
    const memory = new ProjectMemoryService(ctx, config);
    const analysis = new AnalysisService(ctx, config, memory);
    const pipeline = new PipelineService(ctx, config, memory);
    const dataSvc = new DataService(ctx, config, memory);
    const codegen = new CodeGenService(ctx, config, memory);
    const refs = new ReferencesService(ctx, config, memory);
    const paper = new PaperService(ctx, config, memory);
    const format = new FormatService(ctx, config, memory);
    const disposers = [];
    disposers.push(registerCommands(ctx, config, memory, analysis, pipeline, dataSvc, codegen, refs, paper, format));
    const systemPrompt = ctx.get('systemPrompt');
    if (systemPrompt) {
        disposers.push(systemPrompt.section({
            name: 'math-assistant',
            order: 121,
            text: '用户可用数学建模助手（/math-problem、/math-run、/math-code、/math-data、/math-paper 等命令）进行数学建模。' +
                '建模流程与论文输出由该插件负责，用户在其独立页面中操作。',
        }));
    }
    return () => {
        for (const dispose of disposers)
            dispose();
    };
}
mathAssistant.inject = ['fs', 'llm', 'commands'];
