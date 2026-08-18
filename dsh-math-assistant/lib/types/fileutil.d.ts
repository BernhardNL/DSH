/**
 * 从问题文件读取文本：pdf → pdftotext；docx → python-docx（项目 .venv）；
 * txt/md → 直接读。
 */
export declare function readProblemFile(projectRoot: string, relPath: string, configuredPython?: string): Promise<string>;
/** 列出工作区可见文件（排除隐藏/缓存/大模型目录），最多到 3 层。 */
export declare function workspaceFiles(projectRoot: string): Promise<string[]>;
/**
 * 读取文件供 LLM 上下文使用（带大小上限）：
 * txt/md → 直接读；pdf → pdftotext；docx → python-docx；csv/xlsx → pandas 前若干行。
 */
export declare function readFileForContext(projectRoot: string, relPath: string, configuredPython?: string, maxChars?: number): Promise<string>;
