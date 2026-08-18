/** Model-facing file tools that rewrite files. */
const WRITE_TOOLS = new Set(['write', 'edit']);
/**
 * Write-approval guard: every model-facing file rewrite (`write` / `edit`)
 * is routed through the approval seam before it may execute. Returning
 * `{ kind: 'ask' }` from `tools/pre-execute` makes the tools pipeline ask the
 * user automatically; a rejected call never reaches the tool body.
 *
 * Plugin-internal writes (note insertion, style profile, reports) go through
 * the fs provider directly and are NOT model-facing tool calls, so they are
 * not re-prompted — the user already approved those actions explicitly.
 */
export function installWriteGuard(ctx, config) {
    if (!config.approvalMode)
        return () => undefined;
    return ctx.on('tools/pre-execute', async (exec, next) => {
        if (WRITE_TOOLS.has(exec.name)) {
            const args = exec.arguments;
            const file = args?.file_path ? `（${args.file_path}）` : '';
            return {
                kind: 'ask',
                reason: `笔记插件强制要求：写入文件 ${file} 前需你确认`,
            };
        }
        return next();
    });
}
