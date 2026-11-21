import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await build({
  entryPoints: [resolve(root, 'src/client/index.js')],
  outfile: resolve(root, 'bundle/client/index.js'),
  bundle: true,
  format: 'iife',
  target: ['chrome110', 'safari16'],
  loader: { '.css': 'text' },
  minify: false,
  legalComments: 'inline',
  banner: { js: '/* Generated from src/client/index.js. Run npm run build. React is provided by Harness. */' },
});
console.log('Built the self-contained Harness client.');
