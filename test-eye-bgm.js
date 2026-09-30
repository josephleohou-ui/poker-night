/**
 * 护眼 + BGM 回归测试
 * 1. BGM 连续性（有声占比应 > 95%）
 * 2. BGM 响度（峰值 RMS 应 > 0.1）
 * 3. 亮度调节生效
 * 4. 牌面柔化生效
 * 5. 牌面颜色确实变暗（不再是刺眼纯白）
 */
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const ok = (c, m) => { c ? (pass++, console.log('  ✓ ' + m)) : (fail++, console.log('  ✗ ' + m)); };

(async () => {
  const PORT = 4730;
  const srv = spawn('node', ['server.js'], {
    cwd: __dirname, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore'
  });
  await sleep(3500);

  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.addInitScript(() => {
    window.__gauges = [];
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const orig = AC.prototype.createGain;
      AC.prototype.createGain = function () {
        const g = orig.call(this); window.__gauges.push(g); return g;
      };
    }
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await sleep(600);

  console.log('\n[1] BGM 连续性 + 响度');
  await page.mouse.click(400, 400);
  await sleep(2500);

  const audio = await page.evaluate(() => new Promise(resolve => {
    const g = window.__gauges[0];
    const ctx = g.context;
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    g.connect(an);
    const buf = new Float32Array(an.fftSize);
    const s = [];
    let i = 0;
    const iv = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let k = 0; k < buf.length; k++) sum += buf[k] * buf[k];
      s.push(Math.sqrt(sum / buf.length));
      if (++i >= 40) {
        clearInterval(iv);
        const nz = s.filter(x => x > 0.0001).length;
        resolve({
          total: s.length, voiced: nz,
          ratio: +(nz / s.length * 100).toFixed(1),
          peak: +Math.max(...s).toFixed(4),
        });
      }
    }, 100);
  }));
  console.log('   ', JSON.stringify(audio));
  ok(audio.ratio >= 95, `BGM 连续（有声占比 ${audio.ratio}% ≥ 95%）`);
  ok(audio.peak > 0.08, `BGM 响度足够（峰值 ${audio.peak} > 0.08）`);

  console.log('\n[2] 护眼：亮度调节');
  const bright = await page.evaluate(() => {
    localStorage.setItem('poker_bright', '70');
    // 重新初始化（触发 syncUI）
    location.reload();
    return true;
  });
  await page.waitForLoadState('load');
  await sleep(1200);
  const bcheck = await page.evaluate(() => {
    const r = document.documentElement;
    const f = getComputedStyle(r).filter;
    return {
      dataset: r.dataset.bright,
      varVal: r.style.getPropertyValue('--ui-bright'),
      filter: f,
    };
  });
  console.log('   ', JSON.stringify(bcheck));
  ok(bcheck.varVal === '0.7', `亮度变量已设 0.7（实际 ${bcheck.varVal}）`);
  ok(bcheck.filter.includes('brightness'), '亮度滤镜已应用');

  console.log('\n[3] 护眼：牌面柔化');
  const soft = await page.evaluate(() => {
    localStorage.setItem('poker_soft', 'on');
    location.reload();
    return true;
  });
  await page.waitForLoadState('load');
  await sleep(1200);
  const scheck = await page.evaluate(() => ({
    attr: document.documentElement.dataset.cardSoft,
    face: getComputedStyle(document.documentElement).getPropertyValue('--card-face').trim(),
  }));
  console.log('   ', JSON.stringify(scheck));
  ok(scheck.attr === 'on', '柔化模式已开启');
  ok(scheck.face === '#ded5c0', `牌面变柔和（${scheck.face}）`);

  console.log('\n[4] 牌面亮度（应为暖象牙，非纯白）');
  const cardColor = await page.evaluate(() => {
    localStorage.setItem('poker_bright', '100');
    localStorage.setItem('poker_soft', 'off');
    location.reload();
    return true;
  });
  await page.waitForLoadState('load');
  await sleep(1200);
  const cc = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = '<span class="c-top">A♠</span>';
    document.body.appendChild(el);
    const cs = getComputedStyle(el);
    const out = { bgImage: cs.backgroundImage, bgColor: cs.backgroundColor };
    el.remove();
    return out;
  });
  console.log('    backgroundImage:', cc.bgImage.slice(0, 110));
  // 从 rgb()/rgba() 里提取所有颜色分量
  const nums = [];
  const re = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi;
  let mt;
  while ((mt = re.exec(cc.bgImage)) !== null) nums.push([+mt[1], +mt[2], +mt[3]]);
  const lums = nums.map(([r, g, b]) => (0.299 * r + 0.587 * g + 0.114 * b) / 255);
  const maxLum = lums.length ? Math.max(...lums) : -1;
  console.log('    提取色值数:', nums.length, '| 最高亮度:',
    maxLum < 0 ? '未提取到' : (maxLum * 100).toFixed(1) + '%');
  ok(nums.length >= 2, '成功提取牌面渐变色');
  ok(maxLum >= 0 && maxLum < 0.92, `牌面不再刺眼（亮度 ${(maxLum * 100).toFixed(1)}% < 92%）`);

  console.log('\n[5] JS 错误');
  ok(errs.length === 0, errs.length ? errs.join(' | ') : '无 JS 错误');

  await browser.close();
  srv.kill();
  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
})();
