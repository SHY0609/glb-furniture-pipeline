# 家具放置与场景页接入

第 ③④ 步的详细操作手册：怎么把一个压缩+验证完的 GLB 摆进场景页。

## 1. 放置模板（三步走）

```js
// ===== 第 1 步：原生 bbox 量尺寸（缩放前）=====
loader.load('/furniture_med.glb', (gltf) => {
  const obj = gltf.scene;
  scene.add(obj);
  obj.updateMatrixWorld(true);
  let bb = new THREE.Box3().setFromObject(obj);
  const native = bb.getSize(new THREE.Vector3());   // 模型原始单位

  // ===== 第 2 步：算缩放（单轴 resize：只按需要的那根轴算）=====
  // 例：床要占 2.5m 宽（X），只按 X 缩放
  const s = TARGET_WIDTH / native.x;
  obj.scale.setScalar(s);          // 等比先用 setScalar；要非等比再分轴设

  // ===== 第 3 步：旋转 → 重测 → 定位（顺序不能乱）=====
  obj.rotation.y = Math.PI;        // 朝向，配 ?xflip=1 兜底
  obj.updateMatrixWorld(true);     // 🔥 必须重测前刷矩阵
  bb = new THREE.Box3().setFromObject(obj);
  const size = bb.getSize(new THREE.Vector3());
  const center = bb.getCenter(new THREE.Vector3());

  // XZ 中心对准目标点；底面贴地（或贴目标高度层）
  obj.position.x += TARGET_X - center.x;
  obj.position.z += TARGET_Z - center.z;
  obj.position.y += TARGET_FLOOR_Y - bb.min.y;
  obj.updateMatrixWorld(true);
});
```

**铁律**：改变换 → `updateMatrixWorld(true)` → 量 bbox → 再定位。任何一步跳过都会得到错位。

### 朝向兜底参数

场景页 URL 预留 `?xflip=1`：

```js
const QS = new URLSearchParams(location.search);
if (QS.get('xflip') === '1') obj.rotation.y += Math.PI;   // 不改代码翻转朝向
```

朝向验证（vertex_analyze + 四角度截图 + VL）做到 95% 把握仍可能翻车，这个参数让验证和落地解耦。

## 2. 场景页九点接入清单

新家具进场景页，逐项过：

1. **loader.load** — 路径、DRACOLoader 挂好（只挂一次）
2. **放置块** — 上面的三步模板，坐标注释写清楚来源（`// @vertex_analyze 2026-xx-xx`）
3. **先旋转/缩放再量** — B2/B3 坑
4. **XZ 中心 + 底面贴地** — 别用 min 角对齐，中点对齐才不会歪
5. **碰撞体加入 `collideMeshes`** — 见下节；漏加 = 穿模
6. **隐藏物移出 `collideMeshes`** — 隐藏 ≠ 无碰撞（A1 坑）
7. **并行加载** — `Promise.all([...])` 一次性加载多个模型，别串行 await（场景加载快一倍以上）
8. **clone 变换清零** — 同款家具 clone 第二件时（A3 坑）
9. **`?fresh=` 回归** — 部署后带时间戳参数验证，别信浏览器缓存里的旧页

## 3. 碰撞代理（别对原网格开 raycaster）

对几百 k 三角面的家具直接 `Raycaster.intersectObject` = 卡顿。做法：

```js
// 顶点采样 XZ 网格：把家具的三角面降采样成 0.2m 步长的平面占用格
function buildCollisionProxy(mesh, cell = 0.2) {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const cells = new Set();
  const pos = new THREE.BufferGeometry(); // 或直接遍历 position attribute
  // 对每个世界坐标顶点：key = `${floor(x/cell)}:${floor(z/cell)}` → cells.add(key)
  return { box, cells, cell };   // 查询: cells.has(`${floor(px/cell)}:${floor(pz/cell)}`)
}
```

要点：

- **每格 ≤ 12 个采样三角**，超了就降低采样密度，否则一个格子被反复查询
- **L 形家具不要用整体 bbox 当碰撞盒** —— L 的缺口会被封死，人绕不过去。bbox 只用于「靠墙/贴沿」定位
- 碰撞代理**在最终变换之后生成**（B4 坑）
- 玻璃想挡人：mesh 留在 raycast 列表里；不想挡（或已隐藏）：移出

## 4. 同款家具 ×2（clone 模式）

```js
const proto = await loadFurniture('sofa_med.glb');
const a = proto.clone(); scene.add(a); place(a, { x: 1, z: 2, rotY: 0 });
const b = proto.clone(); scene.add(b); place(b, { x: -1, z: 2, rotY: Math.PI });  // 旋转 180° 面对面
// place() 内部先清零变换（A3 坑），且每次定位后 updateMatrixWorld 再量
```

两件同款时碰撞代理可以只建一份（几何相同），变换跟着实例走。

## 5. 落地验收

- 本机 Edge CDP：`node scripts/cdp_page_test.mjs <场景页.html> _shots/placed.png`
- 看三样：家具在不在、贴没贴地/贴墙（目测接缝）、遮罩是否 `hide`（加载完成契约）
- 服务端：`scp` 后带 `?fresh=<时间戳>` 再验一次（服务器只发静态文件，无缓存头时浏览器自己会缓存）
