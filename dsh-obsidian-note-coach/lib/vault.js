import { Service } from '@deepseek-ai/cordis';
/** Directories never scanned. */
const SKIP_DIRS = new Set(['.git', '.obsidian', '.harness', '.trash', 'node_modules', '.DS_Store', 'archive']);
/** Parse a leading YAML frontmatter block; returns the record or {} on failure. */
export function parseFrontmatter(body) {
    if (!body.startsWith('---'))
        return { frontmatter: {}, rest: body };
    const end = body.indexOf('\n---', 3);
    if (end < 0)
        return { frontmatter: {}, rest: body };
    const raw = body.slice(3, end).trim();
    const rest = body.slice(end + 4).trimStart();
    const record = {};
    for (const line of raw.split('\n')) {
        const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
        if (!m)
            continue;
        let value = m[2].trim();
        if (/^[0-9]+$/.test(value))
            value = Number(value);
        else if (value.startsWith('"') && value.endsWith('"'))
            value = value.slice(1, -1);
        else if (value === 'true')
            value = true;
        else if (value === 'false')
            value = false;
        else if (value.startsWith('[') && value.endsWith(']')) {
            value = value
                .slice(1, -1)
                .split(',')
                .map((s) => s.trim().replace(/^"|"$/g, ''))
                .filter(Boolean);
        }
        record[m[1]] = value;
    }
    return { frontmatter: record, rest };
}
/** Extract markdown structure from note text. */
export function parseNoteBody(body) {
    const headings = [];
    const links = [];
    const tasks = [];
    for (const line of body.split('\n')) {
        const h = line.match(/^(#{1,6})\s+(.+)$/);
        if (h) {
            headings.push(h[2].trim());
            continue;
        }
        for (const m of line.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g))
            links.push(m[1].trim());
        for (const m of line.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g))
            links.push(m[2]);
        const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/);
        if (task)
            tasks.push({ text: task[2].trim(), done: task[1] !== ' ' });
    }
    return { headings, links, tasks };
}
/**
 * Vault scanning and indexing service. The vault root is the session
 * workspace root (the folder the user selects in the GUI), so the same vault
 * opened on another machine resolves identically.
 */
export class NoteVaultService extends Service {
    config;
    constructor(ctx, config) {
        super(ctx, 'noteVault');
        this.config = config;
    }
    /** The vault root for one agent: its session header cwd (the workspace). */
    vaultRoot(agent) {
        const cwd = agent?.session.header.cwd;
        if (!cwd)
            throw new Error('note-coach: session has no workspace root; select a vault folder as the workspace first');
        return cwd;
    }
    async target(path, signal) {
        return this.ctx.fs.resolve(path, { signal });
    }
    /**
     * Recursively index the vault. `depthLimit` guards against runaway scans;
     * the default is generous for note vaults.
     */
    async scan(root, signal, depthLimit = 12) {
        const notes = [];
        const folders = new Set(['']);
        const tags = new Set();
        const walk = async (dir, rel, depth) => {
            if (depth > depthLimit)
                return;
            const entries = await this.ctx.fs.listDir(await this.target(dir, signal), signal);
            for (const entry of entries) {
                if (signal?.aborted)
                    throw new DOMException('Aborted', 'AbortError');
                const childRel = rel ? `${rel}/${entry.name}` : entry.name;
                const childAbs = dir.endsWith('/') ? dir + entry.name : `${dir}/${entry.name}`;
                if (entry.type === 'directory') {
                    if (SKIP_DIRS.has(entry.name))
                        continue;
                    folders.add(childRel);
                    await walk(childAbs, childRel, depth + 1);
                }
                else if (entry.name.endsWith('.md')) {
                    try {
                        const text = await this.ctx.fs.readText(await this.target(childAbs, signal), signal);
                        const { frontmatter, rest } = parseFrontmatter(text);
                        const { headings, links, tasks } = parseNoteBody(rest);
                        const stat = await this.ctx.fs.stat(await this.target(childAbs, signal), signal);
                        const h1 = rest.split('\n').find((l) => l.startsWith('# '));
                        const title = h1 ? h1.replace(/^#\s+/, '').trim() : entry.name.replace(/\.md$/, '');
                        for (const t of collectTags(frontmatter))
                            tags.add(t);
                        notes.push({
                            relPath: childRel,
                            folder: rel,
                            basename: entry.name.replace(/\.md$/, ''),
                            title,
                            frontmatter,
                            headings,
                            links,
                            tasks,
                            body: rest,
                            size: stat?.size ?? 0,
                        });
                    }
                    catch {
                        // Unreadable note: skip silently, never fail the scan.
                    }
                }
            }
        };
        await walk(root, '', 0);
        notes.sort((a, b) => a.relPath.localeCompare(b.relPath));
        return {
            root,
            notes,
            folders: [...folders].sort((a, b) => a.localeCompare(b)),
            tags: [...tags].sort((a, b) => a.localeCompare(b)),
            scannedAt: new Date().toISOString(),
        };
    }
}
function collectTags(frontmatter) {
    const out = [];
    const push = (v) => {
        if (typeof v === 'string')
            out.push(v);
        else if (Array.isArray(v))
            for (const item of v)
                if (typeof item === 'string')
                    out.push(item);
    };
    push(frontmatter.tags);
    push(frontmatter.tag);
    push(frontmatter.category);
    return out;
}
