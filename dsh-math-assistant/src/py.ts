import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

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
export function resolvePython(projectRoot: string, configured?: string): string {
  if (configured) return configured;
  const venv = projectRoot.endsWith('/') ? `${projectRoot}.venv/bin/python` : `${projectRoot}/.venv/bin/python`;
  if (existsSync(venv)) return venv;
  return 'python3';
}

/**
 * 运行一段 python 脚本（通过临时文件），返回 stdout/stderr。
 * 脚本写在项目 workDir 下，便于 import 相对资源；cwd 为项目根。
 */
export async function runPython(
  projectRoot: string,
  workDir: string,
  code: string,
  args: string[] = [],
  timeoutMs = 120_000,
  configuredPython?: string,
): Promise<PyRunResult> {
  const python = resolvePython(projectRoot, configuredPython);
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = projectRoot.endsWith('/') ? projectRoot + workDir : `${projectRoot}/${workDir}`;
  mkdirSync(dir, { recursive: true });
  const script = join(dir, `_run_${Date.now()}.py`);
  writeFileSync(script, code, 'utf8');
  try {
    const { stdout, stderr } = await execFileAsync(python, [script, ...args], {
      cwd: projectRoot,
      timeout: timeoutMs,
      env: { ...process.env, MPLCONFIGDIR: dir },
      maxBuffer: 10 * 1024 * 1024,
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number | string; message?: string };
    return {
      ok: false,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      error: e.message ?? String(err),
    };
  } finally {
    try {
      await import('node:fs').then((fs) => fs.rmSync(script, { force: true }));
    } catch {
      // best effort
    }
  }
}
