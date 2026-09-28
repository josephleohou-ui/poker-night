/**
 * 德州扑克核心引擎
 * 纯逻辑，不依赖任何框架。可单独测试。
 *
 * 术语:
 *  seat   - 座位索引
 *  stack  - 筹码量
 *  pot    - 主池
 *  side   - 边池 (side pot)
 */

'use strict';

const SUITS = ['s', 'h', 'd', 'c']; // 黑桃 红桃 方块 梅花
const RANKS = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];

// ---------- 牌 ----------
function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(r + s);
  return deck;
}

function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function rankValue(r) {
  return RANKS.indexOf(r); // 0..12
}

// ---------- 牌型评估 ----------
// 返回 { score: Number, name: String }  score 越大越强
// score 用 5 个 base-15 位打包，方便直接比较
const HAND_NAMES = [
  '高牌', '一对', '两对', '三条', '顺子',
  '同花', '葫芦', '四条', '同花顺', '皇家同花顺'
];

function evaluate7(cards) {
  // 从 7 张里选 5 张的所有组合，取最大
  let best = null;
  const n = cards.length;
  const idx = [0, 1, 2, 3, 4];
  // 组合迭代
  const combo = (start, picked) => {
    if (picked.length === 5) {
      const r = evaluate5(picked);
      if (!best || r.score > best.score) best = r;
      return;
    }
    for (let i = start; i < n; i++) {
      picked.push(cards[i]);
      combo(i + 1, picked);
      picked.pop();
    }
  };
  combo(0, []);
  return best;
}

function evaluate5(cards) {
  const ranks = cards.map(c => rankValue(c[0])).sort((a, b) => b - a);
  const suits = cards.map(c => c[1]);

  const isFlush = suits.every(s => s === suits[0]);

  // 顺子检测（含 A2345）
  const uniq = [...new Set(ranks)].sort((a, b) => b - a);
  let straightHigh = -1;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 12 && uniq[1] === 3 && uniq[4] === 0) straightHigh = 3; // A2345 -> 5 高
  }

  // 计数
  const counts = {};
  for (const r of ranks) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.entries(counts)
    .map(([r, c]) => ({ r: Number(r), c }))
    .sort((a, b) => (b.c - a.c) || (b.r - a.r));

  const kickerScore = (rankArr) => {
    // rankArr 长度 5, 每个 0..12, 打包
    let s = 0;
    for (const v of rankArr) s = s * 15 + (v + 1);
    return s;
  };

  let category, packRanks;

  if (isFlush && straightHigh >= 0) {
    category = straightHigh === 12 ? 9 : 8;
    packRanks = [straightHigh];
  } else if (groups[0].c === 4) {
    category = 7;
    packRanks = [groups[0].r, groups[1].r];
  } else if (groups[0].c === 3 && groups[1] && groups[1].c === 2) {
    category = 6;
    packRanks = [groups[0].r, groups[1].r];
  } else if (isFlush) {
    category = 5;
    packRanks = ranks;
  } else if (straightHigh >= 0) {
    category = 4;
    packRanks = [straightHigh];
  } else if (groups[0].c === 3) {
    category = 3;
    packRanks = [groups[0].r, groups[1].r, groups[2].r];
  } else if (groups[0].c === 2 && groups[1] && groups[1].c === 2) {
    category = 2;
    packRanks = [groups[0].r, groups[1].r, groups[2].r];
  } else if (groups[0].c === 2) {
    category = 1;
    packRanks = [groups[0].r, groups[1].r, groups[2].r, groups[3].r];
  } else {
    category = 0;
    packRanks = ranks;
  }

  // 最终 score: category 占高位
  let score = category;
  for (let i = 0; i < 5; i++) {
    const v = packRanks[i] !== undefined ? packRanks[i] : -1;
    score = score * 15 + (v + 1);
  }

  return { score, category, name: HAND_NAMES[category], packRanks };
}

// ---------- 游戏状态机 ----------
const STREET = { PREFLOP: 0, FLOP: 1, TURN: 2, RIVER: 3, SHOWDOWN: 4 };

class Player {
  constructor(id, name, seat, chips) {
    this.id = id;
    this.name = name;
    this.seat = seat;
    this.chips = chips;
    this.hole = [];
    this.bet = 0;          // 本轮已投入
    this.totalBet = 0;     // 本手总投入（用于边池）
    this.folded = false;
    this.allin = false;
    this.acted = false;    // 本轮是否已行动
    this.sittingOut = false;
    this.lastAction = null;
    this.handResult = null; // 摊牌时填充
  }
  get inHand() { return !this.folded && !this.sittingOut && this.hole.length > 0; }
  get canAct() { return this.inHand && !this.allin; }
}

class PokerGame {
  constructor(opts = {}) {
    this.smallBlind = opts.smallBlind || 10;
    this.bigBlind = opts.bigBlind || 20;
    this.startChips = opts.startChips || 1000;
    this.players = [];      // 按座位序
    this.deck = [];
    this.board = [];
    this.pot = 0;
    this.street = STREET.PREFLOP;
    this.dealerSeat = -1;
    this.currentSeat = -1;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.running = false;
    this.handNumber = 0;
    this.log = [];
    this.lastWinners = null;
  }

  seatCount() { return this.players.length; }

  getPlayerBySeat(seat) { return this.players.find(p => p.seat === seat); }
  getPlayerById(id) { return this.players.find(p => p.id === id); }

  activePlayers() { return this.players.filter(p => p.inHand); }
  actablePlayers() { return this.players.filter(p => p.canAct); }

  // 找到下一个座位的玩家（按下标循环）
  nextSeat(fromSeat, filter) {
    const n = this.seatCount();
    if (n === 0) return -1;
    let s = fromSeat;
    for (let i = 1; i <= n; i++) {
      s = (fromSeat + i) % n;
      const p = this.getPlayerBySeat(s);
      if (p && (!filter || filter(p))) return s;
    }
    return -1;
  }

  // ---------- 开局 ----------
  startHand() {
    const eligible = this.players.filter(p => p.chips > 0 && !p.sittingOut);
    if (eligible.length < 2) {
      this.pushLog('人数不足，无法开局');
      return false;
    }

    this.handNumber++;
    this.deck = shuffle(makeDeck());
    this.board = [];
    this.pot = 0;
    this.street = STREET.PREFLOP;
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastWinners = null;

    for (const p of this.players) {
      p.hole = [];
      p.bet = 0;
      p.totalBet = 0;
      p.folded = p.chips <= 0 || p.sittingOut;
      p.allin = false;
      p.acted = false;
      p.lastAction = null;
      p.handResult = null;
    }

    // 移动庄家位
    this.dealerSeat = this.nextSeat(this.dealerSeat, p => !p.folded);
    if (this.dealerSeat < 0) this.dealerSeat = 0;

    // 盲注：人头数 == 2 时，庄家是小盲
    const aliveCount = this.players.filter(p => !p.folded).length;
    let sbSeat, bbSeat;
    if (aliveCount === 2) {
      sbSeat = this.dealerSeat;
      bbSeat = this.nextSeat(this.dealerSeat, p => !p.folded);
    } else {
      sbSeat = this.nextSeat(this.dealerSeat, p => !p.folded);
      bbSeat = this.nextSeat(sbSeat, p => !p.folded);
    }

    this.postBlind(sbSeat, this.smallBlind, '小盲');
    this.postBlind(bbSeat, this.bigBlind, '大盲');
    this.currentBet = this.bigBlind;

    // 发底牌
    for (let round = 0; round < 2; round++) {
      let s = sbSeat;
      for (let i = 0; i < aliveCount; i++) {
        this.getPlayerBySeat(s).hole.push(this.deck.pop());
        s = this.nextSeat(s, p => !p.folded);
      }
    }

    // 行动从大盲下家开始
    this.currentSeat = this.nextSeat(bbSeat, p => p.canAct);
    this.running = true;

    this.pushLog(`第 ${this.handNumber} 手开始，庄家位：${this.getPlayerBySeat(this.dealerSeat).name}`);
    if (this.actablePlayers().length <= 1) {
      // 全都 all-in 了，直接跑到摊牌
      this.dealRemainingAndShowdown();
    }
    return true;
  }

  postBlind(seat, amount, label) {
    const p = this.getPlayerBySeat(seat);
    if (!p) return;
    const real = Math.min(amount, p.chips);
    p.chips -= real;
    p.bet += real;
    p.totalBet += real;
    this.pot += real;
    if (p.chips === 0) p.allin = true;
    p.lastAction = label;
    this.pushLog(`${p.name} 下${label} ${real}`);
  }

  // ---------- 行动 ----------
  /** action: 'fold' | 'check' | 'call' | 'raise' | 'allin'  amount: 加注到的总额 */
  act(playerId, action, amount = 0) {
    if (!this.running) return { ok: false, msg: '本手未开始' };
    const p = this.getPlayerById(playerId);
    if (!p) return { ok: false, msg: '玩家不存在' };
    if (p.seat !== this.currentSeat) return { ok: false, msg: '还没轮到你' };
    if (!p.canAct) return { ok: false, msg: '你无法行动' };

    const toCall = Math.max(0, this.currentBet - p.bet);
    let msg = '';

    switch (action) {
      case 'fold': {
        p.folded = true;
        p.lastAction = '弃牌';
        this.pushLog(`${p.name} 弃牌`);
        break;
      }
      case 'check': {
        if (toCall > 0) return { ok: false, msg: '有下注，不能过牌' };
        p.lastAction = '过牌';
        this.pushLog(`${p.name} 过牌`);
        break;
      }
      case 'call': {
        if (toCall <= 0) return { ok: false, msg: '无需跟注' };
        const real = Math.min(toCall, p.chips);
        p.chips -= real;
        p.bet += real;
        p.totalBet += real;
        this.pot += real;
        if (p.chips === 0) p.allin = true;
        p.lastAction = p.allin ? '全下' : `跟注 ${real}`;
        this.pushLog(`${p.name} ${p.allin ? '全下' : '跟注'} ${real}`);
        break;
      }
      case 'raise':
      case 'allin': {
        const target = action === 'allin'
          ? p.bet + p.chips
          : Math.max(amount, this.currentBet + this.minRaise);
        if (target <= this.currentBet && action === 'raise') {
          return { ok: false, msg: '加注必须高于当前注额' };
        }
        const real = Math.min(target - p.bet, p.chips);
        const newBet = p.bet + real;
        p.chips -= real;
        p.bet = newBet;
        p.totalBet += real;
        this.pot += real;

        const raiseSize = newBet - this.currentBet;
        if (newBet > this.currentBet) {
          this.minRaise = Math.max(this.minRaise, raiseSize);
          this.currentBet = newBet;
          // 别人要重新行动
          for (const q of this.players) if (q !== p && q.canAct) q.acted = false;
        }
        if (p.chips === 0) p.allin = true;
        p.lastAction = p.allin ? `全下 ${newBet}` : `加注到 ${newBet}`;
        this.pushLog(`${p.name} ${p.allin ? '全下到' : '加注到'} ${newBet}`);
        break;
      }
      default:
        return { ok: false, msg: '未知操作' };
    }

    p.acted = true;
    this.advance();
    return { ok: true };
  }

  // 推进到下一个行动者或下一街
  advance() {
    if (this.activePlayers().length <= 1) {
      // 只剩一人 -> 直接结算
      this.endHandByFold();
      return;
    }
    if (this.actablePlayers().length === 0) {
      // 没人能行动了 -> 发完剩余公共牌摊牌
      this.dealRemainingAndShowdown();
      return;
    }

    // 找下一个能行动且未完成本轮的人
    let s = this.currentSeat;
    for (let i = 1; i <= this.seatCount(); i++) {
      s = (s + 1) % this.seatCount();
      const p = this.getPlayerBySeat(s);
      if (!p || !p.canAct) continue;
      const needCall = p.bet < this.currentBet;
      if (!p.acted || needCall) {
        this.currentSeat = s;
        return;
      }
    }

    // 本轮结束
    this.endStreet();
  }

  endStreet() {
    // 收注入池（其实已经累计在 pot 里了），重置 bet
    for (const p of this.players) {
      p.bet = 0;
      p.acted = false;
      if (p.lastAction && !p.folded) p.lastAction = null;
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;

    if (this.street === STREET.RIVER) {
      this.showdown();
      return;
    }

    this.street++;
    // 发公共牌
    this.deck.pop(); // burn
    if (this.street === STREET.FLOP) {
      this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
      this.pushLog(`翻牌：${this.board.join(' ')}`);
    } else if (this.street === STREET.TURN) {
      this.board.push(this.deck.pop());
      this.pushLog(`转牌：${this.board.join(' ')}`);
    } else if (this.street === STREET.RIVER) {
      this.board.push(this.deck.pop());
      this.pushLog(`河牌：${this.board.join(' ')}`);
    }

    // 从庄家下家开始
    this.currentSeat = this.nextSeat(this.dealerSeat, p => p.canAct);
    if (this.currentSeat < 0) this.dealRemainingAndShowdown();
  }

  dealRemainingAndShowdown() {
    while (this.board.length < 5) {
      this.deck.pop();
      if (this.board.length < 3) this.board.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
      else this.board.push(this.deck.pop());
    }
    if (this.street < STREET.RIVER) this.street = STREET.RIVER;
    this.showdown();
  }

  // ---------- 结算 ----------
  computePots() {
    // 按 totalBet 分层构建边池
    const contenders = this.players.filter(p => p.totalBet > 0 && !p.sittingOut);
    const levels = [...new Set(contenders.map(p => p.totalBet))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const lvl of levels) {
      let amount = 0;
      const eligible = [];
      for (const p of this.players) {
        const contrib = Math.min(p.totalBet, lvl) - Math.min(p.totalBet, prev);
        if (contrib > 0) amount += contrib;
        if (p.totalBet >= lvl && p.inHand) eligible.push(p);
      }
      if (amount > 0) pots.push({ amount, eligible });
      prev = lvl;
    }
    return pots;
  }

  endHandByFold() {
    const winner = this.activePlayers()[0];
    const total = this.pot;
    if (winner) winner.chips += total;
    this.pot = 0;
    this.running = false;
    this.street = STREET.SHOWDOWN;
    this.lastWinners = [{
      id: winner ? winner.id : null,
      name: winner ? winner.name : '-',
      amount: total,
      reason: '其他人弃牌'
    }];
    this.pushLog(`${winner ? winner.name : '-'} 赢得底池 ${total}（其他人弃牌）`);
  }

  showdown() {
    const alive = this.activePlayers();
    const pots = this.computePots();

    for (const p of alive) {
      const r = evaluate7([...p.hole, ...this.board]);
      p.handResult = r;
    }

    const results = [];
    for (const pot of pots) {
      const elig = pot.eligible.filter(p => p.handResult);
      if (elig.length === 0) continue;
      let best = -1;
      for (const p of elig) if (p.handResult.score > best) best = p.handResult.score;
      const winners = elig.filter(p => p.handResult.score === best);
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount - share * winners.length;
      // 余数给庄家下家的第一个赢家（简化：给第一个）
      for (const w of winners) {
        let got = share;
        if (remainder > 0) { got += 1; remainder--; }
        w.chips += got;
        results.push({
          id: w.id, name: w.name, amount: got,
          hand: w.handResult.name,
          cards: w.hole.slice()
        });
      }
    }

    // 合并同一玩家的多池奖金
    const merged = {};
    for (const r of results) {
      if (!merged[r.id]) merged[r.id] = { ...r, amount: 0 };
      merged[r.id].amount += r.amount;
    }

    this.pot = 0;
    this.running = false;
    this.street = STREET.SHOWDOWN;

    for (const p of this.players) {
      if (p.folded) p.handResult = null;
    }

    this.lastWinners = Object.values(merged);
    const names = this.lastWinners.map(w => `${w.name}(${w.hand}) +${w.amount}`).join('，');
    this.pushLog(`摊牌结束：${names}`);
  }

  pushLog(msg) {
    this.log.push(msg);
    if (this.log.length > 200) this.log.shift();
  }

  // ---------- 对外快照（按玩家过滤隐藏信息） ----------
  snapshot(forPlayerId = null) {
    const me = forPlayerId ? this.getPlayerById(forPlayerId) : null;
    const showAll = this.street === STREET.SHOWDOWN && !this.running;

    const players = this.players.map(p => ({
      id: p.id,
      name: p.name,
      seat: p.seat,
      chips: p.chips,
      bet: p.bet,
      folded: p.folded,
      allin: p.allin,
      sittingOut: p.sittingOut,
      lastAction: p.lastAction,
      isDealer: p.seat === this.dealerSeat,
      isTurn: p.seat === this.currentSeat && this.running,
      holeCount: p.hole.length,
      // 只给自己、或摊牌时的存活玩家看牌
      hole: (me && p.id === me.id) || (showAll && p.inHand) ? p.hole.slice() : null,
      handName: p.handResult ? p.handResult.name : null,
    }));

    return {
      seatCount: this.seatCount(),
      players,
      board: this.board.slice(),
      pot: this.pot,
      street: this.street,
      streetName: ['翻牌前', '翻牌', '转牌', '河牌', '摊牌'][this.street],
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      dealerSeat: this.dealerSeat,
      currentSeat: this.currentSeat,
      running: this.running,
      handNumber: this.handNumber,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      lastWinners: this.lastWinners,
      myId: forPlayerId,
      toCall: me ? Math.max(0, this.currentBet - (me.bet || 0)) : 0,
      log: this.log.slice(-30),
    };
  }
}

module.exports = {
  PokerGame, Player, makeDeck, shuffle, evaluate5, evaluate7,
  SUITS, RANKS, STREET, HAND_NAMES
};
