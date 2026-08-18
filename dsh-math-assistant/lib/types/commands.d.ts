import type { CommandResult } from '@deepseek-ai/dsh-commands';
import type { Context } from '@deepseek-ai/cordis';
import type { MathConfig } from './types.js';
import type { ProjectMemoryService } from './memory.js';
import type { AnalysisService } from './analysis.js';
import type { PipelineService } from './pipeline.js';
import type { DataService } from './data.js';
import type { CodeGenService } from './codegen.js';
import type { ReferencesService } from './references.js';
import type { PaperService } from './paper.js';
import type { FormatService } from './format.js';
/** 问题文件扩展名（页面文件选择器用）。 */
export declare const PROBLEM_EXTS: string[];
export declare const DATA_EXTS: string[];
type Handler = (inv: {
    agent: any;
    rawInput: string;
    signal: AbortSignal;
}) => CommandResult | Promise<CommandResult>;
export declare function registerCommands(ctx: Context & {
    commands: {
        register(def: {
            name: string;
            description: string;
            input?: {
                hint: string;
            };
            handler: Handler;
        }): () => void;
    };
}, config: MathConfig, memory: ProjectMemoryService, analysis: AnalysisService, pipeline: PipelineService, dataSvc: DataService, codegen: CodeGenService, refs: ReferencesService, paper: PaperService, format: FormatService): () => void;
export {};
