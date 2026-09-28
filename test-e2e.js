'use strict';
/**
 * 端到端集成测试 v2 — 模拟多台 iPad
 * 在子进程中启动真实服务器，用 socket.io-client 连接，打完整对局
 */
const { io } = require('socket.io-client');
const { spawn } = require('child_process');
const path = require('path');

const PORT = 3999;
const URL = 'http://127.0.0.1:' + PORT;

let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log('  \u2713 ' + l); } else { fail++; console.log('  \u2717 ' + l); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let srvOut = '';
srv.stdout.on('data', d => srvOut += d);
srv.stderr.on('data', d => srvOut += d);

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(URL, { transports: ['websocket'], forceNew: true, reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', e => reject(e));
    setTimeout(() => reject(new Error('连接超时')), 10000);
  });
}
const emit = (s, ev, data) => new Promise(res => s.emit(ev, data, res));

async function main() {
  await sleep(3000);
  if (!srvOut.includes('已启动')) { console.log('服务器启动失败:\n' + srvOut); process.exit(1); }
  console.log('=== 服务器已启动 (端口 ' + PORT + ') ===\n');

  // ---- 1. 房主创建房间 ----
  console.log('[1] 创建房间');
  const A = await connect();
  const stateA0 = { v: null }; A.on('state', s => stateA0.v = s);
  const resA = await emit(A, 'createRoom', { name: '小明', opts: { startChips: 1000, smallBlind: 10, bigBlind: 20 } });
  ok(resA && resA.ok, '房主创建房间');
  const code = resA.roomCode;
  ok(/^\d{4,5}$/.test(code), '房间号 ' + code);

  // ---- 2. 用房间号加入 ----
  console.log('\n[2] 加入房间');
  const B = await connect();
  const stateB = { v: null }; B.on('state', s => stateB.v = s);
  const resB = await emit(B, 'joinRoom', { name: '小红', code });
  ok(resB && resB.ok, '玩家B 用房间号 ' + code + ' 加入');

  const C = await connect();
  const resBad = await emit(C, 'joinRoom', { name: '路人', code: '99999' });
  ok(resBad && !resBad.ok, '错误房间号被拒绝: ' + (resBad && resBad.msg));

  await sleep(500);
  const st = stateA0.v;
  ok(st && st.members.length === 2, '房间 2 名成员');
  ok(st.isHost === true, 'A 是房主');

  // ---- 3. 发牌员语音 ----
  console.log('\n[3] 电子发牌员');
  const dealerEvents = [];
  A.on('dealer', e => dealerEvents.push(e));
  A.emit('startHand');
  await sleep(700);
  ok(dealerEvents.length > 0, '收到发牌员语音事件 (' + dealerEvents.length + ' 条)');
  console.log('     样例: ' + dealerEvents.map(e => e.text).slice(0, 3).join(' | '));

  // ---- 4. 底牌私密性（核心） ----
  console.log('\n[4] 底牌私密性');
  const sA = stateA0.v, sB = stateB.v;
  ok(sA.running, '本手进行中');
  ok(sA.pot === 30, '盲注入池 ' + sA.pot);
  const aMe = sA.players.find(p => p.id === sA.myId);
  const aOther = sA.players.find(p => p.id !== sA.myId);
  const bMe = sB.players.find(p => p.id === sB.myId);
  ok(aMe.hole && aMe.hole.length === 2, 'A 看到自己底牌: ' + aMe.hole.join(' '));
  ok(aOther.hole === null, 'A 看不到对手底牌 \u2705');
  ok(bMe.hole && bMe.hole.length === 2, 'B 看到自己底牌: ' + bMe.hole.join(' '));
  ok(aMe.hole.join() !== bMe.hole.join(), '两人底牌不同');
  ok(aOther.holeCount === 2, '对手只暴露张数(2)');

  // ---- 5. 打完整一手 ----
  console.log('\n[5] 完整对局');
  let guard = 0;
  while (stateA0.v.running && guard++ < 50) {
    const cur = stateA0.v.players.find(p => p.isTurn);
    if (!cur) { await sleep(150); continue; }
    const sock = cur.id === stateA0.v.myId ? A : B;
    const toCall = stateA0.v.currentBet - cur.bet;
    await emit(sock, 'action', toCall > 0 ? { action: 'call' } : { action: 'check' });
    await sleep(130);
  }
  ok(!stateA0.v.running, '一手打完');
  ok(stateA0.v.board.length === 5, '摊牌 5 张公共牌: ' + stateA0.v.board.join(' '));
  ok(stateA0.v.pot === 0, '底池已分配');
  ok(stateA0.v.lastWinners.length > 0, '有赢家');
  const total = stateA0.v.players.reduce((s, p) => s + p.chips, 0);
  ok(total === 2000, '筹码守恒 ' + total);
  console.log('     赢家: ' + stateA0.v.lastWinners.map(w => w.name + '(' + w.hand + ') +' + w.amount).join(', '));
  await sleep(300);
  ok(stateA0.v.players.every(p => p.hole && p.hole.length === 2), '摊牌后所有底牌公开');

  // ---- 6. 弃牌结束 ----
  console.log('\n[6] 弃牌流程');
  A.emit('startHand');
  await sleep(600);
  ok(stateA0.v.handNumber === 2, '第 2 手开始');
  const cur2 = stateA0.v.players.find(p => p.isTurn);
  const sock2 = cur2.id === stateA0.v.myId ? A : B;
  await emit(sock2, 'action', { action: 'fold' });
  await sleep(400);
  ok(!stateA0.v.running, '弃牌后立即结束');
  ok(stateA0.v.lastWinners[0].reason === '其他人弃牌', '赢家原因: 对手弃牌');

  // ---- 7. 加注流程 ----
  console.log('\n[7] 加注流程');
  A.emit('startHand');
  await sleep(600);
  const curR = stateA0.v.players.find(p => p.isTurn);
  const sockR = curR.id === stateA0.v.myId ? A : B;
  const raiseTo = stateA0.v.currentBet + stateA0.v.minRaise;
  const rres = await emit(sockR, 'action', { action: 'raise', amount: raiseTo });
  ok(rres && rres.ok, '加注到 ' + raiseTo + ' 成功');
  await sleep(300);
  ok(stateA0.v.currentBet === raiseTo, '当前注额更新为 ' + stateA0.v.currentBet);
  // 另一人跟注
  const curR2 = stateA0.v.players.find(p => p.isTurn);
  const sockR2 = curR2.id === stateA0.v.myId ? A : B;
  await emit(sockR2, 'action', { action: 'call' });
  await sleep(300);
  ok(stateA0.v.street === 1 || !stateA0.v.running, '进入翻牌或结束');

  // ---- 8. 非法操作 ----
  console.log('\n[8] 非法操作拦截');
  const notTurn = stateA0.v.players.find(p => !p.isTurn && !p.folded);
  if (notTurn) {
    const s = notTurn.id === stateA0.v.myId ? A : B;
    const r = await emit(s, 'action', { action: 'check' });
    ok(r && !r.ok, '非当前玩家操作被拒绝: ' + (r && r.msg));
  } else { ok(true, '（跳过）'); }

  // ---- 9. 人多 + 聊天 ----
  console.log('\n[9] 多人 + 聊天');
  // 先把第 7 步那手打完，让牌桌空闲
  guard = 0;
  while (stateA0.v.running && guard++ < 50) {
    const cur = stateA0.v.players.find(p => p.isTurn);
    if (!cur) { await sleep(150); continue; }
    const sock = cur.id === stateA0.v.myId ? A : B;
    const toCall = stateA0.v.currentBet - cur.bet;
    await emit(sock, 'action', toCall > 0 ? { action: 'call' } : { action: 'check' });
    await sleep(130);
  }
  await sleep(300);
  const D = await connect();
  const resD = await emit(D, 'joinRoom', { name: '小刚', code });
  ok(resD && resD.ok, '第 3 名玩家加入');
  await sleep(600);
  ok(stateA0.v.members.length === 3, '3 名成员');

  let gotChat = null;
  A.on('chat', m => gotChat = m);
  B.emit('chat', { text: '大家好呀' });
  await sleep(500);
  ok(gotChat && gotChat.text === '大家好呀', '聊天转发正常');
  ok(gotChat && gotChat.name === '小红', '显示正确昵称');

  // 3 人开局，验证新手拿到牌
  A.emit('startHand');
  await sleep(700);
  ok(stateA0.v.players.length === 3, '3 人牌桌');
  // 筹码守恒：场上筹码 + 底池 = 3000（3人各1000）
  const onTable3 = stateA0.v.players.reduce((s, p) => s + p.chips, 0) + stateA0.v.pot;
  ok(onTable3 === 3000, '3 人筹码守恒（含底池）3000，实际 ' + onTable3);
  ok(stateA0.v.pot === 30, '3 人局盲注 30');
  const newbie = stateA0.v.players.find(p => p.name === '小刚');
  ok(newbie && newbie.holeCount === 2, '新加入的玩家拿到底牌');

  // ---- 10. 断线 ----
  console.log('\n[10] 断线处理');
  const beforeDisc = stateA0.v.members.length;
  B.disconnect();
  await sleep(900);
  ok(stateA0.v.members.length === beforeDisc - 1, '断线后成员 ' + beforeDisc + ' -> ' + stateA0.v.members.length);

  console.log('\n' + '='.repeat(40));
  console.log('结果: ' + pass + ' 通过, ' + fail + ' 失败');
  console.log('='.repeat(40));
  A.disconnect(); C.disconnect(); D.disconnect();
  srv.kill();
  await sleep(300);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('测试异常:', e.message);
  console.error('服务器输出:\n' + srvOut);
  try { srv.kill(); } catch (_) {}
  process.exit(1);
});
