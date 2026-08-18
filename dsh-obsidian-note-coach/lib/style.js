import { Service } from '@deepseek-ai/cordis';
import { completeText, extractJson } from './llm.js';
/** Keys allowed in a portable style profile. Anything else is stripped on load. */
const STYLE_KEYS = new Set([
    'schemaVersion',
    'generatedAt',
    'language',
    'frontmatterFields',
    'headingConventions',
    'folderTaxonomy',
    'namingPattern',
    'linkStyle',
    'tone',
    'paragraphHabits',
    'templateElements',
    'specialConventions',
]);
/** The only volatile memory file, kept under .harness and TTL-purged. */
const MEMORY_FILE = '.harness/notes-memory.json';
/**
 * Style learning and portability service.
 *
 * - The style profile is a vault-local, portable JSON file: copy the vault (or
 *   just this file) to another machine and DSH restores the writing style.
 * - Value hygiene: the profile schema carries ONLY mechanical conventions.
 *   Opinions/values live in a volatile ledger that is purged on TTL and on
 *   startup, so no stance ever persists or biases later judgments.
 */
export class NoteStyleService extends Service {
    config;
    constructor(ctx, config) {
        super(ctx, 'noteStyle');
        this.config = config;
    }
    /** Absolute path of the style profile inside the vault. */
    stylePath(root) {
        return root.endsWith('/') ? root + this.config.styleFile : `${root}/${this.config.styleFile}`;
    }
    memoryPath(root) {
        return `${root}/.harness/notes-memory.json`;
    }
    /** Load and sanitize the portable style profile; returns undefined when absent. */
    async loadStyle(root) {
        try {
            const target = await this.ctx.fs.resolve(this.stylePath(root));
            const raw = await this.ctx.fs.readText(target);
            const parsed = JSON.parse(raw);
            return this.sanitize(parsed);
        }
        catch {
            return undefined;
        }
    }
    /** Sanitize a parsed profile: keep only allowed keys with correct shapes. */
    sanitize(input) {
        const pick = (key, fallback) => typeof input[key] === 'string' ? input[key] : fallback;
        const pickList = (key) => Array.isArray(input[key]) ? input[key].filter((v) => typeof v === 'string') : [];
        const style = {
            schemaVersion: 1,
            generatedAt: pick('generatedAt', new Date(0).toISOString()),
            language: pick('language', ''),
            frontmatterFields: pickList('frontmatterFields'),
            headingConventions: pick('headingConventions', ''),
            folderTaxonomy: pickList('folderTaxonomy'),
            namingPattern: pick('namingPattern', ''),
            linkStyle: pick('linkStyle', ''),
            tone: pick('tone', ''),
            paragraphHabits: pick('paragraphHabits', ''),
            templateElements: pick('templateElements', ''),
            specialConventions: pick('specialConventions', ''),
        };
        return style;
    }
    /** Persist the profile atomically. */
    async saveStyle(root, style) {
        const target = await this.ctx.fs.resolve(this.stylePath(root));
        await this.ctx.fs.writeText(target, JSON.stringify(style, null, 2) + '\n');
    }
    /**
     * Learn the user's writing style from the vault index. Always runs even when
     * a previous profile exists (the requirement), then merges: a fresh LLM
     * extraction overwrites mechanical fields, never value content (none exists).
     */
    async learnStyle(agent, index, signal) {
        const samples = pickSamples(index.notes, 30);
        const sampleText = samples
            .map((n) => {
            const head = n.body.slice(0, 1500);
            return `--- ${n.relPath} (folder: ${n.folder || '/'}) ---\nfrontmatter: ${JSON.stringify(n.frontmatter)}\nheadings: ${n.headings.join(' / ')}\n\n${head}`;
        })
            .join('\n\n');
        const system = [
            'You extract the MECHANICAL writing style of an Obsidian note author. ',
            'Output STRICT JSON only, no prose. ',
            'You must NOT record any opinions, values, stances, beliefs, or personal positions — ',
            'style is about FORMAT and STRUCTURE only. If you are unsure, leave the field empty.',
        ].join('');
        const user = [
            `The user's vault has these folders: ${index.folders.join(', ') || '(root only)'}.`,
            `Tags seen: ${index.tags.join(', ') || '(none)'}.`,
            'Below are sample notes. Extract the style profile:',
            '',
            sampleText,
            '',
            'Return JSON with exactly these string/string[] fields:',
            '{ "language": string, "frontmatterFields": string[], "headingConventions": string, "folderTaxonomy": string[], "namingPattern": string, "linkStyle": string, "tone": string, "paragraphHabits": string, "templateElements": string, "specialConventions": string }',
        ].join('\n');
        const answer = await completeText(this.ctx, agent, {
            provider: this.config.judge.provider,
            model: this.config.judge.model,
            temperature: 0.2,
            maxTokens: 1500,
        }, system, user, signal);
        const parsed = extractJson(answer);
        const existing = (await this.loadStyle(index.root)) ?? emptyStyle();
        const merged = {
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            language: str(parsed?.language) || existing.language || 'zh-CN',
            frontmatterFields: list(parsed?.frontmatterFields).length
                ? list(parsed?.frontmatterFields)
                : existing.frontmatterFields,
            headingConventions: str(parsed?.headingConventions) || existing.headingConventions,
            folderTaxonomy: list(parsed?.folderTaxonomy).length
                ? list(parsed?.folderTaxonomy)
                : existing.folderTaxonomy,
            namingPattern: str(parsed?.namingPattern) || existing.namingPattern,
            linkStyle: str(parsed?.linkStyle) || existing.linkStyle,
            tone: str(parsed?.tone) || existing.tone,
            paragraphHabits: str(parsed?.paragraphHabits) || existing.paragraphHabits,
            templateElements: str(parsed?.templateElements) || existing.templateElements,
            specialConventions: str(parsed?.specialConventions) || existing.specialConventions,
        };
        await this.saveStyle(index.root, merged);
        return merged;
    }
    // ── Volatile opinion memory (value hygiene) ────────────────────────────────
    /** Load the volatile ledger, purging entries older than the TTL. */
    async loadMemory(root, now = Date.now()) {
        let entries = [];
        try {
            const target = await this.ctx.fs.resolve(this.memoryPath(root));
            const raw = await this.ctx.fs.readText(target);
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed))
                entries = parsed.filter(isMemoryEntry);
        }
        catch {
            entries = [];
        }
        const cutoff = now - this.config.memoryRetentionDays * 24 * 60 * 60 * 1000;
        const kept = entries.filter((e) => Date.parse(e.at) > cutoff);
        if (kept.length !== entries.length) {
            try {
                await this.saveMemory(root, kept);
            }
            catch {
                // Purging is best-effort; never fail the caller.
            }
        }
        return kept;
    }
    /** Append one opinion memory entry (short, user-worded, no extrapolation). */
    async rememberOpinion(root, opinion, verdict) {
        const entries = await this.loadMemory(root);
        entries.push({ at: new Date().toISOString(), opinion: opinion.slice(0, 500), verdict });
        await this.saveMemory(root, entries.slice(-200));
    }
    /** Wipe the volatile ledger entirely (startup + on demand). */
    async clearMemory(root) {
        try {
            await this.saveMemory(root, []);
        }
        catch {
            // best effort
        }
    }
    async saveMemory(root, entries) {
        const target = await this.ctx.fs.resolve(this.memoryPath(root));
        await this.ctx.fs.writeText(target, JSON.stringify(entries, null, 2) + '\n');
    }
}
function emptyStyle() {
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        language: 'zh-CN',
        frontmatterFields: [],
        headingConventions: '',
        folderTaxonomy: [],
        namingPattern: '',
        linkStyle: '',
        tone: '',
        paragraphHabits: '',
        templateElements: '',
        specialConventions: '',
    };
}
function str(v) {
    return typeof v === 'string' ? v : undefined;
}
function list(v) {
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}
function isMemoryEntry(v) {
    if (typeof v !== 'object' || v === null)
        return false;
    const e = v;
    return typeof e.at === 'string' && typeof e.opinion === 'string' && typeof e.verdict === 'string';
}
/** Pick a diverse sample: up to `count` notes, spread across folders. */
function pickSamples(notes, count) {
    const byFolder = new Map();
    for (const n of notes) {
        const list = byFolder.get(n.folder) ?? [];
        list.push(n);
        byFolder.set(n.folder, list);
    }
    const buckets = [...byFolder.values()];
    const out = [];
    let i = 0;
    while (out.length < count && buckets.some((b) => b.length > i)) {
        for (const bucket of buckets) {
            if (bucket[i] && out.length < count)
                out.push(bucket[i]);
        }
        i++;
    }
    return out;
}
