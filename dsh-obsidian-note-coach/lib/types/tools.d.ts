import { defineTool } from '@deepseek-ai/dsh-tools';
import type { NoteCoachConfig } from './types.js';
import type { NoteJudgeService } from './judge.js';
import type { NoteReportService } from './report.js';
/**
 * Register the model-facing tools:
 *
 * - `note_coach_judge` — the opinion-judging entry point. Its description
 *   doubles as the auto-detect hook: when the model sees the user state an
 *   opinion, it calls this tool (the "auto" half of the trigger design). The
 *   `/note` command is the explicit half. Output separates 判断 / 理由 /
 *   建议 / 推荐记录位置.
 * - `note_coach_followup` — continuous follow-up on the latest judgment's
 *   reasoning.
 * - `note_coach_report` — report generation (summary / evaluation / plan
 *   comparison).
 */
export declare function registerTools(ctx: {
    tools: {
        register(definition: ReturnType<typeof defineTool>): () => void;
    };
}, config: NoteCoachConfig, judge: NoteJudgeService, report: NoteReportService): () => void;
