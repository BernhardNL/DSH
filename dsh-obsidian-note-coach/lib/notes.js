import { Service } from '@deepseek-ai/cordis';
import { completeText } from './llm.js';
const WRITER_SYSTEM = [
    'You write ONE Obsidian markdown note that captures the user\'s opinion in THEIR OWN WORDS, enriched with brief clarifying examples.',
    'Follow the user\'s writing style profile exactly: frontmatter fields, heading conventions, tone, link style, and structure.',
    'Keep the note concise (under 400 words). Use the user\'s phrasing as the backbone; add examples only where they clarify.',
    'Do NOT add opinions of your own, do NOT moralize, do NOT editorialize beyond the user\'s statement.',
    'Output STRICT JSON only: { "title": string, "folder": string, "content": string } — content is the full markdown body including any frontmatter.',
].join('\n');
export class NoteWriterService extends Service {
    config;
    constructor(ctx, config) {
        super(ctx, 'noteWriter');
        this.config = config;
    }
    /**
     * Generate the note content WITHOUT writing (used to preview the note's
     * format and content before asking the user to confirm).
     */
    async previewNote(agent, index, style, opinion, opts = {}, signal) {
        return this.generateContent(agent, index, style, opinion, opts, signal);
    }
    async insertNote(agent, index, style, opinion, opts = {}, signal) {
        const generated = await this.generateContent(agent, index, style, opinion, opts, signal);
        return this.writeGenerated(index, generated);
    }
    /** Write an already-generated note to the vault. */
    async writeGenerated(index, generated) {
        const { folder, title, content } = generated;
        const relPath = folder ? `${folder}/${safeFilename(title)}.md` : `${safeFilename(title)}.md`;
        const absPath = index.root.endsWith('/') ? index.root + relPath : `${index.root}/${relPath}`;
        const target = await this.ctx.fs.resolve(absPath);
        await this.ctx.fs.writeText(target, content.trimEnd() + '\n');
        return { path: absPath, folder, title };
    }
    async generateContent(agent, index, style, opinion, opts = {}, signal) {
        const existingTitles = new Set(index.notes.map((n) => n.title.toLowerCase()));
        const userLocation = normalizeUserLocation(opts.userLocation, index);
        const user = [
            `Vault folders available: ${index.folders.join(', ') || '(root only)'}`,
            `Existing note titles (avoid duplicating): ${[...existingTitles].slice(0, 60).join('; ') || '(none)'}`,
            '',
            `User's writing style profile:\n${JSON.stringify(style, null, 2)}`,
            '',
            `The user's opinion to record (verbatim): "${opinion}"`,
            opts.suggestedFolder ? `\nSuggested folder: ${opts.suggestedFolder}` : '',
            opts.suggestedTitle ? `Suggested title: ${opts.suggestedTitle}` : '',
            opts.recommendedLocation ? `\nRecommended location: ${opts.recommendedLocation}` : '',
            userLocation ? `\nUSER-REQUIRED location: ${userLocation} (use exactly this; the user specified it)` : '',
            opts.supplement
                ? `\nUSER-SUPPLIED supplement (MUST be merged in, keep its meaning verbatim):\n${opts.supplement}`
                : '',
            '',
            'Write the note now.',
        ].join('\n');
        const answer = await completeText(this.ctx, agent, {
            provider: this.config.judge.provider,
            model: this.config.judge.model,
            temperature: 0.4,
            maxTokens: 1500,
        }, WRITER_SYSTEM, user, signal);
        const parsed = parseWriterAnswer(answer);
        const folder = pickFolder(userLocation?.folder ?? parsed.folder, opts.suggestedFolder, index);
        const title = pickTitle(userLocation?.title ?? parsed.title, opts.suggestedTitle, opinion);
        const content = parsed.content || `# ${title}\n\n${opinion}\n`;
        return { folder, title, content };
    }
}
/** Parse the user's custom location into {folder?, title?} when possible. */
function normalizeUserLocation(input, index) {
    if (!input)
        return undefined;
    const t = input.trim().replace(/^\/+|\/+$/g, '');
    if (!t)
        return undefined;
    if (t.endsWith('.md')) {
        const clean = t.replace(/\.md$/i, '');
        const slash = clean.lastIndexOf('/');
        if (slash >= 0) {
            return { folder: clean.slice(0, slash), title: clean.slice(slash + 1) };
        }
        return { title: clean };
    }
    const folders = new Set(index.folders);
    if (folders.has(t))
        return { folder: t };
    if (t.includes('/')) {
        const [head] = t.split('/');
        if (folders.has(head))
            return { folder: t };
    }
    // Bare name that is not an existing folder: treat as a title.
    return { title: t };
}
export function parseWriterAnswer(answer) {
    const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : answer;
    let obj;
    try {
        obj = JSON.parse(candidate);
    }
    catch {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                obj = JSON.parse(candidate.slice(start, end + 1));
            }
            catch {
                obj = undefined;
            }
        }
    }
    return {
        title: typeof obj?.title === 'string' ? obj.title : undefined,
        folder: typeof obj?.folder === 'string' ? obj.folder : undefined,
        content: typeof obj?.content === 'string' ? obj.content : undefined,
    };
}
/** Choose the destination folder: LLM suggestion, then judge suggestion, then existing taxonomy, then root. */
function pickFolder(llmFolder, judgeFolder, index) {
    const folders = new Set(index.folders);
    for (const candidate of [llmFolder, judgeFolder]) {
        if (candidate && candidate !== '/' && candidate !== '.') {
            const normalized = candidate.replace(/^\/+|\/+$/g, '');
            if (folders.has(normalized))
                return normalized;
        }
    }
    if (folders.has('Inbox'))
        return 'Inbox';
    return '';
}
/** Choose a unique title, preferring suggestions, then deriving from the opinion. */
function pickTitle(llmTitle, judgeTitle, opinion) {
    const base = (llmTitle && llmTitle.trim()) ||
        (judgeTitle && judgeTitle.trim()) ||
        opinion.slice(0, 40).replace(/[#*\[\]<>|]/g, '').trim() ||
        '未命名笔记';
    return base.replace(/\s+/g, ' ').slice(0, 80);
}
function safeFilename(name) {
    return name
        .replace(/[\\/:*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120) || 'note';
}
