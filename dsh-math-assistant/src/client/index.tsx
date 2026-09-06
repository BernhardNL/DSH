/**
 * 数学建模助手 — 独立全屏页面（/math-assistant）。
 *
 * 六区块：题目分析 / 需求与提问 / 阶段显示 / 文献参考 / 程序 / 数据，
 * 共享按项目隔离的服务端记忆；一键生成 Word 论文；清除记忆需确认。
 * 页面通过 ctx.remote.commands 驱动服务端命令；弹窗交互复用 pending 桥接。
 */

import { Button } from '@deepseek-ai/dsh-client-ui-primitives';
import katex from 'katex';
import { marked } from 'marked';
import { createPortal } from 'react-dom';
import { Component, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { jsx, jsxs, Fragment } from 'react/jsx-runtime';
import { publishPending, subscribePending, getPending, removePending } from './store.js';

declare const __KATEX_CSS__: string;

const NS = 'math';

const zh: Record<string, string> = {
  'page.title': '数学建模助手',
  'page.session': '工作区/会话',
  'page.noSession': '（无会话）',
  'page.close': '关闭页面',
  'page.hint': '独立面板 · 右上角 ✕ 关闭',
  'page.open': '打开数学建模助手',
  'prob.label': '题目分析',
  'prob.input': '输入题目描述…（或选择下方文件）',
  'prob.file': '工作区文件',
  'prob.run': '设定题目并分析',
  'prob.none': '尚未分析。设定题目后自动分析每一问。',
  'chat.label': '需求与提问',
  'chat.placeholder': '提问，或输入命令（如：建立并求解第一问的优化模型）…',
  'chat.send': '发送',
  'pipeline.label': '阶段显示',
  'pipeline.idle': '尚无流水线。在需求与提问中输入建模命令（如"求解第一问"）即自动规划并执行。',
  'pipeline.plan': '总体步骤设计',
  'pipeline.current': '当前',
  'refs.label': '文献参考',
  'refs.input': '主题（如：ARIMA 时间序列预测）',
  'refs.run': '收集文献',
  'code.label': '程序',
  'code.input': '实现要求（如：用 scipy 求解第一问的线性规划）',
  'code.run': '生成代码',
  'data.label': '数据',
  'data.file': '数据文件',
  'data.spec': '显示要求（可选，如：前10行和相关系数矩阵）',
  'data.run': '处理数据',
  'paper.label': '一键 Word 论文',
  'paper.input': '额外要求/修改要求（可选）',
  'paper.run': '生成/修改论文',
  'paper.cancel': '取消重排',
  'memory.label': '项目记忆',
  'memory.status': '查看',
  'memory.clear': '清除记忆',
  'format.label': '论文格式学习',
  'format.input': '参考论文文件名（可多个，空格分隔，需在工作区）',
  'format.learn': '学习格式',
  'format.status': '查看',
  'format.clear': '清除格式',
  'busy': '执行中…',
  'noSessionMsg': '请先选择工作区（会话）。工作区文件夹将作为建模项目目录。',
  'cmd': '命令',
  'exec': '执行',
  'dialog.approve': '允许',
  'dialog.reject': '拒绝',
  'dialog.cancel': '放弃',
  'dialog.submit': '提交',
  'dialog.custom': '输入你的答案…',
};

const en: Record<string, string> = {
  'page.title': 'Math Modeling Assistant',
  'page.session': 'Workspace / Session',
  'page.noSession': '(no session)',
  'page.close': 'Close',
  'page.hint': 'Standalone panel · close with ✕',
  'page.open': 'Open math modeling assistant',
  'prob.label': 'Problem Analysis',
  'prob.input': 'Describe the problem… (or pick a file below)',
  'prob.file': 'Workspace files',
  'prob.run': 'Set problem & analyze',
  'prob.none': 'No analysis yet. Set the problem to analyze each question.',
  'chat.label': 'Requests & Q&A',
  'chat.placeholder': 'Ask a question, or issue a command (e.g. build and solve Q1 as an optimization model)…',
  'chat.send': 'Send',
  'pipeline.label': 'Pipeline',
  'pipeline.idle': 'No pipeline yet. Issue a modeling command in the Q&A box (e.g. "solve Q1").',
  'pipeline.plan': 'Plan',
  'pipeline.current': 'Now',
  'refs.label': 'References',
  'refs.input': 'Topic (e.g. ARIMA time series)',
  'refs.run': 'Collect',
  'code.label': 'Code',
  'code.input': 'Implementation request (e.g. solve Q1 LP with scipy)',
  'code.run': 'Generate',
  'data.label': 'Data',
  'data.file': 'Data file',
  'data.spec': 'Display spec (optional)',
  'data.run': 'Process',
  'paper.label': 'Word Paper',
  'paper.input': 'Extra / modification request (optional)',
  'paper.run': 'Generate / Modify',
  'paper.cancel': 'Cancel reformat',
  'memory.label': 'Project Memory',
  'memory.status': 'Status',
  'memory.clear': 'Clear',
  'format.label': 'Paper format learning',
  'format.input': 'Reference paper file names (space separated, in workspace)',
  'format.learn': 'Learn format',
  'format.status': 'Status',
  'format.clear': 'Clear format',
  'busy': 'Working…',
  'noSessionMsg': 'Select a workspace (session) first. Its folder is the modeling project root.',
  'cmd': 'command',
  'exec': 'run',
  'dialog.approve': 'Approve',
  'dialog.reject': 'Reject',
  'dialog.cancel': 'Cancel',
  'dialog.submit': 'Submit',
  'dialog.custom': 'Type your answer…',
};

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
      execute(sessionId: string, line: string): Promise<
        | { ok: true; value: { commandId: string; result: { kind: 'success'; text?: string } | { kind: 'error'; text: string } } }
        | { ok: false; error: { code: string; message: string } }
      >;
    };
  };
  sessions: { open(id: string): void };
}

async function runCommand(ctx: ClientCtx, sessionId: string, line: string): Promise<string> {
  const answered = await ctx.remote.commands.execute(sessionId, line);
  if (!answered.ok) return `命令执行失败：${answered.error.code} ${answered.error.message}`;
  return answered.value.result.text ?? '(无输出)';
}

/** 页面开合状态：纯组件状态。新版 dsh 无 URL 子路由（任意路径均 404），
 *  整页跳转会报"网站出现问题"，因此不再修改地址栏，页面以覆盖层形式开合。 */
function usePageOpen(): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(false);
  return [open, () => setOpen(true), () => setOpen(false)];
}

// ── 渲染辅助（复用笔记助手：KaTeX + marked + 错误边界 + 弹窗桥接） ──

const SPIN_CSS =
  '@keyframes nc-spin { to { transform: rotate(360deg); } }' +
  '.nc-spinner { box-sizing: border-box; border-radius: 50%; border: 2px solid var(--dsh-border, #d0d0d0); border-top-color: #2563eb; animation: nc-spin 0.8s linear infinite; display: inline-block; }';

function Spinner({ size = 18 }: { size?: number }) {
  return jsx('span', { className: 'nc-spinner', 'aria-label': 'loading', style: { width: size, height: size } });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMarkdownPreview(detail: string): string {
  const fmStart = detail.search(/\n\n---\r?\n/);
  const intro = fmStart >= 0 ? detail.slice(0, fmStart) : '';
  const body = fmStart >= 0 ? detail.slice(fmStart + 2) : detail;
  return marked.parse(intro, { gfm: true, breaks: true }) + renderNoteBody(body);
}

function renderNoteBody(md: string): string {
  let fmHtml = '';
  let body = md;
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) {
    fmHtml = `<pre style="margin:0 0 8px;padding:8px 10px;background:#fafafa;border:1px solid var(--dsh-border,#e5e5e5);border-radius:6px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11.5px;color:#666;white-space:pre-wrap;">${escapeHtml(fm[1])}</pre>`;
    body = md.slice(fm[0].length);
  }
  const tokens: string[] = [];
  const protectedBody = body.replace(/\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g, (match, block, inline) => {
    try {
      const html = katex.renderToString(block ?? inline ?? '', { displayMode: Boolean(block), throwOnError: false, output: 'html' });
      const id = `\u0000NC${tokens.length}\u0000`;
      tokens.push(html);
      return id;
    } catch {
      return match;
    }
  });
  const rendered = marked.parse(protectedBody, { gfm: true, breaks: true }) as string;
  return fmHtml + rendered.replace(/\u0000NC(\d+)\u0000/g, (_m, i) => tokens[Number(i)] ?? '');
}

function Markdown({ text }: { text: string }) {
  return jsx('div', { style: { lineHeight: 1.6, wordBreak: 'break-word' }, dangerouslySetInnerHTML: { __html: renderMarkdownPreview(text) } });
}

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
      return jsx('div', {
        style: { position: 'fixed', inset: 0, zIndex: 9999, background: '#fff', color: '#c00', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, fontFamily: 'system-ui, sans-serif', padding: 24 },
        children: [
          jsx('div', { style: { fontWeight: 700, fontSize: 16 }, children: '数学建模助手渲染异常' }),
          jsx('pre', { style: { whiteSpace: 'pre-wrap', maxWidth: 640, fontSize: 12, color: '#333' }, children: message }),
          jsx('button', { type: 'button', onClick: () => window.location.reload(), style: { padding: '8px 16px', borderRadius: 8, border: '1px solid #ccc', background: '#f5f5f5', cursor: 'pointer', fontSize: 13 }, children: '刷新重试' }),
        ],
      });
    }
    return this.props.children as never;
  }
}

function PendingBridge(props: { sessionId?: string; useSession?: (s: (sn: { pending?: readonly unknown[] }) => unknown) => unknown }) {
  const pending = props.useSession?.((s: { pending?: readonly unknown[] }) => s.pending);
  useEffect(() => {
    if (props.sessionId && pending) publishPending(props.sessionId, pending as readonly unknown[]);
  }, [props.sessionId, pending]);
  return null;
}

function PendingDialogs({ sessionId, t }: { sessionId: string | undefined; t: (k: string) => string }) {
  const pending = useSyncExternalStore(subscribePending, () => getPending(sessionId), () => getPending(sessionId));
  const baseline = useRef<Set<string> | null>(null);
  const lastSession = useRef<string | undefined>(undefined);
  if (lastSession.current !== sessionId) {
    lastSession.current = sessionId;
    baseline.current = new Set(pending.map((e) => e.key));
  }
  const fresh = pending.filter((e) => !baseline.current?.has(e.key));
  if (fresh.length === 0) return null;
  return createPortal(
    jsx('div', {
      style: { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.45)', fontFamily: 'system-ui, sans-serif' },
      children: fresh.map((wait) => (wait.kind === 'approval' ? jsx(ApprovalDialog, { key: wait.key, wait, t }) : jsx(QuestionDialog, { key: wait.key, wait, t }))),
    }),
    document.body,
  );
}

const dialogCardStyle = { width: 'min(520px, calc(100vw - 40px))', background: '#fff', color: '#222', borderRadius: 14, boxShadow: '0 16px 48px rgba(0,0,0,0.25)', padding: 18, maxHeight: '80vh', overflowY: 'auto', position: 'relative', zIndex: 1, pointerEvents: 'auto' } as const;

function ApprovalDialog({ wait, t }: { wait: ReturnType<typeof getPending>[number]; t: (k: string) => string }) {
  const payload = wait.payload as { approvalId?: string; toolName?: string; reason?: string };
  const answer = async (outcome: 'allowed-once' | 'rejected') => {
    try {
      await wait.respond({ ok: true, value: { sessionId: wait.sessionId, approvalId: payload.approvalId, outcome } });
    } catch {
      /* settled */
    } finally {
      removePending(wait.sessionId, wait.key);
    }
  };
  return jsxs('div', { style: dialogCardStyle, children: [
    jsx('div', { style: { fontWeight: 700, fontSize: 15, marginBottom: 8 }, children: `${payload.toolName ?? 'math_assistant'} · 审批` }),
    jsx('div', { style: { whiteSpace: 'pre-wrap', lineHeight: 1.6, marginBottom: 14 }, children: payload.reason ?? '' }),
    jsx('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' }, children: [
      jsx(Button, { onClick: () => void answer('allowed-once'), children: t('dialog.approve') }),
      jsx(Button, { onClick: () => void answer('rejected'), children: t('dialog.reject') }),
    ]}),
  ]});
}

function QuestionDialog({ wait, t }: { wait: ReturnType<typeof getPending>[number]; t: (k: string) => string }) {
  const payload = wait.payload as { questions?: Array<{ id: string; question: string; detail?: string; header?: string; options?: Array<{ label: string; description?: string }> }> };
  const questions = payload.questions ?? [];
  const [selected, setSelected] = useState<Record<string, string | undefined>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const toggle = (qid: string, label: string) =>
    setSelected((prev) => {
      const next = { ...prev };
      if (prev[qid] === label) delete next[qid];
      else next[qid] = label;
      return next;
    });
  const submit = async () => {
    const answers = questions
      .map((q) => ({ id: q.id, selected: selected[q.id] ? [selected[q.id] as string] : [], custom: custom[q.id]?.trim() || undefined }))
      .filter((a) => a.selected.length > 0 || a.custom);
    if (answers.length !== questions.length) return;
    try {
      await wait.respond({ ok: true, value: { sessionId: wait.sessionId, answer: { answers } } });
    } catch {
      /* settled */
    } finally {
      removePending(wait.sessionId, wait.key);
    }
  };
  const cancel = async () => {
    try {
      await wait.respond({ ok: false, error: { code: 'cancelled', message: 'the user closed this question request', details: {} } });
    } catch {
      /* settled */
    } finally {
      removePending(wait.sessionId, wait.key);
    }
  };
  return jsxs('div', { style: { ...dialogCardStyle, maxWidth: 560 }, children: [
    questions.map((q) =>
      jsxs('div', { key: q.id, style: { marginBottom: 12 }, children: [
        q.header ? jsx('div', { style: { fontWeight: 700, fontSize: 15, marginBottom: 4 }, children: q.header }) : null,
        jsx('div', { style: { fontWeight: 600, fontSize: 14, marginBottom: 4, lineHeight: 1.5 }, children: q.question }),
        q.detail ? jsx('div', { style: { fontSize: 13, marginBottom: 8, maxHeight: 260, overflowY: 'auto', background: '#fff', border: '1px solid var(--dsh-border,#e5e5e5)', borderRadius: 8, padding: 10, wordBreak: 'break-word' }, dangerouslySetInnerHTML: { __html: renderMarkdownPreview(q.detail) } }) : null,
        (q.options ?? []).map((opt) => {
          const active = selected[q.id] === opt.label;
          return jsx('button', {
            type: 'button',
            onClick: () => toggle(q.id, opt.label),
            'aria-pressed': active,
            style: { display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', marginBottom: 6, borderRadius: 8, pointerEvents: 'auto', position: 'relative', zIndex: 1, border: active ? '1.5px solid #2563eb' : '1px solid var(--dsh-border, #ddd)', background: active ? '#eff6ff' : '#fafafa', cursor: 'pointer', fontSize: 13, color: 'inherit' },
            children: jsxs(Fragment, { children: [
              jsx('div', { style: { fontWeight: 600 }, children: `${active ? '✓ ' : ''}${opt.label}` }),
              opt.description ? jsx('div', { style: { fontSize: 12, color: '#777', marginTop: 2 }, children: opt.description }) : null,
            ]}),
          });
        }),
        jsx('input', {
          value: custom[q.id] ?? '',
          onChange: (e: { target: { value: string } }) => setCustom((prev) => ({ ...prev, [q.id]: e.target.value })),
          placeholder: t('dialog.custom'),
          style: { width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 8, border: '1px solid var(--dsh-border,#ddd)', background: '#fafafa', marginTop: 4, fontFamily: 'inherit', fontSize: 13, pointerEvents: 'auto' },
        }),
      ]}),
    ),
    jsx('div', { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' }, children: [
      jsx(Button, { onClick: () => void cancel(), children: t('dialog.cancel') }),
      jsx(Button, { onClick: () => void submit(), children: t('dialog.submit') }),
    ]}),
  ]});
}

// ── 页面主体 ──

interface Snapshot {
  problem?: { title?: string; description?: string; problemFile?: string };
  analysis?: Array<{ question: string; type: string; models: string[]; algorithms: string[]; tools: string[]; approach: string; subProblems: string[] }>;
  pipeline?: { status: string; current: string; stages: Array<{ title: string; detail: string; status: string; reasoningBrief?: string; output?: string }>; plan: string };
  references?: Array<{ title: string; url?: string; note: string; verified: boolean }>;
  data?: Array<{ fileName: string; rows: number; columns: string[]; statsText: string }>;
  code?: Array<{ name: string; path: string; language: string; description: string; verified: boolean }>;
  papers?: Array<{ path: string; generatedAt: string }>;
  chat?: Array<{ role: 'user' | 'assistant'; text: string }>;
}

const COMMAND_PREFIXES = ['求解', '建模', '分析', '实现', '建立', '拟合', '预测', '优化', '模拟', '整理', '写'];

function MathPage({
  ctx,
  t,
  useSessions,
  close,
}: {
  ctx: ClientCtx;
  t: (k: string) => string;
  useSessions?: (s: (st: { ids?: string[]; byId?: Record<string, { title?: string; cwd?: string; displayTitle?: string }>; current?: string }) => unknown) => unknown;
  close: () => void;
}) {
  const list = (useSessions as ((s: (st: { ids?: string[]; byId?: Record<string, { title?: string; cwd?: string; displayTitle?: string }>; current?: string }) => unknown) => unknown) | undefined)?.((st) => st) as
    | { ids?: string[]; byId?: Record<string, { title?: string; cwd?: string; displayTitle?: string }>; current?: string }
    | undefined;
  const ids = list?.ids ?? [];
  const current = list?.current;
  const idsRef = useRef<string[]>([]);
  idsRef.current = ids;
  const [sessionId, setSessionId] = useState<string | undefined>(current && ids.includes(current) ? current : ids[0]);
  useEffect(() => {
    try {
      if (sessionId) {
        if (idsRef.current.includes(sessionId) && ctx.sessions && sessionId !== current) ctx.sessions.open(sessionId);
        return;
      }
      const pick = current && idsRef.current.includes(current) ? current : idsRef.current[0];
      if (pick) {
        setSessionId(pick);
        ctx.sessions?.open(pick);
      }
    } catch {
      /* ignore */
    }
  }, [sessionId, current]);

  const [problemText, setProblemText] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [refTopic, setRefTopic] = useState('');
  const [codeReq, setCodeReq] = useState('');
  const [dataFile, setDataFile] = useState('');
  const [dataSpec, setDataSpec] = useState('');
  const [paperReq, setPaperReq] = useState('');
  const [formatFiles, setFormatFiles] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');

  const refreshSnapshot = async () => {
    if (!sessionId) return;
    try {
      const text = await runCommand(ctx, sessionId, '/math-snapshot');
      const parsed = JSON.parse(text) as Snapshot;
      setSnap(parsed);
    } catch {
      /* ignore */
    }
  };

  const refreshFiles = async () => {
    if (!sessionId) return;
    try {
      const text = await runCommand(ctx, sessionId, '/math-files');
      setFiles(text.split('\n').filter(Boolean));
    } catch {
      setFiles([]);
    }
  };

  useEffect(() => {
    if (sessionId) {
      void refreshSnapshot();
      void refreshFiles();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 流水线轮询：执行期间每 2s 拉取状态
  useEffect(() => {
    if (!busy || !sessionId) return;
    const timer = setInterval(() => {
      runCommand(ctx, sessionId, '/math-status')
        .then((text) => {
          try {
            const s = JSON.parse(text) as Snapshot['pipeline'];
            setSnap((prev) => (prev ? { ...prev, pipeline: s } : prev));
          } catch {
            /* ignore */
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => clearInterval(timer);
  }, [busy, sessionId, ctx]);

  const dispatch = async (line: string, opts?: { quiet?: boolean }) => {
    if (!sessionId) {
      setOutput(t('noSessionMsg'));
      return;
    }
    setBusy(true);
    try {
      const text = await runCommand(ctx, sessionId, line);
      if (!opts?.quiet) {
        setOutput(text);
        setSnap((prev) => (prev ? { ...prev, chat: [...(prev.chat ?? []), { role: 'user' as const, text: line }, { role: 'assistant' as const, text }] } : prev));
      }
      await refreshSnapshot();
      if (line.startsWith('/math-problem') || line.startsWith('/math-data')) await refreshFiles();
    } catch (err) {
      setOutput(`执行异常：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const sendChat = () => {
    const text = chatInput.trim();
    if (!text) return;
    setChatInput('');
    const isCommand = COMMAND_PREFIXES.some((p) => text.startsWith(p));
    void dispatch(isCommand ? `/math-run ${text}` : `/math-ask ${text}`);
  };

  const sectionTitle = (label: string) => jsx('h2', { style: { fontSize: 15, fontWeight: 600, margin: '20px 0 8px', color: 'var(--dsh-fg,#222)' }, children: label });
  const card = (children: unknown) => jsx('div', { style: { borderRadius: 10, border: '1px solid var(--dsh-border,#e0e0e0)', background: 'var(--dsh-card-bg,#fff)', padding: 12, marginBottom: 8 }, children });
  const inputStyle = { width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8, border: '1px solid var(--dsh-border,#ddd)', background: 'var(--dsh-input-bg,#fafafa)', color: 'inherit', fontFamily: 'inherit', fontSize: 13 } as const;

  const chat = snap?.chat ?? [];
  const pipeline = snap?.pipeline;
  const references = snap?.references ?? [];
  const codeArtifacts = snap?.code ?? [];
  const dataList = snap?.data ?? [];

  return jsxs(Fragment, {
    children: [
      jsxs('div', {
        style: { position: 'fixed', inset: 0, zIndex: 9990, background: 'var(--dsh-page-bg,#f7f7f8)', color: 'var(--dsh-fg,#222)', overflowY: 'auto', fontFamily: 'system-ui, sans-serif' },
        children: [
          jsx('style', { children: SPIN_CSS }),
          jsx('style', { children: __KATEX_CSS__ }),
          // 头部
          jsxs('div', {
            style: { position: 'sticky', top: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 20px', background: 'var(--dsh-header-bg,#fff)', borderBottom: '1px solid var(--dsh-border,#e5e5e5)', zIndex: 1, flexWrap: 'wrap' },
            children: [
              jsxs('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }, children: [
                jsx('span', { style: { fontSize: 16, fontWeight: 700 }, children: '🧮 ' + t('page.title') }),
                jsx('span', { style: { fontSize: 12, color: 'var(--dsh-muted,#888)' }, children: t('page.hint') }),
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
                        /* ignore */
                      }
                    },
                    style: { padding: '4px 8px', borderRadius: 6, border: '1px solid var(--dsh-border,#ddd)', fontSize: 13, maxWidth: 280 },
                    children: [
                      jsx('option', { value: '', children: t('page.noSession') }),
                      ids.map((id) => {
                        const meta = list?.byId?.[id];
                        const label = meta?.displayTitle || meta?.title || id;
                        return jsx('option', { key: id, value: id, children: label });
                      }),
                    ],
                  }),
                ]}),
              ]}),
              jsx('button', { type: 'button', onClick: close, title: t('page.close'), style: { border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, padding: 6 }, children: '✕' }),
            ],
          }),
          jsx('div', {
            style: { maxWidth: 900, margin: '0 auto', padding: '16px 20px 60px' },
            children: jsxs(Fragment, {
              children: [
                // 1. 题目分析
                sectionTitle(t('prob.label')),
                card(jsxs(Fragment, { children: [
                  jsx('textarea', { value: problemText, onChange: (e: { target: { value: string } }) => setProblemText(e.target.value), placeholder: t('prob.input'), rows: 4, style: inputStyle }),
                  jsx('div', { style: { marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }, children: [
                    jsx('select', { value: '', onChange: (e: { target: { value: string } }) => { if (e.target.value) { setProblemText(e.target.value); } }, style: { padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsh-border,#ddd)', fontSize: 13, maxWidth: 320 }, children: [
                      jsx('option', { value: '', children: `${t('prob.file')}…` }),
                      files.map((f) => jsx('option', { key: f, value: f, children: f })),
                    ]}),
                    jsx(Button, { onClick: () => { const text = problemText.trim(); if (text) void dispatch(`/math-problem ${text}`); }, disabled: busy || !problemText.trim(), children: t('prob.run') }),
                    busy ? jsx(Spinner, { size: 16 }) : null,
                  ]}),
                ]})),
                (snap?.analysis?.length ?? 0) > 0
                  ? snap!.analysis!.map((a, i) =>
                      card(jsxs(Fragment, { children: [
                        jsx('div', { style: { fontWeight: 700, marginBottom: 4 }, children: `${i + 1}. ${a.question}（${a.type}）` }),
                        jsx('div', { style: { fontSize: 13, lineHeight: 1.6 }, children: [
                          a.models.length ? jsx('div', { children: `模型：${a.models.join('、')}` }) : null,
                          a.algorithms.length ? jsx('div', { children: `算法：${a.algorithms.join('、')}` }) : null,
                          a.tools.length ? jsx('div', { children: `工具：${a.tools.join('、')}` }) : null,
                          a.approach ? jsx('div', { style: { marginTop: 4 }, children: `思路：${a.approach}` }) : null,
                          a.subProblems.length ? jsx('div', { style: { marginTop: 4, color: '#555' }, children: `子问题：${a.subProblems.join('；')}` }) : null,
                        ]}),
                      ]})),
                    )
                  : jsx('div', { style: { color: 'var(--dsh-muted,#999)', fontSize: 13 }, children: t('prob.none') }),
                // 2. 需求与提问
                sectionTitle(t('chat.label')),
                card(jsxs(Fragment, { children: [
                  jsx('div', { style: { maxHeight: 260, overflowY: 'auto', marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }, children: chat.length ? chat.map((m, i) => jsx('div', { key: i, style: { fontSize: 13, padding: '6px 10px', borderRadius: 8, background: m.role === 'user' ? '#eef2ff' : 'var(--dsh-code-bg,#f2f2f2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }, children: m.role === 'user' ? `你：${m.text}` : jsx(Markdown, { text: m.text }) })) : jsx('div', { style: { color: 'var(--dsh-muted,#999)', fontSize: 13 }, children: t('chat.placeholder') }) }),
                  jsx('div', { style: { display: 'flex', gap: 8 }, children: [
                    jsx('input', { value: chatInput, onChange: (e: { target: { value: string } }) => setChatInput(e.target.value), placeholder: t('chat.placeholder'), style: { ...inputStyle, flex: 1 }, onKeyDown: (e: { key: string }) => { if (e.key === 'Enter') sendChat(); } }),
                    jsx(Button, { onClick: sendChat, disabled: busy || !chatInput.trim(), children: t('chat.send') }),
                  ]}),
                ]})),
                // 3. 阶段显示
                sectionTitle(t('pipeline.label')),
                pipeline && pipeline.stages.length > 0
                  ? card(jsxs(Fragment, { children: [
                      pipeline.plan ? jsx('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 }, children: `${t('pipeline.plan')}：${pipeline.plan}` }) : null,
                      jsx('div', { style: { display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }, children: busy ? [jsx(Spinner, { size: 14 }), jsx('span', { style: { fontSize: 12, color: '#2563eb' }, children: `${t('pipeline.current')}：${pipeline.current}` })] : jsx('span', { style: { fontSize: 12, color: 'var(--dsh-muted,#888)' }, children: `状态：${pipeline.status === 'done' ? '已完成' : pipeline.status === 'running' ? '执行中' : pipeline.status}` }) }),
                      pipeline.stages.map((s, i) => {
                        const color = s.status === 'done' ? '#16a34a' : s.status === 'running' ? '#2563eb' : s.status === 'error' ? '#dc2626' : '#999';
                        return jsxs('div', { key: i, style: { display: 'flex', gap: 8, padding: '6px 0', borderBottom: i < pipeline.stages.length - 1 ? '1px solid var(--dsh-border,#f0f0f0)' : 'none' }, children: [
                          jsx('span', { style: { color, fontWeight: 700, fontSize: 13 }, children: s.status === 'done' ? '✓' : s.status === 'running' ? '▶' : s.status === 'error' ? '✗' : '○' }),
                          jsxs('div', { children: [
                            jsx('div', { style: { fontSize: 13, fontWeight: 600, color }, children: `${i + 1}. ${s.title}` }),
                            s.detail ? jsx('div', { style: { fontSize: 12, color: '#666' }, children: s.detail }) : null,
                            s.reasoningBrief ? jsx('div', { style: { fontSize: 12, color: '#888', marginTop: 2, whiteSpace: 'pre-wrap' }, children: `推理简述：${s.reasoningBrief.slice(0, 200)}` }) : null,
                            s.output ? jsx('details', { style: { marginTop: 4 }, children: [jsx('summary', { style: { fontSize: 12, color: '#2563eb', cursor: 'pointer' }, children: '阶段输出' }), jsx('pre', { style: { fontSize: 12, whiteSpace: 'pre-wrap', background: '#fafafa', padding: 8, borderRadius: 6, maxHeight: 200, overflowY: 'auto' }, children: s.output.slice(0, 3000) })] }) : null,
                          ]}),
                        ]});
                      }),
                    ]}))
                  : jsx('div', { style: { color: 'var(--dsh-muted,#999)', fontSize: 13 }, children: t('pipeline.idle') }),
                // 4. 文献参考
                sectionTitle(t('refs.label')),
                card(jsxs(Fragment, { children: [
                  jsx('div', { style: { display: 'flex', gap: 8 }, children: [
                    jsx('input', { value: refTopic, onChange: (e: { target: { value: string } }) => setRefTopic(e.target.value), placeholder: t('refs.input'), style: { ...inputStyle, flex: 1 } }),
                    jsx(Button, { onClick: () => { const topic = refTopic.trim(); if (topic) void dispatch(`/math-refs ${topic}`); }, disabled: busy || !refTopic.trim(), children: t('refs.run') }),
                  ]}),
                  references.length ? jsx('div', { style: { marginTop: 8 }, children: references.map((r, i) =>
                    jsx('div', { key: i, style: { fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--dsh-border,#f0f0f0)' }, children: [
                      jsx('span', { style: { fontWeight: 600 }, children: `${i + 1}. ${r.title}` }),
                      r.url ? jsx('span', { children: ` ${r.verified ? '' : '（⚠️ 未验证）'}` }) : null,
                      jsx('div', { style: { fontSize: 12, color: '#666' }, children: `${r.note}${r.url ? ` ${r.url}` : ''}` }),
                    ] }))}) : null,
                ]})),
                // 5. 程序
                sectionTitle(t('code.label')),
                card(jsxs(Fragment, { children: [
                  jsx('div', { style: { display: 'flex', gap: 8 }, children: [
                    jsx('input', { value: codeReq, onChange: (e: { target: { value: string } }) => setCodeReq(e.target.value), placeholder: t('code.input'), style: { ...inputStyle, flex: 1 } }),
                    jsx(Button, { onClick: () => { const req = codeReq.trim(); if (req) void dispatch(`/math-code ${req}`); }, disabled: busy || !codeReq.trim(), children: t('code.run') }),
                  ]}),
                  codeArtifacts.length ? jsx('div', { style: { marginTop: 8 }, children: codeArtifacts.map((c, i) => jsx('div', { key: i, style: { fontSize: 13, padding: '4px 0', borderBottom: '1px solid var(--dsh-border,#f0f0f0)' }, children: `${c.path} — ${c.description}${c.verified ? ' ✅' : ' ⚠️'}` })) }) : null,
                ]})),
                // 6. 数据
                sectionTitle(t('data.label')),
                card(jsxs(Fragment, { children: [
                  jsx('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [
                    jsx('select', { value: dataFile, onChange: (e: { target: { value: string } }) => setDataFile(e.target.value), style: { padding: '6px 8px', borderRadius: 6, border: '1px solid var(--dsh-border,#ddd)', fontSize: 13, maxWidth: 260 }, children: [
                      jsx('option', { value: '', children: `${t('data.file')}…` }),
                      files.filter((f) => /\.(txt|csv|xlsx|xls|tsv)$/i.test(f)).map((f) => jsx('option', { key: f, value: f, children: f })),
                    ]}),
                    jsx('input', { value: dataSpec, onChange: (e: { target: { value: string } }) => setDataSpec(e.target.value), placeholder: t('data.spec'), style: { ...inputStyle, flex: 1, minWidth: 200 } }),
                    jsx(Button, { onClick: () => { if (dataFile) void dispatch(`/math-data ${dataFile}${dataSpec.trim() ? ` ${dataSpec.trim()}` : ''}`); }, disabled: busy || !dataFile, children: t('data.run') }),
                  ]}),
                  dataList.length ? jsx('div', { style: { marginTop: 8 }, children: dataList.map((d, i) =>
                    jsx('div', { key: i, style: { fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--dsh-border,#f0f0f0)' }, children: [
                      jsx('div', { style: { fontWeight: 600 }, children: `${d.fileName}（${d.rows} 行）` }),
                      jsx('pre', { style: { fontSize: 12, whiteSpace: 'pre-wrap', background: '#fafafa', padding: 8, borderRadius: 6, marginTop: 4, maxHeight: 200, overflowY: 'auto' }, children: d.statsText.slice(0, 2000) }),
                    ] }),
                  )}) : null,
                ]})),
                // 论文
                sectionTitle(t('paper.label')),
                card(jsxs(Fragment, { children: [
                  jsx('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [
                    jsx('input', { value: paperReq, onChange: (e: { target: { value: string } }) => setPaperReq(e.target.value), placeholder: t('paper.input'), style: { ...inputStyle, flex: 1, minWidth: 200 } }),
                    jsx(Button, { onClick: () => { const req = paperReq.trim(); void dispatch(req ? `/math-paper ${req}` : '/math-paper'); }, disabled: busy, children: t('paper.run') }),
                    busy ? jsx(Button, { onClick: () => void dispatch('/math-cancel', { quiet: true }), children: t('paper.cancel') }) : null,
                  ]}),
                  jsx('div', { style: { fontSize: 12, color: 'var(--dsh-muted,#888)', marginTop: 6 }, children: '若已把源论文设为问题文件（docx/pdf），将自动转为重排版：保留全文、补充公式、套用格式规范；执行中可随时点"取消"（当前块结束后停止，已完成的块保留）。' }),
                  (snap?.papers?.length ?? 0) > 0 ? jsx('div', { style: { marginTop: 8, fontSize: 13 }, children: snap!.papers!.map((p, i) => jsx('div', { key: i, children: `📄 ${p.path}` })) }) : null,
                ]})),
                // 记忆
                sectionTitle(t('memory.label')),
                card(jsxs(Fragment, { children: [
                  jsx('div', { style: { display: 'flex', gap: 8 }, children: [
                    jsx(Button, { onClick: () => void dispatch('/math-memory status'), disabled: busy, children: t('memory.status') }),
                    jsx(Button, { onClick: () => void dispatch('/math-memory clear'), disabled: busy, children: t('memory.clear') }),
                  ]}),
                  jsx('div', { style: { fontSize: 12, color: 'var(--dsh-muted,#888)', marginTop: 6 }, children: '清除记忆会弹出确认；清除后题目/分析/数据/流水线/文献/代码/论文记录/聊天全部清空。' }),
                ]})),
                // 论文格式学习
                sectionTitle(t('format.label')),
                card(jsxs(Fragment, { children: [
                  jsx('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [
                    jsx('input', {
                      value: formatFiles,
                      onChange: (e: { target: { value: string } }) => setFormatFiles(e.target.value),
                      placeholder: t('format.input'),
                      style: { ...inputStyle, flex: 1, minWidth: 200 },
                    }),
                    jsx(Button, { onClick: () => { const files = formatFiles.trim(); if (files) void dispatch(`/math-learn-format ${files}`); }, disabled: busy || !formatFiles.trim(), children: t('format.learn') }),
                    jsx(Button, { onClick: () => void dispatch('/math-format status'), disabled: busy, children: t('format.status') }),
                    jsx(Button, { onClick: () => void dispatch('/math-format clear'), disabled: busy, children: t('format.clear') }),
                  ]}),
                  jsx('div', { style: { fontSize: 12, color: 'var(--dsh-muted,#888)', marginTop: 6 }, children: '学习后，重排版与生成论文会自动套用该格式规范（章节/标题/公式编号/图表/引用）。' }),
                ]})),
                // 输出
                output
                  ? jsx('div', { style: { marginTop: 16, padding: 12, borderRadius: 10, background: 'var(--dsh-code-bg,#f2f2f2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 360, overflowY: 'auto', fontSize: 13, lineHeight: 1.6 }, children: output })
                  : null,
              ],
            }),
          }),
        ],
      }),
      jsx(PendingDialogs, { sessionId, t }),
    ],
  });
}

function SidebarEntry({ ctx, t, wide, useSessions }: { ctx: ClientCtx; t: (k: string) => string; wide?: boolean; useSessions?: (s: (st: unknown) => unknown) => unknown }) {
  const [open, openPage, close] = usePageOpen();
  if (open) {
    return createPortal(jsx(PageErrorBoundary, { children: jsx(MathPage, { ctx, t, useSessions, close }) }), document.body);
  }
  return jsx('div', {
    style: { position: 'relative' },
    children: jsx('button', {
      type: 'button',
      'aria-label': t('page.open'),
      title: t('page.open'),
      onClick: openPage,
      style: { display: 'flex', alignItems: 'center', gap: 6, width: '100%', border: 'none', background: 'transparent', color: 'var(--dsh-fg,#333)', fontSize: 13, padding: '8px 10px', cursor: 'pointer', borderRadius: 8 },
      children: [jsx('span', { 'aria-hidden': true, children: '🧮' }), wide ? jsx('span', { children: t('page.title') }) : null],
    }),
  });
}

function apply(ctx: ClientCtx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'math-assistant: dictionaries');
  const t = ctx.locale.bind(NS);

  ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'math-assistant-bridge' }, (props: { sessionId?: string; useSession?: (s: (sn: { pending?: readonly unknown[] }) => unknown) => unknown }) =>
      jsx(PendingBridge, { sessionId: props.sessionId, useSession: props.useSession }),
    ),
  );

  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({ name: 'sidebar.footer.action', id: 'math-assistant-entry', locale: NS }, (props: { wide?: boolean; useSessions?: (s: (st: unknown) => unknown) => unknown }) =>
      jsx(SidebarEntry, { ctx, t, wide: props.wide, useSessions: props.useSessions }),
    ),
  );
}

const inject = ['slots', 'locale', 'remote', 'remote.commands', 'sessions'];

export { apply, inject, NS };
