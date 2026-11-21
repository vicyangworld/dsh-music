import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : resolve(root, 'dist/echo-continuous-world.html');
const result = await build({ entryPoints: [resolve(root, 'src/preview/habitat-demo.jsx')], bundle: true, write: false, format: 'iife', minify: true, platform: 'browser', target: ['chrome110', 'safari16'], define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none' });
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = (await Promise.all(['ui', 'creature', 'habitat'].map(name => readFile(resolve(root, `src/client/echo/${name}.css`), 'utf8')))).join('\n');
const previewCSS = `
#echo-continuous-world{width:100%;min-width:0;color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;}
#echo-continuous-world *{box-sizing:border-box;}
#echo-continuous-world [data-echo-mount]{position:relative;min-width:0;height:640px;}
#echo-continuous-world .echo-demo-caption{padding:8px 12px;font-size:11px;line-height:1.5;color:light-dark(#5d6763,#bcc7c1);background:light-dark(#f2f5f3,#101a16);}
#echo-continuous-world .echo-demo-loading{margin:0;padding:80px 24px;background:light-dark(#edf1ee,#111b18);color:light-dark(#294235,#d5dfd8);}
#echo-continuous-world .echo-demo-utility{padding:24px;line-height:1.8;}
#echo-continuous-world .echo-demo-utility h2{font-size:22px;font-weight:500;}
#echo-continuous-world .echo-demo-utility button{font:inherit;color:inherit;min-height:44px;border:1px solid currentColor;border-radius:8px;background:transparent;padding:8px 14px;}
#echo-continuous-world .echo-modal-shade{position:absolute;}
`;
const template = await readFile(resolve(root, 'src/preview/habitat-fragment.html'), 'utf8');
const html = template.replace('/* ECHO_PREVIEW_CSS */', css + previewCSS).replace('/* ECHO_PREVIEW_SCRIPT */', script);
if (Buffer.byteLength(html) > 1024 * 1024) throw new Error('Conversation preview exceeds 1 MiB');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, html);
console.log(`Wrote actual-component interaction preview: ${output} (${Buffer.byteLength(html)} bytes). All adapters are local; audio is intentionally disabled.`);
