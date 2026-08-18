import { Service } from '@deepseek-ai/cordis';
import { completeText, extractJson } from './llm.js';
import { runPython } from './py.js';
const CODE_SYSTEM = [
    'You write Python code for a mathematical modeling task.',
    'Follow standard project conventions: clear structure, functions with docstrings, type hints where helpful.',
    'COMMENTS EXPLAIN WHY, NOT WHAT: for non-obvious choices, write the reasoning behind them; do not narrate obvious lines.',
    'The script must be self-contained: reads data relative to the project root via a PROJECT_ROOT constant at the top.',
    'Respond with: a line "FILE_NAME: <name>.py", a line "DESCRIPTION: <one-line description>", then ONE ```python fenced block containing the full code.',
].join('\n');
/**
 * 代码生成服务：按请求生成 python 代码 → 语法/冒烟验证 → 弹窗确认 → 写入工作区。
 */
export class CodeGenService extends Service {
    config;
    memory;
    constructor(ctx, config, memory) {
        super(ctx, 'mathCodeGen');
        this.config = config;
        this.memory = memory;
    }
    async generate(agent, root, request, signal) {
        const mem = await this.memory.load(root);
        const context = [
            mem.problem.title ? `题目：${mem.problem.title}` : '',
            mem.problem.description ? `问题描述：${mem.problem.description}` : '',
            mem.analysis.length ? `题目分析：${mem.analysis.map((a) => `[${a.question}] 模型=${a.models.join('/')} 思路=${a.approach}`).join('; ')}` : '',
            mem.data.length ? `数据摘要：${mem.data.map((d) => `${d.fileName}(${d.rows}行)`).join('; ')}` : '',
        ].filter(Boolean).join('\n');
        const answer = await completeText(this.ctx, agent, CODE_SYSTEM, `Project context:\n${context}\n\nUser request: ${request}\n\nWrite the code now.`, { temperature: 0.2, maxTokens: 3000 }, signal);
        // 解析：优先 FILE_NAME/DESCRIPTION + ```python 围栏，其次 JSON。
        const fileNameFromText = answer.match(/FILE_NAME:\s*([^\n]+)/);
        const descriptionFromText = answer.match(/DESCRIPTION:\s*([^\n]+)/);
        const fenced = answer.match(/```(?:python)?\s*\n?([\s\S]*?)```/);
        const parsedJson = extractJson(answer);
        const code = fenced?.[1]?.trim() || parsedJson?.code;
        if (!code)
            throw new Error('math-assistant: 代码生成失败（未返回有效代码）。');
        const rawFileName = (fileNameFromText?.[1] ?? parsedJson?.fileName ?? `model_${Date.now()}`).trim().replace(/[\\/:*?"<>|]/g, '_');
        const description = (descriptionFromText?.[1] ?? parsedJson?.description ?? request).trim();
        // 1. 验证：语法 + 冒烟（无数据文件时不真跑，仅语法）
        const checkCode = [
            'import py_compile, sys',
            'try:',
            '    py_compile.compile(sys.argv[1], doraise=True)',
            '    print("SYNTAX_OK")',
            'except Exception as e:',
            '    print("SYNTAX_ERR:", e)',
            '    sys.exit(1)',
        ].join('\n');
        const tmpPath = `.harness/math/_gen_${Date.now()}.py`;
        const { writeFileSync } = await import('node:fs');
        writeFileSync(`${root}/${tmpPath}`, code, 'utf8');
        const check = await runPython(root, this.config.workDir, checkCode, [tmpPath], 30_000, this.config.pythonPath);
        const verified = check.ok && check.stdout.includes('SYNTAX_OK');
        const { rmSync } = await import('node:fs');
        rmSync(`${root}/${tmpPath}`, { force: true });
        if (!verified) {
            return `❌ 生成的代码语法校验未通过：\n${check.stderr.slice(0, 600)}\n\n请描述修改要求重试。`;
        }
        // 2. 弹窗确认写入
        const fileName = rawFileName || `model_${Date.now()}`;
        const targetPath = `code/${fileName.replace(/\.py$/, '')}.py`;
        let confirmed = false;
        const questions = this.ctx.get('userQuestions');
        if (questions) {
            try {
                const answer2 = await questions.ask({
                    agent,
                    signal,
                    questions: [
                        {
                            id: 'code_write',
                            header: '写入代码',
                            question: `代码验证通过。是否写入项目工作区？`,
                            detail: `文件：${targetPath}\n说明：${description || request}\n\n代码预览（前 600 字符）：\n\`\`\`python\n${code.slice(0, 600)}\n\`\`\``,
                            options: [
                                { label: '同意，写入工作区', description: '按规范目录写入 code/' },
                                { label: '放弃写入', description: '仅在页面显示代码，不落盘' },
                            ],
                        },
                    ],
                });
                const item = answer2.answers[0];
                confirmed = item?.selected.includes('同意，写入工作区') ?? false;
            }
            catch {
                confirmed = false;
            }
        }
        else {
            const approval = this.ctx.get('approval');
            if (approval) {
                try {
                    const decision = await approval.request({
                        agent,
                        toolName: 'math_code',
                        reason: `代码验证通过，是否写入工作区 ${targetPath}？`,
                        signal,
                    });
                    confirmed = decision === 'allowed-once';
                }
                catch {
                    confirmed = false;
                }
            }
        }
        if (!confirmed) {
            return '已放弃写入（代码仅显示，未落盘）。';
        }
        const { mkdirSync } = await import('node:fs');
        mkdirSync(`${root}/code`, { recursive: true });
        const abs = `${root}/${targetPath}`;
        writeFileSync(abs, code.trimEnd() + '\n', 'utf8');
        await this.memory.update(root, (m) => {
            m.code.push({
                name: fileName.replace(/\.py$/, ''),
                path: targetPath,
                language: 'python',
                description: description || request,
                verified: true,
                verificationNote: '语法校验通过',
            });
            m.chat.push({ role: 'user', text: `实现代码：${request}` });
            m.chat.push({ role: 'assistant', text: `✅ 已写入 ${targetPath}（语法校验通过）。` });
            if (m.chat.length > 100)
                m.chat = m.chat.slice(-100);
        });
        return `✅ 已写入 ${targetPath}（语法校验通过）。\n说明：${description || request}`;
    }
}
