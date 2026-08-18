# dsh-obsidian-note-coach

Obsidian 笔记助手插件（DeepSeek Harness / DSH）。

把 Obsidian 知识库目录选为工作区后，插件会：

1. **学习你的书写风格**，生成可跨电脑迁移的风格画像（只含机械书写习惯，**绝不存储价值取向**）；
2. **观点裁判**：当你表达看法时，独立判断其是否正确并给建议；正确或非主观时征询你是否记笔记，同意后按你的风格在合适位置落笔记；
3. **写前审批**：强制每次模型发起的文件改写（`write`/`edit`）都要你确认；
4. **结构化判断输出**：判断 / 理由 / 建议 / 推荐记录位置分开呈现；判断正确或非主观时先**生成笔记预览**（格式+内容，按你的风格），再弹窗征询——同意按预览写入，或用自然语言补充内容 / 指定位置（选择自定义会按你的输入重新生成）；
5. **连续追问**：对上一次判断的理由可多轮追问（`/note-followup`、对话中"追问：…"、独立页面输入框）；
6. **报告**：全局/指定范围的内容总结、客观评价，计划类笔记自动附带"计划 vs 现状"对比；
7. **GitHub 上推**：在独立页面输入仓库链接，一键把笔记推到 GitHub。

## 安装（本仓库已完成）

```bash
# 1. 构建服务端 + 客户端 bundle
npm install --cache /home/llt/dsh/.npm-cache
npm run build

# 2. 链接进 web profile（已做：软链到 ~/.dsh/profiles/node_modules/）
ln -sfn /home/llt/dsh ~/.dsh/profiles/node_modules/dsh-obsidian-note-coach

# 3. 注册行已写入 ~/.dsh/profiles/web/cordis.patch.yml
# 4. 重启 `dsh web` 生效
```

## 使用

| 入口 | 作用 |
|---|---|
| 侧边栏底部 📝 按钮 | 当前窗口跳转到独立页面（URL：`http://<host>:<port>/notes-coach`，可加书签，浏览器后退返回主界面） |
| 直接访问 `/notes-coach` | 独立网址直达；页面自带会话选择器，弹窗（同意/自定义、审批）直接显示在页面内 |
| `/note <观点>` | 显式触发观点判断（判断/理由/建议/推荐记录位置分开输出） |
| `/note-followup <追问>` | 对上一次判断的理由连续追问（多轮） |
| `/notes-report [scope[:target]] [mode]` | 报告，如 `global evaluate`、`folder:Projects summary` |
| `/notes-style [status\|clear-memory]` | 学习/查看风格；清除易失观点记忆 |
| `/notes-push [仓库链接]` | 设置仓库地址（带参）或上推（不带参） |
| 对话中表达"我认为…" | 模型自动调用 `note_coach_judge` 工具（auto-detect） |

## 配置（`cordis.patch.yml` 中 `note-coach` 行的 config）

| 键 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `styleFile` | `.harness/notes-style.json` | 便携风格画像路径（放 vault 内，跨电脑随 vault 迁移） |
| `memoryRetentionDays` | `7` | 易失观点记忆的保留天数，到期自动清理 |
| `judge.model/provider` | 跟随会话 | 裁判/写笔记/报告所用的模型 |
| `judge.temperature` | `0.3` | 裁判温度 |
| `judge.maxTokens` | `2000` | 裁判最大输出 |
| `autoDetect` | `true` | 是否注册 `note_coach_judge` 工具（对话自动触发） |
| `approvalMode` | `true` | 是否强制写前审批（拦 `write`/`edit`） |
| `reportDir` | `.harness/reports` | 报告输出目录 |

## 设计要点

### 价值取向隔离（安全 + 防止 AI 偏见）

- `notes-style.json` 的 schema 只允许机械风格字段（语言、frontmatter 习惯、标题层级、文件夹分类法、命名、链接风格、语气机制、段落习惯、模板元素）——**不允许任何观点/立场/价值观**；加载时会做字段白名单清洗。
- 观点判断时，裁判模型**从零评估**，不携带用户历史观点上下文，避免顺着用户立场"顺着说"。
- 观点会短暂记入易失记忆（`.harness/notes-memory.json`），按 `memoryRetentionDays` 定期清理，且只在会话内使用，永不进入便携风格画像。

### 写前审批

`tools/pre-execute` 瀑布对 `write`/`edit` 返回 `{kind:'ask'}`，DSH 的审批管道会自动弹窗询问；拒绝则调用不执行。插件自身的落笔记/写报告走 `ctx.fs` 服务直写（非模型工具调用），不会重复弹窗——那些动作你已经在面板/审批里明确同意过。

### 跨电脑恢复风格

风格画像存在 **vault 内的 `.harness/notes-style.json`**。换电脑时：打开同一份 vault（作为工作区）→ 插件自动读取该文件恢复书写风格，无需重新学习。`/notes-style` 可随时重新学习/覆盖。

## 目录结构

```
src/
├── index.ts     插件入口（装配所有服务）
├── config.ts    配置解析与默认值
├── types.ts     共享类型
├── vault.ts     Obsidian vault 扫描与索引
├── style.ts     风格学习/便携画像/易失观点记忆
├── judge.ts     观点裁判流（判断→建议→征询→落笔记）
├── notes.ts     笔记落位（文件夹/标题/内容生成）
├── report.ts    报告生成（总结/评价/计划对比）
├── github.ts    Git 上推
├── guard.ts     写前审批守卫
├── tools.ts     模型工具注册（note_coach_judge / note_coach_report）
├── commands.ts  斜杠命令
└── client/      Web GUI 面板（esbuild 打包为客户端 bundle）
```

## 已知限制（v1）

- vault 扫描按 relPath 排序取"近期"样本，无真实 mtime（后端 FsInfo 不提供）；跨文件夹抽样不受影响。
- GitHub 上推依赖本机 git 凭据（SSH agent / HTTPS credential helper），不在插件内存任何 token。
- 报告保存在 `.harness/reports/`，面板内直接展示 Markdown 文本；未做富文本预览。
- 客户端 bundle 由 esbuild 手写打包（`scripts/build-client.mjs`），未接入 dsh 仓库的 tsdown 热更新链。
