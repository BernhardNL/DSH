import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { MathConfig, DataSummary } from './types.js';
import { completeText } from './llm.js';
import type { ProjectMemoryService } from './memory.js';
import { runPython } from './py.js';

/**
 * 数据处理服务：读取 txt/csv/xlsx，做基础处理并展示结果。
 * - 固定脚本给出基本信息（行数/列/类型/描述统计/缺失值）
 * - 用户可指定"显示什么结果"（displaySpec），由 LLM 生成对应 pandas 代码执行
 * - 结果写入项目记忆（数据摘要），供其他模块（流水线/论文）使用
 */
export class DataService extends Service {
  constructor(
    ctx: Context,
    private readonly config: MathConfig,
    private readonly memory: ProjectMemoryService,
  ) {
    super(ctx, 'mathData');
  }

  async process(
    agent: Agent,
    root: string,
    fileName: string,
    displaySpec?: string,
    signal?: AbortSignal,
  ): Promise<DataSummary> {
    const abs = root.endsWith('/') ? root + fileName : `${root}/${fileName}`;
    const lower = fileName.toLowerCase();

    // 1. 固定基本信息脚本
    const infoCode = [
      'import sys, json, os',
      'import pandas as pd',
      'path = sys.argv[1]',
      'p = path.lower()',
      'if p.endswith(".xlsx") or p.endswith(".xls"):',
      '    df = pd.read_excel(path)',
      'elif p.endswith(".csv"):',
      '    df = pd.read_csv(path)',
      'else:',
      '    for sep in ["\\t", ",", ";", " ", "|"]:',
      '        try:',
      '            df = pd.read_csv(path, sep=sep, engine="python")',
      '            if df.shape[1] > 1: break',
      '        except Exception:',
      '            continue',
      'lines = []',
      'lines.append(f"SHAPE: {df.shape[0]} rows x {df.shape[1]} cols")',
      'lines.append(f"COLUMNS: {list(df.columns)}")',
      'lines.append("DTYPES: " + ", ".join(f"{c}={t}" for c, t in df.dtypes.items()))',
      'lines.append(f"MISSING: {int(df.isna().sum().sum())}")',
      'lines.append("HEAD:")',
      'lines.append(df.head(5).to_string())',
      'lines.append("DESCRIBE:")',
      'try:',
      '    lines.append(df.describe(include="all").to_string())',
      'except Exception:',
      '    pass',
      'print("\\n".join(lines))',
    ].join('\n');
    const info = await runPython(root, this.config.workDir, infoCode, [abs], 120_000, this.config.pythonPath);

    // 2. 用户指定结果：LLM 生成 pandas 代码执行
    let specOutput = '';
    if (displaySpec && displaySpec.trim()) {
      const code = await completeText(
        this.ctx,
        agent,
        [
          'You write a short standalone python/pandas snippet to answer a data-analysis request.',
          'The data file path is passed as sys.argv[1]. Print ONLY the requested results as text (and save plots to sys.argv[2] if a plot is requested).',
          'Do NOT include imports of files; the snippet is executed with the project venv (pandas/numpy/matplotlib available).',
          'Output STRICT JSON only: { "code": string }',
        ].join('\n'),
        `Request: ${displaySpec}\nFile: ${fileName}`,
        { temperature: 0.2, maxTokens: 1200 },
        signal,
      );
      const parsed = extractCode(code);
      if (parsed) {
        const figDir = `${root}/.harness/math/figures`;
        const { mkdirSync } = await import('node:fs');
        mkdirSync(figDir, { recursive: true });
        const res = await runPython(root, this.config.workDir, parsed, [abs, figDir], 180_000, this.config.pythonPath);
        specOutput = res.ok ? res.stdout.trim() : `（结果计算失败：${res.error || res.stderr.slice(0, 300)}）`;
      }
    }

    const statsText = [info.stdout.trim(), specOutput ? `\n[指定结果]\n${specOutput}` : ''].filter(Boolean).join('\n');
    const summary: DataSummary = {
      fileName,
      rows: parseRows(info.stdout),
      columns: parseColumns(info.stdout),
      statsText: statsText.slice(0, 6000),
      artifacts: [],
      note: displaySpec ? `按指定要求显示：${displaySpec}` : undefined,
    };

    await this.memory.update(root, (m) => {
      const existing = m.data.findIndex((d) => d.fileName === fileName);
      if (existing >= 0) m.data[existing] = summary;
      else m.data.push(summary);
      m.chat.push({ role: 'user', text: `数据处理：${fileName}${displaySpec ? `（${displaySpec}）` : ''}` });
      m.chat.push({ role: 'assistant', text: statsText.slice(0, 2000) });
      if (m.chat.length > 100) m.chat = m.chat.slice(-100);
    });
    return summary;
  }
}

function parseRows(text: string): number {
  const m = text.match(/SHAPE:\s*(\d+)/);
  return m ? Number(m[1]) : 0;
}

function parseColumns(text: string): string[] {
  const m = text.match(/COLUMNS:\s*\[(.*)\]/);
  if (!m) return [];
  return m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

function extractCode(answer: string): string | undefined {
  const fenced = answer.match(/```(?:python|json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  try {
    const obj = JSON.parse(answer) as { code?: string };
    if (obj && typeof obj.code === 'string') return obj.code.trim();
  } catch {
    // ignore
  }
  return undefined;
}
