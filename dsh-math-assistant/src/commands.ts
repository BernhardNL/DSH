import type { CommandResult } from '@deepseek-ai/dsh-commands';
import type { FsTarget } from '@deepseek-ai/dsh-fs';
import type { Context } from '@deepseek-ai/cordis';
import type { MathConfig } from './types.js';
import { completeText } from './llm.js';
import type { ProjectMemoryService } from './memory.js';
import type { AnalysisService } from './analysis.js';
import type { PipelineService } from './pipeline.js';
import type { DataService } from './data.js';
import type { CodeGenService } from './codegen.js';
import type { ReferencesService } from './references.js';
import type { PaperService } from './paper.js';
import type { FormatService } from './format.js';
import { requestCancel } from './paper.js';
import { readProblemFile, workspaceFiles, readFileForContext } from './fileutil.js';

/** 问题文件扩展名（页面文件选择器用）。 */
export const PROBLEM_EXTS = ['.pdf', '.docx', '.doc', '.txt', '.md'];
export const DATA_EXTS = ['.txt', '.csv', '.xlsx', '.xls', '.tsv'];

const ASK_SYSTEM = [
  'You are a mathematical modeling assistant answering the user\'s question about their ongoing modeling project.',
  'Use the project context (problem, analysis, data, pipeline outputs) to answer concretely. If the context is insufficient, say so and ask for the missing piece.',
  'Keep answers focused and practical. Use LaTeX math where helpful.',
].join('\n');

type Handler = (inv: { agent: any; rawInput: string; signal: AbortSignal }) => CommandResult | Promise<CommandResult>;

export function registerCommands(
  ctx: Context & { commands: { register(def: { name: string; description: string; input?: { hint: string }; handler: Handler }): () => void } },
  config: MathConfig,
  memory: ProjectMemoryService,
  analysis: AnalysisService,
  pipeline: PipelineService,
  dataSvc: DataService,
  codegen: CodeGenService,
  refs: ReferencesService,
  paper: PaperService,
  format: FormatService,
): () => void {
  const disposers: Array<() => void> = [];
  const wrap =
    (fn: (agent: any, input: string, signal: AbortSignal) => Promise<string> | string): Handler =>
    async ({ agent, rawInput, signal }) => {
      try {
        const text = await fn(agent, rawInput, signal);
        return { kind: 'success', text };
      } catch (err) {
        return { kind: 'error', text: `math-assistant：${err instanceof Error ? err.message : String(err)}` };
      }
    };

  disposers.push(
    ctx.commands.register({
      name: 'math-problem',
      description: '设定题目（对话框描述或工作区文件名，如 xxx.pdf），并自动做题目分析',
      input: { hint: '<题目描述 或 工作区中的文件名>' },
      handler: wrap(async (agent, input, signal) => {
        const root = memory.projectRoot(agent);
        const trimmed = input.trim();
        if (!trimmed) return '用法：/math-problem <题目描述 或 文件名>。文件需先放入当前工作区。';
        await memory.update(root, async (m) => {
          const ext = PROBLEM_EXTS.find((e) => trimmed.toLowerCase().endsWith(e));
          if (ext) {
            const text = await readProblemFile(root, trimmed, config.pythonPath);
            m.problem.problemFile = trimmed;
            m.problem.title = trimmed.replace(/\.\w+$/, '');
            m.problem.description = text.slice(0, 30000);
          } else {
            m.problem.title = trimmed.slice(0, 40);
            m.problem.description = trimmed;
          }
        });
        const memAfter = await memory.load(root);
        const descLen = (memAfter.problem.description ?? '').trim().length;
        if (descLen < 80) {
          // 描述过短：文件可能没读成功，给出明确提示而不是继续分析
          return `⚠️ 题目内容过短（${descLen} 字符），可能未能正确读取文件。\n请确认：\n1. 文件名与工作区中的一致（可用 /math-files 查看）；\n2. 文件是 pdf/docx/txt 格式。\n然后重新执行 /math-problem <文件名>。`;
        }
        const result = await analysis.analyze(agent, root, signal);
        const summary =
          `✅ 题目已设定，完成分析（${result.length} 个问题）：\n\n` +
          result.map((a, i) => `${i + 1}. **${a.question}**（${a.type}）\n模型：${a.models.join('、')}\n思路：${a.approach}`).join('\n\n');
        return summary;
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-analyze',
      description: '重新生成题目分析（逐问：类型/模型/算法/思路）',
      handler: wrap(async (agent, _input, signal) => {
        const root = memory.projectRoot(agent);
        const result = await analysis.analyze(agent, root, signal);
        return (
          '✅ 题目分析：\n\n' +
          result
            .map((a, i) => `${i + 1}. **${a.question}**（${a.type}）\n- 模型：${a.models.join('、')}\n- 算法：${a.algorithms.join('、')}\n- 工具：${a.tools.join('、')}\n- 思路：${a.approach}\n- 子问题：${a.subProblems.join('；')}`)
            .join('\n\n')
        );
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-ask',
      description: '针对当前建模项目提问（需求与提问）；引用工作区文件（如 路径/xxx.pdf）会自动读取内容',
      input: { hint: '<你的问题>' },
      handler: wrap(async (agent, input, signal) => {
        const root = memory.projectRoot(agent);
        const mem = await memory.load(root);
        const q = input.trim();
        if (!q) return '用法：/math-ask <你的问题>';

        // 工作区文件清单 + 问题引用的文件内容
        const files = await workspaceFiles(root);
        const fileIndex = files.length ? `工作区文件清单：\n${files.join('\n')}` : '工作区无可见文件';
        let fileContents = '';
        const referenced = files.filter((f) => q.includes(f));
        for (const f of referenced.slice(0, 4)) {
          const text = await readFileForContext(root, f, config.pythonPath, 15000);
          fileContents += `\n\n[文件 ${f} 的内容]\n${text}`;
        }

        // 论文生成/重排版意图：直接路由到 repaper（绕开问答 LLM 的空响应问题）
        if (isPaperIntent(q)) {
          const papers = files.filter((f) => /\.(docx|pdf)$/i.test(f));
          const match = bestPaperMatch(papers, q);
          if (match) {
            const extra = q.replace(/帮我把|请|把|的/g, ' ').replace(/\s+/g, ' ').trim();
            return await paper.repaper(agent, root, match, extra || undefined, signal);
          }
          return '检测到你想生成/重排版论文，但未在工作区找到论文文件（docx/pdf）。请用 /math-files 查看文件，或运行 /math-repaper <文件名>。';
        }

        const context = [
          mem.problem.title ? `题目：${mem.problem.title}` : '',
          mem.problem.description ? `问题描述：${mem.problem.description.slice(0, 4000)}` : '',
          mem.analysis.length ? `题目分析：${mem.analysis.map((a) => `[${a.question}] ${a.type}; 模型=${a.models.join('/')}; 思路=${a.approach}`).join('; ')}` : '',
          mem.data.length ? `数据摘要：${mem.data.map((d) => `${d.fileName}(${d.rows}行)`).join('; ')}` : '',
          mem.pipeline.stages.length ? `流水线状态：${mem.pipeline.stages.filter((s) => s.status === 'done').length}/${mem.pipeline.stages.length} 阶段完成` : '',
          fileIndex,
          fileContents || '',
        ].filter(Boolean).join('\n');
        const answer = (await completeText(ctx, agent, ASK_SYSTEM, `Project context:\n${context}\n\nUser question: ${q}`, config.llm, signal)) || '（模型未返回内容，请重试或换个说法。）';
        await memory.update(root, (m) => {
          m.chat.push({ role: 'user', text: q });
          m.chat.push({ role: 'assistant', text: answer.slice(0, 4000) });
          if (m.chat.length > 100) m.chat = m.chat.slice(-100);
        });
        return answer;
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-run',
      description: '执行一个建模任务命令（自动设计并运行流水线，阶段显示会更新）',
      input: { hint: '<建模命令，如：建立并求解第一问的优化模型>' },
      handler: wrap(async (agent, input, signal) => {
        const root = memory.projectRoot(agent);
        const cmd = input.trim();
        if (!cmd) return '用法：/math-run <建模命令>';
        return await pipeline.run(agent, root, cmd, signal);
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-status',
      description: '返回流水线当前状态（阶段显示轮询用）',
      handler: wrap(async (agent, _input, _signal) => {
        const root = memory.projectRoot(agent);
        const s = await pipeline.status(root);
        return JSON.stringify(s);
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-snapshot',
      description: '返回项目记忆快照（页面恢复视图用）',
      handler: wrap(async (agent, _input, _signal) => {
        const root = memory.projectRoot(agent);
        const mem = await memory.load(root);
        return JSON.stringify({
          problem: mem.problem,
          analysis: mem.analysis,
          pipeline: mem.pipeline,
          references: mem.references,
          data: mem.data,
          code: mem.code,
          papers: mem.papers,
          chat: mem.chat,
        });
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-code',
      description: '按请求生成并验证 python 代码，验证通过后弹窗确认写入工作区',
      input: { hint: '<实现要求>' },
      handler: wrap(async (agent, input, signal) => {
        const root = memory.projectRoot(agent);
        const req = input.trim();
        if (!req) return '用法：/math-code <实现要求>';
        return await codegen.generate(agent, root, req, signal);
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-data',
      description: '处理工作区数据文件（txt/csv/xlsx），可指定显示什么结果',
      input: { hint: '<文件名> [显示要求，如：显示前10行和相关系数矩阵]' },
      handler: wrap(async (agent, input, signal) => {
        const root = memory.projectRoot(agent);
        const trimmed = input.trim();
        const [file, ...rest] = trimmed.split(/\s+/);
        const spec = rest.join(' ');
        if (!file) return '用法：/math-data <文件名> [显示要求]';
        const summary = await dataSvc.process(agent, root, file, spec, signal);
        return `📊 数据：${summary.fileName}（${summary.rows} 行）\n列：${summary.columns.join('、')}\n\n${summary.statsText}`;
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-refs',
      description: '为关键建模/算法步骤收集参考文献并校验链接',
      input: { hint: '<主题，如：ARIMA 时间序列预测>' },
      handler: wrap(async (agent, input, signal) => {
        const root = memory.projectRoot(agent);
        const topic = input.trim() || '本建模项目的关键模型与算法';
        const entries = await refs.collect(agent, root, topic, signal);
        return (
          '📚 文献参考：\n\n' +
          entries.map((r, i) => `${i + 1}. ${r.title}${r.url ? `\n   链接：${r.url}` : ''}\n   ${r.note}${r.verified ? '' : '（⚠️ 链接不可达/未验证）'}`).join('\n')
        );
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-paper',
      description: '一键生成规范 Word 论文（公式 LaTeX 转 Word 原生公式、统计图嵌入）；带参数=修改要求',
      input: { hint: '[修改要求，可选]' },
      handler: wrap(async (agent, input, signal) => {
        const root = memory.projectRoot(agent);
        return await paper.generate(agent, root, input.trim() || undefined, signal);
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-repaper',
      description: '读取已有论文（docx/pdf/txt），通读并补充公式（LaTeX），生成新的 Word 论文',
      input: { hint: '<源论文文件名> [额外要求，可选]' },
      handler: wrap(async (agent, input, signal) => {
        const root = memory.projectRoot(agent);
        const [file, ...rest] = input.trim().split(/\s+/);
        if (!file) return '用法：/math-repaper <源论文文件名> [额外要求]';
        return await paper.repaper(agent, root, file, rest.join(' ') || undefined, signal);
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-learn-format',
      description: '从参考论文学习论文格式规范（章节/标题/公式/图表/引用等），之后重排版自动套用',
      input: { hint: '<参考论文文件名，可多个，空格分隔>' },
      handler: wrap(async (agent, input, signal) => {
        const root = memory.projectRoot(agent);
        const files = input.trim().split(/\s+/).filter(Boolean);
        if (!files.length) return '用法：/math-learn-format <参考论文1> [参考论文2] …';
        const profile = await format.learn(agent, root, files, signal);
        return '📐 已学习格式规范档案：\n\n' + format.profileText(profile) + '\n\n后续 /math-repaper、/math-paper 会自动套用。';
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-format',
      description: '查看/清除已学习的论文格式规范',
      input: { hint: '[status | clear]' },
      handler: wrap(async (agent, input, signal) => {
        const root = memory.projectRoot(agent);
        const cmd = input.trim().toLowerCase();
        if (cmd === 'clear') {
          const questions = ctx.get('userQuestions');
          let confirmed = false;
          if (questions) {
            try {
              const answer = await questions.ask({
                agent,
                signal,
                questions: [
                  {
                    id: 'format_clear',
                    header: '清除格式规范',
                    question: '确定要清除已学习的论文格式规范档案吗？',
                    options: [
                      { label: '确认清除', description: '之后重排版不再套用该格式' },
                      { label: '取消', description: '保留格式规范' },
                    ],
                  },
                ],
              });
              confirmed = answer.answers[0]?.selected.includes('确认清除') ?? false;
            } catch {
              confirmed = false;
            }
          }
          if (confirmed) {
            await format.clear(root);
            return '🗑️ 已清除格式规范档案。';
          }
          return '已取消。';
        }
        const p = await format.load(root);
        return p ? '📐 当前格式规范档案：\n\n' + format.profileText(p) : '尚未学习格式规范。运行 /math-learn-format <参考论文>。';
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-cancel',
      description: '取消正在进行的论文重排版（下一次块边界处生效）',
      handler: wrap(async (agent, _input, _signal) => {
        const root = memory.projectRoot(agent);
        requestCancel(root);
        return '⏹ 已请求取消重排版，将在当前块结束后停止（已完成的块会保留）。';
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-files',
      description: '列出工作区文件（页面文件选择用）',
      handler: wrap(async (agent, _input, _signal) => {
        const root = memory.projectRoot(agent);
        const files = await workspaceFiles(root);
        return files.join('\n') || '（工作区暂无可见文件）';
      }),
    }),
  );

  disposers.push(
    ctx.commands.register({
      name: 'math-memory',
      description: '查看/清除项目记忆（清除前弹窗确认）',
      input: { hint: '[status | clear]' },
      handler: wrap(async (agent, input, signal) => {
        const root = memory.projectRoot(agent);
        const cmd = input.trim().toLowerCase();
        if (cmd === 'clear') {
          const questions = ctx.get('userQuestions');
          let confirmed = false;
          if (questions) {
            try {
              const answer = await questions.ask({
                agent,
                signal,
                questions: [
                  {
                    id: 'memory_clear',
                    header: '清除记忆',
                    question: '确定要清除本项目的全部记忆吗？（题目、分析、数据、流水线、代码记录、论文记录、聊天）',
                    options: [
                      { label: '确认清除', description: '不可恢复' },
                      { label: '取消', description: '保留记忆' },
                    ],
                  },
                ],
              });
              confirmed = answer.answers[0]?.selected.includes('确认清除') ?? false;
            } catch {
              confirmed = false;
            }
          }
          if (confirmed) {
            await memory.clear(root);
            return '🗑️ 已清除本项目记忆。';
          }
          return '已取消清除，记忆保留。';
        }
        const mem = await memory.load(root);
        return [
          `题目：${mem.problem.title || mem.problem.problemFile || '（未设定）'}`,
          `分析：${mem.analysis.length} 问`,
          `数据：${mem.data.length} 份`,
          `流水线：${mem.pipeline.stages.length} 阶段（${mem.pipeline.status}）`,
          `文献：${mem.references.length} 条`,
          `代码：${mem.code.length} 个`,
          `论文：${mem.papers.length} 篇`,
          `聊天：${mem.chat.length} 条`,
        ].join('\n');
      }),
    }),
  );

  return () => {
    for (const dispose of disposers) dispose();
  };
}

/** 判断是否"生成/重排版论文"意图。 */
function isPaperIntent(q: string): boolean {
  const action = /(生成|补全|转成|转|写|整理|重排|输出)/.test(q);
  const target = /(论文|word|公式|latex|排版|docx|pdf)/i.test(q);
  return action && target;
}

/** 从论文文件列表中模糊匹配最符合问题描述的文件。 */
function bestPaperMatch(papers: string[], q: string): string | undefined {
  if (papers.length === 0) return undefined;
  const tokens = q.split(/[\s，。、的]/).map((t) => t.trim()).filter((t) => t.length >= 2);
  let best: string | undefined;
  let bestScore = 0;
  for (const p of papers) {
    const lower = p.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (lower.includes(t.toLowerCase())) score += t.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  // 完全没有命中时，若只有一个论文文件则用它
  return best ?? (papers.length === 1 ? papers[0] : undefined);
}
