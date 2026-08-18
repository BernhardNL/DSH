import { Context } from '@deepseek-ai/cordis';
export * from './types.js';
export { resolveConfig } from './config.js';
export { NoteVaultService } from './vault.js';
export { NoteStyleService } from './style.js';
export { NoteWriterService } from './notes.js';
export { NoteJudgeService } from './judge.js';
export { NoteReportService } from './report.js';
export { NoteGitService } from './github.js';
/**
 * dsh-obsidian-note-coach
 *
 * Obsidian note coach for DSH. Mount with the vault folder selected as the
 * workspace root:
 *
 * ```yaml
 * - id: note-coach
 *   name: 'dsh-obsidian-note-coach'
 *   config:
 *     enabled: true
 * ```
 *
 * Capabilities:
 * - Scans the workspace vault and learns the user's writing style into a
 *   portable `.harness/notes-style.json` (style only — never value content).
 * - Opinion judging: when the user states an opinion, an independent LLM call
 *   evaluates it against the user's knowledge base and advises; when correct
 *   or non-subjective, the user is asked whether to take a note, and the note
 *   is written in the learned style at the appropriate location.
 * - Write guard: every model-facing `write`/`edit` requires user approval.
 * - Reports: summary / objective evaluation / plan-vs-actual, saved under
 *   `.harness/reports`.
 * - GitHub push: configure a repo URL and push the vault.
 */
declare function noteCoach(ctx: Context, input?: unknown): () => void;
declare namespace noteCoach {
    var inject: string[];
}
export default noteCoach;
