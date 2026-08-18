# DSH 插件集

DeepSeek Harness (DSH) 插件集合。当前包含两个插件：

## 目录

| 目录 | 插件 | 说明 |
|---|---|---|
| [`dsh-obsidian-note-coach`](./dsh-obsidian-note-coach) | 笔记教练 | Obsidian 笔记风格学习、观点判断、经确认的记笔记、报告与 GitHub 推送 |
| [`dsh-math-assistant`](./dsh-math-assistant) | 数学建模助手 | 数学建模竞赛全流程：题目分析、需求问答、阶段显示、文献参考、程序实现、数据处理、一键 Word 论文（LaTeX 公式 → Word 原生公式，docx 原位补公式） |

## 安装

每个插件目录内都有独立的 README。通用流程：

1. 把插件目录放到任意位置（例如 `~/dsh/<插件名>`），并安装依赖：
   ```bash
   cd <插件目录>
   npm install
   npm run build        # 生成 lib/
   ```
2. 数学建模助手还需要 Python venv（pandas/numpy/scipy/sympy/matplotlib/python-docx/pypandoc-binary/latex2mathml/mathml2omml）：
   ```bash
   cd dsh-math-assistant
   python3 -m venv .venv
   .venv/bin/pip install pypandoc-binary pandas numpy scipy sympy matplotlib python-docx latex2mathml mathml2omml
   ```
3. 在 DSH profile 的 `cordis.patch.yml` 里注册插件（`dsh-plugin --profile <你的profile> add <插件目录>` 或手动 insert），数学建模助手显式配置 `pythonPath`。

详细用法见各插件 README。

## 说明

- 两个插件均为 DSH 客户端-服务端混合插件（`type: module`，客户端 bundle 注入 `window.__ModuleLoader__`）。
- 未经许可，请勿用于商业用途。
