# 案例：对 GLB 内已有物件做几何操作（挂画换图 + 移位）

场景：场景里的画是 GLB 内嵌 mesh（不是独立家具），要**换贴图 + 移位置**。表面看是改材质，实际是矩阵几何题。

## 四个连环坑（每个都单独卡住过）

### 1. flipY 反了，贴图上下颠倒

- **现象**：新贴图贴上去上下镜像。
- **真因**：`GLTFLoader` 里 `texture.flipY = false`（glTF 规范约定），但手动创建 `TextureLoader` 加载的图默认 `true`；改贴图时按 three.js 默认习惯写就反了。
- **解法**：GLB 内嵌贴图 → **手动设 `flipY = false`**，与 GLTFLoader 的约定对齐。

### 2. 同名节点污染（sanitize 撞车）

- **现象**：按名字 `getObjectByName('画')` 取到的不是目标画，改错了东西。
- **真因**：① GLTFLoader sanitize 同名/非法字符节点被合并或改名；② 场景里多张画重名。
- **解法**：**拿到候选后用世界 bbox 过滤** —— 只保留世界坐标 bbox 中心距预期位置 < 5m 的那个：

```js
obj.updateMatrixWorld(true);   // 必须先刷矩阵（见坑 3）
const candidates = [];
obj.traverse((o) => { if (o.name.includes('画')) candidates.push(o); });
const target = candidates.find((o) => {
  const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
  return c.distanceTo(EXPECTED_CENTER) < 5;
});
```

### 3. 矩阵没刷新，bbox 量的是上一帧的世界

- **现象**：`setFromObject` 出来的 bbox 和目测位置对不上。
- **真因**：直接对子节点量 bbox，但它的父链刚被改过/刚加载完，`matrixWorld` 还是旧值。
- **解法**：**任何几何测量之前先 `obj.updateMatrixWorld(true)`**（`true` = 强制刷全子树）。这条贯穿整个 skill。

### 4. 🔥 父链带 0.01 缩放，直接加 position 差值错位

- **现象**：`m.position.x += 1` 想让它移 1 米，实际只挪了 1cm。
- **真因**：父节点缩放是 0.01（常见于米/厘米单位混用的模型），**`position` 是父空间坐标** —— 父空间里 1 个单位 = 世界 0.01 米，直接加世界尺度的差值全错。
- **解法**：世界空间的目标位移 → **逆矩阵转回父空间**再加：

```js
m.updateMatrixWorld(true);
const inv = new THREE.Matrix4().copy(m.parent.matrixWorld).invert();

// 记录旧位置在世界系的点（用模型中心即可），算 delta，转父空间
const centerLocal = m.geometry.boundingBox.getCenter(new THREE.Vector3());
const v0 = centerLocal.clone().applyMatrix4(m.matrixWorld);        // 世界旧位置
const v1 = v0.clone().add(WORLD_DELTA);                            // 世界新位置
const p0 = v0.clone().applyMatrix4(inv);                           // 转父空间
const p1 = v1.clone().applyMatrix4(inv);
m.position.add(p1.sub(p0));                                        // 父空间增量
m.updateMatrixWorld(true);
```

> 通用形式：任何「在世界空间看到的量」（位移/速度/目标点）要写进 `position`/`rotation`，都必须先过 `parent.matrixWorld` 的逆矩阵。**缩放不是 1 的父链下，裸加裸减全是错的。**

## 标准流程（背下来）

```
① updateMatrixWorld(true)          先把世界矩阵刷对
② 世界 bbox 过滤                    从重名/污染候选里筛出真目标（< 5m）
③ 世界空间操作                      位移、测量、对齐都在世界系算
④ 逆矩阵转父空间                    写回 position/rotation 前过 inv(parent.matrixWorld)
⑤ 再次 updateMatrixWorld(true)     写完再刷一次，供后续测量/渲染
```

## 换贴图补充

```js
new THREE.TextureLoader().load('/new_art.jpg', (tex) => {
  tex.flipY = false;                 // 坑 1：GLB 内嵌贴图约定
  tex.colorSpace = THREE.SRGBColorSpace;
  const old = target.material.map;
  target.material.map = tex;
  target.material.needsUpdate = true;
  old?.dispose();                    // 别泄漏旧贴图
});
```

## 附：经验教训

- 对**已有模型内部**做操作，比接入新家具更容易错 —— 因为父链变换、同名节点、贴图约定全是隐藏状态。
- 每一步都可以用 `?fresh=` + `cdp_page_test.mjs` 截图验证，**别攒到最后一起看**。
- 换图后如果要重压缩 GLB：切记压缩脚本会**重导贴图**，确认新贴图在导出目录里（`--texdir`）。
