# glb-furniture-pipeline

> Claude Code skill：把 **AI 图生3D / 外部下载的 GLB 家具模型**接入 **three.js 网页场景**的完整管线。
> 8 件家具实战跑通——单件 80~115MB 压到 1.9~2.3MB（约 -97%），手机端可加载。

**压缩 → 朝向双路验证 → 定位摆放 → 本地 CDP 无头验证 → 部署**

## 安装

```bash
git clone https://github.com/SHY0609/glb-furniture-pipeline.git
cp -r glb-furniture-pipeline ~/.claude/skills/     # 或放进某个项目的 .claude/skills/
cd ~/.claude/skills/glb-furniture-pipeline && npm i
```

依赖：Node ≥ 18 · python + Pillow · 本地 Edge/Chrome（headless 验证用）。

装好后，对 Claude 说"接入这个 GLB 家具 / 这个图生3D 模型太大帮我压一下 / 家具朝向反了"就会自动触发本 skill；完整流程见 [SKILL.md](SKILL.md)。

## 管线一览

| 步骤 | 做什么 | 脚本 |
|---|---|---|
| ① 压缩 | 纹理 1024 + weld + simplify 0.3 + draco，80MB→2MB | `scripts/compress_glb.cjs` |
| ② 朝向验证 | 顶点分箱（几何证据）× VL 四角度截图（视觉）双路交叉 | `scripts/vertex_analyze.mjs` · `cdp_shot.mjs` · `vl_orient_check.mjs` |
| ③ 定位摆放 | 量 bbox → 缩放 → 旋转 → 再量 → 定位（顺序有铁律） | [references/placement.md](references/placement.md) |
| ④ 接入场景页 | 9 处改动清单（加载/进度/放置/碰撞/兜底参数…） | [references/placement.md](references/placement.md) |
| ⑤ 本地验证 | headless Edge + CDP 截图 + console 检查 | `scripts/serve_local.js` · `cdp_page_test.mjs` |
| ⑥ 部署 | scp 上线，多入口页同步，线上复验 | — |

## 脚本速查

```bash
# 压缩（python + Pillow）
node scripts/compress_glb.cjs 家具.glb 家具_med.glb [--ratio 0.3] [--maxside 1024] [--quality 85]

# 顶点分布分析：三轴直方图 + 最长轴两端密度 + 分高度层极值（贴沿检测）
node scripts/vertex_analyze.mjs 家具_med.glb [--bins 12] [--layers 8] [--zup]

# 本地静态服务器（验证用，带 no-store）
node scripts/serve_local.js [站点根目录] [端口=8921]

# 单模型四角度截图（先起 serve_local + headless Edge :9333）
node scripts/cdp_shot.mjs <yaw> <pitch> <out.png> <模型.glb> [页面名] [端口]

# 页面级验证：等 #loading 出现 hide 类 → console 收集 → 截图
node scripts/cdp_page_test.mjs <页面.html> <out.png>

# VL 视觉朝向判定（SiliconFlow Qwen3-VL，只信"哪张图"，别信坐标轴结论）
SF_KEY=sk-xxx node scripts/vl_orient_check.mjs --ref 正面参考.jpg --object 床 \
  --shot 0:_shots/yaw0.png --shot 90:_shots/yaw90.png \
  --shot 180:_shots/yaw180.png --shot 270:_shots/yaw270.png
```

## 为什么值得一条条踩出来

这些坑全都真实踩过、并在 8 件家具上复验过解法，细节在 [references/pitfalls.md](references/pitfalls.md)：

- 隐藏家具 = 隐形墙（raycaster 不管 `visible`，碰撞列表要显式移除）
- GLTFLoader 会把节点名空格/点号改成下划线（gltf-transform 和浏览器看到的名字不一致）
- `rotateY` 绕原点，先测量后旋转会把家具甩飞
- AI 生成模型的床头板比基座窄 22cm，贴墙要按"目标高度层实际边缘"而不是 bbox
- 视觉模型（VL）判朝向会自相矛盾——只取"哪张图"，坐标轴结论直接忽略
- gltf-transform v4 写 draco 忘记 register 两件套 = 输出 15MB 未压缩

## 实战战绩

- 8 件家具（沙发/床/床头柜×2/边桌/吊灯/地毯/书桌）全链路接入
- 压缩率：80~115MB → 1.9~2.3MB；纹理 4096² → 1024（normal PNG / 其余 JPG q85）
- 验证链路：顶点分析 + VL 四角度 + headless CDP 截图 + console 零异常，全部部署前完成

## License

[MIT](LICENSE) © SHY0609
