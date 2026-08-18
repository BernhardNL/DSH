/** 数学建模助手的共享类型。 */
/** 一问答题目分析。 */
export interface QuestionAnalysis {
    /** 第几问（如 "问题一"）或自定义小节。 */
    question: string;
    /** 问题类型（如 优化/统计/时间序列/微分方程…）。 */
    type: string;
    /** 可能需要使用的模型。 */
    models: string[];
    /** 可能需要使用的算法。 */
    algorithms: string[];
    /** 工具/库（如 numpy/scipy/sympy）。 */
    tools: string[];
    /** 大致解决思路（简洁，保留重点）。 */
    approach: string;
    /** 拆分成的小问题。 */
    subProblems: string[];
}
/** 流水线阶段。 */
export interface PipelineStage {
    title: string;
    detail: string;
    status: 'pending' | 'running' | 'done' | 'error';
    /** 该阶段 AI 推理过程简述。 */
    reasoningBrief?: string;
    /** 该阶段产物文本（截断）。 */
    output?: string;
}
/** 流水线整体状态（阶段显示用）。 */
export interface PipelineState {
    status: 'idle' | 'running' | 'done' | 'error';
    stages: PipelineStage[];
    currentIndex: number;
    /** 当前正在执行什么。 */
    current: string;
    /** 总体步骤设计简述。 */
    plan: string;
    updatedAt: string;
}
/** 一条文献引用。 */
export interface RefEntry {
    title: string;
    url?: string;
    note: string;
    verified: boolean;
}
/** 数据处理摘要。 */
export interface DataSummary {
    fileName: string;
    rows: number;
    columns: string[];
    /** 文本化统计结果（展示用）。 */
    statsText: string;
    /** 处理产物（如清洗后文件、图表）路径，相对项目根。 */
    artifacts: string[];
    note?: string;
}
/** 代码产物。 */
export interface CodeArtifact {
    name: string;
    /** 相对项目根的路径。 */
    path: string;
    language: string;
    description: string;
    verified: boolean;
    verificationNote?: string;
}
/** 论文产物。 */
export interface PaperRecord {
    /** 相对项目根的路径（.docx）。 */
    path: string;
    generatedAt: string;
    note?: string;
}
/** 论文格式规范档案（从参考论文学习）。 */
export interface PaperFormatProfile {
    schemaVersion: 1;
    /** 参考论文文件（相对项目根）。 */
    sourceFiles: string[];
    /** 章节体系（如：1 引言 / 2 模型建立与求解 / …）。 */
    structure: string;
    /** 标题编号与层级规范。 */
    headingConvention: string;
    /** 公式规范（编号、符号定义、排版）。 */
    formulaConvention: string;
    /** 图表规范（编号、标题位置）。 */
    tableFigureConvention: string;
    /** 引用风格。 */
    citationStyle: string;
    /** 摘要/关键词写法。 */
    abstractKeywords: string;
    /** 语言。 */
    language: string;
    /** 其他格式要点。 */
    notes: string;
}
/** 按项目隔离的持久记忆。 */
export interface ProjectMemory {
    schemaVersion: 1;
    updatedAt: string;
    /** 题目信息。 */
    problem: {
        title?: string;
        /** 用户在对话框描述的问题原文。 */
        description?: string;
        /** 问题文件（相对项目根的路径，如 pdf/docx/txt）。 */
        problemFile?: string;
    };
    analysis: QuestionAnalysis[];
    pipeline: PipelineState;
    references: RefEntry[];
    data: DataSummary[];
    code: CodeArtifact[];
    papers: PaperRecord[];
    /** 论文格式规范档案（可选）。 */
    formatProfile?: PaperFormatProfile;
    /** 需求问答历史（最近若干条）。 */
    chat: {
        role: 'user' | 'assistant';
        text: string;
    }[];
}
/** 插件配置。 */
export interface MathConfig {
    enabled: boolean;
    /** 记忆/产物目录（相对项目根）。 */
    workDir: string;
    /** python 解释器路径（优先项目 .venv，回退系统 python3）。 */
    pythonPath?: string;
    /** 论文输出目录。 */
    paperDir: string;
    /** 格式重排时最多处理的章节块数（其余保留原文）。 */
    formatReformatBlocks: number;
    llm: {
        temperature: number;
        maxTokens: number;
    };
}
