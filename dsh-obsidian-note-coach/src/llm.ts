import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm';
import type { NoteCoachConfig } from './types.js';

/** One-shot LLM call configuration (model/provider may fall back to the agent). */
export interface LlmTarget {
  provider?: string;
  model?: string;
  temperature: number;
  maxTokens: number;
}

/** Resolve the effective provider/model for one call, falling back to the agent. */
export function resolveLlmTarget(
  config: NoteCoachConfig,
  agent: Agent | undefined,
): { provider: string; model: string } {
  const provider = config.judge.provider ?? agent?.options.provider;
  const model = config.judge.model ?? agent?.options.model;
  if (!provider || !model) {
    throw new Error(
      'note-coach: no provider/model configured for judge calls and none resolvable from the agent',
    );
  }
  return { provider, model };
}

/**
 * Run one streaming completion and return the assembled plain text.
 * Used for judge, style-profile, report, and note-generation calls.
 */
export async function completeText(
  ctx: Context,
  agent: Agent | undefined,
  target: LlmTarget,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<string> {
  const { provider, model } = resolveLlmTarget(
    { ...emptyConfig, judge: { temperature: target.temperature, maxTokens: target.maxTokens, model: target.model, provider: target.provider } },
    agent,
  );
  const assembler = new BlockAssembler();
  const userMessage = createUserMessage({
    content: [{ type: 'text', text: user }],
    source: { kind: 'user' },
  });
  for await (const chunk of ctx.llm.stream({
    provider,
    model,
    system,
    messages: [userMessage],
    temperature: target.temperature,
    maxTokens: target.maxTokens,
    signal,
  })) {
    assembler.push(chunk);
  }
  return assembler
    .blocks()
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

const emptyConfig: NoteCoachConfig = {
  enabled: true,
  styleFile: '.harness/notes-style.json',
  memoryRetentionDays: 7,
  judge: { temperature: 0.3, maxTokens: 2000 },
  autoDetect: true,
  approvalMode: true,
  reportDir: '.harness/reports',
};

/** Parse a JSON object out of an LLM answer that may be wrapped in prose/code fences. */
export function extractJson<T>(text: string): T | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Fall back to the first balanced {...} span.
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
