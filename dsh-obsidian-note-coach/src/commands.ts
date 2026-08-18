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
export function registerCommands(
  ctx: { commands: { register(def: { name: string; description: string; input?: { hint: string }; handler: (inv: { agent: any; rawInput: string; signal: AbortSignal }) => CommandResult | Promise<CommandResult> }): () => void } },
  config: NoteCoachConfig,
  judge: NoteJudgeService,
  report: NoteReportService,
  style: NoteStyleService,
  vault: NoteVaultService,
  git: NoteGitService,
): () => void {
  const disposers: Array<() => void> = [];

  disposers.push(
    ctx.commands.register({
      name: 'note',
      description: '对你说出的观点做判断与建议（判断/理由/建议/推荐位置分开输出），正确或非主观时弹窗征询是否记入笔记',
      input: { hint: '你的观点原文' },
      handler: async ({ agent, rawInput, signal }) => {
        const opinion = rawInput.trim();
        if (!opinion) {
          return { kind: 'error', text: '用法：/note <你的观点>' };
        }
        try {
          const outcome = await judge.judge(agent, opinion, undefined, signal);
          return { kind: 'success', text: outcome.summary };
        } catch (err) {
          return { kind: 'error', text: `note-coach：${err instanceof Error ? err.message : String(err)}` };
        }
      },
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'note-followup',
      description: '对上一次观点判断的理由继续追问（支持连续追问）',
      input: { hint: '你的追问，例如：为什么这么判断？' },
      handler: async ({ agent, rawInput, signal }) => {
        const question = rawInput.trim();
        if (!question) {
          return { kind: 'error', text: '用法：/note-followup <你的追问>' };
        }
        try {
          const outcome = await judge.followUp(agent, question, signal);
          return { kind: 'success', text: `【追问回答】\n${outcome.answer}` };
        } catch (err) {
          return { kind: 'error', text: `note-coach：${err instanceof Error ? err.message : String(err)}` };
        }
      },
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'note-organize',
      description: '把本次追问过程（原始观点+判断+理由+全部追问回答）整理为笔记，弹窗询问保存位置',
      handler: async ({ agent, signal }) => {
        try {
          const outcome = await judge.organizeThread(agent, signal);
          return { kind: 'success', text: outcome.summary };
        } catch (err) {
          return { kind: 'error', text: `note-coach：${err instanceof Error ? err.message : String(err)}` };
        }
      },
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'notes-report',
      description: '生成笔记报告：总结或客观评价，自动附带计划对比',
      input: { hint: '[scope[:target]] [mode]  例如: global evaluate / folder:Projects summary / tag:AI summary' },
      handler: async ({ agent, rawInput, signal }) => {
        const parts = rawInput.trim().split(/\s+/).filter(Boolean);
        let scope: 'global' | 'folder' | 'note' | 'tag' = 'global';
        let target: string | undefined;
        let mode: 'summary' | 'evaluate' = 'summary';
        for (const part of parts) {
          const [head, ...rest] = part.split(':');
          if ((head === 'folder' || head === 'note' || head === 'tag') && rest.length) {
            scope = head;
            target = rest.join(':');
          } else if (head === 'global') {
            scope = 'global';
            target = undefined;
          } else if (head === 'summary' || head === 'evaluate') {
            mode = head;
          } else if (head === 'folder' || head === 'note' || head === 'tag') {
            scope = head;
          }
        }
        try {
          const result = await report.generate(agent, { scope, target, mode }, signal);
          return {
            kind: 'success',
            text: `📄 报告（笔记 ${result.noteCount} 篇${result.planCount ? `，计划 ${result.planCount} 篇` : ''}）${result.savedPath ? `\n保存于：${result.savedPath}` : ''}\n\n${result.markdown}`,
          };
        } catch (err) {
          return { kind: 'error', text: `note-coach：${err instanceof Error ? err.message : String(err)}` };
        }
      },
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'notes-style',
      description: '学习/查看笔记书写风格画像（不含价值取向）；clear-memory 清除易失观点记忆',
      input: { hint: '[status | clear-memory]' },
      handler: async ({ agent, rawInput, signal }) => {
        const cmd = rawInput.trim();
        const root = vault.vaultRoot(agent);
        if (cmd === 'clear-memory') {
          await style.clearMemory(root);
          return { kind: 'success', text: '已清除易失观点记忆（价值取向不持久化，仅保留书写风格）。' };
        }
        if (cmd === 'status') {
          const current = await style.loadStyle(root);
          return {
            kind: 'success',
            text: current
              ? `当前风格画像（.harness/notes-style.json，可跨电脑迁移）：\n\`\`\`json\n${JSON.stringify(current, null, 2)}\n\`\`\``
              : '尚未生成风格画像。运行 /notes-style 学习。',
          };
        }
        const index = await vault.scan(root, signal);
        const learned = await style.learnStyle(agent, index, signal);
        return {
          kind: 'success',
          text: `已学习 ${index.notes.length} 篇笔记的书写风格（仅机械风格，不含价值取向）：\n\`\`\`json\n${JSON.stringify(learned, null, 2)}\n\`\`\``,
        };
      },
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'notes-push',
      description: '配置 GitHub 仓库并上推笔记（先设置仓库地址，之后直接推送）',
      input: { hint: '<仓库链接> 或留空直接推送' },
      handler: async ({ agent, rawInput, signal }) => {
        const root = vault.vaultRoot(agent);
        const url = rawInput.trim();
        if (url) {
          try {
            const set = await git.setRepo(root, url);
            return { kind: 'success', text: `已记录仓库地址：${set}\n再次运行 /notes-push 即可上推。` };
          } catch (err) {
            return { kind: 'error', text: err instanceof Error ? err.message : String(err) };
          }
        }
        const result = await git.push(root, undefined, signal);
        return { kind: result.ok ? 'success' : 'error', text: result.output.join('\n') };
      },
    }),
  );

  return () => {
    for (const dispose of disposers) dispose();
  };
}
