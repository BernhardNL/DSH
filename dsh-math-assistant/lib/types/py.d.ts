export interface PyRunResult {
    ok: boolean;
    stdout: string;
    stderr: string;
    /** 超时/执行异常时的说明。 */
    error?: string;
}
/**
 * 解析 python 解释器：优先项目内 .venv（自包含科学库），回退系统 python3。
 */
export declare function resolvePython(projectRoot: string, configured?: string): string;
/**
 * 运行一段 python 脚本（通过临时文件），返回 stdout/stderr。
 * 脚本写在项目 workDir 下，便于 import 相对资源；cwd 为项目根。
 */
export declare function runPython(projectRoot: string, workDir: string, code: string, args?: string[], timeoutMs?: number, configuredPython?: string): Promise<PyRunResult>;
