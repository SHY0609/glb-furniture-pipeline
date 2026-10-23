---
name: glb-furniture-pipeline
description: 将 AI 图生3D 或外部下载的 GLB 家具模型接入 three.js 网页场景的完整管线：gltf-transform 压缩（80MB→2MB）、顶点分箱+VL 视觉双路朝向验证、bbox 定位摆放、本地 Edge CDP 无头验证、部署上线。当用户要求接入家具、导入 GLB 模型、图生3D 模型落地上网、模型太大加载慢、家具朝向不对、在 three.js 场景里放置 3D 模型时使用。
---

# GLB 家具接入管线

把一件 GLB 家具从"下载来的原始模型"变成"网页场景里摆好的家具"。8 件家具实战跑通，单件 80~115MB → 1.9~2.3MB（约 -97%），手机端可加载。

## 前置条件

- Node ≥ 18（脚本用原生 `fetch` / `WebSocket`，无需额外依赖）
- 本 skill 目录 `npm i`（gltf-transform 4.4.2 + meshoptimizer + draco3dgltf，版本均为实战验证值）
- python + Pillow（`PIL`，压缩脚本处理纹理）
- 本地有 Edge 或 Chrome 可 `--headless`（验证全在本地做；**服务器上的 CDP Chromium 通常禁了 WebGL，不能验 3D**）
- 一个已有的 three.js 场景页（下文称"场景页"），以及一份本地 three.js 库拷贝（见 ⑤）

## 六步管线（按序执行，别跳步）

### ① 压缩：80~115MB → ~2MB

```bash
node scripts/compress_glb.cjs 家具.glb 家具_med.glb
# 可选：--texdir 自定义纹理目录 --ratio 0.3 --maxside 1024 --quality 85
```

管线：导出纹理 → PIL 缩到 1024（normal 留 PNG、其余 JPG q85、alpha 有意义的 PNG 保留）→ weld → meshopt simplify 0.3 → draco。

要点（脚本已处理，改代码时别改掉）：

- gltf-transform v4：`io.read` 是 **async**；写 draco **必须** `registerExtensions([KHRDracoMeshCompression])` + `registerDependencies({'draco3d.encoder': ...})`（漏了 = 输出 15MB 未压缩或直接报错）；**读** draco GLB 同理要注册 decoder
- `getSceneVertexCount` 在 v4 有 bug（返回 undefined），只做 try/catch 日志用
- 纹理处理用 **PIL 不用 sharp**——sharp 遇无色彩空间配置的 PNG 会崩（`colourspace: parameter space not set`）
- 输出 > 8MB 就大声警告：draco 大概率没生效
- 压缩后 bbox 必须和压缩前基本一致（simplify 允许毫米级收缩）；尺寸对不上说明模型有问题

### ② 朝向验证：双路交叉，别只信视觉模型

**路 A · 顶点分布分析（几何证据，零成本）**：

```bash
node scripts/vertex_analyze.mjs 家具_med.glb
# 输出：三轴直方图、最长轴及两端密度（床头板启发）、分高度层 X/Z 极值（贴沿检测）
```

**路 B · VL 视觉四角度（需要 API）**：

```bash
node scripts/serve_local.js .. &        # 在 skill 目录跑：把上级目录当站点根，:8921
# 把 model_view.html 和模型放到站点根（或用 --root 指定）
node scripts/cdp_shot.mjs 0 20 _shots/yaw0.png 家具_med.glb
node scripts/cdp_shot.mjs 90 20 _shots/yaw90.png 家具_med.glb
node scripts/cdp_shot.mjs 180 20 _shots/yaw180.png 家具_med.glb
node scripts/cdp_shot.mjs 270 20 _shots/yaw270.png 家具_med.glb
SF_KEY=sk-xxx node scripts/vl_orient_check.mjs --ref 正面参考.jpg --object 床 \
  --shot 0:_shots/yaw0.png --shot 90:_shots/yaw90.png \
  --shot 180:_shots/yaw180.png --shot 270:_shots/yaw270.png
```

- 🔥 **只取 VL 说的"哪张图看到了正面/抽屉/床头"，别信它给的坐标轴结论**——视觉模型空间推理经常自相矛盾（说过 "yaw=0 可见正面" 却下结论 "+X 是正面"）
- **经验值：图生 3D 模型正面 = +Z**（沙发/床/边桌多件一致）；两路证据打架时以用户实测为准
- 所有家具在场景页放 `?xflip=1` 之类的翻转兜底参数，朝向错了不用改代码

### ③ 定位摆放：放置块模板

```js
const f = gltf.scene;
const b0 = new THREE.Box3().setFromObject(f);          // 先量原生 bbox
const s0 = b0.getSize(new THREE.Vector3());
f.scale.set(目标宽 / s0.x, 目标高 / s0.y, 目标深 / s0.z); // 非等比缩放
if (QS.has('xflip')) f.rotateY(Math.PI);                // 朝向兜底参数
f.updateMatrixWorld(true);                              // ⚠️ 必须先旋转/缩放再测量
const b1 = new THREE.Box3().setFromObject(f);           // 再量
const c1 = b1.getCenter(new THREE.Vector3());
f.position.set(目标X - c1.x, 0 - b1.min.y, 目标Z - c1.z); // XZ 中心对齐 + 底面贴地
f.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
scene.add(f);
```

铁律：**rotateY 绕原点转，先转后量否则中心被甩偏**。贴墙/贴家具的"贴沿"要用**目标高度层的实际边缘**，不是整体 bbox 边缘（AI 模型床头板比基座窄，按 bbox 贴曾留 22cm 视觉缝）——用 `vertex_analyze.mjs` 输出的分层极值。

完整放置块（含碰撞代理、单轴改尺寸、双件 clone）见 `references/placement.md`。

### ④ 接入场景页：改动清单

新家具一般要动这些地方（按页面结构数一遍，漏一处就白部署）：

1. 加载进度变量（如 `progSofa`）
2. 进度条分母 +1
3. `loadGLB` 调用行
4. `Promise.all` 解构出变量（**家具与房子并行加载**，不要房子先出家具后蹦）
5. 放置块（上一节）
6. 阴影开关
7. 碰撞代理（不需要碰撞就跳过）
8. 替换旧家具时：隐藏旧节点 + 加入 `hiddenRoots`（从碰撞列表移除，见 references/pitfalls.md 第 1 条）
9. 翻转兜底查询参数

### ⑤ 本地 CDP 验证（部署前必做）

```bash
# 1) 场景页做本地副本：CDN/绝对路径换成本地库，出生点改到目标家具跟前
sed -e 's|/lib/|/_three_lib/|g' -e 's|/home/|/|g' 场景页.html > 场景页_test.html
# 再手动改出生点两行（camera.position.set / lookAt）看向目标物

# 2) 起本地服务器 + headless Edge + 截图
node scripts/serve_local.js .. 8921 &
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --remote-debugging-port=9333 --user-data-dir=./_edge_tmp &
node scripts/cdp_page_test.mjs 场景页_test.html _shots/check.png
```

- 本地要有一份 three 库拷贝（`_three_lib/`：`three.module.js` + `examples/jsm/` + `libs/draco/`），**jsdelivr 在国内 8-10s/文件且易卡**
- 验收清单：贴墙?穿模?悬浮?大小对?朝向对?（可把截图丢给 VL 复查）
- `#loading` 遮罩等 DOM 出现 className 含 `hide` 才算加载完（`cdp_page_test.mjs` 按此轮询）

### ⑥ 部署

```bash
scp 家具_med.glb 场景页.html 场景页_d3.html user@server:/var/www/site/
```

- **多入口页面必须同步**（如 walk.html 与 walk_d3.html 是 cp 维护的双份，只传一个 = 另一个入口看到旧版）
- 部署目录以 nginx 配置为准（`alias` 指到哪就传哪），别想当然
- 部署后自己带 `?fresh=时间戳` 验一遍线上；用户端缓存顽固时让其硬刷

## 铁律速查

| 铁律 | 原因 |
|---|---|
| 先旋转/缩放 → `updateMatrixWorld` → 再量 bbox | rotateY 绕原点，后旋转甩偏中心 |
| 贴沿用目标高度层实际边缘，不是整体 bbox | AI 模型床头板比基座窄，曾差 22cm |
| 隐藏家具必须移出碰撞列表 | three.js raycaster 不管 `visible`，隐藏 = 隐形墙 |
| `getObjectByName` 用下划线版名字 | GLTFLoader sanitizeNodeName：空格→`_`、点号删除 |
| 只信 VL 说的"哪张图" | 它的坐标轴结论经常自相矛盾 |
| 图生 3D 正面默认 = +Z | 多件家具一致的经验值；放翻转兜底参数 |
| 碰撞用顶点采样 XZ 隐形盒，不用原始三角面 | raycaster 无 BVH 全量遍历，百万三角面手机必卡 |
| clone 后先清零再测量 | clone 继承原对象已摆放的变换 |
| 验收只认本地 CDP 截图 + 线上实测 | file:// 缓存、出生点朝向都会骗人 |

## 引用文档

- `references/pitfalls.md` —— 18 条坑总表（现象 → 解法），出问题先查它
- `references/placement.md` —— 放置块完整模板、9 处接入点细节、碰撞代理做法、单轴改尺寸、clone 双件
- `references/case-geo-ops.md` —— 案例：对场景内已有模型的内部物件做几何操作（换贴图/移位）的四个连环坑
