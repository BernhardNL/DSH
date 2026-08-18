/**
 * Build the client (browser) bundle in the DSH client-module format:
 * `window.__ModuleLoader__.load({ id, factory })`, factory-form CJS.
 * React and UI primitives stay external — the shell's module table provides
 * them, so the plugin shares the same React instance as the app.
 * marked + katex are BUNDLED (the shell does not expose a markdown/math
 * renderer); KaTeX's CSS and fonts are inlined so the bundle is fully
 * self-contained.
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Inline KaTeX CSS with fonts as data URLs so the math renders everywhere.
const katexCss = readFileSync('node_modules/katex/dist/katex.min.css', 'utf8');
const katexCssInlined = katexCss.replace(/url\(([^)]+?\.(?:woff2?|ttf))\)/g, (_match, path) => {
  const clean = path.replace(/^\.\//, '').replace(/^fonts\//, '');
  const data = readFileSync(`node_modules/katex/dist/fonts/${clean}`).toString('base64');
  return `url(data:font/woff2;base64,${data})`;
});

const result = await build({
  entryPoints: ['src/client/index.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  jsx: 'automatic',
  external: [
    'react',
    'react/jsx-runtime',
    'react-dom',
    '@deepseek-ai/dsh-client-ui-primitives',
  ],
  define: {
    __KATEX_CSS__: JSON.stringify(katexCssInlined),
  },
  write: false,
  logLevel: 'info',
});

const code = result.outputFiles[0].text;
const wrapped = `window.__ModuleLoader__.load({
\tid: "dsh-math-assistant",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${code}
\t\treturn module.exports;
\t}
});
`;

mkdirSync('lib', { recursive: true });
writeFileSync('lib/client.js', wrapped);
console.log(`client bundle written: lib/client.js (${(wrapped.length / 1024).toFixed(0)} KiB)`);
