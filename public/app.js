/* ==========================================================
   德州扑克之夜 — 前端逻辑
   电子发牌员：Web Speech API 语音 + 文字弹窗
   ========================================================== */
'use strict';

const socket = io();
const $ = (id) => document.getElementById(id);

let ME = { id: null, name: '', roomCode: null, isHost: false };
let STATE = null;
let soundOn = true;
let dealerVoice = null;
let speechReady = false;

/* ---------------- 语音合成（电子发牌员） ---------------- */
function initSpeech() {
  if (!('speechSynthesis' in window)) return;
  const pick = () => {
    const voices = speechSynthesis.getVoices();
    if (!voices.length) return;
    // 优先中文女声
    dealerVoice =
      voices.find(v => /zh[-_]CN/i.test(v.lang) && /female|女|Ting|Mei|Xiao/i.test(v.name)) ||
      voices.find(v => /zh[-_]CN/i.test(v.lang)) ||
      voices.find(v => /zh/i.test(v.lang)) ||
      voices[0];
    speechReady = true;
  };
  pick();
  speechSynthesis.onvoiceschanged = pick;
}
initSpeech();

function speak(text) {
  if (!soundOn || !('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (dealerVoice) u.voice = dealerVoice;
    u.lang = 'zh-CN';
    u.rate = 1.02;
    u.pitch = 1.06;   // 略高，像发牌员
    u.volume = 0.95;
    speechSynthesis.speak(u);
  } catch (e) { /* 忽略 */ }
}

/* 中文数字读法，让语音更自然 */
const SUIT_CN = { s: '黑桃', h: '红桃', d: '方块', c: '梅花' };
const RANK_CN = { '2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9','T':'10','J':'J','Q':'Q','K':'K','A':'A' };
function cardToSpeech(card) {
  const r = card[0], s = card[1];
  return SUIT_CN[s] + RANK_CN[r];
}
function cardsToSpeech(cards) {
  return cards.map(cardToSpeech).join('、');
}

/* 发牌员：弹窗 + 语音 */
let toastTimer = null;
function dealerSay(text, kind = 'info', speakText = null) {
  const t = $('dealerToast');
  $('dealerText').textContent = text;
  t.className = 'dealer-toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  speak(speakText || text);
}

socket.on('dealer', (ev) => {
  // 优化播报文本（牌面用中文）
  let sp = ev.text;
  if (ev.kind === 'board') {
    const m = ev.text.match(/^(.+?)：(.+)$/);
    if (m) {
      const cards = m[2].trim().split(/\s+/);
      sp = m[1] + '、' + cardsToSpeech(cards);
    }
  }
  dealerSay(ev.text, ev.kind, sp);
});

/* ---------------- 大厅 ---------------- */
function nickname() {
  let n = $('nickname').value.trim();
  if (!n) {
    n = '玩家' + Math.floor(Math.random() * 90 + 10);
    $('nickname').value = n;
  }
  return n;
}

$('btnCreate').onclick = () => {
  const blinds = $('optBlinds').value.split(',').map(Number);
  socket.emit('createRoom', {
    name: nickname(),
    opts: {
      startChips: Number($('optChips').value),
      smallBlind: blinds[0],
      bigBlind: blinds[1],
    }
  }, (res) => {
    if (!res.ok) return alert(res.msg || '创建失败');
    enterTable(res);
  });
};

$('btnJoin').onclick = () => {
  const code = $('roomCodeInput').value.trim();
  if (!/^\d{4,5}$/.test(code)) return alert('请输入 4-5 位数字房间号');
  socket.emit('joinRoom', { name: nickname(), code }, (res) => {
    if (!res.ok) return alert(res.msg || '加入失败');
    enterTable(res);
  });
};

$('roomCodeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnJoin').click(); });

function enterTable(res) {
  ME.id = res.playerId;
  ME.roomCode = res.roomCode;
  ME.name = nickname();
  localStorage.setItem('poker_last', JSON.stringify({ code: res.roomCode, playerId: res.playerId, name: ME.name }));
  $('lobby').classList.remove('active');
  $('table').classList.add('active');
  $('tbCode').textContent = res.roomCode;
}

/* 断线重连 */
window.addEventListener('load', () => {
  if (location.hash === '#norestore') return;
  try {
    const last = JSON.parse(localStorage.getItem('poker_last') || 'null');
    if (last && last.code) {
      $('nickname').value = last.name || '';
      socket.emit('rejoin', last, (res) => {
        if (res && res.ok) {
          ME.id = res.playerId; ME.roomCode = res.roomCode; ME.name = last.name;
          $('lobby').classList.remove('active');
          $('table').classList.add('active');
          $('tbCode').textContent = res.roomCode;
        }
      });
    }
  } catch (e) {}
});

/* ---------------- 渲染状态 ---------------- */
socket.on('state', (s) => {
  STATE = s;
  ME.isHost = s.isHost;
  $('tbCode').textContent = s.roomCode;
  $('tbStreet').textContent = s.running
    ? `${s.streetName} · 第${s.handNumber}手`
    : (s.handNumber ? '本手结束' : '等待开始');

  renderBoard(s);
  renderSeats(s);
  renderMyPanel(s);
  renderControls(s);
  renderResult(s);
});

function renderBoard(s) {
  const b = $('board');
  b.innerHTML = '';
  const shown = s.board.length;
  for (let i = 0; i < 5; i++) {
    if (i < shown) b.appendChild(makeCard(s.board[i], false, true));
    else b.appendChild(makePlaceholder());
  }
  $('potValue').textContent = s.pot || 0;
}

function makeCard(card, small, animate) {
  const el = document.createElement('div');
  el.className = 'card' + (small ? ' small' : '') + (animate ? ' new' : '');
  const r = card[0], suit = card[1];
  const isRed = suit === 'h' || suit === 'd';
  if (isRed) el.classList.add('red');
  const chain = { s: '♠', h: '♥', d: '♦', c: '♣' }[suit];
  const rankTxt = r === 'T' ? '10' : r;
  el.innerHTML = `<div class="c-top">${rankTxt}<br>${chain}</div>
                  <div class="c-mid">${chain}</div>
                  <div class="c-bottom">${rankTxt}<br>${chain}</div>`;
  return el;
}
function makeBack(small) {
  const el = document.createElement('div');
  el.className = 'card back' + (small ? ' small' : '');
  el.innerHTML = `<div class="c-mid">🂠</div>`;
  return el;
}
function makePlaceholder() {
  const el = document.createElement('div');
  el.className = 'card placeholder';
  return el;
}

/* 座位椭圆布局 */
function seatPositions(n) {
  // 围绕椭圆均匀分布，开角在上下（避免被我的面板挡住）
  const pos = [];
  const cx = 50, cy = 52, rx = 42, ry = 36;
  if (n === 1) return [[50, 22]];
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2; // 从顶部开始
    pos.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }
  return pos;
}

function renderSeats(s) {
  const wrap = $('seats');
  wrap.innerHTML = '';
  const list = s.players.slice().sort((a, b) => a.seat - b.seat);
  const n = Math.max(list.length, 2);
  const positions = seatPositions(n);

  // 找到"我"的座位，旋转布局让"我"在下方
  const meIdx = list.findIndex(p => p.id === ME.id);
  const ordered = [];
  for (let i = 0; i < list.length; i++) {
    const idx = meIdx >= 0 ? (meIdx + i) % list.length : i;
    ordered.push({ p: list[idx], pos: positions[i] });
  }

  for (const { p, pos } of ordered) {
    const el = document.createElement('div');
    el.className = 'seat' + (p.isTurn ? ' turn' : '') + (p.folded ? ' folded' : '')
      + (p.id === ME.id ? ' me' : '') + (p.connected === false ? ' offline' : '');
    el.style.left = pos[0] + '%';
    el.style.top = pos[1] + '%';

    const showCards = p.hole && p.hole.length === 2;
    let cardsHtml = '';
    if (showCards) {
      cardsHtml = `<div class="seat-cards">${p.hole.map(c => {
        const isRed = c[1] === 'h' || c[1] === 'd';
        const chain = { s: '♠', h: '♥', d: '♦', c: '♣' }[c[1]];
        const rt = c[0] === 'T' ? '10' : c[0];
        return `<div class="mini-card" style="${isRed ? 'color:#f0a49c' : ''}">${rt}${chain}</div>`;
      }).join('')}</div>`;
    } else if (p.holeCount >= 1 && !p.folded) {
      cardsHtml = `<div class="seat-cards">${Array(p.holeCount).fill('<div class="mini-card" style="background:linear-gradient(150deg,#2e5f8a,#1d3f5e)"></div>').join('')}</div>`;
    }

    el.innerHTML = `
      <div class="seat-inner">
        ${p.isDealer ? '<div class="badge-dealer">D</div>' : ''}
        ${p.allin ? '<div class="badge-allin">ALL IN</div>' : ''}
        <div class="seat-name">${esc(p.name)}${p.id === ME.id ? ' (你)' : ''}</div>
        <div class="seat-chips">💰 ${p.chips}</div>
        ${cardsHtml}
        <div class="seat-action">${p.folded ? '已弃牌' : esc(p.lastAction || '')}</div>
        ${p.bet > 0 ? `<div class="seat-bet">${p.bet}</div>` : ''}
      </div>`;
    wrap.appendChild(el);
  }
}

function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function renderMyPanel(s) {
  const me = s.players.find(p => p.id === ME.id);
  const hole = $('myHole');
  hole.innerHTML = '';
  if (me && me.hole && me.hole.length) {
    me.hole.forEach(c => hole.appendChild(makeCard(c, false, false)));
  } else {
    hole.appendChild(makePlaceholder());
    hole.appendChild(makePlaceholder());
  }
  $('myName').textContent = ME.name || '我';
  $('myChips').textContent = me ? me.chips : 0;
  $('myHandName').textContent = me && me.handName ? me.handName : '';
}

/* 操作按钮 */
let pendingRaise = null;
function renderControls(s) {
  const c = $('controls');
  const me = s.players.find(p => p.id === ME.id);

  if (!s.running) {
    c.innerHTML = '';
    const alive = s.players.filter(p => p.chips > 0).length;
    if (s.isHost) {
      const b = document.createElement('button');
      b.className = 'ctrl-btn host-btn';
      b.innerHTML = alive >= 2 ? '开始发牌 <span class="sub">房主操作</span>' : '等待玩家';
      b.disabled = alive < 2;
      b.onclick = () => socket.emit('startHand');
      c.appendChild(b);
    } else {
      const d = document.createElement('div');
      d.className = 'waiting';
      d.textContent = alive >= 2 ? '等待房主开始发牌…' : '等待更多玩家加入…';
      c.appendChild(d);
    }
    // 补码按钮
    if (me && me.chips < s.bigBlind) {
      const rb = document.createElement('button');
      rb.className = 'ctrl-btn ctrl-check';
      rb.style.flex = '0 0 110px';
      rb.innerHTML = `补充筹码 <span class="sub">回到 ${s.startChips || 1000}</span>`;
      rb.onclick = () => socket.emit('rebuy');
      c.appendChild(rb);
    }
    return;
  }

  const isMyTurn = me && me.id === ME.id && me.isTurn;
  if (!isMyTurn) {
    c.innerHTML = '';
    const d = document.createElement('div');
    d.className = 'waiting';
    if (!me) d.textContent = '观战中…';
    else if (me.folded) d.textContent = '你已弃牌，等待这手结束';
    else if (me.allin) d.textContent = '你已全下，等待摊牌';
    else d.textContent = '等待对手行动…';
    c.appendChild(d);
    return;
  }

  // 我该行动
  const toCall = s.toCall || 0;
  const canCheck = toCall === 0;
  const minRaiseTo = Math.max(s.currentBet + s.minRaise, s.currentBet + s.bigBlind);
  const maxRaiseTo = me.chips + me.bet;
  pendingRaise = pendingRaise === null ? minRaiseTo : pendingRaise;
  pendingRaise = Math.max(minRaiseTo, Math.min(pendingRaise, maxRaiseTo));

  c.innerHTML = '';

  // 弃牌
  const bFold = document.createElement('button');
  bFold.className = 'ctrl-btn ctrl-fold';
  bFold.innerHTML = `弃牌 <span class="sub">Fold</span>`;
  bFold.onclick = () => act('fold');
  c.appendChild(bFold);

  // 过牌 / 跟注
  if (canCheck) {
    const b = document.createElement('button');
    b.className = 'ctrl-btn ctrl-check';
    b.innerHTML = `过牌 <span class="sub">Check</span>`;
    b.onclick = () => act('check');
    c.appendChild(b);
  } else {
    const b = document.createElement('button');
    b.className = 'ctrl-btn ctrl-call';
    const real = Math.min(toCall, me.chips);
    b.innerHTML = `${real >= me.chips ? '全下跟注' : '跟注'} ${real} <span class="sub">Call</span>`;
    b.onclick = () => act('call');
    c.appendChild(b);
  }

  // 加注
  const canRaise = maxRaiseTo > s.currentBet && me.chips > toCall;
  if (canRaise) {
    const b = document.createElement('button');
    b.className = 'ctrl-btn ctrl-raise';
    b.innerHTML = `加注到 ${pendingRaise} <span class="sub">Raise</span>`;
    b.onclick = () => act('raise', pendingRaise);
    c.appendChild(b);
  }

  // 全下
  const bAll = document.createElement('button');
  bAll.className = 'ctrl-btn ctrl-allin';
  const allinTo = me.chips + me.bet;
  bAll.innerHTML = `全下 ${allinTo} <span class="sub">All-in</span>`;
  bAll.onclick = () => {
    if (confirm(`确认全下 ${allinTo} 筹码？`)) act('allin');
  };
  c.appendChild(bAll);

  // 加注滑条
  if (canRaise) {
    const row = document.createElement('div');
    row.className = 'raise-row';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = minRaiseTo;
    slider.max = maxRaiseTo;
    slider.step = s.bigBlind;
    slider.value = pendingRaise;
    const val = document.createElement('div');
    val.className = 'raise-val';
    val.textContent = pendingRaise;
    slider.oninput = () => {
      pendingRaise = Number(slider.value);
      val.textContent = pendingRaise;
      b.innerHTML = `加注到 ${pendingRaise} <span class="sub">Raise</span>`;
    };
    row.appendChild(slider);
    row.appendChild(val);
    c.appendChild(row);
  }
}

function act(action, amount) {
  socket.emit('action', { action, amount }, (res) => {
    if (res && !res.ok) dealerSay(res.msg, 'warn', '不行，' + res.msg);
    pendingRaise = null;
  });
}

/* 结果横幅 */
let resultTimer = null;
function renderResult(s) {
  const el = $('resultBanner');
  if (s.running || !s.lastWinners || !s.lastWinners.length) {
    el.classList.remove('show');
    return;
  }
  // 避免重复弹（同一手）
  const key = 'r' + s.handNumber;
  if (el.dataset.key === key) return;
  el.dataset.key = key;

  el.innerHTML = '<div class="rb-title">本手结果</div>' +
    s.lastWinners.map(w =>
      `<div class="rb-winner">${esc(w.name)} +${w.amount}</div>
       <div class="rb-hand">${esc(w.hand || '对手弃牌')}</div>`
    ).join('');
  el.classList.add('show');
  clearTimeout(resultTimer);
  resultTimer = setTimeout(() => el.classList.remove('show'), 5000);
}

/* 我的底牌播报（轮到我时提示） */
let lastTurnKey = null;
setInterval(() => {
  if (!STATE || !STATE.running) return;
  const me = STATE.players.find(p => p.id === ME.id);
  if (me && me.isTurn) {
    const key = STATE.handNumber + '-' + STATE.street + '-' + me.bet;
    if (lastTurnKey !== key) {
      lastTurnKey = key;
      const toCall = STATE.toCall || 0;
      const msg = toCall > 0 ? `轮到你了，需要跟注 ${toCall}` : '轮到你了，可以过牌或加注';
      dealerSay(msg, 'info');
    }
  }
}, 400);

/* ---------------- 聊天 ---------------- */
$('btnChat').onclick = () => $('chatPanel').classList.toggle('open');
$('chatClose').onclick = () => $('chatPanel').classList.remove('open');
$('chatSend').onclick = sendChat;
$('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
function sendChat() {
  const v = $('chatInput').value.trim();
  if (!v) return;
  socket.emit('chat', { text: v });
  $('chatInput').value = '';
}
socket.on('chat', (m) => {
  const log = $('chatLog');
  const d = document.createElement('div');
  d.innerHTML = `<span class="cl-name">${esc(m.name)}:</span> ${esc(m.text)}`;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
});

/* ---------------- 其它 ---------------- */
$('btnLeave').onclick = () => {
  if (!confirm('确定退出房间？')) return;
  localStorage.removeItem('poker_last');
  location.href = '/#norestore';
  location.reload();
};

$('btnToggleSound').onclick = () => {
  soundOn = !soundOn;
  $('btnToggleSound').textContent = soundOn ? '🔊' : '🔇';
  if (!soundOn && 'speechSynthesis' in window) speechSynthesis.cancel();
  if (soundOn) dealerSay('语音已开启', 'info');
};

$('btnRules').onclick = () => $('rulesModal').classList.add('open');
$('rulesClose').onclick = () => $('rulesModal').classList.remove('open');

// iPad 需要一次用户交互才能解锁语音
document.addEventListener('touchstart', function unlock() {
  try {
    if ('speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance('');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch (e) {}
  document.removeEventListener('touchstart', unlock);
}, { once: true });

// 防止双指缩放干扰
document.addEventListener('gesturestart', e => e.preventDefault());
// 防止滚动橡皮筋
document.body.addEventListener('touchmove', e => {
  if (e.target.closest('.chat-log, #lobby, .modal-box')) return;
  if (e.touches.length > 1) e.preventDefault();
}, { passive: false });
