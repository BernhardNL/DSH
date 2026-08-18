import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type {
  JudgeThread,
  JudgeVerdict,
  NoteCoachConfig,
  NoteInsertion,
} from './types.js';
import { completeText, extractJson } from './llm.js';
import type { NoteVaultService } from './vault.js';
import type { NoteStyleService } from './style.js';
import type { NoteWriterService, NoteWriteOptions } from './notes.js';
import { parseWriterAnswer } from './notes.js';

export interface JudgeOutcome {
  verdict: JudgeVerdict;
  /** Set when the user approved a note and one was written. */
  insertion?: NoteInsertion;
  /** Whether a note was offered (verdict correct / non-subjective). */
  offered: boolean;
  /** The judgment thread (for follow-up questions). */
  thread?: JudgeThread;
  /** Human-readable summary with separate 判断 / 理由 / 建议 / 推荐位置 sections. */
  summary: string;
}

export interface FollowUpOutcome {
  answer: string;
  thread: JudgeThread;
}

export interface OrganizeOutcome {
  /** Set when the user approved and the organized note was written. */
  insertion?: NoteInsertion;
  summary: string;
}

const JUDGE_SYSTEM = [
  'You are an independent critical reviewer. The user states an opinion; you evaluate it on its merits.',
  'You have NO memory of this user\'s past opinions or values — judge this statement fresh, objectively, and neutrally.',
  'Compare the statement against the user\'s own knowledge base (their notes) when relevant: does it contradict, support, or extend what they already hold?',
  'Be honest: if the statement is wrong, say so clearly and explain why. Never flatter to please.',
  'Output STRICT JSON only with fields:',
  '{ "verdict": "correct" | "incorrect" | "partially-correct" | "non-subjective", "confidence": number 0-1, "reasoning": string, "advice": string, "suggestedFolder": string|null, "suggestedTitle": string|null, "recommendedLocation": string|null, "recommendationReason": string|null }',
  '"non-subjective" means the statement is a fact, preference, or definition that cannot be judged right or wrong.',
  '"recommendedLocation" is a concrete vault-relative path like "Projects/学习Obsidian.md" or "Inbox/观点-xxx.md" where this note best fits the user\'s existing folder taxonomy. "recommendationReason" explains why in one sentence.',
].join('\n');

const FOLLOWUP_SYSTEM = [
  'You continue an earlier opinion judgment conversation. The user is asking a FOLLOW-UP question about your reasoning.',
  'Answer directly, honestly, and concretely. If the user challenges your verdict, defend or revise it on the merits — never flatter, never cave without reason.',
  'You still have NO memory of the user\'s values beyond the original opinion quoted below; judge on the merits.',
  'Keep the answer focused (under 250 words), in the user\'s language.',
].join('\n');

const ORGANIZE_SYSTEM = [
  'You organize a complete opinion-thinking thread into ONE concise Obsidian note.',
  'The thread contains: the user\'s original opinion, the independent judgment (verdict with confidence + reasoning + advice), and the full follow-up Q&A discussion.',
  "Produce a well-structured note that captures the whole thinking process: frontmatter (tags, date, type), title, a one-paragraph summary, the judgment section, and the follow-up Q&A condensed into clear sections (keep each question and its answer's core point; merge repetition).",
  'Follow the user\'s writing style profile exactly: frontmatter conventions, headings, tone, link style.',
  'Keep the user\'s own words where they matter; do NOT add new opinions of your own.',
  'Output STRICT JSON only: { "title": string, "folder": string, "content": string } — content is the full markdown body including any frontmatter.',
].join('\n');

/** Verdict display names. */
const VERDICT_TEXT: Record<JudgeVerdict['verdict'], string> = {
  correct: '你的观点与你的知识体系一致，判断正确',
  'partially-correct': '你的观点部分正确',
  incorrect: '你的观点有误',
  'non-subjective': '这属于事实/偏好类陈述，无所谓对错',
};

/**
 * Opinion judging flow: independent model judgment → structured output
 * (判断 / 理由 / 建议 / 推荐记录位置) → user-interactive recording prompt
 * (同意推荐位置，或用自然语言补充内容 / 指定位置) → note insertion.
 * A per-session thread keeps the reasoning open to continuous follow-up.
 */
export class NoteJudgeService extends Service {
  /** Per-session judgment threads for follow-up (capped, in-memory). */
  private readonly threads = new Map<string, JudgeThread>();

  constructor(
    ctx: Context,
    private readonly config: NoteCoachConfig,
    private readonly vault: NoteVaultService,
    private readonly style: NoteStyleService,
    private readonly writer: NoteWriterService,
  ) {
    super(ctx, 'noteJudge');
  }

  /**
   * Run the full judge flow for one stated opinion.
   * @param agent - the agent whose session/workspace owns the vault.
   * @param opinion - the user's words, verbatim.
   * @param context - optional surrounding conversation context.
   */
  async judge(
    agent: Agent,
    opinion: string,
    context?: string,
    signal?: AbortSignal,
  ): Promise<JudgeOutcome> {
    const root = this.vault.vaultRoot(agent);
    const index = await this.vault.scan(root, signal);
    const style = (await this.style.loadStyle(root)) ?? (await this.style.learnStyle(agent, index, signal));

    // A sample of notes gives the judge the user's existing体系 without full-history cost.
    const recent = index.notes
      .slice()
      .sort((a, b) => a.relPath.localeCompare(b.relPath))
      .slice(0, 12)
      .map((n) => `${n.title} (${n.folder || '/'}): ${n.body.slice(0, 200).replace(/\s+/g, ' ')}`)
      .join('\n');

    const user = [
      `The user stated this opinion (verbatim): "${opinion}"`,
      context ? `\nConversation context:\n${context}` : '',
      `\nThe user's existing knowledge base (recent notes):\n${recent || '(empty vault)'}`,
      `\nVault folders: ${index.folders.join(', ') || '(root only)'}`,
      '',
      'Evaluate the opinion and return the JSON verdict.',
    ].join('\n');

    const answer = await completeText(
      this.ctx,
      agent,
      {
        provider: this.config.judge.provider,
        model: this.config.judge.model,
        temperature: this.config.judge.temperature,
        maxTokens: this.config.judge.maxTokens,
      },
      JUDGE_SYSTEM,
      user,
      signal,
    );
    const parsed = extractJson<Record<string, unknown>>(answer);
    const verdict: JudgeVerdict = normalizeVerdict(parsed);

    // Remember the opinion in the volatile ledger (TTL-purged; never persisted
    // into the portable style profile).
    try {
      await this.style.rememberOpinion(root, opinion, verdict.verdict);
    } catch {
      // memory is best-effort
    }

    // Seed the follow-up thread.
    const thread: JudgeThread = {
      sessionId: agent.id,
      opinion,
      verdict: verdict.verdict,
      confidence: verdict.confidence,
      reasoning: verdict.reasoning,
      advice: verdict.advice,
      recommendedLocation: verdict.recommendedLocation,
      qa: [],
      at: new Date().toISOString(),
    };
    this.threads.set(agent.id, thread);
    if (this.threads.size > 200) {
      const oldest = this.threads.keys().next().value;
      if (oldest !== undefined) this.threads.delete(oldest);
    }

    const verdictText = VERDICT_TEXT[verdict.verdict];
    const offered = verdict.verdict === 'correct' || verdict.verdict === 'non-subjective';

    if (!offered) {
      return {
        verdict,
        offered: false,
        thread,
        summary: formatSummary(verdict, undefined),
      };
    }

    // Interactive recording prompt: agree to the recommended location, or
    // supplement / specify via natural language. Before asking, generate the
    // note content so the user can preview its format and content.
    let insertion: NoteInsertion | undefined;
    let recordNote = false;
    let userLocation: string | undefined;
    let supplement: string | undefined;
    let preview: { folder: string; title: string; content: string } | undefined;

    try {
      preview = await this.writer.previewNote(
        agent,
        index,
        style,
        opinion,
        {
          suggestedFolder: verdict.suggestedFolder,
          suggestedTitle: verdict.suggestedTitle,
          recommendedLocation: verdict.recommendedLocation,
        },
        signal,
      );
    } catch {
      preview = undefined; // preview is a nicety; the flow continues without it
    }

    const rec = verdict.recommendedLocation ?? '（自动选择合适位置）';
    const detailLines = [
      verdict.recommendationReason ? `推荐理由：${verdict.recommendationReason}` : '',
      preview
        ? `\n**笔记预览**（按你的书写风格生成，将写入 ${preview.folder ? `${preview.folder}/` : ''}${preview.title}.md）：\n\n${preview.content.trim()}`
        : '',
    ].filter(Boolean).join('\n');

    const questions = this.ctx.get('userQuestions');
    if (questions) {
      try {
        const answer = await questions.ask({
          agent,
          signal,
          questions: [
            {
              id: 'record_note',
              header: '记入笔记',
              question: `是否将这条观点记入笔记？推荐位置：${rec}`,
              detail: detailLines || undefined,
              options: [
                { label: `同意，记到 ${rec}`, description: '按推荐位置写入，以你的话为骨架' },
                { label: '自定义位置或补充内容', description: '选择后在输入框填写位置路径或要补充的内容' },
              ],
            },
          ],
        });
        const item = answer.answers[0];
        if (item) {
          recordNote = item.selected.includes(`同意，记到 ${rec}`) || item.selected.length > 0;
          const custom = (item.custom ?? '').trim();
          if (custom) {
            if (looksLikeLocation(custom)) userLocation = custom;
            else supplement = custom;
          }
        }
      } catch {
        recordNote = false;
      }
    } else {
      // No question UI: fall back to the approval seam.
      const approval = this.ctx.get('approval');
      if (approval) {
        try {
          const decision = await approval.request({
            agent,
            toolName: 'note_coach_judge',
            reason: `将这条观点记入笔记？「${opinion.slice(0, 120)}」`,
            signal,
          });
          recordNote = decision === 'allowed-once';
        } catch {
          recordNote = false;
        }
      }
    }

    if (recordNote) {
      if (!userLocation && !supplement && preview) {
        // User agreed to the recommended location and the preview content.
        insertion = await this.writer.writeGenerated(index, preview);
      } else {
        // Custom location / supplement: regenerate the note with the input.
        insertion = await this.writer.insertNote(
          agent,
          index,
          style,
          opinion,
          {
            suggestedFolder: verdict.suggestedFolder,
            suggestedTitle: verdict.suggestedTitle,
            recommendedLocation: verdict.recommendedLocation,
            userLocation,
            supplement,
          },
          signal,
        );
      }
      thread.recommendedLocation = insertion.folder ? `${insertion.folder}/${insertion.title}` : insertion.title;
    }

    return {
      verdict,
      offered: true,
      insertion,
      thread,
      summary: formatSummary(verdict, insertion, supplement),
    };
  }

  /**
   * Answer a follow-up question about the latest judgment thread's reasoning.
   */
  async followUp(agent: Agent, question: string, signal?: AbortSignal): Promise<FollowUpOutcome> {
    const thread = this.threads.get(agent.id);
    if (!thread) {
      throw new Error('note-coach：还没有可追问的判断。请先表达一个观点并完成一次判断。');
    }
    const history = thread.qa
      .map((pair, i) => `追问${i + 1}: ${pair.q}\n回答${i + 1}: ${pair.a}`)
      .join('\n\n');
    const user = [
      `原始观点：${thread.opinion}`,
      `先前的判断：${thread.verdict}（置信度 ${Math.round(thread.confidence * 100)}%）`,
      `先前的理由：${thread.reasoning}`,
      thread.advice ? `先前的建议：${thread.advice}` : '',
      history ? `\n已有追问记录：\n${history}` : '',
      '',
      `用户的追问：${question}`,
      '',
      '回答这个追问。',
    ].join('\n');
    const answer = await completeText(
      this.ctx,
      agent,
      {
        provider: this.config.judge.provider,
        model: this.config.judge.model,
        temperature: this.config.judge.temperature,
        maxTokens: this.config.judge.maxTokens,
      },
      FOLLOWUP_SYSTEM,
      user,
      signal,
    );
    thread.qa.push({ q: question, a: answer });
    return { answer, thread };
  }

  /**
   * Organize the session's whole thinking thread (original opinion + judgment
   * + all follow-up Q&A) into one note. Like the judge flow, it generates a
   * preview first and asks the user where to save (同意推荐位置 / 自定义 /
   * 放弃) before writing.
   */
  async organizeThread(agent: Agent, signal?: AbortSignal): Promise<OrganizeOutcome> {
    const thread = this.threads.get(agent.id);
    if (!thread) {
      throw new Error('note-coach：还没有可整理的追问过程。请先表达一个观点完成判断，再用追问展开讨论。');
    }
    const root = this.vault.vaultRoot(agent);
    const index = await this.vault.scan(root, signal);
    const style = (await this.style.loadStyle(root)) ?? (await this.style.learnStyle(agent, index, signal));

    const qaText = thread.qa.length
      ? thread.qa.map((p, i) => `追问${i + 1}：${p.q}\n回答${i + 1}：${p.a}`).join('\n\n')
      : '（本次判断还没有追问记录，仅整理判断本身。）';
    const digest = [
      `原始观点：${thread.opinion}`,
      `判断：${thread.verdict}（置信度 ${Math.round(thread.confidence * 100)}%）`,
      `理由：${thread.reasoning}`,
      thread.advice ? `建议：${thread.advice}` : '',
      `追问讨论：\n${qaText}`,
    ].join('\n');

    const generate = async (opts: NoteWriteOptions = {}): Promise<{ folder: string; title: string; content: string }> => {
      const userLocation = opts.userLocation?.trim();
      const user = [
        `Vault folders available: ${index.folders.join(', ') || '(root only)'}`,
        `User's writing style profile:\n${JSON.stringify(style, null, 2)}`,
        userLocation ? `\nUSER-REQUIRED location: ${userLocation} (use exactly this; the user specified it)` : '',
        opts.supplement
          ? `\nUSER-SUPPLIED supplement (MUST be merged in, keep its meaning verbatim):\n${opts.supplement}`
          : '',
        '',
        'The opinion-thinking thread to organize:',
        digest,
        '',
        'Organize it into a note now.',
      ].join('\n');
      const answer = await completeText(
        this.ctx,
        agent,
        {
          provider: this.config.judge.provider,
          model: this.config.judge.model,
          temperature: 0.3,
          maxTokens: 2000,
        },
        ORGANIZE_SYSTEM,
        user,
        signal,
      );
      const parsed = parseWriterAnswer(answer);
      const folder = pickOrganizeFolder(parsed.folder, index.folders);
      const title = parsed.title?.trim() || `思考过程：${thread.opinion.slice(0, 30)}`;
      const content = parsed.content || `# ${title}\n\n${digest}\n`;
      return { folder, title, content };
    };

    // 1. Generate the preview.
    let preview: { folder: string; title: string; content: string };
    try {
      preview = await generate({});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { summary: `note-coach：整理失败 — ${message}` };
    }

    // 2. Ask where to save, showing the preview.
    const rec = preview.folder ? `${preview.folder}/${preview.title}.md` : `${preview.title}.md`;
    let recordNote = false;
    let userLocation: string | undefined;
    let supplement: string | undefined;
    const questions = this.ctx.get('userQuestions');
    if (questions) {
      try {
        const answer = await questions.ask({
          agent,
          signal,
          questions: [
            {
              id: 'organize_note',
              header: '整理为笔记',
              question: `是否将这次追问过程整理为笔记？推荐位置：${rec}`,
              detail: `**笔记预览**（按你的书写风格生成，将写入 ${rec}）：\n\n${preview.content.trim()}`,
              options: [
                { label: `同意，记到 ${rec}`, description: '按预览内容写入' },
                { label: '自定义位置或补充内容', description: '选择后在输入框填写位置路径或要补充的内容' },
              ],
            },
          ],
        });
        const item = answer.answers[0];
        if (item) {
          recordNote = item.selected.includes(`同意，记到 ${rec}`) || item.selected.length > 0;
          const custom = (item.custom ?? '').trim();
          if (custom) {
            if (looksLikeLocation(custom)) userLocation = custom;
            else supplement = custom;
          }
        }
      } catch {
        recordNote = false;
      }
    } else {
      const approval = this.ctx.get('approval');
      if (approval) {
        try {
          const decision = await approval.request({
            agent,
            toolName: 'note_coach_organize',
            reason: `将这次追问过程整理为笔记？推荐位置 ${rec}`,
            signal,
          });
          recordNote = decision === 'allowed-once';
        } catch {
          recordNote = false;
        }
      }
    }

    if (!recordNote) {
      return { summary: '已取消整理（未写入笔记）。' };
    }

    // 3. Write (regenerate when the user customized location/content).
    const generated = userLocation || supplement ? await generate({ userLocation, supplement }) : preview;
    const insertion = await this.writer.writeGenerated(index, generated);
    return {
      insertion,
      summary: `✅ 已把追问过程整理为笔记：${insertion.path}\n\n${generated.content.trim().slice(0, 400)}${generated.content.trim().length > 400 ? '\n…' : ''}`,
    };
  }
}

/** Format a structured summary with clearly separated sections. */
function formatSummary(
  verdict: JudgeVerdict,
  insertion?: NoteInsertion,
  supplement?: string,
): string {
  const rec = verdict.recommendedLocation
    ? `\n\n【推荐记录位置】${verdict.recommendedLocation}${verdict.recommendationReason ? `\n（${verdict.recommendationReason}）` : ''}`
    : '';
  const note = insertion
    ? `\n\n✅ 已按你的书写风格记入笔记：${insertion.path}${supplement ? '\n（已融入你的补充内容）' : ''}`
    : '\n\n（你选择不记笔记，已跳过。追问可继续：直接说"追问：…"或使用 /note-followup）';
  return [
    `【判断】${VERDICT_TEXT[verdict.verdict]}（置信度 ${Math.round(verdict.confidence * 100)}%）`,
    `\n【理由】\n${verdict.reasoning}`,
    `\n【建议】\n${verdict.advice}`,
    rec,
    note,
  ].join('');
}

function normalizeVerdict(parsed: Record<string, unknown> | undefined): JudgeVerdict {
  const verdict =
    parsed?.verdict === 'incorrect' ||
    parsed?.verdict === 'partially-correct' ||
    parsed?.verdict === 'non-subjective'
      ? parsed.verdict
      : 'correct';
  const confidence =
    typeof parsed?.confidence === 'number'
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5;
  return {
    verdict,
    confidence,
    reasoning: typeof parsed?.reasoning === 'string' ? parsed.reasoning : '（未提供理由）',
    advice: typeof parsed?.advice === 'string' ? parsed.advice : '（未提供建议）',
    suggestedFolder:
      typeof parsed?.suggestedFolder === 'string' && parsed.suggestedFolder
        ? parsed.suggestedFolder
        : undefined,
    suggestedTitle:
      typeof parsed?.suggestedTitle === 'string' && parsed.suggestedTitle
        ? parsed.suggestedTitle
        : undefined,
    recommendedLocation:
      typeof parsed?.recommendedLocation === 'string' && parsed.recommendedLocation
        ? parsed.recommendedLocation
        : undefined,
    recommendationReason:
      typeof parsed?.recommendationReason === 'string' && parsed.recommendationReason
        ? parsed.recommendationReason
        : undefined,
  };
}

/** Heuristic: does the user's custom text look like a location path? */
function looksLikeLocation(text: string): boolean {
  const t = text.trim();
  if (t.endsWith('.md')) return true;
  if (t.includes('/') || t.includes('\\')) return true;
  return /^[A-Za-z0-9_\-\u4e00-\u9fff]+(\.[A-Za-z0-9]+)?$/.test(t) && t.length <= 40;
}

/** Pick the folder for an organized note: the LLM's suggestion if it exists, else Inbox, else root. */
function pickOrganizeFolder(candidate: string | undefined, folders: string[]): string {
  const set = new Set(folders);
  if (candidate) {
    const normalized = candidate.replace(/^\/+|\/+$/g, '');
    if (normalized && set.has(normalized)) return normalized;
  }
  if (set.has('Inbox')) return 'Inbox';
  return '';
}
