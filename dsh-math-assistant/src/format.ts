import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { MathConfig, PaperFormatProfile } from './types.js';
import { completeText, extractJson } from './llm.js';
import type { ProjectMemoryService } from './memory.js';

const FORMAT_SYSTEM = [
  'You extract the FORMAT/LAYOUT conventions of academic papers from provided exemplar texts.',
  'Analyze the exemplar papers and summarize, in Chinese, the consistent format rules:',
  '1) structure (chapter system and order), 2) heading numbering and hierarchy, 3) formula conventions (numbering like (1-1), symbol definition style, placement), 4) table and figure conventions (numbering, caption position), 5) citation/reference style, 6) abstract and keywords style, 7) language and any other notable layout rules.',
  'Be concrete and prescriptive (write rules a writer can follow), not vague.',
  'Output STRICT JSON only: { "structure": string, "headingConvention": string, "formulaConvention": string, "tableFigureConvention": string, "citationStyle": string, "abstractKeywords": string, "language": string, "notes": string }',
].join('\n');

/**
 * 论文格式学习服务：从用户提供的严谨格式论文中提炼格式规范档案，
 * 供重排版/生成论文时套用（按项目隔离、随记忆持久化）。
 */
export class FormatService extends Service {
  constructor(
    ctx: Context,
    private readonly config: MathConfig,
    private readonly memory: ProjectMemoryService,
  ) {
    super(ctx, 'mathFormat');
  }

  async learn(agent: Agent, root: string, files: string[], signal?: AbortSignal): Promise<PaperFormatProfile> {
    if (!files.length) throw new Error('请至少提供一个参考论文文件。');
    const { readFileForContext } = await import('./fileutil.js');
    const samples: string[] = [];
    for (const f of files.slice(0, 3)) {
      const text = await readFileForContext(root, f, this.config.pythonPath, 60000);
      if (text && !text.startsWith('（无法解析')) {
        samples.push(`[参考论文：${f}]\n${text}`);
      }
    }
    if (!samples.length) throw new Error('无法读取任何参考论文。请确认文件在工作区且为 docx/pdf/txt 格式。');
    const answer = await completeText(
      this.ctx,
      agent,
      FORMAT_SYSTEM,
      `Exemplar papers:\n\n${samples.join('\n\n---\n\n')}\n\nExtract the format conventions now.`,
      { temperature: 0.2, maxTokens: 2000 },
      signal,
    );
    const parsed = extractJson<Record<string, unknown>>(answer);
    const profile: PaperFormatProfile = {
      schemaVersion: 1,
      sourceFiles: files.slice(0, 3),
      structure: str(parsed?.structure),
      headingConvention: str(parsed?.headingConvention),
      formulaConvention: str(parsed?.formulaConvention),
      tableFigureConvention: str(parsed?.tableFigureConvention),
      citationStyle: str(parsed?.citationStyle),
      abstractKeywords: str(parsed?.abstractKeywords),
      language: str(parsed?.language) || 'zh-CN',
      notes: str(parsed?.notes),
    };
    await this.memory.update(root, (m) => {
      m.formatProfile = profile;
    });
    return profile;
  }

  async load(root: string): Promise<PaperFormatProfile | undefined> {
    const mem = await this.memory.load(root);
    return mem.formatProfile;
  }

  async clear(root: string): Promise<void> {
    await this.memory.update(root, (m) => {
      delete m.formatProfile;
    });
  }

  /** 渲染成可注入提示的文本。 */
  profileText(p: PaperFormatProfile | undefined): string {
    if (!p) return '';
    return [
      '目标论文格式规范（从参考论文学习，必须遵守）：',
      p.structure ? `- 章节体系：${p.structure}` : '',
      p.headingConvention ? `- 标题编号：${p.headingConvention}` : '',
      p.formulaConvention ? `- 公式规范：${p.formulaConvention}` : '',
      p.tableFigureConvention ? `- 图表规范：${p.tableFigureConvention}` : '',
      p.citationStyle ? `- 引用风格：${p.citationStyle}` : '',
      p.abstractKeywords ? `- 摘要关键词：${p.abstractKeywords}` : '',
      p.language ? `- 语言：${p.language}` : '',
      p.notes ? `- 其他：${p.notes}` : '',
    ].filter(Boolean).join('\n');
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}
