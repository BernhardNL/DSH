import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { MathConfig, PipelineStage } from './types.js';
import { completeText, extractJson } from './llm.js';
import type { ProjectMemoryService } from './memory.js';
import { runPython } from './py.js';

const PLAN_SYSTEM = [
  'You design an execution pipeline for a mathematical modeling task.',
  'Given the modeling problem context and the user\'s command, produce a step-by-step plan. Each step must be concrete and actionable.',
  'Output STRICT JSON only: { "plan": string, "stages": [ { "title": string, "detail": string, "task": string } ] }',
  '"plan" is a one-paragraph summary of the overall approach. "task" tells the worker what to produce in this step (analysis, equations, code, verification…). 5-10 stages.',
].join('\n');

const WORKER_SYSTEM = [
  'You are a mathematical modeling worker executing one step of a pipeline.',
  'Produce the deliverable for your assigned task using the project context provided.',
  'If you produce Python code, put it in a single ```python fenced block; otherwise plain text/markdown is fine. Be rigorous and concrete.',
].join('\n');

/**
 * 阶段显示服务：总体步骤设计 + 当前执行 + 推理简述。
 * 每次命令触发时规划并顺序执行阶段；每完成一阶段即保存记忆，
 * 页面可轮询 /math-status 获得实时进度。
 */
export class PipelineService extends Service {
  constructor(
    ctx: Context,
    private readonly config: MathConfig,
    private readonly memory: ProjectMemoryService,
  ) {
    super(ctx, 'mathPipeline');
  }

  async status(root: string): Promise<{ status: string; current: string; stages: PipelineStage[]; plan: string }> {
    const mem = await this.memory.load(root);
    const p = mem.pipeline;
    return { status: p.status, current: p.current, stages: p.stages, plan: p.plan };
  }

  /**
   * 规划并执行用户命令对应的流水线。
   * @returns 最终汇总文本（同时会写入聊天记录）。
   */
  async run(agent: Agent, root: string, command: string, signal?: AbortSignal): Promise<string> {
    const mem = await this.memory.load(root);
    const context = buildContext(mem);

    // 1. 规划
    const planAnswer = await completeText(
      this.ctx,
      agent,
      PLAN_SYSTEM,
      `Project context:\n${context}\n\nUser command: ${command}\n\nDesign the pipeline now.`,
      { temperature: 0.2, maxTokens: 2000 },
      signal,
    );
    const plan = extractJson<{ plan?: string; stages?: Array<{ title?: string; detail?: string; task?: string }> }>(planAnswer);
    let stages: PipelineStage[] = (plan?.stages ?? [])
      .filter((s) => s && typeof s === 'object')
      .map((s, i) => ({
        title: s.title || `阶段 ${i + 1}`,
        detail: s.detail || '',
        status: 'pending' as const,
        reasoningBrief: s.task || '',
      }));
    if (stages.length === 0) {
      // 解析失败时的兜底计划：通用建模阶段，保证命令总能执行
      stages = [
        { title: '理解任务与数据', detail: '梳理命令要求与现有项目上下文', status: 'pending', reasoningBrief: '结合题目/分析/数据明确要做什么' },
        { title: '建立模型', detail: '给出模型的形式化描述（公式）', status: 'pending', reasoningBrief: '选择合适模型并用公式表达' },
        { title: '求解与实现', detail: '给出求解思路或代码', status: 'pending', reasoningBrief: '用解析解/数值方法或代码求解' },
        { title: '结果与检验', detail: '展示结果并做合理性检验', status: 'pending', reasoningBrief: '数值核对、误差或敏感性简述' },
      ];
    }

    await this.memory.update(root, (m) => {
      m.pipeline = {
        status: 'running',
        stages,
        currentIndex: -1,
        current: '规划完成，开始执行',
        plan: plan?.plan || '',
        updatedAt: new Date().toISOString(),
      };
    });

    // 2. 顺序执行
    const outputs: string[] = [];
    for (let i = 0; i < stages.length; i++) {
      if (signal?.aborted) break;
      const stage = stages[i];
      await this.memory.update(root, (m) => {
        stage.status = 'running';
        m.pipeline.currentIndex = i;
        m.pipeline.current = stage.title;
        m.pipeline.stages = stages;
        m.pipeline.updatedAt = new Date().toISOString();
      });

      let output = '';
      let error: string | undefined;
      try {
        const workerContext = [context, ...outputs.map((o, j) => `\n[阶段 ${j + 1} 输出]\n${o.slice(0, 1500)}`)].join('\n');
        output = await completeText(
          this.ctx,
          agent,
          WORKER_SYSTEM,
          `Project context:\n${workerContext}\n\nYour task (stage ${i + 1}): ${stage.title}\n${stage.reasoningBrief}\n\nProduce the deliverable now.`,
          { temperature: this.config.llm.temperature, maxTokens: this.config.llm.maxTokens },
          signal,
        );
        // 若输出含 python 代码块且阶段需要实现：保存+校验
        const code = extractPythonCode(output);
        if (code) {
          const saved = await this.saveAndValidate(agent, root, stage.title, code, signal);
          if (saved) output += `\n\n[代码已保存: ${saved.path}，验证: ${saved.verified ? '通过' : '未通过'}]`;
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
        output = `（本阶段执行失败：${error}）`;
      }
      if (!output.trim()) {
        output = '（该阶段未生成文本内容——可能是模型偶发空响应。建议重新运行本命令或换一种表述。）';
      }

      outputs.push(output);
      await this.memory.update(root, (m) => {
        stage.status = error ? 'error' : 'done';
        stage.output = output.slice(0, 4000);
        m.pipeline.currentIndex = i;
        m.pipeline.stages = stages;
        m.pipeline.updatedAt = new Date().toISOString();
      });
    }

    const summary = `✅ 流水线完成（${stages.length} 个阶段）。\n\n${stages.map((s, i) => `${i + 1}. ${s.title} — ${s.status === 'done' ? '完成' : s.status === 'error' ? '失败' : '未执行'}`).join('\n')}\n\n（详细输出见各阶段）`;

    await this.memory.update(root, (m) => {
      m.pipeline.status = 'done';
      m.pipeline.current = '已完成';
      m.pipeline.stages = stages;
      m.pipeline.updatedAt = new Date().toISOString();
      m.chat.push({ role: 'user', text: command });
      m.chat.push({ role: 'assistant', text: summary });
      if (m.chat.length > 100) m.chat = m.chat.slice(-100);
    });

    return summary;
  }

  private async saveAndValidate(
    agent: Agent,
    root: string,
    stageTitle: string,
    code: string,
    signal?: AbortSignal,
  ): Promise<{ path: string; verified: boolean } | undefined> {
    try {
      const { writeFileSync, mkdirSync } = await import('node:fs');
      const dir = `${root}/code`;
      mkdirSync(dir, { recursive: true });
      const name = safeName(stageTitle);
      const path = `code/${name}.py`;
      writeFileSync(`${root}/${path}`, code, 'utf8');
      // 简单验证：语法检查（py_compile）
      const checkCode = [
        'import py_compile, sys',
        'try:',
        '    py_compile.compile(sys.argv[1], doraise=True)',
        '    print("SYNTAX_OK")',
        'except Exception as e:',
        '    print("SYNTAX_ERR:", e)',
        '    sys.exit(1)',
      ].join('\n');
      const res = await runPython(root, this.config.workDir, checkCode, [path], 30_000, this.config.pythonPath);
      const verified = res.ok && res.stdout.includes('SYNTAX_OK');
      await this.memory.update(root, (m) => {
        m.code.push({ name, path, language: 'python', description: stageTitle, verified, verificationNote: verified ? '语法校验通过' : `语法校验失败：${res.stderr.slice(0, 300)}` });
      });
      return { path, verified };
    } catch (err) {
      return undefined;
    }
  }
}

function buildContext(mem: Awaited<ReturnType<ProjectMemoryService['load']>>): string {
  const parts: string[] = [];
  if (mem.problem.title) parts.push(`题目：${mem.problem.title}`);
  if (mem.problem.description) parts.push(`问题描述：${mem.problem.description}`);
  if (mem.problem.problemFile) parts.push(`问题文件：${mem.problem.problemFile}`);
  if (mem.analysis.length) {
    parts.push(
      '题目分析：' + mem.analysis.map((a) => `[${a.question}] 类型=${a.type}; 模型=${a.models.join('/')}; 思路=${a.approach}`).join('\n'),
    );
  }
  if (mem.data.length) {
    parts.push('数据摘要：' + mem.data.map((d) => `${d.fileName}(${d.rows}行, ${d.columns.join(',')})`).join('; '));
  }
  return parts.join('\n\n');
}

function extractPythonCode(text: string): string | undefined {
  const m = text.match(/```python\n([\s\S]*?)```/);
  return m ? m[1].trim() : undefined;
}

function safeName(title: string): string {
  return title.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 40) || 'stage';
}
