# 使用说明与使用场景

给两类读者：**让 Claude Code 自动干活的人**（看触发方式和场景就够），以及**想手动跑脚本 / 评估能不能用在自己项目里的人**（看手动用法和适配性）。

---

## 一、使用说明

### 1. 安装（3 条命令）

```bash
git clone https://github.com/SHY0609/glb-furniture-pipeline.git
cp -r glb-furniture-pipeline ~/.claude/skills/     # 或放进某项目的 .claude/skills/ 只对该项目生效
cd ~/.claude/skills/glb-furniture-pipeline && npm i
```

前置依赖：Node ≥ 18 · python + Pillow（`PIL`）· 本地 Edge 或 Chrome（headless 验证用）。可选：`SF_KEY`（SiliconFlow key，只在走 VL 视觉朝向那一路时需要）。

### 2. 触发方式（对 Claude 说人话即可）

装好后在 Claude Code 里直接说，命中下表关键词会自动加载本 skill：

| 你说 | Claude 会做 |
|---|---|
| "接入这个 GLB 家具" / "这个图生3D 模型放进场景" | 走完整六步管线 |
| "这个模型 80MB 太大了，压一下" | 只跑 ① 压缩 |
| "家具朝向反了" / "床头朝墙了" | ② 朝向双路验证 + ③ 重摆放 |
| "家具贴墙差一截" / "悬浮/穿模" | 查坑表 B1/B2，重新按分层极值定位 |
| "换卧室那幅画的贴图" / "把桌上摆件挪走" | 走 `references/case-geo-ops.md` 案例流程 |
| "改完部署上线" | ⑤ 本地验证 → ⑥ scp 部署（含多入口同步） |

### 3. 不是每次都跑满六步

```
只想压模型          → ①            （独立可用，不需要场景页）
不确定朝向          → ②（路 A 免费，路 B 需 SF_KEY）
新家具完整接入      → ① ② ③ ④ ⑤ ⑥
改已有物件（贴图/移位）→ case-geo-ops 案例（跳过 ①②）
改完要上线          → ⑤ ⑥
```

### 4. 输入清单（开工前备齐，缺了 Claude 会问）

| 必需 | 说明 |
|---|---|
| GLB 文件路径 | 图生3D 输出或下载的原始模型 |
| 场景页 HTML | 承载 three.js 场景的那个文件 |
| 目标位置 | 具体坐标，或"放到书桌旁边"这类参照描述 |
| 场景页本地 three 库 | `_three_lib/` 拷贝（CDN 国内慢，见坑 A6） |

| 可选 | 说明 |
|---|---|
| `SF_KEY` | 没有就只走路 A 顶点分析 + 你人眼确认 |
| 正面参考图 | 有实物照片 VL 判朝向更准 |
| 翻转兜底参数 | 朝向拿不准时页面预置 `?xflip=1`，不改代码就能翻 |

### 5. 手动跑脚本（不经过 Claude 也行）

```bash
cd glb-furniture-pipeline
node scripts/compress_glb.cjs 家具.glb 家具_med.glb        # ① 压缩
node scripts/vertex_analyze.mjs 家具_med.glb              # ②路A 顶点分析
node scripts/serve_local.js .. 8921 &                     # ⑤ 起本地站点
node scripts/cdp_page_test.mjs 场景页_test.html _shots/check.png   # ⑤ 页面验证
```

完整参数见 [README · 脚本速查](README.md#脚本速查)。

### 6. 验收标准（部署前逐条过）

- 压缩后 > 8MB → 报警，draco 大概率没生效
- 压缩前后 bbox 差 > 10% → 模型有问题
- 贴墙无视觉缝（按目标高度层实际边缘量，不是 bbox）
- 无悬浮、无穿模、朝向正确
- console 零异常、截图正常（等 ready 后 ≥8 秒再截，坑 D7）
- 部署后带 `?fresh=<时间戳>` 线上复验；多入口页两个都要传

---

## 二、使用场景（全部真实发生过）

| # | 场景 | 走哪些步骤 | 实战记录 |
|---|---|---|---|
| S1 | **新图生3D 家具接入**：AI 生成的沙发/床/柜子丢进 3D 家场景 | ①→⑥ 全流程 | 8 件家具（沙发/床/床头柜×2/边桌/吊灯/地毯/书桌），80~115MB → 1.9~2.3MB |
| S2 | **模型太大加载慢**：下载的 GLB 几十 MB 手机打不开 | 只 ① | 纹理 4096²→1024 + weld + simplify + draco，约 -97% |
| S3 | **家具朝向反了**：床头对着脚那头 | ②→③ | 顶点分箱看两端密度 + VL 四角度交叉；页面预置 `?xflip=1` 兜底 |
| S4 | **贴墙差一截**：看着摆好了，床头和墙差 22cm | ③（坑 B1） | bbox 边缘 ≠ 视觉边缘，按分高度层 X/Z 极值重新贴 |
| S5 | **换旧家具/藏家具**：新旧两件叠着，人还被隐形墙挡 | ④第 8 条（坑 A1） | 旧节点移入 `hiddenRoots` + 从 `collideMeshes` 显式移除 |
| S6 | **改场景内已有物件**：换挂画贴图、挪桌上摆件 | case-geo-ops 案例 | 2026-10-23 卧室画换海崖照：世界 bbox 筛选 + 父链 0.01 缩放逆矩阵 + flipY 推导 |
| S7 | **改完部署，两个入口只更新了一个** | ⑥ | walk.html / walk_d3.html 必须 `cp` 同步再一起 scp（本仓库部署的 Yuuke-Home 即此模式） |
| S8 | **验证时截图全黑/测到别的服务** | ⑤（坑 D1/D6/D7） | 服务器 CDP 没 WebGL、9333 撞淘宝桥 → 换 9444；SwiftShader 帧滞后 → 等 8s |

---

## 三、适配性评估（能不能用在你的项目）

### ✅ 开箱即用的条件（满足就直接用）

- 你的页面是 **three.js + GLTFLoader** 的原生 HTML/JS 场景（最典型的"3D 虚拟家/房间/展厅"类页面）
- 本机有 Node 18+、python+PIL、Edge/Chrome
- Windows / macOS / Linux 均可——脚本是纯 Node，没有平台专用代码；只是 D3、D8 那两个路径坑是 **Windows 特有**，macOS/Linux 不会遇到

### 🟡 原理通用、需要小改的地方

| 情况 | 哪些步骤直接用 | 哪些要改 |
|---|---|---|
| **React Three Fiber**（React 里用 three） | ①② 压缩/朝向完全通用；铁律通用 | ③④ 的放置块是命令式 `scene.add` 写法，要翻成 R3F 组件；⑤ 验证脚本只认静态 HTML，要适配 dev server URL |
| **入口不是 #loading/hide 契约**（Mist 开屏、SSR、路由框架） | ①②③④⑥ 全部 | ⑤ 的 `cdp_page_test.mjs` 会干等到超时——换等待信号（如按钮 `dataset.ready`、点击后再等），实测见坑 D5 |
| **three 之外的引擎**（Babylon.js / PlayCanvas 等） | ① 压缩完全通用（gltf-transform 与引擎无关）；② 路 A 通用 | ③④ 放置/碰撞要换引擎 API；⑤ 验证思路通用、脚本可能要改 |
| **项目没有"站点根"概念**（Vite/webpack dev server） | ①② 不受影响 | ⑤ 用 `serve_local.js` 时把 `--root` 指到构建产物或让脚本直接打 dev server URL |

### ❌ 明确不覆盖的（别指望）

- **非 GLB 格式**：OBJ/glTF 目录先转 GLB（gltf-transform CLI 一条命令）
- **KTX2/Basis 纹理**、Draco 以外的 mesh 压缩方案——本管线纹理只走 JPEG/PNG 缩尺寸
- **WebGPU renderer**（three 的 TSL 材质）：压缩/朝向不碰 renderer 通用，放置块里 `castShadow/receiveShadow` 等老 API 在 WebGPU 下语义有差异，未实测
- **骨骼/物理模拟家具**：8 件实战全是静态网格
- **自动摆放**：③ 给的是"测量→缩放→定位"的方法和模板，**最终位置仍需人/Claude 按场景判断**，没有"AI 看一眼自动选坐标"的魔法

### 一句话结论

> 这是一个**以 three.js 静态场景页为原型**打磨出来的管线：**①②（压缩/朝向）近乎通用**，任何 GLB 都能单独用；**③④⑤ 绑定 three.js 生态但不绑定具体项目**（文档全程用"场景页"通称，换项目只要改路径和放置坐标）；入口/框架越偏离"原生 HTML + #loading"，⑤ 验证那步越需要换等待信号——这是当前唯一的硬契约（坑 D5）。

---

## 相关文档

- [SKILL.md](SKILL.md) —— Claude 触发后的完整执行流程
- [references/pitfalls.md](references/pitfalls.md) —— 22 条坑总表，出问题先查它
- [references/placement.md](references/placement.md) —— 放置块模板与 9 处接入点
- [references/case-geo-ops.md](references/case-geo-ops.md) —— 对已有物件做几何操作的案例
