#!/usr/bin/env node
// 顶点分布分析 —— 朝向判定的几何证据（不渲染、不截图、不调 API）
//
// 用法: node scripts/vertex_analyze.mjs <model.glb> [--bins 12] [--layers 8] [--zup]
//
// 输出四样东西：
//  1. 三轴范围 + ASCII 直方图（哪根轴最长、顶点怎么分布）
//  2. 最长轴两端密度（床头板启发：有靠背一端顶点更密、更高）
//  3. 分高度层 X/Z 极值（贴沿检测：床头板比基座窄时，上层 X 范围会收窄）
//  4. 解读提示
//
// 原理：遍历场景图，把 POSITION 顶点乘上节点世界矩阵 → 世界坐标统计。
// 节点自带的旋转（图生3D 常见 Z-up→Y-up 烘焙）会被世界矩阵自然吸收，无需手动换算；
// 只有当矩阵没烘焙、顶点数据本身是 Z-up 时才加 --zup（手动换算 X=x, Y=-z, Z=y）。
import fs from 'fs';
import path from 'path';
import { NodeIO } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';

const argv = process.argv.slice(2);
const pos = argv.filter((a) => !a.startsWith('--'));
const getOpt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
if (!pos[0]) {
  console.error('用法: node scripts/vertex_analyze.mjs <model.glb> [--bins 12] [--layers 8] [--zup]');
  process.exit(1);
}
const SRC = path.resolve(pos[0]);
const BINS = parseInt(getOpt('bins', '12'), 10);
const LAYERS = parseInt(getOpt('layers', '8'), 10);
const ZUP = argv.includes('--zup');

if (!fs.existsSync(SRC)) { console.error('文件不存在:', SRC); process.exit(1); }

// ---- 读 GLB（draco 注册 decoder）----
const draco3d = (await import('draco3dgltf')).default ?? (await import('draco3dgltf'));
const decoderModule = await draco3d.createDecoderModule({});
const io = new NodeIO()
  .registerExtensions([KHRDracoMeshCompression])
  .registerDependencies({ 'draco3d.decoder': decoderModule });
const doc = await io.read(SRC);
const scene = doc.getRoot().getDefaultScene();
if (!scene) { console.error('模型没有默认 scene'); process.exit(1); }

// ---- 矩阵工具（列主序 4×4，与 glTF/three 一致；gltf-transform 不导出 Mat4 类，手写）----
const mul = (A, B) => {
  const C = new Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += A[k * 4 + r] * B[c * 4 + k];
    C[c * 4 + r] = s;
  }
  return C;
};
const apply = (M, x, y, z) => ([
  M[0] * x + M[4] * y + M[8] * z + M[12],
  M[1] * x + M[5] * y + M[9] * z + M[13],
  M[2] * x + M[6] * y + M[10] * z + M[14]
]);

// ---- 收集世界坐标顶点 ----
const pts = [];
let primCount = 0;
const walk = (node, parent) => {
  const world = parent ? mul(parent, node.getMatrix()) : node.getMatrix();
  const mesh = node.getMesh();
  if (mesh) {
    for (const prim of mesh.listPrimitives()) {
      const acc = prim.getAttribute('POSITION');
      if (!acc) continue;
      primCount++;
      const arr = acc.getArray();
      for (let i = 0; i < arr.length; i += 3) {
        let [x, y, z] = apply(world, arr[i], arr[i + 1], arr[i + 2]);
        if (ZUP) { const ny = -z; const nz = y; y = ny; z = nz; }
        pts.push(x, y, z);
      }
    }
  }
  for (const c of node.listChildren()) walk(c, world);
};
for (const root of scene.listChildren()) walk(root, null);

const N = pts.length / 3;
if (N === 0) { console.error('没找到任何 POSITION 顶点'); process.exit(1); }
console.log(`模型: ${path.basename(SRC)}  顶点: ${N}  primitive: ${primCount}${ZUP ? '  (--zup 已应用)' : ''}`);

// ---- 三轴统计 ----
const axes = ['X', 'Y', 'Z'];
const stat = [0, 1, 2].map(() => ({ min: Infinity, max: -Infinity, sum: 0 }));
for (let i = 0; i < pts.length; i += 3) {
  for (let k = 0; k < 3; k++) {
    const v = pts[i + k];
    if (v < stat[k].min) stat[k].min = v;
    if (v > stat[k].max) stat[k].max = v;
    stat[k].sum += v;
  }
}
console.log('\n=== 三轴范围（世界坐标，单位与模型一致）===');
stat.forEach((s, k) => {
  const size = s.max - s.min;
  console.log(`${axes[k]}: ${s.min.toFixed(3)} ~ ${s.max.toFixed(3)}  跨度 ${size.toFixed(3)}  均值 ${(s.sum / N).toFixed(3)}`);
});
const sizes = stat.map((s) => s.max - s.min);
const longest = sizes.indexOf(Math.max(...sizes));
console.log(`最长轴: ${axes[longest]}（${sizes[longest].toFixed(3)}）`);

// ---- ASCII 直方图 ----
console.log(`\n=== ${axes[longest]} 轴直方图（${BINS} 桶）===`);
{
  const s = stat[longest];
  const bins = new Array(BINS).fill(0);
  const w = (s.max - s.min) / BINS || 1;
  for (let i = 0; i < pts.length; i += 3) {
    const b = Math.min(BINS - 1, Math.floor((pts[i + longest] - s.min) / w));
    bins[b]++;
  }
  const peak = Math.max(...bins);
  bins.forEach((c, i) => {
    const bar = '█'.repeat(Math.round((c / peak) * 40));
    const lo = (s.min + i * w).toFixed(2);
    const hi = (s.min + (i + 1) * w).toFixed(2);
    console.log(`${axes[longest]}[${lo}~${hi}] ${String(c).padStart(7)} ${bar}`);
  });
}

// ---- 最长轴两端密度（床头板启发）----
console.log('\n=== 最长轴两端密度（床头板启发：密+高的一侧更可能有靠背）===');
{
  const s = stat[longest];
  const span = s.max - s.min;
  const quarter = span * 0.25;
  let lo = 0, hi = 0;
  const other = [0, 1, 2].filter((k) => k !== longest);
  let loY = 0, hiY = 0; // 两端的平均高度
  for (let i = 0; i < pts.length; i += 3) {
    const v = pts[i + longest];
    if (v < s.min + quarter) { lo++; loY += pts[i + 1]; }
    if (v > s.max - quarter) { hi++; hiY += pts[i + 1]; }
  }
  console.log(`${axes[longest]} 低侧 [${s.min.toFixed(2)}~${(s.min + quarter).toFixed(2)}]: ${lo} 顶点, 平均高 ${(loY / Math.max(1, lo)).toFixed(3)}`);
  console.log(`${axes[longest]} 高侧 [${(s.max - quarter).toFixed(2)}~${s.max.toFixed(2)}]: ${hi} 顶点, 平均高 ${(hiY / Math.max(1, hi)).toFixed(3)}`);
  const denseSide = lo > hi ? '低侧' : '高侧';
  console.log(`→ 密集端: ${axes[longest]} ${denseSide}（若这是床/沙发，靠背大概率在这一侧）`);
}

// ---- 分高度层 X/Z 极值（贴沿检测）----
console.log(`\n=== 分 ${LAYERS} 层 X/Z 极值（贴沿检测：上层比下层窄 = 有内收部件如床头板）===`);
{
  const yMin = stat[1].min, yMax = stat[1].max;
  const h = (yMax - yMin) / LAYERS || 1;
  for (let L = 0; L < LAYERS; L++) {
    const lo = yMin + L * h, hi = lo + h;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, c = 0;
    for (let i = 0; i < pts.length; i += 3) {
      const y = pts[i + 1];
      if (y < lo || y >= hi) continue;
      c++;
      if (pts[i] < x0) x0 = pts[i];
      if (pts[i] > x1) x1 = pts[i];
      if (pts[i + 2] < z0) z0 = pts[i + 2];
      if (pts[i + 2] > z1) z1 = pts[i + 2];
    }
    if (!c) { console.log(`Y[${lo.toFixed(2)}~${hi.toFixed(2)}]: (空)`); continue; }
    console.log(`Y[${lo.toFixed(2)}~${hi.toFixed(2)}] n=${String(c).padStart(6)}  X[${x0.toFixed(2)}, ${x1.toFixed(2)}] 宽 ${(x1 - x0).toFixed(2)}  Z[${z0.toFixed(2)}, ${z1.toFixed(2)}] 深 ${(z1 - z0).toFixed(2)}`);
  }
}

// ---- 解读提示 ----
console.log(`
=== 解读提示 ===
· 有靠背/床头板的一侧 = 顶点更密 + 平均高度更高的那端（对照上面两端密度）
· 贴墙/贴家具时，用目标高度层的 X/Z 极值，别用整体 bbox（上层收窄就是床头板信号）
· 图生3D 模型正面经验值 = +Z；几何证据和视觉截图（cdp_shot + vl_orient_check）交叉验证
· 视觉模型只信"哪张图看到正面"，坐标轴结论直接忽略
· 场景页里记得放 ?xflip=1 翻转兜底参数，朝向错了不用改代码`);
