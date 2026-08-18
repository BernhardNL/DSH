import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';

/** 解析有效 provider/model（跟随会话默认）。 */
export function resolveLlmTarget(
  agent: Agent | undefined,
): { provider: string; model: string } {
  const provider = agent?.options.provider;
  const model = agent?.options.model;
  if (!provider || !model) {
    throw new Error('math-assistant: 无法从会话解析 provider/model');
  }
  return { provider, model };
}

/** 一次流式补全，返回纯文本。 */
export async function completeText(
  ctx: Context,
  agent: Agent | undefined,
  system: string,
  user: string,
  opts: { temperature?: number; maxTokens?: number } = {},
  signal?: AbortSignal,
): Promise<string> {
  const { provider, model } = resolveLlmTarget(agent);
  const baseMaxTokens = opts.maxTokens ?? 3000;
  let text = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const assembler = new BlockAssembler();
    // 大 prompt 是空响应高发场景：重试时先截断再追加"敲打"提示。
    let body = attempt === 0 ? user : user;
    if (attempt > 0 && body.length > 6000) body = body.slice(0, 6000) + '\n…（已截断）';
    if (attempt > 0) body += '\n\n（注意：上一次尝试没有输出文本。请务必以纯文本形式输出完整回答，不要调用任何工具，不要只输出思考过程。）';
    const userMessage = createUserMessage({
      content: [{ type: 'text', text: body }],
      source: { kind: 'user' },
    });
    // 推理模型可能把输出预算吃在推理上：重试时逐步提高预算，给正文留空间。
    const effMax = Math.min(Math.ceil(baseMaxTokens * (1 + attempt * 0.6)), 8000);
    for await (const chunk of ctx.llm.stream({
      provider,
      model,
      system,
      messages: [userMessage],
      temperature: opts.temperature ?? 0.3,
      maxTokens: effMax,
      signal,
    })) {
      assembler.push(chunk);
    }
    text = assembler
      .blocks()
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();
    if (text) break; // 偶发空输出：提高预算并换提示重试
  }
  return text;
}

/** 从 LLM 输出中提取 JSON 对象（容忍围栏/散文包裹）。 */
export function extractJson<T>(text: string): T | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
