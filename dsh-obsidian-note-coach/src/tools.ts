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
export function registerTools(
  ctx: { tools: { register(definition: ReturnType<typeof defineTool>): () => void } },
  config: NoteCoachConfig,
  judge: NoteJudgeService,
  report: NoteReportService,
): () => void {
  const disposers: Array<() => void> = [];

  if (config.autoDetect) {
    disposers.push(
      ctx.tools.register(
        defineTool({
          name: 'note_coach_judge',
          description:
            '当用户表达观点或看法时（例如“我认为…”“我觉得…”“我的看法是…”）调用。独立、中立地判断该观点是否正确（对照用户自己的知识库笔记），输出分开的【判断】【理由】【建议】和【推荐记录位置】；若判断为正确或属非主观陈述，则弹窗征询用户：同意按推荐位置记录，或用自然语言补充内容/指定位置。观点判断不依赖任何历史价值记忆。',
          parameters: {
            opinion: { type: 'string', required: true, description: '用户表达的观点原文' },
            context: { type: 'string', description: '可选：相关的对话上下文' },
          },
          output: {
            schema: {
              type: 'object',
              properties: {
                verdict: { type: 'string', required: true },
                confidence: { type: 'number' },
                reasoning: { type: 'string', required: true },
                advice: { type: 'string', required: true },
                recommendedLocation: { type: 'string' },
                notePath: { type: 'string' },
                summary: { type: 'string', required: true },
              },
              additionalProperties: false,
            },
            render: (_args, value) => {
              const blocks: Array<{ type: 'text'; text: string }> = [
                { type: 'text', text: `【判断】${value.verdict}${value.confidence != null ? `（置信度 ${Math.round(value.confidence * 100)}%）` : ''}` },
                { type: 'text', text: `【理由】\n${value.reasoning}` },
                { type: 'text', text: `【建议】\n${value.advice}` },
              ];
              if (value.recommendedLocation) {
                blocks.push({ type: 'text', text: `【推荐记录位置】${value.recommendedLocation}` });
              }
              if (value.notePath) {
                blocks.push({ type: 'text', text: `✅ 已记入笔记：${value.notePath}\n（可继续追问理由：说"追问：…"）` });
              }
              return blocks;
            },
          },
          timeoutMs: 240_000,
          isConcurrencySafe: () => false,
          execute: async (args, exec) => {
            if (!exec.agent) {
              return {
                verdict: '（无法判断）',
                reasoning: 'note-coach：无法解析当前会话。请先在界面选择知识库目录作为工作区。',
                advice: '',
                summary: 'note-coach：无法解析当前会话。请先在界面选择知识库目录作为工作区。',
              };
            }
            try {
              const outcome = await judge.judge(exec.agent, args.opinion, args.context, exec.signal);
              return {
                verdict: outcome.verdict.verdict,
                confidence: outcome.verdict.confidence,
                reasoning: outcome.verdict.reasoning,
                advice: outcome.verdict.advice,
                recommendedLocation: outcome.verdict.recommendedLocation,
                notePath: outcome.insertion?.path,
                summary: outcome.summary,
              };
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              return {
                verdict: '（执行失败）',
                reasoning: message,
                advice: '',
                summary: `note-coach：判断流程失败 — ${message}`,
              };
            }
          },
        }),
      ),
    );

    disposers.push(
      ctx.tools.register(
        defineTool({
          name: 'note_coach_followup',
          description:
            '当用户对上一次观点判断的理由/结论继续追问时调用（例如“为什么这么判断？”“能举个反例吗？”“那如果换成XX呢？”）。基于原始观点与先前的判断、理由连续作答，不依赖历史价值记忆。',
          parameters: {
            question: { type: 'string', required: true, description: '用户的追问内容' },
          },
          output: {
            schema: {
              type: 'object',
              properties: { text: { type: 'string', required: true } },
              additionalProperties: false,
            },
            render: (_args, value) => [{ type: 'text', text: `【追问回答】\n${value.text}` }],
          },
          timeoutMs: 180_000,
          isConcurrencySafe: () => false,
          execute: async (args, exec) => {
            if (!exec.agent) {
              return { text: 'note-coach：无法解析当前会话。请先选择工作区。' };
            }
            try {
              const outcome = await judge.followUp(exec.agent, args.question, exec.signal);
              return { text: outcome.answer };
            } catch (err) {
              return { text: `note-coach：${err instanceof Error ? err.message : String(err)}` };
            }
          },
        }),
      ),
    );
  }

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'note_coach_report',
        description:
          '生成笔记报告：对指定内容或整个知识库做分类总结（纯内容总结）或客观评价（结构/覆盖/质量/缺口，中立语气）；笔记中含计划类内容（frontmatter type: plan 或含清单）时自动附带“计划 vs 现状”对比。报告保存到 .harness/reports/ 并返回 Markdown。',
        parameters: {
          scope: {
            type: 'string',
            required: true,
            enum: ['global', 'folder', 'note', 'tag'],
            description: 'global=全部笔记；folder=指定文件夹；note=单个笔记；tag=按标签',
          },
          target: { type: 'string', description: 'folder 路径 / 笔记相对路径 / 标签名（scope 非 global 时必填）' },
          mode: { type: 'string', required: true, enum: ['summary', 'evaluate'], description: 'summary=纯内容总结；evaluate=客观评价' },
          category: { type: 'string', description: '可选：按文件夹或标签过滤' },
        },
        output: {
          schema: {
            type: 'object',
            properties: {
              text: { type: 'string', required: true },
              savedPath: { type: 'string' },
              noteCount: { type: 'integer' },
              planCount: { type: 'integer' },
            },
            additionalProperties: false,
          },
          render: (_args, value) => [
            { type: 'text', text: `📄 报告（笔记 ${value.noteCount} 篇${value.planCount ? `，计划 ${value.planCount} 篇` : ''}）${value.savedPath ? `\n保存于：${value.savedPath}` : ''}\n\n${value.text}` },
          ],
        },
        timeoutMs: 240_000,
        isConcurrencySafe: () => false,
        execute: async (args, exec) => {
          if (!exec.agent) {
            return { text: 'note-coach：无法解析当前会话。请先选择工作区。', savedPath: undefined, noteCount: 0, planCount: 0 };
          }
          try {
            const result = await report.generate(
              exec.agent,
              { scope: args.scope, target: args.target, mode: args.mode, category: args.category },
              exec.signal,
            );
            return { text: result.markdown, savedPath: result.savedPath, noteCount: result.noteCount, planCount: result.planCount };
          } catch (err) {
            return { text: `note-coach：报告生成失败 — ${err instanceof Error ? err.message : String(err)}`, savedPath: undefined, noteCount: 0, planCount: 0 };
          }
        },
      }),
    ),
  );

  return () => {
    for (const dispose of disposers) dispose();
  };
}
