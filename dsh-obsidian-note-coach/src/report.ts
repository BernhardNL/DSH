import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { NoteCoachConfig, VaultIndex, VaultNote } from './types.js';
import { completeText } from './llm.js';

export interface ReportRequest {
  scope: 'global' | 'folder' | 'note' | 'tag';
  /** Folder path, note relPath, or tag, depending on scope. */
  target?: string;
  mode: 'summary' | 'evaluate';
  /** Optional category filter (folder or tag name). */
  category?: string;
}

export interface ReportResult {
  markdown: string;
  /** Absolute path the report was saved to (when saved). */
  savedPath?: string;
  noteCount: number;
  planCount: number;
}

/**
 * Report generator: content summary, objective evaluation, and plan-vs-actual
 * comparison for planning notes. Reports are saved under the vault's
 * `.harness/reports` directory and returned as markdown.
 */
export class NoteReportService extends Service {
  constructor(
    ctx: Context,
    private readonly config: NoteCoachConfig,
  ) {
    super(ctx, 'noteReport');
  }

  async generate(agent: Agent, req: ReportRequest, signal?: AbortSignal): Promise<ReportResult> {
    const root = agent.session.header.cwd;
    if (!root) throw new Error('note-coach: no workspace root; select the vault as the workspace first');

    const scan = async (path: string): Promise<VaultIndex> => {
      const notes: VaultNote[] = [];
      const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
        if (depth > 12) return;
        const target = await this.ctx.fs.resolve(dir, { signal });
        const entries = await this.ctx.fs.listDir(target, signal);
        for (const entry of entries) {
          if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
          const childRel = rel ? `${rel}/${entry.name}` : entry.name;
          const childAbs = dir.endsWith('/') ? dir + entry.name : `${dir}/${entry.name}`;
          if (entry.type === 'directory') {
            if (['.git', '.obsidian', '.harness', '.trash', 'node_modules'].includes(entry.name)) continue;
            await walk(childAbs, childRel, depth + 1);
          } else if (entry.name.endsWith('.md')) {
            try {
              const t = await this.ctx.fs.resolve(childAbs, { signal });
              const text = await this.ctx.fs.readText(t, signal);
              const frontmatter = parseFrontmatterOnly(text);
              const tasks = extractTasks(text);
              notes.push({
                relPath: childRel,
                folder: rel,
                basename: entry.name.replace(/\.md$/, ''),
                title: text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? entry.name.replace(/\.md$/, ''),
                frontmatter,
                headings: [],
                links: [],
                tasks,
                body: text,
                size: 0,
              });
            } catch {
              // skip unreadable
            }
          }
        }
      };
      await walk(path, '', 0);
      notes.sort((a, b) => a.relPath.localeCompare(b.relPath));
      return { root: path, notes, folders: [], tags: [], scannedAt: new Date().toISOString() };
    };

    const index = await scan(root);
    const selected = selectNotes(index.notes, req);
    const plans = selected.filter((n) => isPlanNote(n));
    const noteCount = selected.length;
    const planCount = plans.length;

    const digest = selected
      .map((n) => {
        const tasks = n.tasks.length
          ? `\n  tasks: ${n.tasks.filter((t) => t.done).length}/${n.tasks.length} done`
          : '';
        const plan = isPlanNote(n) ? ' [PLAN]' : '';
        return `### ${n.title}${plan} (${n.folder || '/'})\n${n.body.slice(0, 600).replace(/\s+/g, ' ')}${tasks}`;
      })
      .join('\n\n');

    const system =
      req.mode === 'summary'
        ? [
            'You produce a structured Markdown SUMMARY of the user\'s Obsidian notes.',
            'Summarize faithfully and neutrally. Group by folder or tag where it helps.',
            'Do not judge, do not add opinions, do not evaluate quality.',
          ].join('\n')
        : [
            'You produce an OBJECTIVE EVALUATION of the user\'s Obsidian notes, in Markdown.',
            'Assess structure, coverage, clarity, and gaps — neutrally and concretely, citing note titles.',
            'Be honest about weaknesses, never flattering. End with 3-5 actionable improvement suggestions.',
            'You have no knowledge of the user\'s values; evaluate craftsmanship only.',
          ].join('\n');

    const planSection = plans.length
      ? [
          '',
          '## 计划对比 (Plan vs Actual)',
          ...plans.map((p) => {
            const done = p.tasks.filter((t) => t.done).length;
            const total = p.tasks.length;
            const rate = total ? Math.round((done / total) * 100) : 0;
            return [
              `### ${p.title} — 完成 ${done}/${total} (${rate}%)`,
              ...p.tasks.map((t) => `- ${t.done ? '[x]' : '[ ]'} ${t.text}`),
            ].join('\n');
          }),
        ].join('\n')
      : '';

    const user = [
      `Scope: ${req.scope}${req.target ? ` "${req.target}"` : ''}${req.category ? `, category "${req.category}"` : ''}`,
      `Notes selected: ${noteCount} (plans: ${planCount})`,
      '',
      digest || '(no notes matched)',
      planSection,
      '',
      req.mode === 'summary' ? 'Produce the summary now.' : 'Produce the evaluation now.',
    ].join('\n');

    const markdown = await completeText(
      this.ctx,
      agent,
      {
        provider: this.config.judge.provider,
        model: this.config.judge.model,
        temperature: req.mode === 'evaluate' ? 0.2 : 0.3,
        maxTokens: 3000,
      },
      system,
      user,
      signal,
    );

    const reportPath = this.saveReport(root, req, markdown, noteCount, planCount);
    return { markdown, savedPath: reportPath, noteCount, planCount };
  }

  private saveReport(
    root: string,
    req: ReportRequest,
    markdown: string,
    noteCount: number,
    planCount: number,
  ): string {
    const dir = root.endsWith('/') ? root + this.config.reportDir : `${root}/${this.config.reportDir}`;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = `${stamp}-${req.mode}-${req.scope}${req.target ? `-${safe(req.target)}` : ''}.md`;
    const abs = `${dir}/${file}`;
    // Fire-and-forget: report saving must never fail the request.
    this.ctx.fs
      .resolve(abs)
      .then((target) => this.ctx.fs.writeText(target, `# 笔记报告 ${new Date().toLocaleString()}\n\n> 范围: ${req.scope}${req.target ? ` / ${req.target}` : ''} · 模式: ${req.mode} · 笔记数: ${noteCount} · 计划笔记: ${planCount}\n\n---\n\n${markdown}\n`))
      .catch(() => undefined);
    return abs;
  }
}

function selectNotes(notes: VaultNote[], req: ReportRequest): VaultNote[] {
  const matches = (n: VaultNote): boolean => {
    if (req.category && !(n.folder.includes(req.category) || JSON.stringify(n.frontmatter).includes(req.category))) {
      return false;
    }
    switch (req.scope) {
      case 'global':
        return true;
      case 'folder':
        return req.target ? n.folder === req.target : true;
      case 'note':
        return req.target ? n.relPath === req.target : true;
      case 'tag':
        return req.target ? JSON.stringify(n.frontmatter).includes(req.target) : true;
    }
  };
  return notes.filter(matches);
}

function isPlanNote(n: VaultNote): boolean {
  const type = n.frontmatter?.type;
  return type === 'plan' || type === '计划' || n.tasks.length > 0;
}

function parseFrontmatterOnly(text: string): Record<string, unknown> {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end < 0) return {};
  const record: Record<string, unknown> = {};
  for (const line of text.slice(3, end).split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (m) record[m[1]] = m[2].trim();
  }
  return record;
}

function extractTasks(text: string): { text: string; done: boolean }[] {
  const tasks: { text: string; done: boolean }[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (m) tasks.push({ text: m[2].trim(), done: m[1] !== ' ' });
  }
  return tasks;
}

function safe(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60) || 'target';
}
