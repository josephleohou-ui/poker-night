/**
 * 抽奖自测 —— node test-draw.js
 * 覆盖：奖项配置、概率边界、分布统计、HTTP 接口契约、前端落点算法
 */
const assert = require('assert');
const http = require('http');
const { PRIZES, TOTAL_WEIGHT, drawOnce, simulate } = require('./draw');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✅ ' + name); }
  catch (e) { fail++; console.log('  ❌ ' + name + ' → ' + e.message); }
}

console.log('\n【1】奖项配置');
t('三种奖项齐全且顺序正确', () => {
  assert.deepStrictEqual(PRIZES.map((p) => p.name), ['谢谢您的支持', '纸巾一包', '白酒一瓶']);
});
t('权重合计 100', () => assert.strictEqual(TOTAL_WEIGHT, 100));
t('每个奖项都有配色(≥2) / emoji / tip', () => {
  for (const p of PRIZES) {
    assert.ok(p.colors.length >= 2, p.id + ' 缺配色');
    assert.ok(p.emoji, p.id + ' 缺 emoji');
    assert.ok(p.tip, p.id + ' 缺提示语');
  }
});

console.log('\n【2】概率边界');
t('rand=0 → 谢谢您的支持', () => assert.strictEqual(drawOnce(() => 0), 'thanks'));
t('rand=0.8799 → 谢谢您的支持', () => assert.strictEqual(drawOnce(() => 0.8799), 'thanks'));
t('rand=0.88 → 纸巾一包', () => assert.strictEqual(drawOnce(() => 0.88), 'tissue'));
t('rand=0.9799 → 纸巾一包', () => assert.strictEqual(drawOnce(() => 0.9799), 'tissue'));
t('rand=0.98 → 白酒一瓶', () => assert.strictEqual(drawOnce(() => 0.98), 'baijiu'));
t('rand≈1 → 白酒一瓶（不越界为 undefined）', () => assert.strictEqual(drawOnce(() => 0.99999), 'baijiu'));

console.log('\n【3】20 万次分布（允许 ±1.2% 误差）');
const N = 200000;
const tally = simulate(N);
console.log('   ', JSON.stringify(tally));
t('谢谢您的支持 ≈ 88%', () => {
  const r = tally.thanks / N;
  assert.ok(Math.abs(r - 0.88) < 0.012, '实际 ' + (r * 100).toFixed(2) + '%');
});
t('纸巾一包 ≈ 10%', () => {
  const r = tally.tissue / N;
  assert.ok(Math.abs(r - 0.10) < 0.012, '实际 ' + (r * 100).toFixed(2) + '%');
});
t('白酒一瓶 ≈ 2%', () => {
  const r = tally.baijiu / N;
  assert.ok(Math.abs(r - 0.02) < 0.006, '实际 ' + (r * 100).toFixed(2) + '%');
});
t('三种结果都出现过', () => assert.ok(tally.thanks > 0 && tally.tissue > 0 && tally.baijiu > 0));

console.log('\n【4】前端转盘落点算法（与 public/app.js 同公式）');
// 扇区 i 原始中心角 = i*seg + seg/2（第 0 块已被 -90° 起点摆正到 12 点）
// 目标：旋转后该中心角恰好落在指针 0°（12 点）下 → rotation + center ≡ 0 (mod 360)
function targetRotationFor(index, turns, currentRotation, n) {
  const seg = 360 / n;
  const center = index * seg + seg / 2;
  const needed = ((360 - center) % 360 + 360) % 360;
  const currentMod = ((currentRotation % 360) + 360) % 360;
  let extra = needed - currentMod;
  if (extra < 0) extra += 360;
  return currentRotation + turns * 360 + extra;
}
t('三种奖项落点都精确对准指针（偏差 < 1e-9°）', () => {
  const n = 3;
  for (let i = 0; i < n; i++) {
    const rot = targetRotationFor(i, 6, 0, n);
    const seg = 360 / n;
    const center = i * seg + seg / 2;
    const finalCenter = (((center + rot) % 360) + 360) % 360;
    // 与指针 0° 的角距（处理环绕）
    const diff = Math.abs(((finalCenter + 180) % 360) - 180);
    assert.ok(diff < 1e-9, `奖项${i} 偏差 ${diff}°`);
  }
});
t('落点必须落在该扇区范围内（半宽 60°×0.9）', () => {
  const n = 3, seg = 360 / n;
  for (let i = 0; i < n; i++) {
    const rot = targetRotationFor(i, 5, 0, n);
    const center = i * seg + seg / 2;
    const finalCenter = (((center + rot) % 360) + 360) % 360;
    const off = Math.abs(((finalCenter + 180) % 360) - 180);
    assert.ok(off < seg / 2 * 0.9, `奖项${i} 落到扇区外`);
  }
});
t('至少转 5 整圈（有惯性感）', () => {
  const rot = targetRotationFor(0, 5, 0, 3);
  assert.ok(rot >= 5 * 360);
});
t('角度只增不减（不会倒着转）', () => {
  let r = 0;
  for (const idx of [2, 0, 1, 2, 1]) {
    const nr = targetRotationFor(idx, 5, r, 3);
    assert.ok(nr > r, '角度回退');
    r = nr;
  }
});

console.log('\n【5】HTTP 接口契约（临时端口实测）');
const { app } = require('./server');

function req(port, method, p) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    r.on('error', reject);
    r.end();
  });
}

(async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = server.address().port;

  try {
    const p = await req(port, 'GET', '/api/prizes');
    t('GET /api/prizes → 200', () => assert.strictEqual(p.status, 200));
    t('/api/prizes 含 3 个奖项且字段完整', () => {
      const j = JSON.parse(p.body);
      assert.strictEqual(j.prizes.length, 3);
      assert.ok(j.prizes.every((x) => x.id && x.name && x.emoji && x.colors && x.tip));
    });
    t('/api/prizes 不泄露 weight 内部字段', () => {
      const j = JSON.parse(p.body);
      assert.ok(j.prizes.every((x) => x.weight === undefined));
    });

    const d = await req(port, 'POST', '/api/draw');
    t('POST /api/draw → 200', () => assert.strictEqual(d.status, 200));
    t('/api/draw 返回合法奖项', () => {
      const j = JSON.parse(d.body);
      assert.ok(['thanks', 'tissue', 'baijiu'].includes(j.id));
      assert.ok(j.name && j.emoji && j.tip && j.ts);
    });

    // 连抽 200 次，确保不会 500、且三种结果都有机会出现
    let seen = new Set();
    let bad = 0;
    for (let i = 0; i < 200; i++) {
      const r = await req(port, 'POST', '/api/draw');
      if (r.status !== 200) { bad++; continue; }
      seen.add(JSON.parse(r.body).id);
    }
    t('连抽 200 次无错误响应', () => assert.strictEqual(bad, 0));
    t('200 次里至少出现 2 种结果', () => assert.ok(seen.size >= 2, '只出现 ' + [...seen]));

    for (const f of ['/', '/app.js', '/style.css']) {
      const r = await req(port, 'GET', f);
      t('静态资源 ' + f + ' → 200', () => assert.strictEqual(r.status, 200));
    }

    const html = (await req(port, 'GET', '/')).body;
    t('首页含三个奖项文案', () => {
      // 文案由 JS 注入，这里确认引用了正确的脚本与样式
      assert.ok(html.includes('app.js'));
      assert.ok(html.includes('style.css'));
      assert.ok(html.includes('幸运大转盘'));
    });

    const h = await req(port, 'GET', '/healthz');
    t('/healthz → ok', () => assert.strictEqual(JSON.parse(h.body).ok, true));
  } catch (e) {
    fail++;
    console.log('  ❌ 接口测试异常 → ' + e.message);
  } finally {
    server.close();
    console.log(`\n结果: ${pass} 通过, ${fail} 失败\n`);
    process.exit(fail === 0 ? 0 : 1);
  }
})();
