/**
 * Shared types for the Obsidian note coach plugin.
 *
 * Value-hygiene contract: `NoteStyle` (the portable style profile) contains
 * ONLY mechanical writing conventions — never opinions, values, or stances.
 * Opinion memory lives in the volatile per-session ledger and is purged
 * periodically (see `memoryRetentionDays`).
 */
/** One indexed note inside the vault. */
export interface VaultNote {
    /** Path relative to the vault root, e.g. `Projects/foo.md`. */
    relPath: string;
    /** Folder relative path ('' for the vault root). */
    folder: string;
    /** File basename without `.md`. */
    basename: string;
    /** Display title: first `# ` heading, else the basename. */
    title: string;
    /** Parsed YAML frontmatter (best effort; plain record). */
    frontmatter: Record<string, unknown>;
    /** All ATX headings without the `#` markers. */
    headings: string[];
    /** `[[wikilink]]` and `[md](link)` targets found in the body. */
    links: string[];
    /** Checklist items `- [ ]` / `- [x]`. */
    tasks: {
        text: string;
        done: boolean;
    }[];
    /** Body text after the frontmatter block, trimmed. */
    body: string;
    /** Byte size when the backend reports it. */
    size: number;
}
/** A snapshot index of the whole vault. */
export interface VaultIndex {
    /** Absolute vault root path. */
    root: string;
    notes: VaultNote[];
    /** Sorted folder list; '' represents the root. */
    folders: string[];
    /** Distinct tags collected from frontmatter + body mentions. */
    tags: string[];
    scannedAt: string;
}
/**
 * Portable style profile. Stored in the vault (default
 * `.harness/notes-style.json`) so another machine opening the same vault can
 * restore the user's writing style. NEVER contains value orientation.
 */
export interface NoteStyle {
    schemaVersion: 1;
    generatedAt: string;
    /** e.g. 'zh-CN' */
    language: string;
    /** Frontmatter fields the user routinely writes, in order. */
    frontmatterFields: string[];
    /** Heading structure conventions. */
    headingConventions: string;
    /** Top-level folder taxonomy and the purpose of each folder. */
    folderTaxonomy: string[];
    /** File naming pattern. */
    namingPattern: string;
    /** Link style: wikilinks vs markdown links, and when. */
    linkStyle: string;
    /** Tone of writing (mechanics only, never stance). */
    tone: string;
    /** Paragraph / formatting habits. */
    paragraphHabits: string;
    /** Recurring template or structural elements. */
    templateElements: string;
    /** Anything else mechanical worth preserving across machines. */
    specialConventions: string;
}
/** Structured outcome of the opinion-judge LLM call. */
export interface JudgeVerdict {
    verdict: 'correct' | 'incorrect' | 'partially-correct' | 'non-subjective';
    /** 0..1 model confidence in the verdict. */
    confidence: number;
    /** Why the judge reached this verdict (against the user's note system). */
    reasoning: string;
    /** Direct advice to the user. */
    advice: string;
    /** Suggested vault folder for the note, if any. */
    suggestedFolder?: string;
    /** Suggested note title, if any. */
    suggestedTitle?: string;
    /** Concrete recommended recording location, e.g. `Projects/学习Obsidian.md`. */
    recommendedLocation?: string;
    /** Why that location was recommended. */
    recommendationReason?: string;
}
/** One follow-up question/answer pair inside a judgment thread. */
export interface JudgeThreadQA {
    q: string;
    a: string;
}
/** A judgment thread enabling continuous follow-up on the reasoning. */
export interface JudgeThread {
    /** Session id owning the thread. */
    sessionId: string;
    /** The original opinion, verbatim. */
    opinion: string;
    verdict: string;
    confidence: number;
    reasoning: string;
    advice: string;
    recommendedLocation?: string;
    qa: JudgeThreadQA[];
    at: string;
}
/** Runtime plugin configuration (defaults applied in `resolveConfig`). */
export interface NoteCoachConfig {
    /** Master switch. */
    enabled: boolean;
    /** Vault-relative path of the portable style profile. */
    styleFile: string;
    /** Days before volatile opinion memory is purged. */
    memoryRetentionDays: number;
    /** LLM selection for judge / report / style calls. */
    judge: {
        /** Exact model id; falls back to the calling agent's model. */
        model?: string;
        /** Provider route; falls back to the calling agent's provider. */
        provider?: string;
        temperature: number;
        maxTokens: number;
    };
    /** Contribute the auto-detect system-prompt hint + judge tool. */
    autoDetect: boolean;
    /** Enforce approval before every model-facing file rewrite. */
    approvalMode: boolean;
    /** Vault-relative directory for generated reports. */
    reportDir: string;
}
/** Shape of the volatile opinion ledger entry (purged on TTL). */
export interface OpinionMemoryEntry {
    /** ISO timestamp of the opinion. */
    at: string;
    /** The user's own words, kept short. */
    opinion: string;
    /** The verdict given at the time. */
    verdict: string;
}
/** Result of a note insertion. */
export interface NoteInsertion {
    /** Absolute path of the created file. */
    path: string;
    /** Folder the note landed in. */
    folder: string;
    /** The file's display title. */
    title: string;
}
