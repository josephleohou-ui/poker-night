/**
 * AI 实战端到端测试
 * 启动真实服务器，用 socket 客户端：
 *  1. 人类建房 + 添加 AI
 *  2. 开局，验证 AI 会自动行动（无需人类操作）
 *  3. 验证 AI 能打完一手牌
 *  4. 验证 AI 不会卡死牌局
 *  5. 验证非房主不能添加 AI
 */
'use strict';

const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 4321;
const URL = `http://localhost:${PORT}`;

let pass = 0, fail = 0;
function t(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('连接超时')), 8000);
  });
}
function emit(sock, ev, data) {
  return new Promise((resolve) => {
    sock.emit(ev, data, resolve);
    setTimeout(() => resolve({ ok: false, msg: 'timeout' }), 8000);
  });
}

(async () => {
  console.log('\n=== AI 实战 E2E ===\n');

  // 启动服务器
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvOut = '';
  srv.stdout.on('data', d => { srvOut += d.toString(); });
  srv.stderr.on('data', d => { srvOut += d.toString(); });

  // 等服务器就绪
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const r = await fetch(URL + '/');
      if (r.ok) { ready = true; break; }
    } catch (e) { /* 继续等 */ }
  }
  if (!ready) {
    console.log('服务器未就绪，输出：\n' + srvOut);
    srv.kill(); process.exit(1);
  }
  console.log('[0] 服务器已启动\n');

  const cleanup = [];
  try {
    // ---- 场景 1：房主添加 AI ----
    console.log('[1] 添加 AI');
    const host = await connect();
    cleanup.push(host);

    const hostStates = [];
    host.on('state', s => hostStates.push(s));
    host.on('dealer', () => {});

    const created = await emit(host, 'createRoom', {
      name: '房主', opts: { startChips: 1000, smallBlind: 10, bigBlind: 20 },
    });
    t(created.ok, '创建房间成功');
    const roomCode = created.roomCode;

    const profiles = await emit(host, 'aiProfiles', null);
    t(Array.isArray(profiles) && profiles.length >= 5, '应返回至少 5 种 AI 性格');

    const add1 = await emit(host, 'addAI', { profile: 'loose' });
    t(add1.ok && add1.ai && add1.ai.profile === 'loose', '添加"松凶"AI 成功');
    const aiId = add1.ai.id;

    const add2 = await emit(host, 'addAI', {});
    t(add2.ok, '添加随机性格 AI 成功');
    t(add2.ai.id !== aiId, '两个 AI 的 id 不同');

    const add3 = await emit(host, 'addAI', { profile: 'tight' });
    t(add3.ok, '添加第 3 个 AI 成功');

    await sleep(400);
    const lastState = hostStates[hostStates.length - 1];
    t(lastState && lastState.members.length === 4, `桌上应有 4 人（1人+3AI），实际 ${lastState ? lastState.members.length : 0}`);
    const aiMembers = lastState.players.filter(p => p.isAI);
    t(aiMembers.length === 3, `快照应标记 3 个 AI，实际 ${aiMembers.length}`);
    console.log(`  房间 ${roomCode}：${lastState.players.map(p => p.name + (p.isAI ? '(AI)' : '')).join('、')}`);

    // ---- 场景 2：开局，AI 自动行动 ----
    console.log('\n[2] 开局 — AI 自动行动（人类自动过牌/跟注）');

    // 人类自动出最简单的合法动作，让牌局能推进
    // （真实玩家会自己点，这里模拟一个"只会跟注/过牌"的人类）
    let humanActs = 0;
    host.on('state', (s) => {
      if (!s.running) return;
      const me = s.players.find(p => p.id === created.playerId);
      if (!me || !me.isTurn) return;
      const act = s.toCall > 0 ? 'call' : 'check';
      host.emit('action', { action: act }, () => { humanActs++; });
    });

    const beforeHands = lastState.handNumber;
    host.emit('startHand');

    // 等 AI 自己打（最多 30 秒）
    let done = false;
    for (let i = 0; i < 110; i++) {
      await sleep(500);
      const s = hostStates[hostStates.length - 1];
      if (s && s.handNumber > beforeHands && !s.running) { done = true; break; }
    }
    const fs2 = hostStates[hostStates.length - 1];
    t(fs2.handNumber > beforeHands, `应开出一手牌（手数 ${beforeHands} -> ${fs2.handNumber}）`);
    t(!fs2.running, '牌局应能正常结束');
    t(!!fs2.lastWinners && fs2.lastWinners.length > 0, '应有赢家产生');
    console.log(`  人类自动行动 ${humanActs} 次`);
    if (fs2.lastWinners) {
      console.log('  结果：' + fs2.lastWinners.map(w => `${w.name} ${w.hand || ''} +${w.amount}`).join('，'));
    }

    // ---- 场景 3：筹码守恒 ----
    console.log('\n[3] 筹码守恒');
    const total = fs2.players.reduce((s, p) => s + p.chips, 0) + fs2.pot;
    t(total === 4000, `4 人 × 1000 = 4000，实际 ${total}`);

    // ---- 场景 4：连续多手，验证不卡死 ----
    console.log('\n[4] 连打 3 手，验证不卡死');
    let handsPlayed = 0;
    const startHandNo = fs2.handNumber;
    for (let h = 0; h < 3; h++) {
      host.emit('startHand');
      let ok = false;
      for (let i = 0; i < 110; i++) {
        await sleep(500);
        const s = hostStates[hostStates.length - 1];
        if (s.handNumber > startHandNo + h && !s.running) { ok = true; break; }
      }
      if (ok) handsPlayed++;
      await sleep(300);
    }
    t(handsPlayed === 3, `应连打 3 手，实际 ${handsPlayed} 手`);
    const fs4 = hostStates[hostStates.length - 1];
    const total4 = fs4.players.reduce((s, p) => s + p.chips, 0) + fs4.pot;
    t(total4 === 4000, `连打后筹码仍守恒 4000，实际 ${total4}`);

    // ---- 场景 5：移除 AI ----
    console.log('\n[5] 移除 AI');
    const rm = await emit(host, 'removeAI', { id: aiId });
    t(rm.ok, '移除 AI 成功');
    await sleep(400);
    const fs5 = hostStates[hostStates.length - 1];
    t(fs5.members.length === 3, `移除后应剩 3 人，实际 ${fs5.members.length}`);
    t(!fs5.players.some(p => p.id === aiId), '被移除的 AI 不应还在牌桌上');

    // ---- 场景 6：非房主权限 ----
    console.log('\n[6] 权限：非房主不能加 AI');
    const guest = await connect();
    cleanup.push(guest);
    const joined = await emit(guest, 'joinRoom', { name: '客人', code: roomCode });
    t(joined.ok, '客人加入房间成功');
    const badAdd = await emit(guest, 'addAI', { profile: 'maniac' });
    t(!badAdd.ok, '客人添加 AI 应被拒绝');
    console.log('  拒绝原因：' + (badAdd.msg || ''));

    // ---- 场景 7：AI 只在轮到自己时行动 ----
    console.log('\n[7] 快照正确性');
    const fs7 = hostStates[hostStates.length - 1];
    const aiP = fs7.players.find(p => p.isAI);
    t(aiP && aiP.aiProfile, 'AI 玩家应带 aiProfile 字段');
    const meP = fs7.players.find(p => p.id === created.playerId);
    t(meP && (meP.hole === null || Array.isArray(meP.hole)), '自己能看到底牌字段');

  } catch (e) {
    fail++;
    console.log('  ✗ 异常: ' + e.message);
  } finally {
    for (const s of cleanup) { try { s.close(); } catch (e) {} }
    await sleep(300);
    srv.kill();
  }

  console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
