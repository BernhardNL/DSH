import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { NoteCoachConfig } from './types.js';
export interface ReportRequest {
    scope: 'global' | 'folder' | 'note' | 'tag';
    /** Folder path, note relPath, or tag, depending on scope. */
    target?: string;
    mode: 'summary' | 'evaluate';
    /** Optional category filter (folder or tag name). */
    category?: string;
}
export interface ReportResult {
    markdown: string;
    /** Absolute path the report was saved to (when saved). */
    savedPath?: string;
    noteCount: number;
    planCount: number;
}
/**
 * Report generator: content summary, objective evaluation, and plan-vs-actual
 * comparison for planning notes. Reports are saved under the vault's
 * `.harness/reports` directory and returned as markdown.
 */
export declare class NoteReportService extends Service {
    private readonly config;
    constructor(ctx: Context, config: NoteCoachConfig);
    generate(agent: Agent, req: ReportRequest, signal?: AbortSignal): Promise<ReportResult>;
    private saveReport;
}
