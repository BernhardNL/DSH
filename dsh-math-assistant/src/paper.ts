import { Context, Service } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { MathConfig } from './types.js';
import { completeText, extractJson } from './llm.js';
import type { ProjectMemoryService } from './memory.js';
import { runPython } from './py.js';

const PAPER_SYSTEM = [
  'You write a standard mathematical modeling competition paper in Markdown with LaTeX math.',
  'Structure (fixed): 摘要, 关键词, 问题重述, 模型假设, 符号说明, 模型建立与求解（分问题）, 灵敏度/检验分析, 模型评价（优点与不足）, 参考文献.',
  'Use LaTeX math ($...$ inline, $$...$$ display) for all formulas and equations.',
  'Incorporate the project context: problem, analysis, data results, code artifacts, and figures.',
  'Figures: reference saved images with relative paths in the form ![图](.harness/math/figures/xxx.png) when they exist.',
  'Be rigorous and complete, but keep it concise enough for a working draft.',
].join('\n');

/**
 * 论文生成服务：从项目记忆汇编论文（Markdown+LaTeX 公式+统计图），
 * 用 pandoc 转成规范 Word（公式转 Word 原生公式，图片嵌入）。
 * 支持带修改要求重新生成（可修改已写论文）。
 */
export class PaperService extends Service {
  constructor(
    ctx: Context,
    private readonly config: MathConfig,
    private readonly memory: ProjectMemoryService,
  ) {
    super(ctx, 'mathPaper');
  }

  async generate(agent: Agent, root: string, extraReqs?: string, signal?: AbortSignal): Promise<string> {
    const mem = await this.memory.load(root);
    // 关键路由：项目里已指定源论文文件（docx/pdf）时，用户要的是"把这篇论文生成 Word /
    // 重排版"，而不是从记忆新写一篇压缩草稿。直接转重排版流程，保留全文、补公式、可加格式重排。
    const srcFile = mem.problem?.problemFile || '';
    if (/\.(docx|pdf)$/i.test(srcFile)) {
      return await this.repaper(agent, root, srcFile, extraReqs, signal);
    }
    const context = buildPaperContext(mem);
    const thinContext = !mem.analysis.length && !mem.data.length && !mem.pipeline.stages.length;
    const profileText = mem.formatProfile ? formatProfileToPrompt(mem.formatProfile) : '';
    const modReq = extraReqs && extraReqs.trim() ? `\n\nAdditional requirements / modifications: ${extraReqs.trim()}` : '';
    const paperMd = await completeText(
      this.ctx,
      agent,
      PAPER_SYSTEM,
      `Project context:\n${context}${profileText ? `\n\n${profileText}` : ''}${modReq}\n\nWrite the paper now.`,
      { temperature: 0.4, maxTokens: 6000 },
      signal,
    );
    if (!paperMd.trim()) {
      throw new Error('论文生成失败：模型多次尝试均未返回内容。请先确保项目记忆里有题目/分析/数据（可先运行题目分析），或换一种修改要求再试。');
    }

    // 保存 markdown 底稿
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const paperDir = root.endsWith('/') ? root + this.config.paperDir : `${root}/${this.config.paperDir}`;
    mkdirSync(paperDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const mdPath = `${paperDir}/论文_${stamp}.md`;
    const docxPath = `${paperDir}/论文_${stamp}.docx`;
    writeFileSync(mdPath, paperMd, 'utf8');

    const convert = await convertToDocx(root, this.config.workDir, mdPath, docxPath, this.config.pythonPath);
    if (!convert.ok) {
      return `⚠️ 论文 Markdown 已生成（${mdPath}），但 Word 转换失败：${convert.error}。可安装 pypandoc-binary 后重试。`;
    }

    await this.memory.update(root, (m) => {
      m.papers.push({ path: docxPath.replace(`${root}/`, ''), generatedAt: new Date().toISOString(), note: extraReqs });
      m.chat.push({ role: 'user', text: extraReqs ? `修改论文：${extraReqs}` : '生成论文' });
      m.chat.push({ role: 'assistant', text: `✅ 论文已生成：${docxPath}` });
      if (m.chat.length > 100) m.chat = m.chat.slice(-100);
    });

    return `✅ 论文已生成：\n- Word：${docxPath}\n- Markdown 底稿：${mdPath}\n\n（公式已转为 Word 原生公式，统计图自动嵌入。可在对话框提出修改要求重新生成。）${
      thinContext
        ? `\n\n⚠️ 注意：项目里尚无题目分析/数据/建模流水线记录，当前只是基于题目描述的简短草稿。若要保留并重排版已有论文，请把源论文设为问题文件（或直接用 /math-repaper，要求里加"按格式重排"）。`
        : ''
    }`;
  }

  /**
   * 重排版已有论文：读取源论文文件（docx/pdf/txt），通读并补充公式
   * （把【待展开】等占位替换为完整 LaTeX 公式），输出新的 Word。
   */
  async repaper(agent: Agent, root: string, sourceFile: string, extraReqs?: string, signal?: AbortSignal): Promise<string> {
    const { readFileForContext } = await import('./fileutil.js');
    const source = await readFileForContext(root, sourceFile, this.config.pythonPath, 120000);
    if (!source || source.startsWith('（无法解析')) {
      return `⚠️ 无法读取源论文 ${sourceFile}：${source}`;
    }
    const modReq = extraReqs && extraReqs.trim() ? `\n\nAdditional requirements: ${extraReqs.trim()}` : '';

    // 策略：插件用正则确定性地找出每个公式占位符的出现位置，模型按顺序为每一处生成 LaTeX
    // （短输出 JSON，避免"长文重排"触发空响应）。
    const occurrences = findFormulaOccurrences(source);
    let formulaNote = '';
    const latexByOccurrence: string[] = [];
    if (occurrences.length > 0) {
      // 每一处附带其上下文，帮助模型生成贴合语境的公式
      // 每个占位符单独一次短请求（长列表一次请求易空响应），逐处补公式
      for (let i = 0; i < occurrences.length; i++) {
        const o = occurrences[i];
        const ctx = source.slice(Math.max(0, o.index - 100), Math.min(source.length, o.index + o.marker.length + 100)).replace(/\n/g, ' ');
        const out = await completeText(
          this.ctx,
          agent,
          FORMULA_SYSTEM,
          `The paper has this incomplete-formula marker at position ${i + 1}/${occurrences.length}:

Marker: ${o.marker}
Surrounding context: …${ctx}…

Write the COMPLETE LaTeX formula that belongs at this marker, fitting the context. Do NOT include $ delimiters.
Output STRICT JSON: { "latex": string }`,
          { temperature: 0.2, maxTokens: 800 },
          signal,
        );
        const parsed = extractJson<{ latex?: string }>(out);
        const latex = parsed?.latex || (out.match(/"latex"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1] ?? '');
        if (latex && latex.trim()) {
          latexByOccurrence.push(latex.trim().replace(/^\$+/, '').replace(/\$+$/, ''));
        } else {
          latexByOccurrence.push('');
        }
      }
      if (latexByOccurrence.length === 0) {
        formulaNote = '（已识别到公式占位符但模型未能生成公式，未补充）';
      }
    } else {
      formulaNote = '（未发现公式占位符如【待展开】，未补充公式）';
    }

    // docx 源：原位修补（保留全部 OMML 公式/表格/图片/排版），绝不重建文档
    if (/\.docx$/i.test(sourceFile)) {
      return await this.repaperDocx(root, sourceFile, latexByOccurrence, occurrences.length, extraReqs, signal);
    }

    // 程序化替换：按出现位置逐一替换（第 i 处用第 i 个公式）
    let md = source;
    const occurrencesCopy = occurrences.slice();
    md = md.replace(/(【[^】]+】)/g, (match) => {
      const idx = occurrencesCopy.findIndex((o) => o.marker === match);
      if (idx >= 0 && latexByOccurrence[idx]) {
        occurrencesCopy.splice(idx, 1);
        return `$$${latexByOccurrence[idx]}$$`;
      }
      return match;
    });
    // 处理行内"推导略"等非括号标记（按顺序替换）
    if (occurrencesCopy.length) {
      const rest = occurrencesCopy;
      md = md.replace(/(推导|证明|公式).{0,4}(略|从略|略去)/g, (match) => {
        const idx = rest.findIndex((o) => o.marker === match);
        if (idx >= 0 && latexByOccurrence[idx]) {
          rest.splice(idx, 1);
          return `$$${latexByOccurrence[idx]}$$`;
        }
        return match;
      });
    }
    md = markdownify(md);

    // 若已学习格式档案且用户明确要求"按格式重排"：全文逐块重排（中途可取消），排后自检
    const mem = await this.memory.load(root);
    const wantsFormat = /(格式|标准化|重排|排版|规范)/.test(extraReqs || '');
    let reformattedNote = '';
    if (mem.formatProfile && wantsFormat) {
      const result = await this.reformatAll(agent, root, md, mem.formatProfile, signal);
      if (result) {
        md = result.md;
        reformattedNote = result.aborted
          ? `（已按格式规范重排 ${result.reformattedBlocks}/${result.totalChunks} 块，随后被取消；其余保留原文）`
          : result.reformattedBlocks > 0
            ? `（已按格式规范重排全部 ${result.reformattedBlocks} 块）`
            : `（格式重排未能生效：${result.totalChunks} 块均保留原文，原因见警告）`;
        if (result.warnings.length) {
          reformattedNote += ` ⚠️ ${result.warnings.length} 处警告（见自检报告）`;
        }
        // 自检（仅在未被取消时执行完整自检）
        const check = await this.selfCheck(agent, root, md, result, signal);
        if (check) {
          const reportPath = await this.saveCheckReport(root, sourceFile, check);
          reformattedNote += `\n\n🔍 自检结果：${check.ok ? '通过 ✅' : `发现问题 ⚠️（${check.issues.length} 项）`}${reportPath ? `\n自检报告：${reportPath}` : ''}\n${check.issues.map((i) => `- ${i}`).join('\n')}`;
        }
      }
    }

    const { mkdirSync, writeFileSync } = await import('node:fs');
    const paperDir = root.endsWith('/') ? root + this.config.paperDir : `${root}/${this.config.paperDir}`;
    mkdirSync(paperDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const mdPath = `${paperDir}/重排版_${stamp}.md`;
    const docxPath = `${paperDir}/重排版_${stamp}.docx`;
    writeFileSync(mdPath, md, 'utf8');

    const convert = await convertToDocx(root, this.config.workDir, mdPath, docxPath, this.config.pythonPath);
    if (!convert.ok) {
      return `⚠️ 重排版 Markdown 已生成（${mdPath}），但 Word 转换失败：${convert.error}。`;
    }

    await this.memory.update(root, (m) => {
      m.papers.push({ path: docxPath.replace(`${root}/`, ''), generatedAt: new Date().toISOString(), note: `重排版：${sourceFile}` });
      m.chat.push({ role: 'user', text: `重排版论文：${sourceFile}` });
      m.chat.push({ role: 'assistant', text: `✅ 重排版完成：${docxPath}` });
      if (m.chat.length > 100) m.chat = m.chat.slice(-100);
    });
    const formulaSummary = latexByOccurrence.length
      ? `补充 ${latexByOccurrence.length} 处公式（LaTeX → Word 原生公式）`
      : formulaNote || '未补充公式';
    return `✅ 已通读《${sourceFile}》：${formulaSummary}${reformattedNote}，生成：\n- Word：${docxPath}\n- Markdown 底稿：${mdPath}\n\n（提示：中途可用 /math-cancel 取消；重排版需按格式重排时，请在要求里加"按格式重排"。）`;
  }

  /**
   * docx 源论文原位重排：保留原文档全部内容（OMML 公式、表格、图片、目录、样式），
   * 仅在公式占位符处插入 LaTeX→OMML 公式；有格式档案且要求"按格式重排"时顺带套用标题样式。
   */
  private async repaperDocx(
    root: string,
    sourceFile: string,
    latexByOccurrence: string[],
    markerCount: number,
    extraReqs?: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const { mkdirSync } = await import('node:fs');
    const { copyFileSync } = await import('node:fs');
    const { patchDocxFormulas } = await import('./docxpatch.js');
    const paperDir = root.endsWith('/') ? root + this.config.paperDir : `${root}/${this.config.paperDir}`;
    mkdirSync(paperDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const docxPath = `${paperDir}/重排版_${stamp}.docx`;
    const sourcePath = sourceFile.startsWith('/') ? sourceFile : `${root}/${sourceFile}`;

    const mem = await this.memory.load(root);
    const wantsFormat = /(格式|标准化|重排|排版|规范)/.test(extraReqs || '');
    const headingRestyle = !!(mem.formatProfile && wantsFormat);

    let result: { ok: boolean; inserted?: number; tables?: number; media?: number; failed?: number; failedIdx?: number[]; error?: string };
    if (markerCount === 0) {
      // 无占位符：原样复制（保持字节级一致，不做任何重建）
      copyFileSync(sourcePath, docxPath);
      result = { ok: true, inserted: 0 };
    } else {
      result = await patchDocxFormulas(
        root,
        this.config.workDir,
        sourcePath,
        docxPath,
        latexByOccurrence.map((l) => l || null),
        this.config.pythonPath,
        headingRestyle,
      );
    }
    if (!result.ok) {
      return `⚠️ docx 原位重排失败：${result.error}（源文件未改动，未生成输出）。`;
    }

    const note =
      markerCount > 0
        ? (result.inserted ?? 0) === 0 && (result.failed ?? 0) > 0
          ? `${result.failed} 处公式全部转换失败，已保留原占位符${result.failedIdx?.length ? `（第 ${result.failedIdx.join('、')} 处）` : ''}，未插入任何公式`
          : `原位补充 ${result.inserted ?? 0} 处公式（LaTeX → Word 原生公式）${(result.failed ?? 0) > 0 ? `，${result.failed} 处转换失败已保留原占位符${result.failedIdx?.length ? `（第 ${result.failedIdx.join('、')} 处）` : ''}` : ''}`
        : '未发现公式占位符（如【待展开】），未补充公式';
    const preservedParts = [];
    if (result.tables) preservedParts.push(`${result.tables} 个表格`);
    if (result.media) preservedParts.push(`${result.media} 张图片`);
    const preserved = preservedParts.join('、');
    await this.memory.update(root, (m) => {
      m.papers.push({ path: docxPath.replace(`${root}/`, ''), generatedAt: new Date().toISOString(), note: `重排版（原位）：${sourceFile}` });
      m.chat.push({ role: 'user', text: `重排版论文：${sourceFile}` });
      m.chat.push({ role: 'assistant', text: `✅ 重排版完成：${docxPath}` });
      if (m.chat.length > 100) m.chat = m.chat.slice(-100);
    });
    return `✅ 已通读《${sourceFile}》：${note}。文档以原文件为基础原位修补，原有公式、排版、目录${preserved ? `、${preserved}` : ''}全部保留，生成：\n- Word：${docxPath}\n\n（docx 重排不做"抽取文本→重建"，不会丢失任何结构；如需套用格式档案的标题样式，请先 /math-learn-format 并在要求里加"按格式重排"。）`;
  }

  /** 全文逐块重排（不限块数；每块独立短请求；中途可取消；失败块保留原文）。 */
  private async reformatAll(
    agent: Agent,
    root: string,
    md: string,
    profile: import('./types.js').PaperFormatProfile,
    signal?: AbortSignal,
  ): Promise<{ md: string; reformattedBlocks: number; totalChunks: number; aborted: boolean; warnings: string[] } | undefined> {
    const profileText = formatProfileToPrompt(profile);
    const allChunks = splitByHeadings(md, 5000);
    const outputs: string[] = [];
    const warnings: string[] = [];
    let reformattedBlocks = 0;
    let aborted = false;
    for (let i = 0; i < allChunks.length; i++) {
      if (cancelRequests.has(root) || signal?.aborted) {
        aborted = true;
        break;
      }
      const inputLen = allChunks[i].length;
      let out = '';
      try {
        out = await completeText(
          this.ctx,
          agent,
          REFORMAT_SYSTEM,
          `Format requirements:\n${profileText}\n\nDocument chunk ${i + 1}/${allChunks.length} to reformat:\n\n---\n${allChunks[i]}\n\nReformat this chunk to follow the format requirements. Output only the reformatted chunk.`,
          { temperature: 0.2, maxTokens: 8000 },
          signal,
        );
      } catch (err) {
        if (signal?.aborted || cancelRequests.has(root)) {
          aborted = true;
          outputs.push(allChunks[i]);
          break;
        }
        outputs.push(allChunks[i]);
        warnings.push(`第 ${i + 1} 块重排失败：${err instanceof Error ? err.message : String(err)}（保留原文）`);
        continue;
      }
      if (out && out.trim()) {
        const outLen = out.trim().length;
        // 保真防护：输出明显短于原文（<70%）视为被截断/压缩，保留原文而非写入残缺内容
        if (outLen < inputLen * 0.7) {
          outputs.push(allChunks[i]);
          warnings.push(`第 ${i + 1} 块输出仅 ${outLen}/${inputLen} 字符，疑似被截断或压缩，已保留原文`);
        } else {
          outputs.push(out.trim());
          reformattedBlocks++;
        }
      } else {
        outputs.push(allChunks[i]);
        warnings.push(`第 ${i + 1} 块模型未返回内容（保留原文）`);
      }
    }
    cancelRequests.delete(root);
    const finalMd = outputs.length ? outputs.join('\n\n') : md;
    // 全文级防护：整体明显缩水时给出强警告（逐块 70% 防护是首道防线，这里是第二道）
    if (!aborted && finalMd.length < md.length * 0.6) {
      warnings.push(`⚠️ 重排后全文长度仅为原文的 ${Math.round((finalMd.length / md.length) * 100)}%（${finalMd.length}/${md.length} 字符），疑似整体截断或压缩，请务必人工核对原文与输出`);
    }
    return reformattedBlocks > 0 || aborted || warnings.length > 0
      ? { md: finalMd, reformattedBlocks, totalChunks: allChunks.length, aborted, warnings }
      : undefined;
  }

  /** 重排后自检：确定性检查 + 抽样 LLM 复核。 */
  private async selfCheck(
    agent: Agent,
    root: string,
    md: string,
    result: { reformattedBlocks: number; totalChunks: number; aborted: boolean; warnings: string[] },
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; issues: string[] } | undefined> {
    if (result.aborted) {
      return { ok: false, issues: ['重排被中途取消，未做完整自检。'] };
    }
    const issues = [...result.warnings];
    // 1) 确定性：章节标题完整性（取重排前记忆？此处以 reformatAll 的输入为准——已在 md 中）
    // 2) 确定性：公式定界符平衡
    const open = (md.match(/\$\$/g) || []).length;
    if (open % 2 !== 0) issues.push(`公式定界符 $$ 数量为奇数（${open}），可能存在未闭合公式`);
    // 3) LLM 抽样复核（首/中/尾 各一块，最多 3 块）
    const chunks = splitByHeadings(md, 5000);
    const sampleIdx = uniqueSample(chunks.length, Math.min(3, Math.max(1, Math.floor(chunks.length / 3))));
    for (const idx of sampleIdx) {
      const out = await completeText(
        this.ctx,
        agent,
        CHECK_SYSTEM,
        `Reformatted document chunk ${idx + 1}/${chunks.length} to inspect:\n\n---\n${chunks[idx].slice(0, 6000)}\n\nInspect this chunk now.`,
        { temperature: 0.1, maxTokens: 600 },
        signal,
      );
      const parsed = extractJson<{ ok?: boolean; issues?: string[] }>(out);
      const chunkIssues = parsed?.issues ?? [];
      if (parsed && parsed.ok === false) issues.push(`第 ${idx + 1} 块：${chunkIssues.slice(0, 3).join('；') || '内容疑似不完整'}`);
      else if (parsed && Array.isArray(chunkIssues) && chunkIssues.length) issues.push(`第 ${idx + 1} 块：${chunkIssues.slice(0, 2).join('；')}`);
    }
    return { ok: issues.length === 0, issues };
  }

  private async saveCheckReport(root: string, sourceFile: string, check: { ok: boolean; issues: string[] }): Promise<string | undefined> {
    try {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      const paperDir = root.endsWith('/') ? root + this.config.paperDir : `${root}/${this.config.paperDir}`;
      mkdirSync(paperDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const path = `${paperDir}/自检报告_${stamp}.md`;
      writeFileSync(
        path,
        `# 重排版自检报告\n\n源论文：${sourceFile}\n时间：${new Date().toLocaleString()}\n\n**结论：${check.ok ? '通过 ✅' : '发现问题 ⚠️'}\n\n${check.issues.map((i, n) => `${n + 1}. ${i}`).join('\n') || '（无问题）'}\n`,
        'utf8',
      );
      return path.replace(`${root}/`, '');
    } catch {
      return undefined;
    }
  }
}

function buildPaperContext(mem: Awaited<ReturnType<ProjectMemoryService['load']>>): string {
  const parts: string[] = [];
  if (mem.problem.title) parts.push(`题目：${mem.problem.title}`);
  // 大段原始内容截断，避免超长 prompt 触发空响应
  if (mem.problem.description) parts.push(`问题描述：${mem.problem.description.slice(0, 4000)}${mem.problem.description.length > 4000 ? '\n…（截断）' : ''}`);
  if (mem.problem.problemFile) parts.push(`问题文件：${mem.problem.problemFile}`);
  if (mem.analysis.length) {
    parts.push(
      '题目分析：\n' +
        mem.analysis.map((a) => `### ${a.question}\n类型：${a.type}\n模型：${a.models.join('、')}\n算法：${a.algorithms.join('、')}\n思路：${a.approach}`).join('\n'),
    );
  }
  if (mem.data.length) {
    parts.push('数据结果：\n' + mem.data.map((d) => `- ${d.fileName}：${d.statsText.slice(0, 1000)}`).join('\n'));
  }
  if (mem.pipeline.stages.length) {
    parts.push(
      '建模过程（流水线各阶段输出）：\n' +
        mem.pipeline.stages
          .map((s, i) => `### 阶段${i + 1} ${s.title}\n${(s.output ?? s.detail ?? '').slice(0, 800)}`)
          .join('\n'),
    );
  }
  if (mem.references.length) {
    parts.push('参考文献：\n' + mem.references.map((r) => `- ${r.title}${r.url ? ` ${r.url}` : ''}${r.verified ? '' : '（链接未验证）'}`).join('\n'));
  }
  return parts.join('\n\n');
}

const FORMULA_SYSTEM = [
  'You receive the incomplete-formula markers found in an academic paper (e.g. 【待展开】 meaning "formula to be expanded").',
  'For EACH marker, infer from its position/section hint what formula belongs there and write the COMPLETE, correct LaTeX (inline math WITHOUT the $ delimiters).',
  'Output STRICT JSON only: an array of { "placeholder": string, "latex": string } — placeholder must EXACTLY match the given marker text.',
].join('\n');

const REPAPER_SYSTEM = [
  'You reformat an existing academic paper into a complete, well-typeset Markdown document with LaTeX formulas.',
  'Read the source paper thoroughly. Keep its structure and content, but:',
  '1) SUPPLEMENT all missing/incomplete formulas: replace placeholders like 【待展开】/【公式】/【待补充】 with complete, correct LaTeX math ($...$ inline, $$...$$ display), including full derivations where the paper says "推导略" or "证明略".',
  '2) Keep equations, symbols and notation consistent; define symbols when first used.',
  '3) Preserve tables, figures placeholders, sections and conclusions.',
  '4) Output the FULL markdown document, not a summary. Use LaTeX math everywhere formulas appear.',
].join('\n');

async function convertToDocx(projectRoot: string, workDir: string, mdPath: string, docxPath: string, configuredPython?: string): Promise<{ ok: boolean; error?: string }> {
  const convertCode = [
    'import sys',
    'from pypandoc import convert_file',
    'try:',
    '    convert_file(sys.argv[1], "docx", outputfile=sys.argv[2], extra_args=["--standalone"])',
    '    print("DOCX_OK")',
    'except Exception as e:',
    '    print("DOCX_ERR:", e)',
    '    sys.exit(1)',
  ].join('\n');
  const res = await runPython(projectRoot, workDir, convertCode, [mdPath, docxPath], 120_000, configuredPython);
  if (!res.ok || !res.stdout.includes('DOCX_OK')) {
    return { ok: false, error: res.stderr || res.error || '未知错误' };
  }
  return { ok: true };
}

/** 按段落边界把长文本切成 ≤size 字符的块。 */
function chunkText(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      const cut = text.lastIndexOf('\n\n', end);
      if (cut > start + size / 2) end = cut;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.filter(Boolean);
}

/** 轻量 Markdown 化：数字/汉字章节标题转 markdown 标题。 */
function markdownify(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (/^第[一二三四五六七八九十]+[章节部分]/.test(t) || /^(摘\s*要|关键词|目\s*录|参考文献)$/.test(t)) return `# ${t}`;
      if (/^\d+\s+\|/.test(t)) return line; // 表格/列表行不转标题
      if (/^\d+\.\d+\.\d+\s+\S/.test(t)) return `### ${t}`;
      if (/^\d+\.\d+\s+\S/.test(t)) return `## ${t}`;
      if (/^\d+\s+\S/.test(t)) return `# ${t}`;
      return line;
    })
    .join('\n');
}

/** 用正则找出公式占位符（确定性，不依赖模型识别）。 */
function findFormulaOccurrences(text: string): Array<{ marker: string; index: number }> {
  const out: Array<{ marker: string; index: number }> = [];
  const bracket = /【([^】]{1,20})】/g;
  let m: RegExpExecArray | null;
  while ((m = bracket.exec(text)) !== null) {
    const inner = m[1];
    if (/待展开|待补充|待定|公式|略/.test(inner)) {
      out.push({ marker: `【${inner}】`, index: m.index });
    }
  }
  for (const line of text.split('\n')) {
    const t = line.trim();
    const lm = t.match(/(推导|证明|公式).{0,4}(略|从略|略去)/);
    if (lm && t.length <= 40) {
      out.push({ marker: t, index: text.indexOf(t) });
    }
  }
  return out.slice(0, 15);
}

const REFORMAT_SYSTEM = [
  'You reformat one chunk of an academic document to match given format requirements.',
  'This is a LOSSLESS reformatting task: keep EVERY sentence, number, table row, figure caption, citation and formula exactly as-is.',
  'Change ONLY layout/formatting: heading numbering/hierarchy, formula presentation (keep LaTeX math unchanged), table/figure caption conventions, citation style, spacing.',
  'NEVER summarize, condense, merge, drop or rephrase content. If a section is already compliant, output it unchanged.',
  'Output ONLY the reformatted chunk, complete from first to last line.',
].join('\n');

/** 渲染格式档案为提示文本。 */
function formatProfileToPrompt(p: import('./types.js').PaperFormatProfile): string {
  return [
    '目标论文格式规范（必须遵守）：',
    p.structure ? `- 章节体系：${p.structure}` : '',
    p.headingConvention ? `- 标题编号：${p.headingConvention}` : '',
    p.formulaConvention ? `- 公式规范：${p.formulaConvention}` : '',
    p.tableFigureConvention ? `- 图表规范：${p.tableFigureConvention}` : '',
    p.citationStyle ? `- 引用风格：${p.citationStyle}` : '',
    p.abstractKeywords ? `- 摘要关键词：${p.abstractKeywords}` : '',
    p.notes ? `- 其他：${p.notes}` : '',
  ].filter(Boolean).join('\n');
}

/** 按一级标题（章）切分文本；块超长时内部再按任意标题切。 */
function splitByHeadings(text: string, size: number): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    const isChapter = /^#\s/.test(line);
    if (isChapter && current.trim()) {
      chunks.push(current.trim());
      current = '';
    }
    current = current ? current + '\n' + line : line;
    if (current.length >= size) {
      chunks.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/** 重排取消注册表：keyed by 项目根；/math-cancel 置位，重排循环检查后清除。 */
const cancelRequests = new Set<string>();

/** 请求取消某项目的重排。 */
export function requestCancel(root: string): void {
  cancelRequests.add(root);
}

/** 清空取消标记（重排完成/取消后自动调用，也可手动）。 */
export function clearCancel(root: string): void {
  cancelRequests.delete(root);
}

const CHECK_SYSTEM = [
  'You inspect one chunk of a reformatted academic document for completeness.',
  'Check: is the chunk complete (not truncated mid-sentence/section/formula)? Are formulas well-formed? Are tables/figures captions intact?',
  'Output STRICT JSON only: { "ok": boolean, "issues": string[] } — issues empty when ok.',
].join('\n');

/** 从 [0, n) 取 count 个均匀散布的索引（首/中/尾风格）。 */
function uniqueSample(n: number, count: number): number[] {
  if (n <= 0) return [];
  if (count >= n) return Array.from({ length: n }, (_, i) => i);
  const picks = new Set<number>();
  picks.add(0);
  if (n > 1) picks.add(n - 1);
  const step = Math.max(1, Math.floor(n / count));
  for (let i = step; i < n - 1 && picks.size < count; i += step) picks.add(i);
  return [...picks].slice(0, count).sort((a, b) => a - b);
}
