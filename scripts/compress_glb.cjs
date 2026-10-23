#!/usr/bin/env node
// GLB 压缩管线：导出纹理 → PIL 缩 1024（normal 留 PNG，其余 JPG q85，alpha 有意义的 PNG 保留）
//               → weld → meshopt simplify → draco
// 实测战绩：80~115MB → 1.9~2.3MB（ratio 0.3 / maxside 1024 / q85）
//
// 用法: node scripts/compress_glb.cjs <src.glb> <out.glb> [--texdir <dir>] [--ratio 0.3] [--maxside 1024] [--quality 85]
// 依赖: npm i（见 package.json）；python + Pillow（Windows 下 python 命令需可用）
//
// gltf-transform v4 铁律（本脚本已处理，改动前先读）：
//  - io.read 是 async
//  - 写 draco 必须 registerExtensions([KHRDracoMeshCompression]) + registerDependencies({'draco3d.encoder': ...})
//    （漏了 = 输出 15MB 未压缩或直接报错）
//  - 读 draco GLB 同理要注册 decoder
//  - getSceneVertexCount v4 有 bug（返回 undefined），只做 try/catch 日志
//  - 纹理处理用 PIL 不用 sharp：sharp 遇无色彩空间配置的 PNG 会崩（colourspace: parameter space not set）
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { NodeIO } = require('@gltf-transform/core');
const { KHRDracoMeshCompression } = require('@gltf-transform/extensions');
const { weld, simplify, draco, getSceneVertexCount, getBounds } = require('@gltf-transform/functions');
const { MeshoptSimplifier } = require('meshoptimizer');

const argv = process.argv.slice(2);
const pos = argv.filter((a) => !a.startsWith('--'));
const getOpt = (name, dft) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dft;
};
if (pos.length < 2) {
  console.error('用法: node scripts/compress_glb.cjs <src.glb> <out.glb> [--texdir dir] [--ratio 0.3] [--maxside 1024] [--quality 85]');
  process.exit(1);
}

const SRC = path.resolve(pos[0]);
const OUT = path.resolve(pos[1]);
const TEX_DIR = path.resolve(getOpt('texdir', OUT.replace(/\.glb$/i, '') + '_tex'));
const RATIO = parseFloat(getOpt('ratio', '0.3'));
const MAXSIDE = parseInt(getOpt('maxside', '1024'), 10);
const QUALITY = parseInt(getOpt('quality', '85'), 10);

if (!fs.existsSync(SRC)) {
  console.error('SRC 不存在:', SRC);
  process.exit(1);
}

(async () => {
  const draco3d = require('draco3dgltf');
  // 读写两边都要：源文件若是 draco 压过的，read 时要 decoder；write 时要 encoder
  const encoderModule = await draco3d.createEncoderModule({});
  const decoderModule = await draco3d.createDecoderModule({});
  const io = new NodeIO()
    .registerExtensions([KHRDracoMeshCompression])
    .registerDependencies({ 'draco3d.encoder': encoderModule, 'draco3d.decoder': decoderModule });
  const doc = await io.read(SRC);
  const root = doc.getRoot();
  const scene = root.getDefaultScene();

  // 纹理使用槽位映射（决定 JPG 还是 PNG）
  const slotOf = new Map(); // texture -> Set('baseColor'|'normal'|...)
  for (const m of root.listMaterials()) {
    const bc = m.getBaseColorTexture();
    if (bc) { if (!slotOf.has(bc)) slotOf.set(bc, new Set()); slotOf.get(bc).add('baseColor'); }
    const nm = m.getNormalTexture();
    if (nm) { if (!slotOf.has(nm)) slotOf.set(nm, new Set()); slotOf.get(nm).add('normal'); }
    const mr = m.getMetallicRoughnessTexture();
    if (mr) { if (!slotOf.has(mr)) slotOf.set(mr, new Set()); slotOf.get(mr).add('metallicRoughness'); }
    const ao = m.getOcclusionTexture();
    if (ao) { if (!slotOf.has(ao)) slotOf.set(ao, new Set()); slotOf.get(ao).add('occlusion'); }
    const em = m.getEmissiveTexture();
    if (em) { if (!slotOf.has(em)) slotOf.set(em, new Set()); slotOf.get(em).add('emissive'); }
  }

  fs.mkdirSync(TEX_DIR, { recursive: true });

  // 1) 导出原始纹理 + 写 PIL 清单
  const manifest = [];
  for (const [i, t] of root.listTextures().entries()) {
    const mime = t.getMimeType();
    const isPNG = mime === 'image/png';
    const name = (t.getName() || 'tex' + i).replace(/[^A-Za-z0-9_-]/g, '_');
    const fname = name + (isPNG ? '.png' : '.jpg');
    fs.writeFileSync(path.join(TEX_DIR, fname), t.getImage());
    manifest.push({ idx: i, name, fname, mime, slots: [...(slotOf.get(t) || new Set())] });
  }
  console.log('纹理清单:');
  for (const m of manifest) console.log(' ', m.fname, m.mime, 'slots=', m.slots.join(','));

  // 2) PIL 处理：>maxside 缩到 maxside；normal 留 PNG；baseColor 等 PNG→JPG（alpha 有意义的保留 PNG）
  const py = `
import json, sys, os
from PIL import Image
TEX_DIR = sys.argv[1]
MAXSIDE = int(sys.argv[2])
QUALITY = int(sys.argv[3])
manifest = json.load(open(os.path.join(TEX_DIR, 'manifest.json'), encoding='utf-8'))
out = []
for item in manifest:
    p = os.path.join(TEX_DIR, item['fname'])
    im = Image.open(p)
    im.load()
    w, h = im.size
    mode = im.mode
    # alpha 是否有意义（RGBA/LA/P 带 transparency 且 alpha 不全 255）
    has_alpha = mode in ('RGBA', 'LA') or (mode == 'P' and 'transparency' in im.info)
    if has_alpha:
        a = im.getchannel('A')
        if a.getextrema() == (255, 255):
            has_alpha = False
    maxside = max(w, h)
    if maxside > MAXSIDE:
        ratio = MAXSIDE / maxside
        im = im.resize((max(1, round(w * ratio)), max(1, round(h * ratio))), Image.LANCZOS)
    slots = item['slots']
    keep_png = 'normal' in slots or has_alpha
    if keep_png:
        newname = item['name'] + '_%d.png' % MAXSIDE
        im.save(os.path.join(TEX_DIR, newname), 'PNG')
    else:
        if im.mode in ('RGBA', 'LA', 'P'):
            im = im.convert('RGB')
        newname = item['name'] + '_%d.jpg' % MAXSIDE
        im.save(os.path.join(TEX_DIR, newname), 'JPEG', quality=QUALITY, optimize=True)
    out.append({'idx': item['idx'], 'file': newname, 'mime': 'image/png' if keep_png else 'image/jpeg'})
json.dump(out, open(os.path.join(TEX_DIR, 'resized.json'), 'w'))
print('resized', len(out), 'textures')
`;
  fs.writeFileSync(path.join(TEX_DIR, 'manifest.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(TEX_DIR, 'resize.py'), py);
  const res = execFileSync('python', [path.join(TEX_DIR, 'resize.py'), TEX_DIR, String(MAXSIDE), String(QUALITY)], { encoding: 'utf8' });
  console.log('PIL 输出:', res.trim());

  // 3) 回填纹理
  const resized = JSON.parse(fs.readFileSync(path.join(TEX_DIR, 'resized.json'), 'utf8'));
  const texs = root.listTextures();
  for (const r of resized) {
    const t = texs[r.idx];
    t.setImage(fs.readFileSync(path.join(TEX_DIR, r.file)));
    t.setMimeType(r.mime);
  }

  // 4) 几何优化
  const vcount = () => { try { return getSceneVertexCount(scene); } catch { return '?'; } };
  console.log('原始顶点:', vcount());
  const bb0 = getBounds(scene);
  console.log('原始 bbox 尺寸:', bb0.max.map((v, i) => (v - bb0.min[i]).toFixed(3)).join(' × '));

  await doc.transform(weld());
  await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: RATIO, error: 0.001 }));
  await doc.transform(draco());

  console.log('压缩后顶点:', vcount());
  const bb1 = getBounds(scene);
  console.log('压缩后 bbox 尺寸:', bb1.max.map((v, i) => (v - bb1.min[i]).toFixed(3)).join(' × '));

  await io.write(OUT, doc);
  const sz = fs.statSync(OUT).size;
  console.log('输出:', OUT, (sz / 1024 / 1024).toFixed(2) + 'MB');

  // 自检
  if (sz > 8 * 1024 * 1024) {
    console.warn('⚠️ 输出 > 8MB：draco 大概率没生效，检查 registerExtensions/registerDependencies');
  }
  const shrinks = bb0.max.map((v, i) => (v - bb0.min[i]) / Math.max(1e-6, bb1.max[i] - bb1.min[i]));
  if (shrinks.some((r) => r > 1.1 || r < 0.9)) {
    console.warn('⚠️ 压缩前后 bbox 差异 >10%：几何可能损坏，核对上面两行尺寸');
  }
})().catch((e) => { console.error('ERR:', e); process.exit(1); });
