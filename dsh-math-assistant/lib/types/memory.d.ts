import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { MathConfig, ProjectMemory } from './types.js';
/**
 * 项目记忆服务：按工作区（会话 cwd）隔离的持久记忆。
 * - 存于 `<项目根>/.harness/math/memory.json`
 * - 重启后自动恢复（load 时读取）
 * - 清除需要显式调用（命令层先弹窗确认）
 *
 * 插件自有状态使用 node:fs 直写（插件代码可信；沙箱 fence 面向模型可控路径），
 * 因此工作区可以位于任意位置而不受部署沙箱根限制。
 */
export declare class ProjectMemoryService extends Service {
    private readonly config;
    constructor(ctx: Context, config: MathConfig);
    /** 项目根 = 会话工作区（用户选择的文件夹）。 */
    projectRoot(agent: Agent | undefined): string;
    private memoryPath;
    /** 读取记忆（不存在则返回空记忆，不落盘）。 */
    load(root: string): Promise<ProjectMemory>;
    /** 保存记忆（先写临时文件再原子替换）。 */
    save(root: string, mem: ProjectMemory): Promise<void>;
    /** 清除本项目记忆（文件删除）。调用方必须先征得用户同意。 */
    clear(root: string): Promise<void>;
    /** 便捷：读取并执行一次更新。 */
    update(root: string, fn: (mem: ProjectMemory) => void | Promise<void>): Promise<ProjectMemory>;
}
