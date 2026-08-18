// PaperService 机械测试：路由（generate→repaper）、无占位符不中断、reformatAll 保真防护
// 自举：ROOT 不存在时自动创建夹具 docx 与记忆，可直接运行。
import { Context } from '@deepseek-ai/cordis';
import { PaperService } from './lib/paper.js';
import { ProjectMemoryService } from './lib/memory.js';
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = '/home/llt/dsh/math-test-routing';
const PY = '/home/llt/dsh/math/.venv/bin/python';
const config = { paperDir: '论文', workDir: 'output', pythonPath: PY };

// ── 夹具自举 ─────────────────────────────────────────────────────────────────
mkdirSync(`${ROOT}/论文`, { recursive: true });
mkdirSync(`${ROOT}/.harness/math`, { recursive: true });
if (!existsSync(`${ROOT}/论文/测试论文.docx`)) {
  execFileSync(PY, ['-c', `
from docx import Document
doc = Document()
def P(t): doc.add_paragraph(t)
P('集装箱破损检测论文（测试样例）')
P('摘要')
P('集装箱运输安全至关重要。本文针对集装箱破损检测问题建立数学模型，采用图像处理与深度学习相结合的方法，实现破损区域的自动识别与程度量化。')
P('关键词：破损检测；图像处理；深度学习')
P('第1章 问题重述')
P('1.1 背景')
P('集装箱在长途运输过程中可能因碰撞、挤压等原因发生破损，影响货物安全与运输效率。')
P('1.2 问题')
P('需要检测集装箱表面破损并估计破损程度，误差公式为【待展开】。')
P('推导略。')
P('第2章 模型建立')
P('2.1 图像预处理')
P('对采集图像依次进行灰度化、去噪、对比度增强等预处理操作。')
P('2.2 破损区域分割')
P('采用阈值分割与边缘检测相结合的方法提取破损区域，分割阈值 T 的计算方法为【待展开】。')
P('2.3 破损程度量化')
P('破损面积占比公式为【待展开】。')
P('2.4 分类模型')
P('使用卷积神经网络对破损类型进行分类，损失函数为【待展开】。')
P('2.5 模型评价')
P('准确率 P 的定义为【待展开】。')
P('第3章 结果分析')
P('3.1 检测结果')
P('实验表明模型准确率达到 92%，召回率达到 88%。')
P('3.2 灵敏度分析')
P('调整阈值参数验证模型稳健性，结果符合预期。')
P('第4章 数据说明')
for i in range(120):
    P(f'样本 {i+1}：破损区域面积为 {i*3+7} 像素，置信度 {0.81+i*0.001:.3f}，类别标签由人工标注确定，训练集与测试集按 8:2 划分，数据增强包括随机旋转、翻转与亮度扰动。')
P('参考文献')
P('[1] 张三. 集装箱破损检测方法研究[J]. 物流科技, 2020.')
P('[2] Li M, Wang H. Container damage detection using deep learning[J]. IEEE Access, 2021.')
doc.save('${ROOT}/论文/测试论文.docx')
`]);
}

const agent = {
  options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
  session: { header: { cwd: ROOT } },
};

// mode: 'full' 逐字返回原文块; 'short' 只返回 20% 长度; formulas: 按位置返回指定 latex
function makeStream(mode, formulas) {
  return async function* (opts) {
    const sys = opts.system || '';
    let text = '';
    if (sys.includes('STRICT JSON') || sys.includes('Output STRICT JSON')) {
      if (sys.includes('inspect')) {
        text = JSON.stringify({ ok: true, issues: [] });
      } else {
        const user = opts.messages[0].content[0].text;
        const pm = user.match(/position (\d+)\/(\d+)/);
        const idx = pm ? Number(pm[1]) : 0;
        const latex = formulas ? formulas[idx] : 'E = mc^2';
        text = JSON.stringify({ latex });
      }
    } else if (sys.includes('LOSSLESS reformatting')) {
      const user = opts.messages[0].content[0].text;
      const start = user.indexOf('---\n') + 4;
      const end = user.indexOf('\n\nReformat this chunk', start);
      const chunk = user.slice(start, end);
      text = mode === 'short' ? chunk.slice(0, Math.floor(chunk.length * 0.2)) : chunk;
    } else {
      text = 'ok';
    }
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text };
    yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  };
}

function freshCtx(mode, formulas) {
  const ctx = new Context();
  ctx.llm = { stream: makeStream(mode, formulas) };
  return ctx;
}

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ✅', msg);
  else { failures++; console.log('  ❌', msg); }
}

const memPath = `${ROOT}/.harness/math/memory.json`;
function baseMemory() {
  return {
    schemaVersion: 1,
    updatedAt: '2026-08-18T00:00:00.000Z',
    problem: { title: '集装箱破损检测（测试）', problemFile: '论文/测试论文.docx', description: '' },
    analysis: [],
    pipeline: { status: 'idle', stages: [], currentIndex: -1, current: '', plan: '', updatedAt: '2026-08-18T00:00:00.000Z' },
    references: [],
    data: [],
    code: [],
    papers: [],
    chat: [],
  };
}
function resetMemory(extra = {}) {
  writeFileSync(memPath, JSON.stringify({ ...baseMemory(), ...extra }, null, 2), 'utf8');
}
function cleanPapers() {
  const dir = `${ROOT}/论文`;
  for (const f of readdirSync(dir)) {
    if (f.startsWith('重排版_') || f.startsWith('论文_') || f.startsWith('自检报告_')) {
      const p = `${dir}/${f}`;
      if (statSync(p).isFile()) rm(p);
    }
  }
}
import { rmSync as rm } from 'node:fs';

// ── 测试 1：generate 路由 → repaper（有源论文 docx 时）────────────────────────
console.log('\n[测试1] generate 路由到 repaper（problemFile=docx）');
{
  resetMemory();
  cleanPapers();
  const ctx = freshCtx('full');
  const memory = new ProjectMemoryService(ctx, config);
  const paper = new PaperService(ctx, config, memory);
  const reply = await paper.generate(agent, ROOT, '补全公式推导，要严谨，latex');
  console.log('  reply:', reply.replace(/\n/g, ' | ').slice(0, 220));
  assert(reply.includes('重排版'), '回复确认走的是重排版流程');
  assert(reply.includes('补充 6 处公式'), '回复提到补充了 6 处公式');
  const files = readdirSync(`${ROOT}/论文`);
  const docx = files.find((f) => f.startsWith('重排版_') && f.endsWith('.docx'));
  assert(!!docx, `生成了重排版 docx（${docx || '无'}）`);
  if (docx) {
    const sz = statSync(`${ROOT}/论文/${docx}`).size;
    assert(sz > 5000, `重排版 docx 大小 ${sz} 字节（非空）`);
    const omml = execFileSync(PY, ['-c', `
import zipfile, re
z = zipfile.ZipFile('${ROOT}/论文/${docx}')
xml = z.read('word/document.xml').decode('utf8')
print(len(re.findall(r'<m:oMath>', xml)))
`]).toString().trim();
    assert(Number(omml) === 6, `docx 内含 6 个 Word 原生公式（实得 ${omml}）`);
  }
  assert(!files.some((f) => f.startsWith('论文_')), '本轮没有生成压缩版 论文_ 文件');
}

// ── 测试 2（txt 源）：按格式重排，模型输出全部缩水（<70%）→ 保留原文 + 警告 + 自检报告 ──
console.log('\n[测试2] reformatAll 保真防护（txt 源）：输出缩水时保留原文并告警');
{
  // 生成与夹具 docx 同内容的 txt 源（6 处公式占位符，6000+ 字符）
  execFileSync(PY, ['-c', `
lines = []
lines.append('集装箱破损检测论文（测试样例）')
lines.append('摘要')
lines.append('集装箱运输安全至关重要。本文针对集装箱破损检测问题建立数学模型。')
lines.append('关键词：破损检测')
lines.append('第1章 问题重述')
lines.append('1.1 背景')
lines.append('集装箱在长途运输过程中可能发生破损，影响货物安全与运输效率。')
lines.append('1.2 问题')
lines.append('需要检测集装箱表面破损并估计破损程度，误差公式为【待展开】。')
lines.append('推导略。')
lines.append('第2章 模型建立')
lines.append('2.1 图像预处理')
lines.append('对采集图像依次进行灰度化、去噪、对比度增强等预处理操作。')
lines.append('2.2 破损区域分割')
lines.append('分割阈值 T 的计算方法为【待展开】。')
lines.append('2.3 破损程度量化')
lines.append('破损面积占比公式为【待展开】。')
lines.append('2.4 分类模型')
lines.append('损失函数为【待展开】。')
lines.append('2.5 模型评价')
lines.append('准确率 P 的定义为【待展开】。')
lines.append('第3章 数据说明')
for i in range(200):
    lines.append(f'样本 {i+1}：破损区域面积为 {i*3+7} 像素，置信度 {0.81+i*0.001:.3f}，训练集与测试集按 8:2 划分。')
lines.append('参考文献')
lines.append('[1] 张三. 集装箱破损检测方法研究[J]. 物流科技, 2020.')
open('${ROOT}/论文/测试论文.txt', 'w', encoding='utf8').write('\\n'.join(lines))
`]);
  resetMemory({ problem: { title: '测试论文', problemFile: '论文/测试论文.txt', description: '' }, formatProfile: {
    structure: '章节编号：第X章',
    headingConvention: '章用一级标题，节用二级标题',
    formulaConvention: '公式居中，编号右对齐',
    tableFigureConvention: '图表标题置于下方',
    citationStyle: '顺序编码制',
    abstractKeywords: '摘要含关键词',
    notes: '',
  } });
  cleanPapers();
  const ctx = freshCtx('short');
  const memory = new ProjectMemoryService(ctx, config);
  const paper = new PaperService(ctx, config, memory);
  const reply = await paper.repaper(agent, ROOT, '论文/测试论文.txt', '按格式重排');
  console.log('  reply:', reply.replace(/\n/g, ' | ').slice(0, 300));
  assert(reply.includes('⚠️') && reply.includes('处警告'), '回复包含警告提示');
  assert(reply.includes('自检报告'), '回复包含自检报告路径');
  const md = readdirSync(`${ROOT}/论文`).find((f) => f.startsWith('重排版_') && f.endsWith('.md'));
  if (md) {
    const content = readFileSync(`${ROOT}/论文/${md}`, 'utf8');
    assert(content.includes('样本 200：') && content.includes('E = mc^2'), 'md 内容完整（原文与公式均在）');
    assert(content.length > 9000, `md 长度 ${content.length}，未因缩水而丢失内容`);
  }
  const report = readdirSync(`${ROOT}/论文`).find((f) => f.startsWith('自检报告_') && f.endsWith('.md'));
  assert(!!report, '生成了自检报告');
  if (report) {
    const rc = readFileSync(`${ROOT}/论文/${report}`, 'utf8');
    assert(rc.includes('保留原文'), '自检报告记录了“保留原文”警告');
  }
}

// ── 测试 4：docx 原位修补（含表格+图片+占位符）───────────────────────────────
console.log('\n[测试4] docx 原位修补：表格/图片/公式全部保留');
{
  // 1x1 PNG
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  execFileSync(PY, ['-c', `
import base64
from docx import Document
from docx.shared import Inches
png = base64.b64decode('${pngB64}')
open('${ROOT}/论文/pixel.png','wb').write(png)
d = Document()
d.add_paragraph('第1章 引言')
d.add_paragraph('本文研究破损检测问题，误差公式为【待展开】。')
t = d.add_table(rows=2, cols=2)
t.cell(0,0).text = 'A1'; t.cell(0,1).text = 'B1'
t.cell(1,0).text = 'A2'; t.cell(1,1).text = 'B2'
d.add_paragraph('图1-1 示意图')
d.add_picture('${ROOT}/论文/pixel.png', width=Inches(0.5))
d.add_paragraph('第2章 方法')
d.add_paragraph('推导略。')
d.add_paragraph('结论与致谢。')
d.save('${ROOT}/论文/带图表论文.docx')
`]);
  resetMemory({ problem: { title: '带图表论文', problemFile: '论文/带图表论文.docx', description: '' } });
  cleanPapers();
  const ctx = freshCtx('full');
  const memory = new ProjectMemoryService(ctx, config);
  const paper = new PaperService(ctx, config, memory);
  const reply = await paper.generate(agent, ROOT, '补全公式');
  console.log('  reply:', reply.replace(/\n/g, ' | ').slice(0, 260));
  assert(reply.includes('原位补充 2 处公式'), '回复提到原位补充 2 处公式');
  assert(reply.includes('1 个表格') && reply.includes('1 张图片'), '回复提到保留表格与图片数量');
  const docx = readdirSync(`${ROOT}/论文`).find((f) => f.startsWith('重排版_') && f.endsWith('.docx'));
  assert(!!docx, '生成了重排版 docx');
  if (docx) {
    const stats = execFileSync(PY, ['-c', `
import zipfile, re
from docx import Document
f = '${ROOT}/论文/${docx}'
z = zipfile.ZipFile(f)
xml = z.read('word/document.xml').decode('utf8')
d = Document(f)
text = '\\n'.join(p.text for p in d.paragraphs)
print('OMath', len(re.findall(r'<m:oMath>', xml)))
print('Tbl', xml.count('<w:tbl>'))
print('Media', len([n for n in z.namelist() if n.startswith('word/media/')]))
print('HasErr', '【待展开】' in text)
print('HasDeriv', '推导略' in text)
print('Full', '结论与致谢' in text)
`]).toString().trim();
    const m = {};
    for (const line of stats.split('\n')) { const [k, v] = line.split(' '); m[k] = v; }
    assert(m.OMath === '2', `2 个公式插入（实得 ${m.OMath}）`);
    assert(m.Tbl === '1', `表格保留（实得 ${m.Tbl}）`);
    assert(m.Media === '1', `图片保留（实得 ${m.Media}）`);
    assert(m.HasErr === 'False', '占位符【待展开】已被替换');
    assert(m.HasDeriv === 'False', '推导略已被替换为公式');
    assert(m.Full === 'True', '其余正文完整保留');
  }
}

// ── 测试 5：用户真实论文原版备份（22 表/6 图/5 占位符）原位修补 ──────────────
console.log('\n[测试5] 真实论文备份 docx 原位修补');
{
  execFileSync('cp', ['/home/llt/math_modeling/contests/container-damage-detection/output/论文_集装箱破损检测_原版备份.docx', `${ROOT}/论文/真实论文.docx`]);
  resetMemory({ problem: { title: '真实论文', problemFile: '论文/真实论文.docx', description: '' } });
  cleanPapers();
  const ctx = freshCtx('full');
  const memory = new ProjectMemoryService(ctx, config);
  const paper = new PaperService(ctx, config, memory);
  const reply = await paper.generate(agent, ROOT, '补全公式推导，要严谨，latex');
  console.log('  reply:', reply.replace(/\n/g, ' | ').slice(0, 260));
  assert(reply.includes('原位补充 5 处公式'), '回复提到原位补充 5 处公式');
  assert(reply.includes('22 个表格') && reply.includes('6 张图片'), '回复提到保留 22 表格 6 图片');
  const docx = readdirSync(`${ROOT}/论文`).find((f) => f.startsWith('重排版_') && f.endsWith('.docx'));
  assert(!!docx, '生成了重排版 docx');
  if (docx) {
    const stats = execFileSync(PY, ['-c', `
import zipfile, re
from docx import Document
f = '${ROOT}/论文/${docx}'
z = zipfile.ZipFile(f)
xml = z.read('word/document.xml').decode('utf8')
d = Document(f)
text = '\\n'.join(p.text for p in d.paragraphs)
print('OMath', len(re.findall(r'<m:oMath>', xml)))
print('Tbl', xml.count('<w:tbl>'))
print('Media', len([n for n in z.namelist() if n.startswith('word/media/')]))
print('HasErr', '待展开' in text)
print('Chars', len(text))
`]).toString().trim();
    const m = {};
    for (const line of stats.split('\n')) { const [k, v] = line.split(' '); m[k] = v; }
    assert(m.OMath === '5', `5 个公式原位插入（实得 ${m.OMath}）`);
    assert(m.Tbl === '22', `22 个表格保留（实得 ${m.Tbl}）`);
    assert(m.Media === '6', `6 张图片保留（实得 ${m.Media}）`);
    assert(m.HasErr === 'False', '5 处占位符全部替换');
    assert(Number(m.Chars) > 45000, `正文 ${m.Chars} 字符，未丢失内容`);
  }
}

// ── 测试 6：单处公式转换失败不中断整篇（含用户报错的那条 \text{EdgeDensity} 公式）──
console.log('\n[测试6] 公式转换失败容错：坏公式保留占位符，其余照常插入');
{
  execFileSync(PY, ['-c', `
from docx import Document
d = Document()
d.add_paragraph('第1章 引言')
d.add_paragraph('边缘密度定义为【待展开】。')
d.add_paragraph('能量公式为【待展开】。')
d.add_paragraph('第三个式子【待展开】。')
d.add_paragraph('结论。')
d.save('${ROOT}/论文/三公式论文.docx')
`]);
  resetMemory({ problem: { title: '三公式论文', problemFile: '论文/三公式论文.docx', description: '' } });
  cleanPapers();
  const formulas = {
    1: '\\text{EdgeDensity} = \\frac{1}{MN} \\sum_{i=1}^{M} \\sum_{j=1}^{N} \\mathbb{1}\\left(G(i,j) > 50\\right)',
    2: 'E = mc^2',
    3: '\\frac{1}{', // 故意坏公式：两个转换器都应失败
  };
  const ctx = freshCtx('full', formulas);
  const memory = new ProjectMemoryService(ctx, config);
  const paper = new PaperService(ctx, config, memory);
  const reply = await paper.generate(agent, ROOT, '补全公式');
  console.log('  reply:', reply.replace(/\n/g, ' | ').slice(0, 300));
  assert(reply.includes('原位补充 2 处公式'), '回复提到原位补充 2 处公式');
  assert(reply.includes('1 处转换失败') && reply.includes('第 3 处'), '回复提到第 3 处转换失败已保留占位符');
  const docx = readdirSync(`${ROOT}/论文`).find((f) => f.startsWith('重排版_') && f.endsWith('.docx'));
  assert(!!docx, '仍生成了重排版 docx（不中断）');
  if (docx) {
    const stats = execFileSync(PY, ['-c', `
import zipfile, re
from docx import Document
f = '${ROOT}/论文/${docx}'
z = zipfile.ZipFile(f)
xml = z.read('word/document.xml').decode('utf8')
text = '\\n'.join(p.text for p in Document(f).paragraphs)
print('OMath', len(re.findall(r'<m:oMath>', xml)))
print('Left', text.count('【待展开】'))
print('HasEdge', 'EdgeDe' in xml)
`]).toString().trim();
    const m = {};
    for (const line of stats.split('\n')) { const [k, v] = line.split(' '); m[k] = v; }
    assert(m.OMath === '2', `2 个公式成功插入（实得 ${m.OMath}）`);
    assert(m.Left === '1', `坏公式的占位符保留（实得 ${m.Left} 处）`);
    assert(m.HasEdge === 'True', '用户报错的 \\text{EdgeDensity} 公式转换成功');
  }
}

console.log(failures ? `\n❌ ${failures} 项断言失败` : '\n✅ 全部断言通过');
process.exit(failures ? 1 : 0);
