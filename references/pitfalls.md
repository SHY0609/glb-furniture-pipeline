# 坑全表（22 条，全部实战踩过）

按「现象 → 真因 → 解法」组织。场景页统称"场景页"（本 skill 不绑定具体项目）。

## A. 渲染 / 交互

| # | 坑 | 现象 | 真因 | 解法 |
|---|----|------|------|------|
| A1 | 🔥 raycaster 不管 visible | 隐藏的家具仍然挡路，人物走不过去 | `Raycaster.intersectObjects` 照常命中 `visible=false` 的 mesh | 隐藏家具（或家具组）要**移出 `collideMeshes` 数组**，不是设 visible=false。玻璃是例外：想让玻璃挡人就留着 |
| A2 | GLTFLoader 名字清洗 | `getObjectByName("my table")` 拿到 undefined | sanitizeNodeName：空格→`_`、点号被删 | 用清洗后的名字（`my_table`）取节点；或加载后自己建名字索引 |
| A3 | clone 继承变换 | `mesh.clone()` 出来的东西位置/缩放跟着父物体 | Object3D.clone 复制 position/rotation/scale | clone 后立刻 `position.set(0,0,0); rotation.set(0,0,0); scale.set(1,1,1)` 再摆 |
| A4 | 桌面物件拆不开 | 想把桌上的摆件挪走，切不动 | 图生3D 输出是一整块融合网格 | 切割线 = 桌面高度 + 2cm（bbox 逐层分析找水平面）。⚠️ 切割后重压缩 draco 有异常，未完全解决——先切后压、压缩完必须 CDP 回归验证 |
| A5 | 屏幕/玻璃白块 | 窗外海面一片白、屏幕是白板 | 模型把玻璃/屏幕误配成高反光材质 | 最简解：隐藏玻璃 mesh（配合 A1 移出碰撞）。要保留就降 metalness/加 transmission |
| A6 | jsdelivr 国内慢 | 页面 8-10 秒才出第一个 canvas | CDN 在国内不稳 | three.js **自托管**：拷 `three.module.js` + `examples/jsm/` 到站点目录，importmap 指本地。`model_view.html` 里有注释模板 |

## B. 测量 / 放置

| # | 坑 | 现象 | 真因 | 解法 |
|---|----|------|------|------|
| B1 | 🔥 bbox 边缘 ≠ 视觉边缘 | 贴墙放好后床头和墙差一截（实测差 22cm） | bbox 是整体包围盒；床头板比床垫窄/内收 | 贴沿定位用**目标高度层的实际 X/Z 极值**：`vertex_analyze.mjs` 的分层输出直接给。先 `updateMatrixWorld(true)` 再 `setFromObject` |
| B2 | 先旋转后测量 | rotation 改完量出来的 bbox 还是旧的 | 世界矩阵没刷新 | 顺序钉死：**改变换 → `obj.updateMatrixWorld(true)` → 量** |
| B3 | 非等比缩放 | 视觉对了但碰撞盒是斜的/扁的 | bbox 按缩放前算，或旋转后没重算 | 三步：① 原生 bbox 量尺寸 ② 算 scale ③ rotate → updateMatrixWorld → **重量** → 定 XZ 中心 + 底面贴地 |
| B4 | 隐形墙（非等比缩放版） | 家具看着没那么大，人却撞空气 | 碰撞代理按未缩放/未旋转的几何生成 | 碰撞代理**必须在最终变换之后**再生成（见 placement.md 的顶点采样法） |

## C. 压缩

| # | 坑 | 现象 | 真因 | 解法 |
|---|----|------|------|------|
| C1 | sharp 崩溃 | 处理某张 PNG 时 sharp 直接 crash | 图片缺 colorspace 信息 | **贴图缩放用 PIL（Python），不用 sharp**。`compress_glb.cjs` 内置调用 |
| C2 | draco 没生效 | 输出文件还是几十 MB | encoder 没注册 KHRDracoMeshCompression 扩展 | `registerExtensions([KHRDracoMeshCompression])` + `registerDependencies({'draco3d.encoder': ...})`，读和写都要 |
| C3 | 压缩后尺寸变了 | 压缩前后 bbox 差 >10% | 简化误差过大或坐标搞错 | `compress_glb.cjs` 自动校验，超 10% 警告。**压缩后必跑一次 `vertex_analyze.mjs` 对比 bbox** |
| C4 | 有 alpha 通道的贴图 | 贴图变黑/花屏 | 被无脑转 JPG 丢了 alpha | 槽位判定：normal map 存 PNG（无损）、**alpha 真有用的存 PNG**、其余 JPG q85 |

## D. 验证工具链

| # | 坑 | 现象 | 真因 | 解法 |
|---|----|------|------|------|
| D1 | 服务器 CDP Chromium 没 WebGL | 截图全黑/渲染失败 | 服务器 headless 环境 WebGL 不可用 | 3D 页验证**只用本机 Edge CDP**（`cdp_shot.mjs` / `cdp_page_test.mjs` 默认 :9333），别连服务器 9222 |
| D2 | CDP /json/list 首个 tab 无关 | 页面测的是 Tampermonkey/设置页 | 复用了已有 tab | **一律 `PUT /json/new` 开专用 tab**，两个 CDP 脚本都已内置 |
| D3 | Git Bash 路径转换 | 传 `/walk_test.html` 变成 `C:/Program Files/Git/walk_test.html` | MSYS 把 `/xxx` 参数转 Windows 路径 | 脚本**只收纯文件名**，内部补前缀 `/`；已内置怪路径兜底 |
| D4 | file:// 缓存 | 改了 HTML 浏览器不生效 | 本地文件缓存 | URL 拼 `?fresh=<时间戳>`（CDP 脚本已内置）。必须走 serve_local.js 时同理 |
| D5 | #loading 契约 | 脚本永远等不到 ready | 页面遮罩用 `style.display` 或没有 id | 页面契约：遮罩元素 `id="loading"`，加载完加**类名 `hide`**（不是 display）。`cdp_page_test.mjs` 按此轮询。⚠️ **入口异形的页面不适用**：如 Mist 开屏版（无 loading 遮罩，就绪信号是按钮 `dataset.ready='true'` + 手动点击），要另写等待逻辑，别干等 `hide` 到超时 |
| D6 | 🔥 CDP 端口撞本地服务 | `curl :9333/json/version` 返回 `{"ok":false,"error":"只有 GET /health 和 POST /call"}`，脚本拿到的 target 是别的服务 | 9333 常被同机别的桥接服务占用（本机实测撞过一次） | **起 CDP 前先 `netstat` 挑空闲口**（如 9444），`CDP_PORT` 环境变量传给脚本；`json/version` 能认出 Chrome/Edge 才算连对 |
| D7 | 🔥 SwiftShader 截图滞后 | 页面 `hide` 了、`computed opacity` 已 0、纹理 200，但 `captureScreenshot` 拿到的还是**旧帧**（黑屏/带遮罩） | headless 软渲染 ~1fps，合成帧落后主线程好几秒（2026-10-23 实测：遮罩 DOM 已淡出，截图仍显示遮罩） | ready 后**再等 ≥8 秒**再截图；拿不准就逐秒读 `getComputedStyle(loading).opacity` 确认后多等几帧。**首张截图异常先怀疑帧滞后，别急着改页面** |
| D8 | 🔥 启动参数路径含空格 | PowerShell `Start-Process -ArgumentList '--user-data-dir=D:\My Dir\_edge'` 起 Edge：进程秒退（或转投已开的默认 profile），端口**永不监听**，`/json/version` 连不上 | PowerShell 把 ArgumentList 数组 join 成命令行时**按空格拆词**，`D:\My Dir\_edge` 被劈成两个参数，后续参数全部错位 | 传给 `Start-Process`/`node -e` 的含路径参数**一律用无空格路径**（如 `%TEMP%\_edge_xxx`），或手工包双层引号 `--user-data-dir="D:\My Dir\x"`。Git Bash 侧还有 MSYS 把 `/xxx` 转 Windows 路径的同类坑（D3）。**症状是"端口起不来"时，先查路径空格，别怀疑 Edge 坏了** |
