#!/usr/bin/env node
// CDP 页面级验证：新开 tab → 加载页面 → 轮询 #loading 出现 'hide' 类 → 收集 console → 截图
//
// 用法: node scripts/cdp_page_test.mjs <页面.html> <out.png> [CDP端口=9333]
//   例: node scripts/cdp_page_test.mjs walk_test.html _shots/check.png
//
// 页面契约（按你的场景页改）：
//  - 页面有 id="loading" 的加载遮罩，加载完成后 className 含 'hide'（类名，不是 display）
//  - serve_local.js 在 :8921 跑着（SRV_PORT 可改），页面从站点根取
//
// ⚠️ 页面名收纯文件名（Git Bash 会把 /xxx 参数转成 Windows 路径），脚本自动补前缀 /
// ⚠️ 一律 PUT /json/new 开专用 tab（/json/list 首个 page 可能是无关页）
import fs from 'fs';
import path from 'path';

const PAGE_ARG = process.argv[2] || 'walk_test.html';
const OUT = process.argv[3] || '_shots/check.png';
const PORT = parseInt(process.env.CDP_PORT || '9333', 10);
const SRV = parseInt(process.env.SRV_PORT || '8921', 10);
const PAGE = '/' + PAGE_ARG.replace(/^[/\\]+/, '');
// Git Bash 兼容：/xxx 被转成 C:\xxx 之类的怪路径时，退回纯文件名
const PAGE_CLEAN = PAGE.replace(/^\/[A-Za-z]:[/\\]/, '/');

const nr = await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' });
if (!nr.ok) { console.error('CDP 连不上 :' + PORT + '（headless Edge/Chrome 起了吗）'); process.exit(1); }
const target = await nr.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pend = new Map();
const consoleMsgs = [];
const send = (m, p = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, { r, j }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id).r(m.result); pend.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') {
    const args = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    consoleMsgs.push('[' + m.params.type + '] ' + args);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    consoleMsgs.push('[EXCEPTION] ' + (m.params.exceptionDetails?.exception?.description || '?'));
  }
};
await new Promise((r) => { ws.onopen = r; });
await send('Page.enable');
await send('Runtime.enable');
const url = 'http://127.0.0.1:' + SRV + PAGE_CLEAN + '?fresh=' + Date.now();
console.log('navigating:', url);
await send('Page.navigate', { url });

let state = 'timeout';
for (let i = 0; i < 240; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const r = await send('Runtime.evaluate', {
    expression: "document.title + '|' + (document.getElementById('loading') ? document.getElementById('loading').className : 'nopage')",
    returnByValue: true
  });
  const v = r.result?.value ?? '(undefined)';
  if (i < 6 || i % 20 === 0) console.log('poll', ((i + 1) / 2) + 's:', v);
  if (v.includes('hide')) { state = 'ready'; break; }
  if (v.includes('LOAD_FAIL')) { state = 'load-fail'; break; }
  if (consoleMsgs.some((m) => m.includes('EXCEPTION'))) { state = 'exception'; break; }
}
console.log('状态:', state);
await new Promise((r) => setTimeout(r, 3000));

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('截图:', OUT);
console.log('--- console（后60条）---');
consoleMsgs.slice(-60).forEach((m) => console.log(m.slice(0, 300)));
ws.close();
process.exit(state === 'ready' ? 0 : 1);
