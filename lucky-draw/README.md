# 幸运大转盘 · 抽奖网页

一个简单的抽奖网页。三种奖项，抽中哪个由**服务端**决定，转盘只负责把结果演出来 ——
所以不会出现「指针停在白酒上、结果却说谢谢参与」这种穿帮。

## 奖项与概率

| 奖项 | 概率 |
|------|------|
| 🍀 谢谢您的支持 | 88% |
| 🧻 纸巾一包 | 10% |
| 🍶 白酒一瓶 | 2% |

想调概率？改 `draw.js` 里每个奖项的 `weight` 即可（三者之和要是 100）。

## 本地运行

```bash
npm install
npm start
# 浏览器打开 http://localhost:3000
```

同一 Wi-Fi 下手机 / iPad 也能用，启动日志里会打印局域网地址。

## 自测

```bash
npm test
```

29 项断言：奖项配置、概率边界（0.8799 / 0.88 / 0.9799 / 0.98）、
20 万次分布统计、转盘落点数学、HTTP 接口契约。

## 目录结构

```
lucky-draw/
├── server.js            # Express：静态托管 + /api/draw
├── draw.js              # 奖项与概率（纯逻辑，好改好测）
├── test-draw.js         # 自测
├── render.yaml          # Render 一键部署蓝图
└── public/
    ├── index.html
    ├── style.css        # 深色低蓝光护眼配色
    └── app.js           # Canvas 转盘 + 旋转动画
```

## 部署到 Render

1. Render → **New → Blueprint**
2. 选这个仓库，分支选 `抽奖`
3. 它会自动读 `lucky-draw/render.yaml`（已设 `rootDir: lucky-draw`）
4. 出地址 `https://lucky-draw-xxxx.onrender.com`

> 免费层会休眠，第一次打开要等 30 秒左右冷启动。

## 设计要点

- **结果不可篡改**：抽奖逻辑在服务端，前端拿不到权重，改 JS 也没用。
- **动画与结果一致**：先请求结果，再倒推目标角度（`targetRotationFor`），
  5~7 整圈 + easeOutQuint 缓动，落点精确到 1e-9 度。
- **不怕网络抖动**：接口挂了前端也有兜底奖项数据，不会白屏。
- **手机友好**：`viewport-fit=cover`、44px+ 触控区、支持 `prefers-reduced-motion`。
