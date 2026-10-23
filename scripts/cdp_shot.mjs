#!/usr/bin/env node
// CDP 单页截图：连 headless Edge/Chrome（默认 :9333）→ 打开验证页（默认 model_view.html）
//               → 等 title 出现 READY / FAIL → 截图
//
// 用法: node scripts/cdp_shot.mjs <yaw> <pitch> <out.png> <模型.glb> [页面名] [CDP端口]
//   例: node scripts/cdp_shot.mjs 90 20 _shots/yaw90.png 家具_med.glb
//
// 前置: node scripts/serve_local.js <站点根> 8921  +  headless Edge --remote-debugging-port=9333
//
// ⚠️ 页面名收纯文件名（Git Bash 会把 /xxx 参数转成 Windows 路径），脚本自动补前缀 /
// ⚠️ 不复用已有 tab：/json/list 的第一个 page 可能是 Tampermonkey 等无关页，一律 PUT /json/new
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const yaw = process.argv[2] || '0';
const pitch = process.argv[3] || '20';
const out = process.argv[4] || `_shots/yaw${yaw}.png`;
const model = process.argv[5] || 'model_med.glb';
const page = '/' + (process.argv[6] || 'model_view.html').replace(/^[/\\]+/, '');
const PORT = parseInt(process.env.CDP_PORT || process.argv[7] || '9333', 10);
const SRV = parseInt(process.env.SRV_PORT || '8921', 10);

mkdirSync(path.dirname(out), { recursive: true });

// PUT /json/new 开专用 tab
const nr = await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' });
if (!nr.ok) { console.error('CDP 连不上 :'+PORT+'（headless Edge/Chrome 起了吗）'); process.exit(1); }
const target = await nr.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const send = (method, params = {}) => new Promise((res, rej) => {
  const i = ++id;
  pend.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, method, params }));
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id).res(m.result); pend.delete(m.id); }
};
await new Promise((r) => { ws.onopen = r; });

await send('Page.enable');
await send('Runtime.enable');
const url = 'http://127.0.0.1:' + SRV + page
  + '?yaw=' + yaw + '&pitch=' + pitch + '&model=' + encodeURIComponent(model) + '&fresh=' + Date.now();
await send('Page.navigate', { url });

// 等 title 含 READY / FAIL（model_view.html 约定）
let title = '';
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const r = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
  title = r.result?.value || '';
  if (title.includes('READY') || title.includes('FAIL')) break;
}
console.log('title:', title);
await new Promise((r) => setTimeout(r, 400));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('saved', out);
if (title.includes('FAIL')) { console.error('⚠️ 模型加载失败'); process.exit(1); }
ws.close();
process.exit(0);
