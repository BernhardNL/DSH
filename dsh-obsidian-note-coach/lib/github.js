import { Service } from '@deepseek-ai/cordis';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);
const STATE_FILE = '.harness/git-state.json';
/**
 * GitHub push service. Stores the target repository URL in a vault-local state
 * file; pushing initializes git when needed, stages the vault, commits, and
 * pushes. Authentication relies on the user's existing git credentials
 * (SSH agent or HTTPS credential helper) — no tokens are stored here.
 */
export class NoteGitService extends Service {
    constructor(ctx) {
        super(ctx, 'noteGit');
    }
    statePath(root) {
        return `${root}/.harness/git-state.json`;
    }
    async loadState(root) {
        try {
            const target = await this.ctx.fs.resolve(this.statePath(root));
            const raw = await this.ctx.fs.readText(target);
            const parsed = JSON.parse(raw);
            return typeof parsed.repoUrl === 'string' ? parsed : {};
        }
        catch {
            return {};
        }
    }
    async saveState(root, state) {
        const target = await this.ctx.fs.resolve(this.statePath(root));
        await this.ctx.fs.writeText(target, JSON.stringify(state, null, 2) + '\n');
    }
    /** Record the target repository URL. */
    async setRepo(root, url) {
        const trimmed = url.trim();
        if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(trimmed)) {
            throw new Error(`note-coach: "${trimmed}" 不是合法的 Git 仓库地址`);
        }
        await this.saveState(root, { repoUrl: trimmed });
        return trimmed;
    }
    /** Push the vault to the configured repository. */
    async push(root, message, signal) {
        const state = await this.loadState(root);
        if (!state.repoUrl) {
            return {
                ok: false,
                output: ['未配置仓库地址。请在界面输入仓库链接或运行 /notes-push <repo-url>。'],
            };
        }
        const out = [];
        const run = async (args, opts) => {
            const { stdout, stderr } = await execFileAsync('git', args, {
                cwd: opts?.cwd ?? root,
                timeout: 120_000,
                env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
            });
            const text = (stdout + stderr).trim();
            if (text)
                out.push(text);
            return stdout.trim();
        };
        const abort = () => {
            if (signal?.aborted)
                throw new DOMException('Aborted', 'AbortError');
        };
        try {
            abort();
            // 1. Ensure a git repo exists.
            const inside = await run(['rev-parse', '--is-inside-work-tree']).catch(() => 'false');
            if (inside !== 'true') {
                await run(['init']);
                out.push('已初始化 git 仓库');
            }
            // 2. Point origin at the configured URL.
            const currentRemote = await run(['remote', 'get-url', 'origin']).catch(() => '');
            if (!currentRemote) {
                await run(['remote', 'add', 'origin', state.repoUrl]);
                out.push(`已添加远程 origin → ${state.repoUrl}`);
            }
            else if (currentRemote !== state.repoUrl) {
                await run(['remote', 'set-url', 'origin', state.repoUrl]);
                out.push(`远程 origin 已更新 → ${state.repoUrl}`);
            }
            // 3. Stage everything (respecting the user's own .gitignore).
            await run(['add', '-A']);
            abort();
            const status = await run(['status', '--porcelain']);
            if (!status) {
                return { ok: true, output: [...out, '没有需要提交的更改。'] };
            }
            // 4. Commit.
            const defaultBranch = (await run(['branch', '--show-current']).catch(() => '')) || 'main';
            const commitMsg = message?.trim() || `笔记更新 ${new Date().toLocaleString()}`;
            await run(['commit', '-m', commitMsg]);
            out.push(`已提交：${commitMsg}`);
            // 5. Push.
            abort();
            await run(['push', '-u', 'origin', defaultBranch]);
            out.push(`已推送到 ${state.repoUrl} (${defaultBranch})`);
            return { ok: true, output: out };
        }
        catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            return { ok: false, output: [...out, `推送失败：${detail}`] };
        }
    }
}
