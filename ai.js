/**
 * AI 对手 —— 德州扑克电脑玩家
 *
 * 设计原则（重要）：
 *  - AI 只能看到「它自己应该看到的」信息：自己的底牌 + 公共牌 + 公开的注额/动作。
 *  - 决策基于牌力评估 + 底池赔率 + 位置，不读取其他人的底牌。
 *  - 每个性格有不同的松紧度、激进度和诈唬倾向，让牌局有变化。
 *
 * 策略分层：
 *  1. 计算当前牌力（蒙特卡洛快速估算胜率）
 *  2. 结合底池赔率（pot odds）判断是否值得跟注
 *  3. 按性格加入诈唬/慢打/激进加注
 */
'use strict';

const { evaluate7, STREET } = require('./poker');

/* ---------------- 性格档案 ---------------- */
const PROFILES = {
  // 紧凶：牌好才打，打就凶
  tight: {
    label: '紧凶',
    namePool: ['稳重的小李', '老虎·唐', '冷面书呆子', '老派绅士'],
    playThreshold: 0.52,   // 胜率高于此才主动进攻
    callThreshold: 0.30,   // 胜率高于此才跟注
    aggression: 0.75,      // 加注倾向
    bluff: 0.05,           // 诈唬概率
    slowplay: 0.10,        // 慢打（好牌只跟）
  },
  // 松凶：什么牌都玩，疯狂加注
  loose: {
    label: '松凶',
    namePool: ['疯狗杰克', '德州牛仔', '一掷千金', '不停加注的安娜'],
    playThreshold: 0.36,
    callThreshold: 0.20,
    aggression: 0.90,
    bluff: 0.22,
    slowplay: 0.04,
  },
  // 保守：很少加注，跟注为主
  passive: {
    label: '保守',
    namePool: ['谨慎的老王', '会计先生', '保守派阿姨', '不爱冒险的汤姆'],
    playThreshold: 0.62,
    callThreshold: 0.42,
    aggression: 0.25,
    bluff: 0.03,
    slowplay: 0.18,
  },
  // 疯子：随机性很强，难以预测
  maniac: {
    label: '疯子',
    namePool: ['赌怪老陈', '疯狂麦克', '运气王', '蒙眼大侠'],
    playThreshold: 0.28,
    callThreshold: 0.14,
    aggression: 0.95,
    bluff: 0.38,
    slowplay: 0.02,
  },
  // 均衡：接近理论最优的稳健打法
  balanced: {
    label: '均衡',
    namePool: ['平衡师艾米', '计算器', '职业选手', '稳如老狗的凯文'],
    playThreshold: 0.45,
    callThreshold: 0.30,
    aggression: 0.60,
    bluff: 0.12,
    slowplay: 0.12,
  },
};

const PROFILE_KEYS = Object.keys(PROFILES);

/* ---------------- 牌力估算 ---------------- */
/**
 * 用蒙特卡洛模拟估算当前胜率。
 * @param {string[]} hole   自己的两张底牌
 * @param {string[]} board  公共牌（0/3/4/5 张）
 * @param {number}   opps   对手数量
 * @param {number}   iters  模拟次数（越大越准，越慢）
 * @returns {number} 0..1 的胜率
 */
function estimateEquity(hole, board, opps, iters = 220) {
  if (!hole || hole.length < 2) return 0.5;
  const oppsN = Math.max(1, opps);

  // 剩余牌堆
  const used = new Set([...hole, ...board]);
  const RANKS = '23456789TJQKA';
  const SUITS = 'shdc';
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) {
    const c = r + s;
    if (!used.has(c)) deck.push(c);
  }

  let wins = 0, ties = 0;
  const need = 5 - board.length;

  for (let it = 0; it < iters; it++) {
    // Fisher-Yates 部分洗牌
    const d = deck.slice();
    for (let i = 0; i < need + oppsN * 2; i++) {
      const j = i + Math.floor(Math.random() * (d.length - i));
      [d[i], d[j]] = [d[j], d[i]];
    }

    const extra = d.slice(0, need);
    const fullBoard = [...board, ...extra];

    const myScore = evaluate7([...hole, ...fullBoard]).score;

    let bestOpp = -1, tieCount = 0;
    let p = need;
    for (let o = 0; o < oppsN; o++) {
      const oppHole = [d[p], d[p + 1]];
      p += 2;
      const s = evaluate7([...oppHole, ...fullBoard]).score;
      if (s > bestOpp) { bestOpp = s; tieCount = 1; }
      else if (s === bestOpp) tieCount++;
    }

    if (myScore > bestOpp) wins++;
    else if (myScore === bestOpp) ties++;
  }

  // 平分底池按一半计
  return (wins + ties * 0.5) / iters;
}

/* ---------------- 翻牌前起手牌强度（查表，避免每次都模拟） ---------------- */
const RANK_ORDER = '23456789TJQKA';
function preflopStrength(hole) {
  const [a, b] = hole.map(c => c[0]);
  const [sa, sb] = hole.map(c => c[1]);
  const ra = RANK_ORDER.indexOf(a);
  const rb = RANK_ORDER.indexOf(b);
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  const suited = sa === sb;
  const paired = ra === rb;
  const gap = hi - lo;

  // 基础分（AA 最高）
  let s = (hi / 12) * 0.45 + (lo / 12) * 0.28;

  if (paired) s += 0.22 + (hi / 12) * 0.18;
  if (suited) s += 0.06;
  if (gap === 1) s += 0.04;        // 连牌
  else if (gap === 2) s += 0.02;
  else if (gap >= 5) s -= 0.05;    // 间隔太大
  if (lo < 5 && !paired && !suited && gap > 2) s -= 0.04; // 弱高张

  // AA 封顶在 1.0，其余按比例压到 1.0 以下，保持排序清晰
  s = Math.max(0.05, Math.min(0.99, s));
  if (paired && hi === 12 && lo === 12) s = 1.0;   // AA 独一档

  return s;
}

/* ---------------- AI 决策 ---------------- */
/**
 * 决定 AI 的行动。
 * @param {object} ctx
 *   hole       AI 的底牌 ['As','Kh']
 *   board      公共牌
 *   street     当前街 (0-3)
 *   pot        当前底池
 *   toCall     需要跟注的金额（0 = 可过牌）
 *   myBet      我已投入本轮
 *   myChips    我的剩余筹码
 *   currentBet 本轮当前注额
 *   minRaise   最小加注
 *   bigBlind   大盲
 *   activeOpps 还在牌局里的对手数
 *   profile    性格 key
 * @returns {{action:string, amount?:number, think?:string}}
 */
function decide(ctx) {
  const {
    hole, board = [], street = 0, pot = 0, toCall = 0,
    myChips = 0, currentBet = 0, minRaise = 0, bigBlind = 20,
    activeOpps = 1, profile = 'balanced',
  } = ctx;

  const P = PROFILES[profile] || PROFILES.balanced;

  // 1. 估算胜率
  let equity;
  if (street === STREET.PREFLOP || board.length === 0) {
    equity = preflopStrength(hole);
    // 翻牌前对多人要打折
    equity *= (1 - Math.min(0.35, (activeOpps - 1) * 0.09));
  } else {
    equity = estimateEquity(hole, board, activeOpps, 200);
  }

  // 2. 底池赔率
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;

  // 3. 随机扰动，避免完全机械
  const noise = (Math.random() - 0.5) * 0.08;
  const eff = equity + noise;

  // 4. all-in 保护：筹码太少就别磨叽
  const canCheck = toCall <= 0;
  const potSize = pot + toCall;

  // ---- 决策树 ----

  // (a) 面对下注
  if (toCall > 0) {
    // 跟注会让筹码见底 -> 要么全下要么弃
    const callCost = Math.min(toCall, myChips);

    // 诈唬加注（牌很差但偶尔偷）
    if (eff < P.callThreshold && Math.random() < P.bluff * (canCheck ? 1 : 0.6)) {
      const raiseTo = Math.min(myChips + ctx.myBet, Math.max(currentBet + minRaise, Math.round(potSize * 0.75) + currentBet));
      if (raiseTo > currentBet && myChips > toCall * 1.5) {
        return { action: 'raise', amount: raiseTo, think: '诈唬' };
      }
    }

    // 牌力足够 -> 加注/跟注
    if (eff >= P.playThreshold) {
      // 慢打：好牌只跟，钓大鱼
      if (Math.random() < P.slowplay) {
        return { action: 'call', think: '慢打' };
      }
      // 加注
      if (Math.random() < P.aggression && myChips > toCall * 2) {
        const factor = 2.2 + Math.random() * 0.8;
        let raiseTo = Math.max(
          currentBet + minRaise,
          Math.round((currentBet + potSize) * factor * 0.5)
        );
        raiseTo = Math.min(raiseTo, myChips + ctx.myBet);
        if (raiseTo >= myChips + ctx.myBet) return { action: 'allin', think: '价值全下' };
        return { action: 'raise', amount: raiseTo, think: '价值加注' };
      }
      return { action: 'call', think: '跟注' };
    }

    // 牌力一般，看赔率
    if (eff >= P.callThreshold && eff >= potOdds * 1.05) {
      // 大注面前，边缘牌弃掉
      if (callCost > myChips * 0.35 && eff < 0.5) {
        return { action: 'fold', think: '注太大，弃牌' };
      }
      return { action: 'call', think: '赔率够' };
    }

    // 太贵又没牌 -> 弃
    if (toCall > bigBlind * 3 && eff < 0.35) {
      return { action: 'fold', think: '没牌，弃' };
    }
    return { action: 'fold', think: '弃牌' };
  }

  // (b) 无人下注（可过牌）
  if (eff >= P.playThreshold) {
    if (Math.random() < P.slowplay) return { action: 'check', think: '设陷阱' };
    if (Math.random() < P.aggression) {
      let bet = Math.max(bigBlind, Math.round(pot * (0.5 + Math.random() * 0.4)));
      bet = Math.min(bet, myChips);
      if (bet >= myChips) return { action: 'allin', think: '全下' };
      return { action: 'raise', amount: currentBet + bet, think: '主动下注' };
    }
    return { action: 'check', think: '过牌' };
  }

  // 牌力一般时偶尔偷池
  if (Math.random() < P.bluff * 0.8 && pot > bigBlind * 2 && myChips > bigBlind * 4) {
    const bet = Math.min(Math.round(pot * 0.6), myChips);
    if (bet >= myChips) return { action: 'allin', think: '偷池全下' };
    return { action: 'raise', amount: currentBet + bet, think: '偷池' };
  }

  return { action: 'check', think: '过牌' };
}

/* ---------------- AI 玩家管理器 ---------------- */
let aiCounter = 0;

/**
 * 生成一个 AI 玩家描述（给 Room 用）
 * @param {string} profileKey 性格；不传则随机
 * @param {string[]} takenNames 已被占用的名字，避免重名
 */
function makeAI(profileKey = null, takenNames = []) {
  const key = profileKey && PROFILES[profileKey]
    ? profileKey
    : PROFILE_KEYS[Math.floor(Math.random() * PROFILE_KEYS.length)];
  const P = PROFILES[key];

  // 先在本性格的名池里挑没被占用的；都被占用就换其它性格的名池
  const taken = new Set(takenNames.map(n => String(n)));
  let base = P.namePool.find(n => !taken.has(n));
  if (!base) {
    const all = PROFILE_KEYS.flatMap(k => PROFILES[k].namePool);
    base = all.find(n => !taken.has(n));
  }
  // 实在都占用了，加个编号后缀
  if (!base) {
    let i = 2;
    while (taken.has(`${P.namePool[0]}${i}`)) i++;
    base = `${P.namePool[0]}${i}`;
  }

  aiCounter++;
  return {
    id: 'ai' + aiCounter.toString(36) + Math.random().toString(36).slice(2, 5),
    name: base,
    profile: key,
    profileLabel: P.label,
    isAI: true,
  };
}

module.exports = {
  PROFILES, PROFILE_KEYS, decide, estimateEquity,
  preflopStrength, makeAI,
};
