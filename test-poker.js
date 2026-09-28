'use strict';
const { evaluate5, evaluate7, PokerGame, shuffle, makeDeck } = require('./poker');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; }
  else { fail++; console.log(`  ✗ ${label}: 期望 ${expected}, 实际 ${actual}`); }
}
function ok(cond, label) {
  if (cond) pass++; else { fail++; console.log(`  ✗ ${label}`); }
}

console.log('=== 牌型评估 ===');
// 皇家同花顺 > 同花顺 > 四条 > 葫芦 > 同花 > 顺子 > 三条 > 两对 > 一对 > 高牌
const royal = evaluate5(['As','Ks','Qs','Js','Ts']);
const sf    = evaluate5(['9h','8h','7h','6h','5h']);
const quads = evaluate5(['7s','7h','7d','7c','2s']);
const boat  = evaluate5(['Ks','Kh','Kd','2c','2s']);
const flush = evaluate5(['As','Js','9s','6s','3s']);
const straight = evaluate5(['9s','8h','7d','6c','5s']);
const trips = evaluate5(['4s','4h','4d','Ks','2s']);
const twopair = evaluate5(['As','Ah','Ks','Kh','2s']);
const onepair = evaluate5(['As','Ah','9s','6s','3s']);
const high = evaluate5(['As','Jh','9s','6s','3s']);
const wheel = evaluate5(['As','2h','3d','4c','5s']); // A2345 顺子

eq(royal.name, '皇家同花顺', '皇家同花顺识别');
eq(sf.name, '同花顺', '同花顺识别');
eq(quads.name, '四条', '四条识别');
eq(boat.name, '葫芦', '葫芦识别');
eq(flush.name, '同花', '同花识别');
eq(straight.name, '顺子', '顺子识别');
eq(trips.name, '三条', '三条识别');
eq(twopair.name, '两对', '两对识别');
eq(onepair.name, '一对', '一对识别');
eq(high.name, '高牌', '高牌识别');
eq(wheel.name, '顺子', 'A2345 轮子顺子');

ok(royal.score > sf.score, '皇家 > 同花顺');
ok(sf.score > quads.score, '同花顺 > 四条');
ok(quads.score > boat.score, '四条 > 葫芦');
ok(boat.score > flush.score, '葫芦 > 同花');
ok(flush.score > straight.score, '同花 > 顺子');
ok(straight.score > trips.score, '顺子 > 三条');
ok(trips.score > twopair.score, '三条 > 两对');
ok(twopair.score > onepair.score, '两对 > 一对');
ok(onepair.score > high.score, '一对 > 高牌');

// kicker 比较
const pairA = evaluate5(['As','Ah','Ks','Qs','Js']);
const pairK = evaluate5(['As','Ah','Ks','Qs','Ts']);
ok(pairA.score > pairK.score, '踢脚 J > T');

console.log('=== 7 选 5 ===');
const seven = evaluate7(['As','Ks','Qs','Js','Ts','2h','3d']);
eq(seven.name, '皇家同花顺', '7张里选出皇家同花顺');

console.log('=== 洗牌 ===');
const d1 = makeDeck();
eq(d1.length, 52, '牌堆52张');
const d2 = shuffle(makeDeck());
eq(new Set(d2).size, 52, '洗牌后无重复');

console.log('=== 对局流程 ===');
function mkGame(n, chips = 1000) {
  const g = new PokerGame({ smallBlind: 10, bigBlind: 20, startChips: chips });
  for (let i = 0; i < n; i++) {
    g.players.push(new (require('./poker').Player)(`p${i}`, `玩家${i}`, i, chips));
  }
  return g;
}

// 2 人局：盲注 10/20，庄家是小盲
let g = mkGame(2);
g.startHand();
eq(g.pot, 30, '2人局盲注入池 30');
const sbP = g.getPlayerBySeat(g.dealerSeat);
eq(sbP.bet, 10, '2人局庄家下小盲 10');
eq(g.currentSeat, g.dealerSeat, '2人局庄家先行动(翻前)');
eq(g.getPlayerBySeat(0).hole.length + g.getPlayerBySeat(1).hole.length, 4, '2人局共发4张底牌');

// 打到摊牌：两人都过牌/跟注
g = mkGame(2);
g.startHand();
let guard = 0;
while (g.running && guard++ < 50) {
  const p = g.getPlayerBySeat(g.currentSeat);
  const toCall = g.currentBet - p.bet;
  if (toCall > 0) g.act(p.id, 'call');
  else g.act(p.id, 'check');
}
ok(!g.running, '2人对局能正常结束');
eq(g.board.length, 5, '结束时公共牌5张');
eq(g.pot, 0, '结束时底池已分配');
const totalChips = g.players.reduce((s, p) => s + p.chips, 0);
eq(totalChips, 2000, '筹码守恒 2000');

// 3 人局，一人弃牌
g = mkGame(3);
g.startHand();
const first = g.getPlayerBySeat(g.currentSeat);
g.act(first.id, 'fold');
ok(g.getPlayerById(first.id).folded, '弃牌生效');
guard = 0;
while (g.running && guard++ < 60) {
  const p = g.getPlayerBySeat(g.currentSeat);
  const toCall = g.currentBet - p.bet;
  if (toCall > 0) g.act(p.id, 'call'); else g.act(p.id, 'check');
}
const total3 = g.players.reduce((s, p) => s + p.chips, 0);
eq(total3, 3000, '3人局筹码守恒 3000');

// 加注流程
g = mkGame(3);
g.startHand();
guard = 0;
let raised = false;
while (g.running && guard++ < 60) {
  const p = g.getPlayerBySeat(g.currentSeat);
  const toCall = g.currentBet - p.bet;
  if (!raised && g.street === 0) {
    g.act(p.id, 'raise', g.currentBet + g.bigBlind * 2);
    raised = true;
  } else if (toCall > 0) g.act(p.id, 'call');
  else g.act(p.id, 'check');
}
eq(g.players.reduce((s, p) => s + p.chips, 0), 3000, '加注后筹码守恒');

// all-in 边池
g = mkGame(3);
g.players[0].chips = 100;  // 短筹码
g.players[1].chips = 500;
g.players[2].chips = 1000;
const before = g.players.reduce((s, p) => s + p.chips, 0);
g.startHand();
guard = 0;
while (g.running && guard++ < 80) {
  const p = g.getPlayerBySeat(g.currentSeat);
  const toCall = g.currentBet - p.bet;
  if (toCall > 0) g.act(p.id, 'call');
  else if (g.street === 0 && !p.allin) g.act(p.id, 'raise', g.currentBet + g.bigBlind);
  else g.act(p.id, 'check');
}
const after = g.players.reduce((s, p) => s + p.chips, 0);
eq(after, before, '边池：筹码守恒');
ok(g.players.every(p => p.chips >= 0), '无人筹码为负');

// 隐藏信息
g = mkGame(3);
g.startHand();
const snapForP0 = g.snapshot('p0');
const me0 = snapForP0.players.find(p => p.id === 'p0');
const other = snapForP0.players.find(p => p.id !== 'p0');
ok(me0.hole && me0.hole.length === 2, '自己能看底牌');
ok(other.hole === null, '看不到别人底牌');

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
