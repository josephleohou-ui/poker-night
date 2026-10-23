/**
 * 抽奖前端
 *
 * 分工：
 *   后端 /api/draw 决定"抽中什么"
 *   本文件只负责把结果"演"出来（转盘旋转 + 落点计算 + 结果卡片）
 *
 * 落点算法：奖项 i 的扇区中心角是 (i + 0.5) * seg。
 * 指针在 12 点（canvas 里的 -90° = 270°）。要让某扇区转到指针处，
 * 需要 rotation ≡ -90 - 中心角 (mod 360)。加上 5~7 整圈做出惯性感。
 */
(function () {
  'use strict';

  const canvas = document.getElementById('wheel');
  const ctx = canvas.getContext('2d');
  const spinBtn = document.getElementById('spinBtn');
  const wrap = document.querySelector('.wheel-wrap');
  const card = document.getElementById('resultCard');
  const resEmoji = document.getElementById('resultEmoji');
  const resTitle = document.getElementById('resultTitle');
  const resTip = document.getElementById('resultTip');

  const SIZE = canvas.width;          // 640
  const CX = SIZE / 2;
  const CY = SIZE / 2;
  const R = SIZE / 2 - 6;

  let prizes = [];
  let rotation = 0;                   // 累计角度（度），只增不减
  let spinning = false;
  const reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 绘制 ---------- */

  function drawWheel() {
    const n = prizes.length || 1;
    const seg = (Math.PI * 2) / n;

    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate((rotation * Math.PI) / 180);

    // 扇区
    for (let i = 0; i < n; i++) {
      const p = prizes[i];
      const start = i * seg - Math.PI / 2 - seg / 2; // 让第 0 块正对 12 点
      const end = start + seg;

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, R, start, end);
      ctx.closePath();
      ctx.fillStyle = p.colors[i % p.colors.length];
      ctx.fill();
      ctx.strokeStyle = 'rgba(244, 227, 192, 0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 扇区文字：长文案按两行排（谢谢您的支持 → 谢谢您的 / 支持），避免截断
      ctx.save();
      ctx.rotate(start + seg / 2);
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f7f3ea';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 4;

      const lines = p.name.length > 5
        ? [p.name.slice(0, 4), p.name.slice(4)]
        : [p.name];
      const fs = lines.length > 1 ? 22 : 24;
      const lh = fs + 6;
      ctx.font = `600 ${fs}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      const textRight = R - 40;
      const startY = -((lines.length - 1) * lh) / 2;
      lines.forEach((ln, k) => ctx.fillText(ln, textRight, startY + k * lh));

      // emoji 放在文字内侧
      const maxW = Math.max(...lines.map((ln) => ctx.measureText(ln).width));
      ctx.font = '22px sans-serif';
      ctx.fillText(p.emoji, textRight - maxW - 10, 0);
      ctx.restore();
    }

    // 外圈装饰
    ctx.beginPath();
    ctx.arc(0, 0, R - 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(217, 178, 106, 0.9)';
    ctx.lineWidth = 5;
    ctx.stroke();

    // 内圈小圆点（灯珠感）
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * (R - 16), Math.sin(a) * (R - 16), 3.2, 0, Math.PI * 2);
      ctx.fillStyle = i % 2 ? 'rgba(240, 214, 155, 0.9)' : 'rgba(255, 255, 255, 0.35)';
      ctx.fill();
    }

    ctx.restore();
  }

  /* ---------- 动画 ---------- */

  // 用 requestAnimationFrame 自己做缓动，进度可控、可单测（不依赖 CSS transition）
  function animateTo(target, duration) {
    return new Promise((resolve) => {
      const from = rotation;
      const delta = target - from;
      const t0 = performance.now();
      const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);

      function frame(now) {
        const t = Math.min(1, (now - t0) / duration);
        rotation = from + delta * easeOutQuint(t);
        drawWheel();
        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          rotation = target;
          drawWheel();
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  /**
   * 计算把 index 扇区转到指针下所需的目标角度（总旋转角）
   *
   * 扇区 i 原始中心角（相对 canvas 的 0°）是 i*seg + seg/2，
   * 而第 0 块已经通过 -90° 起点偏移摆正了 12 点位置，所以这里用 i*seg + seg/2 即「相对 12 点」的角度。
   * 指针在 12 点（对应 -90°），要让该扇区中心转到指针下：rotation + center ≡ 0 (mod 360)。
   */
  function targetRotationFor(index, turns) {
    const n = prizes.length;
    const seg = 360 / n;
    const center = index * seg + seg / 2;        // 扇区中心相对 12 点的角度
    const needed = ((360 - center) % 360 + 360) % 360;
    const currentMod = ((rotation % 360) + 360) % 360;
    let extra = needed - currentMod;
    if (extra < 0) extra += 360;
    return rotation + turns * 360 + extra;
  }

  /* ---------- 结果展示 ---------- */

  function showResult(prize) {
    card.dataset.state = prize.id;
    resEmoji.textContent = prize.emoji;
    resTitle.textContent = prize.name;
    resTip.textContent = prize.tip || '';
    card.classList.remove('pop');
    void card.offsetWidth; // 强制重排以重启动画
    card.classList.add('pop');

    if (prize.id !== 'thanks') {
      wrap.classList.add('win');
      setTimeout(() => wrap.classList.remove('win'), 2600);
    }
  }

  /* ---------- 抽奖主流程 ---------- */

  async function spin() {
    if (spinning || prizes.length === 0) return;
    spinning = true;
    spinBtn.disabled = true;
    spinBtn.querySelector('.spin-main').textContent = '转动';
    card.dataset.state = 'idle';
    resEmoji.textContent = '🎈';
    resTitle.textContent = '转盘转动中…';
    resTip.textContent = '看看会停在哪儿';

    try {
      // 先拿结果，再算落点 —— 动画和结果永远一致
      const resp = await fetch('/api/draw', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const prize = await resp.json();

      const index = prizes.findIndex((p) => p.id === prize.id);
      const safeIndex = index >= 0 ? index : 0;

      if (reduceMotion) {
        rotation = targetRotationFor(safeIndex, 0);
        drawWheel();
        await new Promise((r) => setTimeout(r, 120));
      } else {
        // 5~7 整圈 + 落点，随机圈数让每次手感不同
        const turns = 5 + Math.floor(Math.random() * 3);
        const target = targetRotationFor(safeIndex, turns);
        await animateTo(target, 4200 + Math.random() * 600);
      }

      showResult(prize);
    } catch (err) {
      console.error(err);
      card.dataset.state = 'thanks';
      resEmoji.textContent = '😿';
      resTitle.textContent = '网络开小差了';
      resTip.textContent = '请检查网络后再试一次';
    } finally {
      spinning = false;
      spinBtn.disabled = false;
      spinBtn.querySelector('.spin-main').textContent = '再抽';
    }
  }

  /* ---------- 启动 ---------- */

  async function init() {
    try {
      const resp = await fetch('/api/prizes');
      const data = await resp.json();
      prizes = data.prizes;
    } catch (e) {
      // 接口挂了也要能看见转盘，不至于白屏
      prizes = [
        { id: 'thanks', name: '谢谢您的支持', emoji: '🍀', colors: ['#3d4a52', '#46545d'], tip: '再接再厉' },
        { id: 'tissue', name: '纸巾一包', emoji: '🧻', colors: ['#d9b26a', '#e8c887'], tip: '实用小奖' },
        { id: 'baijiu', name: '白酒一瓶', emoji: '🍶', colors: ['#c0392b', '#e05a4a'], tip: '恭喜中奖' }
      ];
    }
    // 初始随机偏转一点，避免每块都正对中线显得呆板
    rotation = Math.random() * 360;
    drawWheel();
  }

  spinBtn.addEventListener('click', spin);
  canvas.addEventListener('click', spin); // 点转盘也能抽

  init();
})();
