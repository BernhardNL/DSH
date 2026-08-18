import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MathConfig } from './types.js';

/** 插件自身根目录（lib/config.js → lib → 根），用于定位随插件的 .venv。 */
const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginPython = join(pluginRoot, '.venv', 'bin', 'python');

const defaults: MathConfig = {
  enabled: true,
  workDir: '.harness/math',
  pythonPath: existsSync(pluginPython) ? pluginPython : undefined,
  paperDir: '论文',
  formatReformatBlocks: 12,
  llm: {
    temperature: 0.3,
    maxTokens: 3000,
  },
};

export function resolveConfig(input?: unknown): MathConfig {
  const src = (input ?? {}) as Record<string, any>;
  const llm = { ...defaults.llm, ...(src.llm ?? {}) };
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : defaults.enabled,
    workDir: typeof src.workDir === 'string' ? src.workDir : defaults.workDir,
    pythonPath: typeof src.pythonPath === 'string' ? src.pythonPath : undefined,
    paperDir: typeof src.paperDir === 'string' ? src.paperDir : defaults.paperDir,
    formatReformatBlocks: typeof src.formatReformatBlocks === 'number' ? src.formatReformatBlocks : defaults.formatReformatBlocks,
    llm: {
      temperature: typeof llm.temperature === 'number' ? llm.temperature : defaults.llm.temperature,
      maxTokens: typeof llm.maxTokens === 'number' ? llm.maxTokens : defaults.llm.maxTokens,
    },
  };
}
