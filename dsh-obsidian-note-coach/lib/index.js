import { resolveConfig } from './config.js';
import { NoteVaultService } from './vault.js';
import { NoteStyleService } from './style.js';
import { NoteWriterService } from './notes.js';
import { NoteJudgeService } from './judge.js';
import { NoteReportService } from './report.js';
import { NoteGitService } from './github.js';
import { installWriteGuard } from './guard.js';
import { registerTools } from './tools.js';
import { registerCommands } from './commands.js';
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
export default function noteCoach(ctx, input) {
    const config = resolveConfig(input);
    if (!config.enabled)
        return () => undefined;
    // Services auto-register on ctx through their Service constructors.
    const vault = new NoteVaultService(ctx, config);
    const style = new NoteStyleService(ctx, config);
    const writer = new NoteWriterService(ctx, config);
    const judge = new NoteJudgeService(ctx, config, vault, style, writer);
    const report = new NoteReportService(ctx, config);
    const git = new NoteGitService(ctx);
    const disposers = [];
    // Write-approval guard: force user consent before any model-facing rewrite.
    disposers.push(installWriteGuard(ctx, config));
    // Model-facing tools (opinion judge + follow-up + report) — the auto-detect hook.
    disposers.push(registerTools(ctx, config, judge, report));
    // Slash commands — the explicit trigger + style/report/push entry points.
    disposers.push(registerCommands(ctx, config, judge, report, style, vault, git));
    // Optional auto-detect guidance in the system prompt (when available).
    const systemPrompt = ctx.get('systemPrompt');
    if (systemPrompt && config.autoDetect) {
        disposers.push(systemPrompt.section({
            name: 'note-coach',
            order: 120,
            text: '当用户表达观点/看法时，调用 note_coach_judge 工具：独立判断其是否正确并给出建议；' +
                '正确或非主观且用户同意后，按用户书写风格记入笔记。判断始终基于当下陈述，不依赖历史价值记忆。',
        }));
    }
    // Volatile opinion-memory hygiene at startup: purge stale entries.
    try {
        const cwd = process.cwd();
        void style.loadMemory(cwd);
    }
    catch {
        // best effort
    }
    return () => {
        for (const dispose of disposers)
            dispose();
    };
}
noteCoach.inject = ['fs', 'llm', 'tools', 'commands'];
