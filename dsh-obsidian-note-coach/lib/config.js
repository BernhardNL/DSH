/** Defaults for every config key. */
const defaults = {
    enabled: true,
    styleFile: '.harness/notes-style.json',
    memoryRetentionDays: 7,
    judge: {
        temperature: 0.3,
        maxTokens: 2000,
    },
    autoDetect: true,
    approvalMode: true,
    reportDir: '.harness/reports',
};
/**
 * Merge a partial input config over the defaults. The loader may pass any
 * subset; unknown keys are ignored so a future plugin version stays
 * backward compatible with older stored configs.
 */
export function resolveConfig(input) {
    const src = (input ?? {});
    const judge = { ...defaults.judge, ...(src.judge ?? {}) };
    return {
        enabled: typeof src.enabled === 'boolean' ? src.enabled : defaults.enabled,
        styleFile: typeof src.styleFile === 'string' ? src.styleFile : defaults.styleFile,
        memoryRetentionDays: typeof src.memoryRetentionDays === 'number'
            ? src.memoryRetentionDays
            : defaults.memoryRetentionDays,
        judge: {
            model: typeof judge.model === 'string' ? judge.model : undefined,
            provider: typeof judge.provider === 'string' ? judge.provider : undefined,
            temperature: typeof judge.temperature === 'number' ? judge.temperature : defaults.judge.temperature,
            maxTokens: typeof judge.maxTokens === 'number' ? judge.maxTokens : defaults.judge.maxTokens,
        },
        autoDetect: typeof src.autoDetect === 'boolean' ? src.autoDetect : defaults.autoDetect,
        approvalMode: typeof src.approvalMode === 'boolean' ? src.approvalMode : defaults.approvalMode,
        reportDir: typeof src.reportDir === 'string' ? src.reportDir : defaults.reportDir,
    };
}
