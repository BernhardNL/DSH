import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { MathConfig, ProjectMemory } from './types.js';

function emptyMemory(): ProjectMemory {
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    problem: {},
    analysis: [],
    pipeline: { status: 'idle', stages: [], currentIndex: -1, current: '', plan: '', updatedAt: new Date().toISOString() },
    references: [],
    data: [],
    code: [],
    papers: [],
    chat: [],
  };
}

/**
 * 项目记忆服务：按工作区（会话 cwd）隔离的持久记忆。
 * - 存于 `<项目根>/.harness/math/memory.json`
 * - 重启后自动恢复（load 时读取）
 * - 清除需要显式调用（命令层先弹窗确认）
 *
 * 插件自有状态使用 node:fs 直写（插件代码可信；沙箱 fence 面向模型可控路径），
 * 因此工作区可以位于任意位置而不受部署沙箱根限制。
 */
export class ProjectMemoryService extends Service {
  constructor(
    ctx: Context,
    private readonly config: MathConfig,
  ) {
    super(ctx, 'mathMemory');
  }

  /** 项目根 = 会话工作区（用户选择的文件夹）。 */
  projectRoot(agent: Agent | undefined): string {
    const cwd = agent?.session.header.cwd;
    if (!cwd) throw new Error('math-assistant: 请先选择工作区（会话的工作目录应为你的建模项目文件夹）');
    return cwd;
  }

  private memoryPath(root: string): string {
    return `${root}/.harness/math/memory.json`;
  }

  /** 读取记忆（不存在则返回空记忆，不落盘）。 */
  async load(root: string): Promise<ProjectMemory> {
    try {
      const raw = readFileSync(this.memoryPath(root), 'utf8');
      const parsed = JSON.parse(raw) as Partial<ProjectMemory>;
      const base = emptyMemory();
      if (parsed && typeof parsed === 'object') {
        return {
          ...base,
          ...parsed,
          problem: { ...base.problem, ...(parsed.problem ?? {}) },
          pipeline: { ...base.pipeline, ...(parsed.pipeline ?? {}) },
        };
      }
      return base;
    } catch {
      return emptyMemory();
    }
  }

  /** 保存记忆（先写临时文件再原子替换）。 */
  async save(root: string, mem: ProjectMemory): Promise<void> {
    mem.updatedAt = new Date().toISOString();
    const path = this.memoryPath(root);
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(mem, null, 2) + '\n', 'utf8');
    rmSync(path, { force: true });
    writeFileSync(path, readFileSync(tmp), 'utf8');
    rmSync(tmp, { force: true });
  }

  /** 清除本项目记忆（文件删除）。调用方必须先征得用户同意。 */
  async clear(root: string): Promise<void> {
    try {
      rmSync(this.memoryPath(root), { force: true });
    } catch {
      // best effort
    }
  }

  /** 便捷：读取并执行一次更新。 */
  async update(root: string, fn: (mem: ProjectMemory) => void | Promise<void>): Promise<ProjectMemory> {
    const mem = await this.load(root);
    await fn(mem);
    await this.save(root, mem);
    return mem;
  }
}
