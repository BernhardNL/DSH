import type { CommandResult } from '@deepseek-ai/dsh-commands';
import type { NoteCoachConfig } from './types.js';
import type { NoteJudgeService } from './judge.js';
import type { NoteReportService } from './report.js';
import type { NoteStyleService } from './style.js';
import type { NoteVaultService } from './vault.js';
import type { NoteGitService } from './github.js';
/**
 * Slash commands — the explicit half of the opinion trigger, plus style,
 * report, and GitHub-push entry points. Command results are rendered by the
 * UI command plane and never enter model history.
 */
export declare function registerCommands(ctx: {
    commands: {
        register(def: {
            name: string;
            description: string;
            input?: {
                hint: string;
            };
            handler: (inv: {
                agent: any;
                rawInput: string;
                signal: AbortSignal;
            }) => CommandResult | Promise<CommandResult>;
        }): () => void;
    };
}, config: NoteCoachConfig, judge: NoteJudgeService, report: NoteReportService, style: NoteStyleService, vault: NoteVaultService, git: NoteGitService): () => void;
