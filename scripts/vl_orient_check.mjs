#!/usr/bin/env node
// 视觉模型朝向复核 —— SiliconFlow Qwen3-VL 看四角度截图，判断哪张是正面
//
// 用法（bash）:
//   SF_KEY=sk-xxx node scripts/vl_orient_check.mjs \
//     --ref 参考图.jpg --object 床 \
//     --shot 0:_shots/yaw0.png --shot 90:_shots/yaw90.png \
//     --shot 180:_shots/yaw180.png --shot 270:_shots/yaw270.png
//
// ⚠️ 铁律：只信「哪张图看到正面」这个选择题答案。
//    视觉模型给出的坐标轴推断（"所以正面是+X"）经常是错的，直接忽略。
//    几何证据用 vertex_analyze.mjs，两边交叉验证。
//
// SF_KEY 走环境变量，别写进文件/提交进仓库。
import fs from 'fs';
import path from 'path';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : undefined; };
const opts = (n) => argv.reduce((acc, a, i) => (a === '--' + n ? [...acc, argv[i + 1]] : acc), []);

const SF_KEY = process.env.SF_KEY || opt('key');
const REF = opt('ref');
const OBJ = opt('object') || '家具';
const shots = opts('shot').map((s) => {
  const i = s.indexOf(':');
  return { yaw: s.slice(0, i), file: s.slice(i + 1) };
});

if (!SF_KEY) { console.error('缺 SF_KEY（环境变量，SiliconFlow API key）'); process.exit(1); }
if (!REF || !fs.existsSync(REF)) { console.error('缺 --ref 参考图 或文件不存在'); process.exit(1); }
if (!shots.length) { console.error('至少一个 --shot yaw:文件.png'); process.exit(1); }
for (const s of shots) if (!fs.existsSync(s.file)) { console.error('截图不存在:', s.file); process.exit(1); }

const b64 = (f) => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');

const userContent = [
  { type: 'text', text: `这是一张「${OBJ}」的参考照片（真实外观）。` },
  { type: 'image_url', image_url: { url: b64(REF) } },
  { type: 'text', text: '下面是同一个 3D 模型在四个不同相机角度下的渲染截图：\n'
    + shots.map((s) => `【角度 yaw=${s.yaw}°】`).join('\n') + '\n\n请逐张对照参考照片判断。' },
  ...shots.flatMap((s) => [
    { type: 'text', text: `角度 yaw=${s.yaw}°：` },
    { type: 'image_url', image_url: { url: b64(s.file) } }
  ]),
  { type: 'text', text: '只回答两个问题：\n'
    + '1) 哪几张截图能看到这个' + OBJ + '的正面（朝向使用者的那一面）？给出角度列表。\n'
    + '2) 参考照片里' + OBJ + '的正面特征是什么（如靠背、把手、屏幕）？\n'
    + '不要分析坐标轴，不要推断 +X/+Z 方向。' }
];

const resp = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SF_KEY },
  body: JSON.stringify({
    model: 'Qwen/Qwen3-VL-32B-Instruct',
    max_tokens: 1000,
    messages: [{ role: 'user', content: userContent }]
  })
});
if (!resp.ok) {
  console.error('API', resp.status, await resp.text());
  process.exit(1);
}
const data = await resp.json();
const text = data.choices?.[0]?.message?.content || '';
console.log('\n=== Qwen3-VL 判定 ===\n' + text);
console.log('\n⚠️ 只取「哪张图看到正面」的结论；坐标轴推断一律忽略。');
console.log('📌 落地前还要过 vertex_analyze.mjs 几何证据，两边一致才动手放置。');
