/**
 * 前端资源与 UI 集成测试
 * 启动服务器，验证：
 *  1. bgm.js / backdrops.js 可访问
 *  2. index.html 包含所有新增控件
 *  3. CSS 包含主题变量与设置面板样式
 */
'use strict';
const { spawn } = require('child_process');

const PORT = 4455;
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0;
function t(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('\n=== 前端集成测试 ===\n');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: __dirname, env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  srv.stdout.on('data', d => out += d);
  srv.stderr.on('data', d => out += d);

  let ready = false;
  for (let i = 0; i < 40; i++) {
    await sleep(300);
    try { const r = await fetch(BASE + '/'); if (r.ok) { ready = true; break; } } catch (e) {}
  }
  if (!ready) { console.log('服务器未就绪:\n' + out); srv.kill(); process.exit(1); }

  try {
    // ---- 静态资源 ----
    console.log('[1] 静态资源可访问');
    for (const f of ['/bgm.js', '/backdrops.js', '/app.js', '/style.css']) {
      const r = await fetch(BASE + f);
      const txt = await r.text();
      t(r.ok && txt.length > 200, `${f} 可访问（${txt.length} 字节）`);
    }

    // ---- HTML 控件 ----
    console.log('\n[2] HTML 新增控件');
    const html = await (await fetch(BASE + '/')).text();
    const need = ['btnToggleBGM', 'btnNextBg', 'btnSettings', 'settingsModal',
                  'setBgmVol', 'setBgAuto', 'setAddAI', 'setAIList', 'setBgSwatches',
                  'optAICount', 'optAIProfile', 'setAICroup'.replace('Croup','Group'),
                  '/bgm.js', '/backdrops.js'];
    for (const id of need) {
      t(html.includes(id), `包含 ${id}`);
    }

    // ---- CSS ----
    console.log('\n[3] CSS 主题与面板样式');
    const css = await (await fetch(BASE + '/style.css')).text();
    for (const k of ['--felt:', '--glow-1:', '--accent:', 'bg-fading', '.set-group', '.swatches', '.ai-row', '.ai-badge', '.icon-btn.active']) {
      t(css.includes(k), `CSS 含 ${k}`);
    }

    // ---- JS 内容 ----
    console.log('\n[4] 前端脚本内容');
    const bgm = await (await fetch(BASE + '/bgm.js')).text();
    t(bgm.includes('AudioContext'), 'bgm.js 使用 Web Audio API');
    t(bgm.includes('PROGRESSION'), 'bgm.js 含和弦进行');
    t(bgm.includes('setVolume'), 'bgm.js 含音量控制');

    const bd = await (await fetch(BASE + '/backdrops.js')).text();
    t(bd.includes('THEMES'), 'backdrops.js 含主题列表');
    const themeCount = (bd.match(/key: '/g) || []).length;
    t(themeCount >= 6, `backdrops.js 至少 6 套主题（实际 ${themeCount}）`);
    t(bd.includes('setAutoMinutes'), 'backdrops.js 含自动切换');

  } catch (e) {
    fail++; console.log('  ✗ 异常: ' + e.message);
  } finally {
    srv.kill();
  }
  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
