/**
 * docx 原位重排：保留源 docx 的 全部内容（OMML 公式、表格、图片、样式、目录），
 * 只在公式占位符（【待展开】等）位置插入 LaTeX→OMML 公式，按需套用格式档案的标题样式。
 * 绝不做"抽取文本→重建"，避免丢失任何结构。
 */
export declare function patchDocxFormulas(projectRoot: string, workDir: string, sourcePath: string, outPath: string, latexByOccurrence: Array<string | null>, pythonPath?: string, headingRestyle?: boolean): Promise<{
    ok: boolean;
    inserted?: number;
    tables?: number;
    media?: number;
    failed?: number;
    failedIdx?: number[];
    error?: string;
}>;
