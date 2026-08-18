import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { runPython } from './py.js';
const execFileAsync = promisify(execFile);
/**
 * 从问题文件读取文本：pdf → pdftotext；docx → python-docx（项目 .venv）；
 * txt/md → 直接读。
 */
export async function readProblemFile(projectRoot, relPath, configuredPython) {
    const abs = projectRoot.endsWith('/') ? projectRoot + relPath : `${projectRoot}/${relPath}`;
    const { existsSync } = await import('node:fs');
    if (!existsSync(abs)) {
        throw new Error(`题目文件不存在：${relPath}（请确认文件已放入工作区文件夹）`);
    }
    const lower = relPath.toLowerCase();
    if (lower.endsWith('.pdf')) {
        const { stdout } = await execFileAsync('pdftotext', ['-layout', abs, '-'], {
            timeout: 60_000,
            maxBuffer: 10 * 1024 * 1024,
        });
        return stdout.trim();
    }
    if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
        const py = runPython;
        const code = [
            'import sys',
            "from docx import Document",
            'try:',
            '    d = Document(sys.argv[1])',
            '    parts = [p.text for p in d.paragraphs]',
            '    for t in d.tables:',
            '        for row in t.rows:',
            '            parts.append(" | ".join(c.text for c in row.cells))',
            '    print("\\n".join(parts))',
            'except Exception as e:',
            '    print("DOCX_ERROR:", e, file=sys.stderr)',
            '    sys.exit(1)',
        ].join('\n');
        const res = await py(projectRoot, '.harness/math/_tmp', code, [abs], 60_000, configuredPython);
        if (!res.ok || res.stderr.includes('DOCX_ERROR')) {
            // .doc 老格式：尝试 antiword/textract 不可用时给出提示
            throw new Error(`无法解析 docx：${res.stderr || res.error || '未知错误'}`);
        }
        return res.stdout.trim();
    }
    // txt / md 等
    return readFileSync(abs, 'utf8').trim();
}
const SKIP_DIRS = new Set(['.harness', '.git', '.venv', 'node_modules', '.obsidian', '.idea', '.ruff_cache', '.cache', '__pycache__', 'models']);
/** 列出工作区可见文件（排除隐藏/缓存/大模型目录），最多到 3 层。 */
export async function workspaceFiles(projectRoot) {
    const { readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const out = [];
    const walk = (dir, rel, depth) => {
        if (depth > 3)
            return;
        let entries;
        try {
            entries = readdirSync(dir);
        }
        catch {
            return;
        }
        for (const name of entries) {
            if (name.startsWith('.'))
                continue;
            const abs = join(dir, name);
            const childRel = rel ? `${rel}/${name}` : name;
            let stat;
            try {
                stat = statSync(abs);
            }
            catch {
                continue;
            }
            if (stat.isDirectory()) {
                if (SKIP_DIRS.has(name))
                    continue;
                walk(abs, childRel, depth + 1);
            }
            else if (stat.size <= 50 * 1024 * 1024) {
                out.push(childRel);
            }
        }
    };
    walk(projectRoot, '', 0);
    return out;
}
/**
 * 读取文件供 LLM 上下文使用（带大小上限）：
 * txt/md → 直接读；pdf → pdftotext；docx → python-docx；csv/xlsx → pandas 前若干行。
 */
export async function readFileForContext(projectRoot, relPath, configuredPython, maxChars = 8000) {
    const abs = projectRoot.endsWith('/') ? projectRoot + relPath : `${projectRoot}/${relPath}`;
    const lower = relPath.toLowerCase();
    try {
        if (lower.endsWith('.pdf')) {
            const { stdout } = await execFileAsync('pdftotext', ['-layout', abs, '-'], { timeout: 60_000, maxBuffer: 20 * 1024 * 1024 });
            return stdout.trim().slice(0, maxChars);
        }
        if (lower.endsWith('.docx') || lower.endsWith('.doc')) {
            const code = [
                'import sys',
                "from docx import Document",
                'try:',
                '    d = Document(sys.argv[1])',
                '    parts = [p.text for p in d.paragraphs]',
                '    for t in d.tables:',
                '        for row in t.rows:',
                '            parts.append(" | ".join(c.text for c in row.cells))',
                '    print("\\n".join(parts))',
                'except Exception as e:',
                '    print("DOCX_ERROR:", e, file=sys.stderr)',
                '    sys.exit(1)',
            ].join('\n');
            const res = await runPython(projectRoot, '.harness/math/_tmp', code, [abs], 60_000, configuredPython);
            if (!res.ok || res.stderr.includes('DOCX_ERROR')) {
                const hint = res.stderr.includes("No module named 'docx'") ? '（请安装 python-docx：.venv/bin/pip install python-docx）' : '';
                return `（无法解析 docx${hint}：${(res.stderr || res.error || '未知错误').slice(0, 300)}）`;
            }
            return res.stdout.trim().slice(0, maxChars);
        }
        if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt') || lower.endsWith('.md')) {
            const raw = readFileSync(abs, 'utf8');
            if (raw.length > maxChars)
                return raw.slice(0, maxChars) + '\n…（已截断）';
            return raw;
        }
        if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
            const code = [
                'import sys',
                'import pandas as pd',
                'df = pd.read_excel(sys.argv[1])',
                'print(df.head(20).to_string())',
            ].join('\n');
            const res = await runPython(projectRoot, '.harness/math/_tmp', code, [abs], 60_000, configuredPython);
            return (res.ok ? res.stdout : `（无法解析：${res.stderr.slice(0, 200)}）`).trim().slice(0, maxChars);
        }
        return `（二进制文件 ${relPath}，不直接读取）`;
    }
    catch (err) {
        return `（读取 ${relPath} 失败：${err instanceof Error ? err.message : String(err)}）`;
    }
}
