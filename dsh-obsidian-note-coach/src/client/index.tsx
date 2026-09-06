/**
 * Client (Web GUI) half of the note coach — dedicated full-page view.
 *
 * The assistant lives at its OWN URL: `/notes-coach` (real path, served by the
 * SPA history fallback) and opens in a separate browser window/tab. It is
 * bookmarkable and survives refresh.
 *
 * The page renders its OWN question/approval dialogs (the shell renders them
 * inside the conversation column, invisible under the full-screen page): a
 * hidden session-scoped bridge publishes pending interactions to a module
 * store, and the page answers them through the carrier's `respond()`.
 *
 * Sections: 观点判断 (structured output), 连续追问, 报告, 风格, GitHub 上推.
 * All actions dispatch the plugin's slash commands against the session chosen
 * in the page's session selector.
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import katex from 'katex';
import { marked } from 'marked';
import { createPortal } from 'react-dom';
import { Component, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { publishPending, subscribePending, getPending, removePending } from './store.js';

/** KaTeX CSS (with fonts inlined) injected by the build script. */
declare const __KATEX_CSS__: string;

/** Dictionary namespace owned by this plugin. */
const NS = 'note-coach';

/** Simplified Chinese dictionary. */
const zh: Record<string, string> = {
  'page.title': '笔记助手',
  'page.urlHint': '独立面板 · 右上角 × 关闭',
  'page.close': '关闭页面',
  'page.open': '在新窗口打开笔记助手独立页面',
  'page.session': '工作会话',
  'page.noSession': '（无会话）',
  'judge.label': '观点判断',
  'judge.placeholder': '输入你的观点/看法…（例如：我认为 Obsidian 的双向链接是知识管理的核心）',
  'judge.run': '开始判断',
  'judge.none': '还没有判断记录。输入观点开始。',
  'followup.label': '连续追问理由',
  'followup.placeholder': '追问：为什么这么判断？能举个反例吗？',
  'followup.run': '追问',
  'followup.organize': '整理为笔记',
  'followup.organizeHint': '把本次判断与全部追问过程汇总成一篇笔记（会先展示预览并询问保存位置）。',
  'followup.hint': '基于上一次判断的理由继续追问，可连续多轮。',
  'report.label': '报告',
  'report.summary': '全局总结',
  'report.evaluate': '全局评价',
  'style.label': '风格',
  'style.learn': '学习风格',
  'style.status': '查看风格',
  'style.clearMemory': '清除观点记忆',
  'github.label': 'GitHub 上推',
  'github.placeholder': 'https://github.com/user/repo.git',
  'github.set': '设置仓库',
  'github.push': '上推至仓库',
  'output.label': '输出',
  'output.empty': '操作结果会显示在这里。',
  'busy': '执行中…',
  'noSession': '请先在工作会话中选择一个会话（工作区应为你的 Obsidian 知识库目录）。',
  'section.verdict': '判断',
  'section.reasoning': '理由',
  'section.advice': '建议',
  'section.location': '推荐记录位置',
  'section.note': '记录结果',
  'dialog.approve': '允许',
  'dialog.reject': '拒绝',
  'dialog.cancel': '放弃',
  'dialog.submit': '提交',
  'dialog.custom': '输入你的答案（位置路径或补充内容）…',
  'dialog.reason': '原因',
  'dialog.none': '没有待处理的提示。',
};

/** English dictionary (same key set). */
const en: Record<string, string> = {
  'page.title': 'Note Coach',
  'page.urlHint': 'Standalone panel · close with ×',
  'page.close': 'Close page',
  'page.open': 'Open the note coach page in a new window',
  'page.session': 'Session',
  'page.noSession': '(no session)',
  'judge.label': 'Opinion judge',
  'judge.placeholder': 'State your opinion… (e.g. I think Obsidian backlinks are the core of knowledge management)',
  'judge.run': 'Judge',
  'judge.none': 'No judgment yet. Enter an opinion to start.',
  'followup.label': 'Follow-up on reasoning',
  'followup.placeholder': 'Why did you judge that way? Any counterexample?',
  'followup.run': 'Ask',
  'followup.organize': 'Organize into a note',
  'followup.organizeHint': 'Compile the whole judgment + follow-up thread into one note (previews it and asks where to save).',
  'followup.hint': 'Keep asking about the latest judgment’s reasoning.',
  'report.label': 'Reports',
  'report.summary': 'Global summary',
  'report.evaluate': 'Global evaluate',
  'style.label': 'Style',
  'style.learn': 'Learn style',
  'style.status': 'View style',
  'style.clearMemory': 'Clear opinion memory',
  'github.label': 'GitHub push',
  'github.placeholder': 'https://github.com/user/repo.git',
  'github.set': 'Set repo',
  'github.push': 'Push to repo',
  'output.label': 'Output',
  'output.empty': 'Action results appear here.',
  'busy': 'Working…',
  'noSession': 'Choose a session first (workspace should be your Obsidian vault).',
  'section.verdict': 'Verdict',
  'section.reasoning': 'Reasoning',
  'section.advice': 'Advice',
  'section.location': 'Recommended location',
  'section.note': 'Result',
  'dialog.approve': 'Approve',
  'dialog.reject': 'Reject',
  'dialog.cancel': 'Cancel',
  'dialog.submit': 'Submit',
  'dialog.custom': 'Type your answer (a path or extra content)…',
  'dialog.reason': 'Reason',
  'dialog.none': 'No pending prompts.',
};

/** Minimal structural typing for the client root context we consume. */
interface ClientCtx {
  effect(fn: () => void, label?: string): void;
  slots: {
    inject(key: string, thunk: () => unknown): void;
    register(options: Record<string, unknown>, component: unknown): unknown;
  };
  locale: {
    register(namespace: string, dict: Record<string, Record<string, string>>): unknown;
    bind(namespace: string): (key: string, params?: Record<string, string | number>) => string;
  };
  remote: {
    commands: {
      execute(
        sessionId: string,
        line: string,
      ): Promise<
        | { ok: true; value: { commandId: string; result: { kind: 'success'; text?: string } | { kind: 'error'; text: string } } }
        | { ok: false; error: { code: string; message: string } }
      >;
    };
  };
  /** Client runtime sessions service: `open()` selects the current session. */
  sessions: {
    open(id: string): void;
    /** ObservableSnapshot：getSnapshot() + subscribe()（新版 dsh 的 ctx.sessions.list） */
    list?: {
      getSnapshot(): { ids?: string[]; byId?: Record<string, { title?: string; cwd?: string; displayTitle?: string }>; current?: string };
      subscribe(fn: () => void): () => void;
    };
  };
}

/** Error boundary: a page render error shows a message instead of silently
 *  unmounting back to the DSH app ("sometimes the page doesn't open"). */
class PageErrorBoundary extends Component<{ children: unknown }, { error: unknown }> {
  constructor(props: { children: unknown }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }
  render() {
    if (this.state.error !== null) {
      const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
      return jsxs('div', {
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          background: '#fff',
          color: '#c00',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          fontFamily: 'system-ui, sans-serif',
          padding: 24,
        },
        children: [
          jsx('div', { style: { fontWeight: 700, fontSize: 16 }, children: '笔记助手渲染异常' }),
          jsx('pre', { style: { whiteSpace: 'pre-wrap', maxWidth: 640, fontSize: 12, textAlign: 'left', color: '#333' }, children: message }),
          jsx('button', {
            type: 'button',
            onClick: () => window.location.reload(),
            style: { padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer', fontSize: 13 },
            children: '刷新重试',
          }),
        ],
      });
    }
    return this.props.children as never;
  }
}

/** Spinner keyframes + component (inline CSS, no module files needed). */
const SPIN_CSS =
  '@keyframes nc-spin { to { transform: rotate(360deg); } }' +
  '.nc-spinner { box-sizing: border-box; border-radius: 50%; border: 2px solid var(--dsh-border, #d0d0d0); border-top-color: #2563eb; animation: nc-spin 0.8s linear infinite; display: inline-block; }';

function Spinner({ size = 18 }: { size?: number }) {
  return jsx('span', { className: 'nc-spinner', 'aria-label': 'loading', style: { width: size, height: size } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Render a note preview: frontmatter shown as a monospace block, body as
 * Markdown, and LaTeX math ($…$ / $$…$$) rendered via KaTeX.
 * The detail string is "<intro paragraphs>：\n\n<note content>"; the note
 * content starts with YAML frontmatter, so we split at the first blank line
 * followed by `---` to anchor the frontmatter split.
 */
function renderMarkdownPreview(detail: string): string {
  const fmStart = detail.search(/\n\n---\r?\n/);
  const intro = fmStart >= 0 ? detail.slice(0, fmStart) : '';
  const body = fmStart >= 0 ? detail.slice(fmStart + 2) : detail;
  const introHtml = marked.parse(intro, { gfm: true, breaks: true }) as string;
  return introHtml + renderNoteBody(body);
}

function renderNoteBody(md: string): string {
  // 1. Split leading YAML frontmatter (display as a code block).
  let fmHtml = '';
  let body = md;
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    fmHtml = `<pre style="margin:0 0 8px;padding:8px 10px;background:#fafafa;border:1px solid var(--dsh-border,#e5e5e5);border-radius:6px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;color:#666;white-space:pre-wrap;">${escapeHtml(fm[1])}</pre>`;
    body = md.slice(fm[0].length);
  }
  // 2. Protect math blocks, render via KaTeX, then Markdown, then restore.
  const tokens: string[] = [];
  const protectedBody = body.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (match, block, inline) => {
    try {
      const html = katex.renderToString(block ?? inline ?? '', {
        displayMode: Boolean(block),
        throwOnError: false,
        output: 'html',
      });
      const id = `\u0000NC${tokens.length}\u0000`;
      tokens.push(html);
      return id;
    } catch {
      return match;
    }
  });
  const rendered = marked.parse(protectedBody, { gfm: true, breaks: true }) as string;
  const restored = rendered.replace(/\u0000NC(\d+)\u0000/g, (_m, i) => tokens[Number(i)] ?? '');
  return fmHtml + restored;
}

/** Parsed judgment sections from a /note summary. */
interface Judgment {
  verdict: string;
  reasoning: string;
  advice: string;
  location?: string;
  note?: string;
}

/** Split a summary into 【…】-marked sections. */
function parseJudgment(text: string): Judgment {
  const pick = (key: string): string | undefined => {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = text.match(new RegExp(`【${esc}】([\\s\\S]*?)(?=【|$)`, 'i'));
    return m ? m[1].trim() : undefined;
  };
  return {
    verdict: pick('判断') ?? text,
    reasoning: pick('理由') ?? '',
    advice: pick('建议') ?? '',
    location: pick('推荐记录位置'),
    note: pick('记录结果'),
  };
}

/** Run one slash command through the client remote and return display text. */
async function runCommand(ctx: ClientCtx, sessionId: string, line: string): Promise<string> {
  const answered = await ctx.remote.commands.execute(sessionId, line);
  if (!answered.ok) {
    return `命令执行失败：${answered.error.code} ${answered.error.message}`;
  }
  return answered.value.result.text ?? '(无输出)';
}

/** 页面开合状态：纯组件状态。新版 dsh 无 URL 子路由（任意路径均 404），
 *  整页跳转会报"网站出现问题"，因此不再修改地址栏，页面以覆盖层形式开合。 */
function usePageOpen(): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(false);
  return [open, () => setOpen(true), () => setOpen(false)];
}

/** Hidden session-scoped bridge: publishes pending interactions to the store. */
function PendingBridge(props: {
  sessionId?: string;
  useSession?: (selector: (s: { pending?: readonly unknown[] }) => unknown) => unknown;
}) {
  const pending = props.useSession?.((s: { pending?: readonly unknown[] }) => s.pending);
  useEffect(() => {
    if (props.sessionId && pending) {
      publishPending(props.sessionId, pending as readonly unknown[]);
    }
  }, [props.sessionId, pending]);
  return null;
}

/** Dialog overlay: renders the page's own question/approval prompts.
 *  Only pendings that appear AFTER the page opened are shown — pendings that
 *  were already waiting when the page opened (e.g. from an earlier unfinished
 *  flow) are suppressed so opening the page never pops a dialog over it.
 *  Rendered via a portal to document.body so no ancestor stacking context can
 *  trap it. */
function PendingDialogs({ sessionId, t }: { sessionId: string | undefined; t: (k: string) => string }) {
  const pending = useSyncExternalStore(
    subscribePending,
    () => getPending(sessionId),
    () => getPending(sessionId),
  );
  // Baseline: keys already present when the page/session opened. Reset
  // synchronously when the session changes so switching never flashes dialogs.
  const baseline = useRef<Set<string> | null>(null);
  const lastSession = useRef<string | undefined>(undefined);
  if (lastSession.current !== sessionId) {
    lastSession.current = sessionId;
    baseline.current = new Set(pending.map((e) => e.key));
  }
  const fresh = pending.filter((e) => !baseline.current?.has(e.key));
  if (fresh.length === 0) return null;

  return createPortal(
    jsxs('div', {
      style: {
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        fontFamily: 'system-ui, sans-serif',
      },
      children: fresh.map((wait) => {
        if (wait.kind === 'approval') {
          return jsx(ApprovalDialog, { key: wait.key, wait, t });
        }
        return jsx(QuestionDialog, { key: wait.key, wait, t });
      }),
    }),
    document.body,
  );
}

function ApprovalDialog({ wait, t }: { wait: ReturnType<typeof getPending>[number]; t: (k: string) => string }) {
  const payload = wait.payload as { approvalId?: string; toolName?: string; reason?: string };
  const [busy, setBusy] = useState(false);
  const answer = async (outcome: 'allowed-once' | 'rejected') => {
    setBusy(true);
    try {
      await wait.respond({ ok: true, value: { sessionId: wait.sessionId, approvalId: payload.approvalId, outcome } });
    } catch {
      // already settled / rejected: the decision still closes the prompt
    } finally {
      removePending(wait.sessionId, wait.key);
      setBusy(false);
    }
  };
  return jsxs('div', {
    style: dialogCardStyle,
    children: [
      jsx('div', { style: { fontWeight: 700, fontSize: 15, marginBottom: 8 }, children: `${payload.toolName ?? 'note_coach_judge'} · ${t('dialog.reason')}` }),
      jsx('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.6, marginBottom: 14 }, children: payload.reason ?? '' }),
      jsx('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' }, children: [
        jsx(Button, { onClick: () => void answer('allowed-once'), disabled: busy, children: t('dialog.approve') }),
        jsx(Button, { onClick: () => void answer('rejected'), disabled: busy, children: t('dialog.reject') }),
      ]}),
    ],
  });
}

function QuestionDialog({ wait, t }: { wait: ReturnType<typeof getPending>[number]; t: (k: string) => string }) {
  const payload = wait.payload as {
    questions?: Array<{ id: string; question: string; detail?: string; header?: string; options?: Array<{ label: string; description?: string }> }>;
  };
  const questions = payload.questions ?? [];
  const [selected, setSelected] = useState<Record<string, string | undefined>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Toggle one option; read from the functional update so rapid re-renders
  // (the store emits on every snapshot change while the agent waits) never
  // leave a stale closure.
  const toggle = (qid: string, label: string) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (prev[qid] === label) delete next[qid];
      else next[qid] = label;
      return next;
    });
  };

  const submit = async () => {
    const answers = questions
      .map((q) => ({
        id: q.id,
        selected: selected[q.id] ? [selected[q.id] as string] : [],
        custom: custom[q.id]?.trim() || undefined,
      }))
      .filter((a) => a.selected.length > 0 || a.custom);
    if (answers.length !== questions.length) return; // incomplete
    setBusy(true);
    try {
      await wait.respond({ ok: true, value: { sessionId: wait.sessionId, answer: { answers } } });
    } catch {
      // already settled / rejected: the answer still closes the prompt
    } finally {
      removePending(wait.sessionId, wait.key);
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      // Host contract (mirrors the shell's ui-user-questions): dismissal is an
      // ERROR envelope with code "cancelled", not an empty answer batch.
      await wait.respond({
        ok: false,
        error: { code: 'cancelled', message: 'the user closed this question request', details: {} },
      });
    } catch {
      // already settled / rejected: the dismissal still closes the prompt
    } finally {
      removePending(wait.sessionId, wait.key);
      setBusy(false);
    }
  };

  return jsxs('div', {
    style: { ...dialogCardStyle, maxWidth: 560, position: 'relative', zIndex: 1, pointerEvents: 'auto' },
    children: [
      questions.map((q) =>
        jsxs('div', { key: q.id, style: { marginBottom: 12 }, children: [
          q.header ? jsx('div', { style: { fontWeight: 700, fontSize: 15, marginBottom: 4 }, children: q.header }) : null,
          jsx('div', { style: { fontWeight: 600, fontSize: 14, marginBottom: 4, lineHeight: 1.5 }, children: q.question }),
          q.detail
            ? jsx('div', {
                style: {
                  fontSize: 13,
                  color: '#333',
                  marginBottom: 8,
                  maxHeight: 240,
                  overflowY: 'auto',
                  background: '#ffffff',
                  border: '1px solid var(--dsh-border, #e5e5e5)',
                  borderRadius: 8,
                  padding: 10,
                  lineHeight: 1.6,
                  wordBreak: 'break-word',
                },
                dangerouslySetInnerHTML: { __html: renderMarkdownPreview(q.detail) },
              })
            : null,
          (q.options ?? []).map((opt) => {
            const active = selected[q.id] === opt.label;
            return jsx('button', {
              type: 'button',
              onClick: () => toggle(q.id, opt.label),
              'aria-pressed': active,
              style: {
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 10px',
                marginBottom: 6,
                borderRadius: 8,
                pointerEvents: 'auto',
                position: 'relative',
                zIndex: 1,
                border: active ? '1.5px solid #2563eb' : '1px solid var(--dsh-border, #ddd)',
                background: active ? '#eff6ff' : 'var(--dsh-input-bg, #fafafa)',
                cursor: 'pointer',
                fontSize: 13,
                color: 'inherit',
              },
              children: jsxs(Fragment, {
                children: [
                  jsx('div', { style: { fontWeight: 600 }, children: `${active ? '✓ ' : ''}${opt.label}` }),
                  opt.description ? jsx('div', { style: { fontSize: 12, color: '#777', marginTop: 2 }, children: opt.description }) : null,
                ],
              }),
            });
          }),
          jsx('input', {
            value: custom[q.id] ?? '',
            onChange: (e: { target: { value: string } }) => setCustom((prev) => ({ ...prev, [q.id]: e.target.value })),
            placeholder: t('dialog.custom'),
            style: { ...dialogInputStyle, marginTop: 4, pointerEvents: 'auto' },
          }),
        ]}),
      ),
      jsx('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' }, children: [
        jsx(Button, { onClick: () => void cancel(), disabled: busy, children: t('dialog.cancel') }),
        jsx(Button, { onClick: () => void submit(), disabled: busy, children: t('dialog.submit') }),
      ]}),
    ],
  });
}

const dialogCardStyle = {
  width: 'min(480px, calc(100vw - 40px))',
  background: '#ffffff',
  color: '#222',
  borderRadius: 14,
  boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
  padding: 18,
  maxHeight: '80vh',
  overflowY: 'auto',
} as const;

const dialogInputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: 8,
  borderRadius: 8,
  border: '1px solid var(--dsh-border, #ddd)',
  background: '#fafafa',
  color: 'inherit',
  fontFamily: 'inherit',
  fontSize: 13,
} as const;

/** Full-screen page content. */
function NoteCoachPage({ ctx, t, close }: { ctx: ClientCtx; t: (k: string) => string; close: () => void }) {
  // 会话/工作区列表：新版 dsh（0.1.1）的 sidebar.footer.action 不再注入 useSessions，
  // 改为直接订阅 ctx.sessions.list（ObservableSnapshot：getSnapshot + subscribe）。
  type SessionListLike = { ids?: string[]; byId?: Record<string, { title?: string; cwd?: string; displayTitle?: string }>; current?: string };
  const sessionsObs = ctx.sessions?.list as { getSnapshot(): SessionListLike; subscribe(fn: () => void): () => void } | undefined;
  const [list, setList] = useState<SessionListLike | undefined>(() => sessionsObs?.getSnapshot());
  useEffect(() => {
    if (!sessionsObs) return;
    const sync = () => setList(sessionsObs.getSnapshot());
    sync();
    return sessionsObs.subscribe(sync);
  }, [sessionsObs]);
  const ids = list?.ids ?? [];
  const current = list?.current;
  const [sessionId, setSessionId] = useState<string | undefined>(current && ids.includes(current) ? current : ids[0]);

  // Select the session in the runtime too: the page-local choice drives the
  // DSH current session in THIS window, so the pending bridge and dialogs
  // follow the same session. Auto-pick the current (or first) once the list
  // arrives; afterwards the user's manual choice wins. Every runtime call is
  // guarded: a throw here would unmount the whole page (the "sometimes the
  // page doesn't open" symptom).
  // `ids` must not be an effect dependency: it is re-created as `[]` until the
  // list loads, and depending on it would re-run the effect on every render.
  const idsRef = useRef<string[]>([]);
  idsRef.current = ids;
  useEffect(() => {
    try {
      if (sessionId) {
        if (idsRef.current.includes(sessionId) && ctx.sessions && sessionId !== current) {
          ctx.sessions.open(sessionId);
        }
        return;
      }
      const currentList = idsRef.current;
      const pick = current && currentList.includes(current) ? current : currentList[0];
      if (pick) {
        setSessionId(pick);
        ctx.sessions?.open(pick);
      }
    } catch {
      // never let session wiring crash the page
    }
  }, [sessionId, current]);

  const [opinion, setOpinion] = useState('');
  const [followup, setFollowup] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [judgment, setJudgment] = useState<Judgment | null>(null);
  const [followups, setFollowups] = useState<{ q: string; a: string }[]>([]);

  const dispatch = async (line: string) => {
    if (!sessionId) {
      setOutput(t('noSession'));
      return;
    }
    setBusy(true);
    try {
      const text = await runCommand(ctx, sessionId, line);
      setOutput(text);
      if (line.startsWith('/note ')) {
        setJudgment(parseJudgment(text));
        setFollowups([]);
      }
      if (line.startsWith('/note-followup')) {
        setFollowups((prev) => [...prev, { q: followup.trim(), a: text }]);
      }
    } catch (err) {
      setOutput(`执行异常：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const verdictColor =
    judgment?.verdict.includes('正确') || judgment?.verdict.includes('无所谓')
      ? '#16a34a'
      : judgment?.verdict.includes('部分')
        ? '#d97706'
        : judgment?.verdict.includes('有误')
          ? '#dc2626'
          : '#2563eb';

  const sectionTitle = (label: string) =>
    jsx('h2', { style: { fontSize: 15, fontWeight: 600, margin: '20px 0 8px', color: 'var(--dsh-fg, #222)' }, children: label });

  return jsxs(Fragment, {
    children: [
      jsxs('div', {
        style: {
          position: 'fixed',
          inset: 0,
          zIndex: 9990,
          background: 'var(--dsh-page-bg, #f7f7f8)',
          color: 'var(--dsh-fg, #222)',
          overflowY: 'auto',
          fontFamily: 'system-ui, sans-serif',
        },
        children: [
          // header
          jsxs('div', {
            style: {
              position: 'sticky',
              top: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 20px',
              background: 'var(--dsh-header-bg, #ffffff)',
              borderBottom: '1px solid var(--dsh-border, #e5e5e5)',
              zIndex: 1,
              flexWrap: 'wrap',
            },
            children: [
              jsxs('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }, children: [
                jsx('span', { style: { fontSize: 16, fontWeight: 700 }, children: '📝 ' + t('page.title') }),
                jsx('span', { style: { fontSize: 12, color: 'var(--dsh-muted, #888)' }, children: t('page.urlHint') }),
                jsx('label', { style: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }, children: [
                  t('page.session'),
                  jsx('select', {
                    value: sessionId ?? '',
                    onChange: (e: { target: { value: string } }) => {
                      const v = e.target.value || undefined;
                      setSessionId(v);
                      try {
                        if (v && ctx.sessions) ctx.sessions.open(v);
                      } catch {
                        // non-fatal: page-local selection still works
                      }
                    },
                    style: { padding: '4px 8px', borderRadius: 6, border: '1px solid var(--dsh-border, #ddd)', fontSize: 13, maxWidth: 260 },
                    children: [
                      jsx('option', { value: '', children: t('page.noSession') }),
                      ids.map((id) => {
                        const meta = list?.byId?.[id];
                        // displayTitle = durable title → project basename → session id
                        const label = meta?.displayTitle || meta?.title || id;
                        return jsx('option', { key: id, value: id, children: label });
                      }),
                    ],
                  }),
                ]}),
              ]}),
              jsx('button', {
                type: 'button',
                onClick: close,
                title: t('page.close'),
                style: { border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, padding: 6 },
                children: '✕',
              }),
            ],
          }),
          // body
          jsx('div', {
            style: { maxWidth: 860, margin: '0 auto', padding: '16px 20px 60px' },
            children: jsxs(Fragment, {
              children: [
                sectionTitle(t('judge.label')),
                jsx('textarea', {
                  value: opinion,
                  onChange: (e: { target: { value: string } }) => setOpinion(e.target.value),
                  placeholder: t('judge.placeholder'),
                  rows: 3,
                  style: { width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8, border: '1px solid var(--dsh-border, #ddd)', background: 'var(--dsh-input-bg, #fafafa)', color: 'inherit', fontFamily: 'inherit', fontSize: 14 },
                }),
                jsx('div', { style: { marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }, children: [
                  jsx(Button, { onClick: () => { const text = opinion.trim(); if (text) { void dispatch(`/note ${text}`); } }, disabled: busy || !opinion.trim(), children: t('judge.run') }),
                  busy ? jsx(Spinner, { size: 16 }) : null,
                ]}),
                jsx('style', { children: SPIN_CSS }),
                jsx('style', { children: __KATEX_CSS__ }),
                judgment
                  ? jsxs('div', {
                      style: { marginTop: 12, borderRadius: 10, border: '1px solid var(--dsh-border, #e0e0e0)', background: 'var(--dsh-card-bg, #ffffff)', overflow: 'hidden' },
                      children: [
                        jsx('div', { style: { padding: '10px 14px', borderBottom: '1px solid var(--dsh-border, #eee)', fontWeight: 600, color: verdictColor }, children: `${t('section.verdict')}：${judgment.verdict}` }),
                        judgment.reasoning ? jsx('div', { style: { padding: '10px 14px', borderBottom: '1px solid var(--dsh-border, #eee)' }, children: jsxs(Fragment, { children: [jsx('div', { style: { fontWeight: 600, marginBottom: 4 }, children: t('section.reasoning') }), jsx('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.6 }, children: judgment.reasoning })] }) }) : null,
                        judgment.advice ? jsx('div', { style: { padding: '10px 14px', borderBottom: '1px solid var(--dsh-border, #eee)' }, children: jsxs(Fragment, { children: [jsx('div', { style: { fontWeight: 600, marginBottom: 4 }, children: t('section.advice') }), jsx('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.6 }, children: judgment.advice })] }) }) : null,
                        judgment.location ? jsx('div', { style: { padding: '10px 14px', borderBottom: '1px solid var(--dsh-border, #eee)', color: '#2563eb' }, children: jsxs(Fragment, { children: [jsx('span', { style: { fontWeight: 600 }, children: t('section.location') + '：' }), judgment.location] }) }) : null,
                        judgment.note ? jsx('div', { style: { padding: '10px 14px', color: '#16a34a' }, children: judgment.note }) : null,
                      ],
                    })
                  : jsx('div', { style: { marginTop: 12, color: 'var(--dsh-muted, #999)', fontSize: 13 }, children: t('judge.none') }),
                sectionTitle(t('followup.label')),
                jsx('div', { style: { fontSize: 12, color: 'var(--dsh-muted, #888)', marginBottom: 6 }, children: t('followup.hint') }),
                jsx('div', { style: { display: 'flex', gap: 8 }, children: [
                  jsx('input', {
                    value: followup,
                    onChange: (e: { target: { value: string } }) => setFollowup(e.target.value),
                    placeholder: t('followup.placeholder'),
                    style: { flex: 1, padding: 10, borderRadius: 8, border: '1px solid var(--dsh-border, #ddd)', background: 'var(--dsh-input-bg, #fafafa)', color: 'inherit', fontFamily: 'inherit', fontSize: 14 },
                    onKeyDown: (e: { key: string }) => { if (e.key === 'Enter' && followup.trim() && !busy) { const q = followup.trim(); void dispatch(`/note-followup ${q}`); } },
                  }),
                  jsx(Button, { onClick: () => { const q = followup.trim(); if (q) { void dispatch(`/note-followup ${q}`); } }, disabled: busy || !followup.trim(), children: t('followup.run') }),
                ]}),
                jsx('div', { style: { marginTop: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [
                  jsx(Button, { onClick: () => void dispatch('/note-organize'), disabled: busy, children: t('followup.organize') }),
                  jsx('span', { style: { fontSize: 12, color: 'var(--dsh-muted, #888)' }, children: t('followup.organizeHint') }),
                ]}),
                followups.length
                  ? jsx('div', { style: { marginTop: 10 }, children: followups.map((f, i) => jsxs('div', { key: i, style: { marginBottom: 8, padding: '8px 12px', borderRadius: 8, background: 'var(--dsh-card-bg, #fff)', border: '1px solid var(--dsh-border, #e0e0e0)' }, children: [jsx('div', { style: { fontWeight: 600, marginBottom: 4 }, children: `Q${i + 1}: ${f.q}` }), jsx('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: 13 }, children: f.a.replace(/^【追问回答】\s*/, '') })] })) }) : null,
                sectionTitle(t('report.label')),
                jsx('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [
                  jsx(Button, { onClick: () => void dispatch('/notes-report global summary'), disabled: busy, children: t('report.summary') }),
                  jsx(Button, { onClick: () => void dispatch('/notes-report global evaluate'), disabled: busy, children: t('report.evaluate') }),
                ]}),
                sectionTitle(t('style.label')),
                jsx('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [
                  jsx(Button, { onClick: () => void dispatch('/notes-style'), disabled: busy, children: t('style.learn') }),
                  jsx(Button, { onClick: () => void dispatch('/notes-style status'), disabled: busy, children: t('style.status') }),
                  jsx(Button, { onClick: () => void dispatch('/notes-style clear-memory'), disabled: busy, children: t('style.clearMemory') }),
                ]}),
                sectionTitle(t('github.label')),
                jsx('input', {
                  value: repoUrl,
                  onChange: (e: { target: { value: string } }) => setRepoUrl(e.target.value),
                  placeholder: t('github.placeholder'),
                  style: { width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8, border: '1px solid var(--dsh-border, #ddd)', background: 'var(--dsh-input-bg, #fafafa)', color: 'inherit', fontFamily: 'inherit', fontSize: 14 },
                }),
                jsx('div', { style: { marginTop: 8, display: 'flex', gap: 8 }, children: [
                  jsx(Button, { onClick: () => { const url = repoUrl.trim(); if (url) void dispatch(`/notes-push ${url}`); }, disabled: busy || !repoUrl.trim(), children: t('github.set') }),
                  jsx(Button, { onClick: () => void dispatch('/notes-push'), disabled: busy, children: t('github.push') }),
                ]}),
                sectionTitle(t('output.label')),
                jsx('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }, children: busy ? [jsx(Spinner, { size: 14 }), jsx('span', { style: { fontSize: 12, color: 'var(--dsh-muted, #888)' }, children: t('busy') })] : null }),
                jsx('pre', {
                  style: { margin: 0, padding: 12, borderRadius: 10, background: 'var(--dsh-code-bg, #f2f2f2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 320, overflowY: 'auto', fontSize: 13, lineHeight: 1.6 },
                  children: output ?? t('output.empty'),
                }),
              ],
            }),
          }),
        ],
      }),
      // the page's own dialogs render above the page
      jsx(PendingDialogs, { sessionId, t }),
    ],
  });
}

function SidebarEntry({ ctx, t, wide }: { ctx: ClientCtx; t: (k: string) => string; wide?: boolean }) {
  const [open, openPage, close] = usePageOpen();
  if (open) {
    // Portal to document.body: escape any ancestor stacking context (the
    // sidebar footer lives inside transformed containers), so nothing in the
    // shell can paint above the full-screen page. The error boundary turns any
    // render crash into a visible message instead of falling back to the app.
    return createPortal(
      jsx(PageErrorBoundary, { children: jsx(NoteCoachPage, { ctx, t, close }) }),
      document.body,
    );
  }
  return jsx('div', {
    style: { position: 'relative' },
    children: jsx('button', {
      type: 'button',
      'aria-label': t('page.open'),
      title: t('page.open'),
      onClick: openPage,
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsh-fg, #333)',
        fontSize: 13,
        padding: '8px 10px',
        cursor: 'pointer',
        borderRadius: 8,
      },
      children: [jsx('span', { 'aria-hidden': true, children: '📝' }), wide ? jsx('span', { children: t('page.title') }) : null],
    }),
  });
}

function apply(ctx: ClientCtx) {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    'note-coach: dictionaries',
  );
  const t = ctx.locale.bind(NS);

  // Hidden bridge: publishes pending interactions for the current session.
  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.utilities',
        id: 'note-coach-pending-bridge',
      },
      (props: { sessionId?: string; useSession?: (s: (sn: { pending?: readonly unknown[] }) => unknown) => unknown }) =>
        jsx(PendingBridge, { sessionId: props.sessionId, useSession: props.useSession }),
    ),
  );

  // Sidebar entry: renders the sidebar button AND the dedicated page.
  // 新版 dsh（0.1.1）无 URL 子路由：页面以覆盖层状态开合，不再整页跳转。
  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register(
      {
        name: 'sidebar.footer.action',
        id: 'note-coach-panel',
        locale: NS,
      },
      (props: { wide?: boolean }) => jsx(SidebarEntry, { ctx, t, wide: props.wide }),
    ),
  );
}

const inject = ['slots', 'locale', 'remote', 'remote.commands', 'sessions'];

export { apply, inject, NS };
