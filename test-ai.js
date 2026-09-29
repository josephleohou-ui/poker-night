/**
 * AI 对手测试
 * 重点验证：
 *  1. 决策合法性（不会在无下注时"跟注"、不会加注低于最小加注等）
 *  2. 公平性（AI 接口里拿不到别人的底牌）
 *  3. 牌力估算合理性（AA 胜率 > 72o）
 *  4. 不同性格行为确实不同
 */
'use strict';

const { PokerGame, STREET } = require('./poker');
const ai = require('./ai');

let pass = 0, fail = 0;
function t(cond, msg) {
  if (cond) { pass++; }
  else { fail++; console.log('  ✗ ' + msg); }
}

console.log('\n=== AI 对手测试 ===\n');

// ---------- 1. 翻牌前牌力表合理性 ----------
console.log('[1] 起手牌强度表');

const aa = ai.preflopStrength(['As', 'Ah']);
const kk = ai.preflopStrength(['Ks', 'Kh']);
const akSuited = ai.preflopStrength(['As', 'Ks']);
const c72 = ai.preflopStrength(['7h', '2c']);
const c32 = ai.preflopStrength(['3d', '2s']);

t(aa > 0.95, 'AA 应该接近 1.0，实际 ' + aa.toFixed(3));
t(aa > kk, 'AA 应该强于 KK');
t(kk > akSuited, 'KK 应该强于 AKs');
t(akSuited > c72, 'AKs 应该强于 72o');
t(c72 > c32 || Math.abs(c72 - c32) < 0.02, '72o 与 32o 应接近最弱');
t(c72 < 0.40, '72o 应该很弱，实际 ' + c72.toFixed(3));
t(akSuited > 0.55, 'AKs 应该较强，实际 ' + akSuited.toFixed(3));
console.log(`  AA=${aa.toFixed(3)} KK=${kk.toFixed(3)} AKs=${akSuited.toFixed(3)} 72o=${c72.toFixed(3)}`);

// ---------- 2. 胜率估算准确性 ----------
console.log('\n[2] 蒙特卡洛胜率估算');

// AA vs 1 个随机对手：理论约 85%
const eqAA = ai.estimateEquity(['As', 'Ah'], [], 1, 800);
t(eqAA > 0.75 && eqAA < 0.95, 'AA 单挑胜率应在 75%~95%，实际 ' + eqAA.toFixed(3));
console.log(`  AA vs 1人 = ${(eqAA * 100).toFixed(1)}%  (理论 ≈85%)`);

// 72o vs 1 个随机对手：理论约 35%
const eq72 = ai.estimateEquity(['7h', '2c'], [], 1, 800);
t(eq72 > 0.20 && eq72 < 0.48, '72o 单挑胜率应在 20%~48%，实际 ' + eq72.toFixed(3));
console.log(`  72o vs 1人 = ${(eq72 * 100).toFixed(1)}%  (理论 ≈35%)`);

// 对手越多，AA 胜率越低
const eqAA3 = ai.estimateEquity(['As', 'Ah'], [], 3, 600);
t(eqAA3 < eqAA, '对手越多 AA 胜率应下降');
console.log(`  AA vs 3人 = ${(eqAA3 * 100).toFixed(1)}%  (应低于单挑)`);

// 已成牌：公共牌给了四条，胜率应极高
const eqQuads = ai.estimateEquity(['As', 'Ah'], ['Ad', 'Ac', 'Ks'], 1, 400);
t(eqQuads > 0.95, '握四条时胜率应 >95%，实际 ' + eqQuads.toFixed(3));
console.log(`  四条 vs 1人 = ${(eqQuads * 100).toFixed(1)}%`);

// ---------- 3. 决策合法性 ----------
console.log('\n[3] 决策合法性（1000 次随机场景）');

const baseCtx = {
  hole: ['As', 'Kh'],
  board: [],
  street: 0,
  pot: 60,
  toCall: 0,
  myBet: 0,
  myChips: 1000,
  currentBet: 20,
  minRaise: 20,
  bigBlind: 20,
  activeOpps: 1,
};

let illegal = 0, actionCounts = {};
const deals = [
  [['As','Ah'], []], [['7h','2c'], []], [['Ks','Qs'], ['Js','Ts','2h']],
  [['Ad','Kd'], ['Qd','Jd','Td']], [['2h','3h'], ['9s','8d','4c']],
  [['Ac','Ad'], ['Ah','As','Kc']], [['7s','2d'], ['Td','9c','8h','3s','2c']],
];

for (let i = 0; i < 1000; i++) {
  const [hole, board] = deals[i % deals.length];
  const toCall = [0, 20, 60, 200, 800][i % 5];
  const ctx = {
    ...baseCtx,
    hole,
    board,
    street: board.length === 0 ? 0 : board.length === 3 ? 1 : board.length === 4 ? 2 : 3,
    toCall,
    myBet: 20,
    currentBet: toCall + 20,
    pot: 100 + i % 500,
    activeOpps: (i % 8) + 1,
    profile: ai.PROFILE_KEYS[i % ai.PROFILE_KEYS.length],
  };
  const d = ai.decide(ctx);
  actionCounts[d.action] = (actionCounts[d.action] || 0) + 1;

  if (!['fold', 'check', 'call', 'raise', 'allin'].includes(d.action)) { illegal++; continue; }
  // 无下注时不能 call
  if (d.action === 'call' && ctx.toCall <= 0) illegal++;
  // 有下注时不能 check
  if (d.action === 'check' && ctx.toCall > 0) illegal++;
  // raise 金额必须合理
  if (d.action === 'raise') {
    if (!(d.amount > ctx.currentBet)) illegal++;
    if (!(d.amount <= ctx.myChips + ctx.myBet)) illegal++;
  }
}

t(illegal === 0, `不应有非法决策，实际 ${illegal} 次`);
console.log('  动作分布:', JSON.stringify(actionCounts));
console.log(`  非法决策: ${illegal}`);

// ---------- 4. 公平性：AI 拿不到别人的底牌 ----------
console.log('\n[4] 公平性检查');

// 让 AI 打满一手牌，验证它只被喂自己的牌
const g = new PokerGame({ smallBlind: 10, bigBlind: 20, startChips: 1000 });
g.players = [
  new (require('./poker').Player)('p1', '人类', 0, 1000),
  new (require('./poker').Player)('p2', 'AI', 1, 1000),
];
g.startHand();

const aiPlayer = g.getPlayerById('p2');
const humanPlayer = g.getPlayerById('p1');

// 模拟：AI 的决策上下文由服务端构造，只包含公开信息 + 自己的牌
function buildCtx(game, pid, profile) {
  const p = game.getPlayerById(pid);
  return {
    hole: p.hole.slice(),              // ← 只有自己的
    board: game.board.slice(),          // ← 公开
    street: game.street,
    pot: game.pot,
    toCall: Math.max(0, game.currentBet - p.bet),
    myBet: p.bet,
    myChips: p.chips,
    currentBet: game.currentBet,
    minRaise: game.minRaise,
    bigBlind: game.bigBlind,
    activeOpps: game.activePlayers().length - 1,
    profile,
  };
}

const ctx = buildCtx(g, 'p2', 'balanced');
t(ctx.hole.length === 2, 'AI 应该拿到自己的 2 张牌');
t(!('allHoles' in ctx), 'AI 上下文不应包含所有人的牌');
t(!JSON.stringify(ctx).includes(humanPlayer.hole[0]) ||
  ctx.hole.includes(humanPlayer.hole[0]), 'AI 上下文不应泄露对手底牌');

// 让 AI 自己打完整手牌，不能崩
let steps = 0;
while (g.running && steps < 60) {
  const cur = g.getPlayerBySeat(g.currentSeat);
  if (!cur) break;
  const d = ai.decide(buildCtx(g, cur.id, 'loose'));
  const res = g.act(cur.id, d.action, d.amount || 0);
  if (!res.ok) { t(false, 'AI 动作被拒: ' + d.action + ' / ' + (res.msg || '')); break; }
  steps++;
}
t(steps > 0 && steps < 60, 'AI 应能自己打完一手牌，步数=' + steps);
t(!g.running, '牌局应正常结束');

// 筹码守恒
const total = g.players.reduce((s, p) => s + p.chips, 0);
t(total === 2000, '筹码应守恒为 2000，实际 ' + total);
console.log(`  对局步数=${steps} 筹码守恒=${total}`);

// ---------- 5. 性格差异 ----------
console.log('\n[5] 性格差异（各 400 次同场景）');

const testCtx = {
  hole: ['Jh', 'Td'], board: ['9s', '8c', '2h'], street: 1,
  pot: 200, toCall: 100, myBet: 0, myChips: 1000,
  currentBet: 100, minRaise: 100, bigBlind: 20, activeOpps: 2,
};

const stats = {};
for (const key of ai.PROFILE_KEYS) {
  let agg = 0, fold = 0;
  for (let i = 0; i < 400; i++) {
    const d = ai.decide({ ...testCtx, profile: key });
    if (d.action === 'raise' || d.action === 'allin') agg++;
    if (d.action === 'fold') fold++;
  }
  stats[key] = { agg, fold };
  console.log(`  ${key.padEnd(9)} 加注率=${(agg / 4).toFixed(0)}%  弃牌率=${(fold / 4).toFixed(0)}%`);
}

t(stats.loose.agg > stats.passive.agg, '松凶加注率应高于保守');
t(stats.maniac.agg > stats.passive.agg, '疯子加注率应高于保守');
t(stats.passive.fold >= stats.loose.fold, '保守弃牌率应不低于松凶');

// ---------- 6. makeAI ----------
console.log('\n[6] AI 生成器');
const a1 = ai.makeAI('tight');
const a2 = ai.makeAI();
t(a1.profile === 'tight', '指定性格应生效');
t(a1.isAI === true, '应标记为 AI');
t(typeof a1.id === 'string' && a1.id.length > 2, '应有唯一 id');
t(a1.id !== a2.id, '两个 AI 的 id 应不同');
t(!!a1.name, '应有名字');
console.log(`  生成: ${a1.name}(${a1.profileLabel}) / ${a2.name}(${a2.profileLabel})`);

// ---------- 结果 ----------
console.log(`\n=== 结果: ${pass} 通过, ${fail} 失败 ===\n`);
process.exit(fail === 0 ? 0 : 1);
