import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { MathConfig, RefEntry } from './types.js';
import { completeText, extractJson } from './llm.js';
import type { ProjectMemoryService } from './memory.js';

const REF_SYSTEM = [
  'You list academic references relevant to mathematical modeling / algorithms for the given task.',
  'Provide real, checkable references: prefer well-known textbooks, papers with DOIs, or official documentation. For each entry give a title, a URL (arxiv/DOI/journal page/docs) and a one-line note on how it supports the modeling work.',
  'If you are not sure a reference is real, still mark it; the system will verify link reachability.',
  'Output STRICT JSON only: [ { "title": string, "url": string, "note": string } ]',
].join('\n');

/**
 * 文献参考服务：为关键建模/算法步骤收集参考文献并校验链接可达性。
 */
export class ReferencesService extends Service {
  constructor(
    ctx: Context,
    private readonly config: MathConfig,
    private readonly memory: ProjectMemoryService,
  ) {
    super(ctx, 'mathRefs');
  }

  async collect(agent: Agent, root: string, topic: string, signal?: AbortSignal): Promise<RefEntry[]> {
    const mem = await this.memory.load(root);
    const context = [
      mem.problem.title ? `题目：${mem.problem.title}` : '',
      mem.analysis.length ? `题目分析：${mem.analysis.map((a) => `[${a.question}] 模型=${a.models.join('/')}`).join('; ')}` : '',
    ].filter(Boolean).join('\n');
    const answer = await completeText(
      this.ctx,
      agent,
      REF_SYSTEM,
      `Project context:\n${context}\n\nKey modeling/algorithm step to reference: ${topic}\n\nList the references now.`,
      { temperature: 0.2, maxTokens: 1500 },
      signal,
    );
    const parsed = extractJson<unknown>(answer);
    const entries: RefEntry[] = [];
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) continue;
        const r = item as Record<string, unknown>;
        const url = typeof r.url === 'string' ? r.url : undefined;
        entries.push({
          title: typeof r.title === 'string' ? r.title : '未命名',
          url,
          note: typeof r.note === 'string' ? r.note : '',
          verified: false,
        });
      }
    }
    // 校验链接可达性（并发、限时）
    const checked = await Promise.all(entries.map(async (e) => ({ ...e, verified: e.url ? await reachable(e.url) : false })));
    await this.memory.update(root, (m) => {
      m.references = [...m.references, ...checked];
    });
    return checked;
  }
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(8000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}
