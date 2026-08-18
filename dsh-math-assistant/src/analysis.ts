import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { MathConfig, QuestionAnalysis } from './types.js';
import { completeText, extractJson } from './llm.js';
import type { ProjectMemoryService } from './memory.js';

const ANALYZE_SYSTEM = [
  'You are a mathematical modeling coach. Analyze the given modeling problem.',
  'For EACH sub-question in the problem, output analysis covering: the type of problem, candidate models, candidate algorithms, tools/libraries, a concise solution approach (keep the key points, not too long), and a breakdown into smaller sub-problems.',
  'Be honest and practical: recommend well-known, implementable methods.',
  'Output STRICT JSON only: an array of objects:',
  '[{ "question": string, "type": string, "models": string[], "algorithms": string[], "tools": string[], "approach": string, "subProblems": string[] }]',
].join('\n');

/**
 * 题目分析服务：对每一问给出类型/模型/算法/工具/思路/子问题，并写入项目记忆。
 */
export class AnalysisService extends Service {
  constructor(
    ctx: Context,
    private readonly config: MathConfig,
    private readonly memory: ProjectMemoryService,
  ) {
    super(ctx, 'mathAnalysis');
  }

  async analyze(agent: Agent, root: string, signal?: AbortSignal): Promise<QuestionAnalysis[]> {
    const mem = await this.memory.load(root);
    // 若题目描述过短但指定了问题文件：自动重新读取，修复"描述只剩路径"的状态
    if (((mem.problem.description ?? '').trim().length < 80) && mem.problem.problemFile) {
      try {
        const { readProblemFile } = await import('./fileutil.js');
        const text = await readProblemFile(root, mem.problem.problemFile, this.config.pythonPath);
        await this.memory.update(root, (m) => {
          m.problem.description = text.slice(0, 30000);
        });
        mem.problem.description = text.slice(0, 30000);
      } catch (err) {
        throw new Error(`题目文件读取失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const problemText = buildProblemText(mem);
    if (!problemText || problemText.trim().length < 30) {
      throw new Error('math-assistant: 题目内容为空或过短。请先描述问题，或确认问题文件已放入工作区并指定正确文件名（/math-problem <描述或文件名>）。');
    }
    const user = [
      'The modeling problem:',
      problemText,
      '',
      'Analyze each sub-question and return the JSON array.',
    ].join('\n');
    const answer = await completeText(
      this.ctx,
      agent,
      ANALYZE_SYSTEM,
      user,
      { temperature: this.config.llm.temperature, maxTokens: this.config.llm.maxTokens },
      signal,
    );
    const parsed = extractJson<unknown>(answer);
    const analysis = normalizeAnalysis(parsed);
    await this.memory.update(root, (m) => {
      m.analysis = analysis;
    });
    return analysis;
  }
}

function buildProblemText(mem: Awaited<ReturnType<ProjectMemoryService['load']>>): string {
  const parts: string[] = [];
  if (mem.problem.title) parts.push(`题目：${mem.problem.title}`);
  if (mem.problem.problemFile) parts.push(`问题文件：${mem.problem.problemFile}`);
  if (mem.problem.description) parts.push(mem.problem.description);
  return parts.join('\n\n');
}

function normalizeAnalysis(parsed: unknown): QuestionAnalysis[] {
  if (!Array.isArray(parsed)) return [];
  const out: QuestionAnalysis[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const a = item as Record<string, unknown>;
    out.push({
      question: str(a.question) || `问题 ${out.length + 1}`,
      type: str(a.type) || '未分类',
      models: list(a.models),
      algorithms: list(a.algorithms),
      tools: list(a.tools),
      approach: str(a.approach) || '',
      subProblems: list(a.subProblems),
    });
  }
  return out;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
