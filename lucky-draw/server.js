/**
 * 抽奖网页服务器
 * - 极简 Express：只服务静态前端 + 一个 /api/draw 接口
 * - 奖项结果由服务端决定（前端无法自己改结果），动画只负责演
 * - 绑定 0.0.0.0 且读 process.env.PORT，Render / Railway 可直接部署
 */
const express = require('express');
const path = require('path');
const os = require('os');
const { drawOnce, publicPrizes } = require('./draw');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 奖项契约：前端拿它来画转盘，保证文案/颜色只有一处来源
app.get('/api/prizes', (req, res) => {
  res.json({ prizes: publicPrizes() });
});

// 抽一次
app.post('/api/draw', (req, res) => {
  const id = drawOnce();
  const prize = publicPrizes().find((p) => p.id === id);
  res.json({
    id: prize.id,
    name: prize.name,
    emoji: prize.emoji,
    tip: prize.tip,
    ts: Date.now()
  });
});

// 健康检查（Render 的 healthCheckPath 指向 /，这里再给一个 /healthz）
app.get('/healthz', (req, res) => res.json({ ok: true }));

// 只在「直接运行」时监听端口；被 require 时不监听，方便单测起临时服务
let server = null;
if (require.main === module) {
  server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎡 抽奖网页已启动: http://localhost:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const i of list || []) {
        if (i.family === 'IPv4' && !i.internal) {
          console.log(`   局域网访问: http://${i.address}:${PORT}`);
        }
      }
    }
  });
}

module.exports = { app, server };
