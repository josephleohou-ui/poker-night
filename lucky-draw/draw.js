/**
 * 抽奖规则（纯逻辑，方便单测）
 *
 * 奖项由「三段概率」决定：
 *   谢谢您的支持  89%   —— 常态，也是最真实的抽奖体感
 *   纸巾一包     10%   —— 小奖，偶尔来一下
 *   白酒一瓶      1%   —— 大奖，稀有
 *
 * 前端转盘只负责「演」：先看后端给定结果，再倒着算扇区落点，
 * 这样动画和结果永远一致，不会出现「指针停在白酒上却说谢谢参与」。
 */

const PRIZES = [
  {
    id: 'thanks',
    name: '谢谢您的支持',
    weight: 89,
    emoji: '🍀',
    // 转盘配色：两档灰绿交替，低调不刺眼
    colors: ['#3d4a52', '#46545d'],
    tip: '再接再厉，好运正在路上～'
  },
  {
    id: 'tissue',
    name: '纸巾一包',
    weight: 10,
    emoji: '🧻',
    colors: ['#d9b26a', '#e8c887'],
    tip: '实用小奖，抽到就是赚到！'
  },
  {
    id: 'baijiu',
    name: '白酒一瓶',
    weight: 1,
    emoji: '🍶',
    colors: ['#c0392b', '#e05a4a'],
    tip: '恭喜！今晚有好酒了 🎉'
  }
];

const TOTAL_WEIGHT = PRIZES.reduce((s, p) => s + p.weight, 0);

/**
 * 抽一次，返回奖项 id
 * @param {Function} rand 随机源，默认 Math.random（单测里替换成定值）
 */
function drawOnce(rand = Math.random) {
  let r = rand() * TOTAL_WEIGHT;
  for (const p of PRIZES) {
    r -= p.weight;
    if (r < 0) return p.id;
  }
  // 浮点边界兜底：rand() 恰好为 1 时落到最后一档
  return PRIZES[PRIZES.length - 1].id;
}

/**
 * 统计 n 次抽奖的分布，用于验证概率没写错
 * @returns {Object} 例 { thanks: 176148, tissue: 19954, baijiu: 3898 }
 */
function simulate(n = 10000, rand = Math.random) {
  const tally = {};
  for (const p of PRIZES) tally[p.id] = 0;
  for (let i = 0; i < n; i++) tally[drawOnce(rand)]++;
  return tally;
}

/** 公开展示用的奖项数据（去掉 weight 这类内部字段） */
function publicPrizes() {
  return PRIZES.map(({ id, name, emoji, colors, tip }) => ({ id, name, emoji, colors, tip }));
}

module.exports = { PRIZES, TOTAL_WEIGHT, drawOnce, simulate, publicPrizes };
