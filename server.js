/**
 * 德州扑克局域网服务器
 * - Express 提供静态页面
 * - Socket.IO 做实时通信
 * - 房间号加入，每桌一个 PokerGame 实例
 * - 快照按玩家过滤，底牌只有自己可见
 */
'use strict';

const path = require('path');
const http = require('http');
const os = require('os');
const express = require('express');
const { Server } = require('socket.io');
const { PokerGame, Player } = require('./poker');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 30000,
});

app.use(express.static(path.join(__dirname, 'public')));

/** rooms: Map<code, Room> */
const rooms = new Map();

class Room {
  constructor(code, hostSocketId, opts = {}) {
    this.code = code;
    this.hostId = hostSocketId;
    this.game = new PokerGame({
      smallBlind: opts.smallBlind || 10,
      bigBlind: opts.bigBlind || 20,
      startChips: opts.startChips || 1000,
    });
    this.members = new Map(); // socketId -> { id, name, seat, connected }
    this.createdAt = Date.now();
    this.pendingDealerEvents = [];
    this.autoNextTimer = null;
  }

  freeSeat() {
    const used = new Set([...this.members.values()].map(m => m.seat));
    for (let i = 0; i < 9; i++) if (!used.has(i)) return i;
    return -1;
  }

  addMember(socketId, name) {
    const seat = this.freeSeat();
    if (seat < 0) return null;
    // 生成稳定短 id（用于游戏逻辑）
    const pid = 'u' + Math.random().toString(36).slice(2, 8);
    const m = { id: pid, name, seat, connected: true, socketId };
    this.members.set(socketId, m);
    this.rebuildPlayers();
    // 本手进行中进来的，先坐等下一手
    if (this.game.running) {
      const p = this.game.getPlayerById(pid);
      if (p) p.sittingOut = true;
    }
    return m;
  }

  removeMember(socketId) {
    const m = this.members.get(socketId);
    if (!m) return null;
    m.connected = false;
    this.members.delete(socketId);
    this.rebuildPlayers();
    return m;
  }

  // 把成员同步进游戏引擎（保留已有筹码和状态）
  rebuildPlayers() {
    const g = this.game;
    const existing = new Map(g.players.map(p => [p.id, p]));
    const sorted = [...this.members.values()].sort((a, b) => a.seat - b.seat);
    const newPlayers = [];
    for (const m of sorted) {
      const old = existing.get(m.id);
      const p = new Player(m.id, m.name, m.seat, old ? old.chips : g.startChips);
      if (old) {
        p.chips = old.chips;
        p.sittingOut = old.sittingOut;
      }
      newPlayers.push(p);
    }
    g.players = newPlayers;
  }

  isHost(socketId) { return this.hostId === socketId; }
}

// 生成唯一房间号（4位数字，避免歧义）
function genRoomCode() {
  for (let tries = 0; tries < 200; tries++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  return String(Math.floor(10000 + Math.random() * 90000));
}

function roomListFor(room) {
  return [...room.members.values()]
    .sort((a, b) => a.seat - b.seat)
    .map(m => ({ id: m.id, name: m.name, seat: m.seat, connected: m.connected }));
}

function broadcast(room) {
  for (const [socketId, m] of room.members) {
    const sock = io.sockets.sockets.get(socketId);
    if (!sock) continue;
    sock.emit('state', {
      ...room.game.snapshot(m.id),
      roomCode: room.code,
      hostId: room.members.get(room.hostId) ? room.members.get(room.hostId).id : null,
      isHost: socketId === room.hostId,
      members: roomListFor(room),
    });
  }
}

// 生成发牌员语音事件（给前端 TTS / 弹窗）
function dealerSay(room, text, kind = 'info') {
  const ev = { text, kind, ts: Date.now() };
  for (const [socketId] of room.members) {
    const sock = io.sockets.sockets.get(socketId);
    if (sock) sock.emit('dealer', ev);
  }
}

function getRoomOf(socketId) {
  for (const room of rooms.values()) if (room.members.has(socketId)) return room;
  return null;
}

function checkAutoNext(room) {
  const g = room.game;
  if (g.running) return;
  // 一手结束后 8 秒自动开下一手（仅当还有人）
  if (room.autoNextTimer) return;
  const alive = room.members.size;
  if (alive < 2) return;
  room.autoNextTimer = setTimeout(() => {
    room.autoNextTimer = null;
    if (!rooms.has(room.code)) return;
    startNewHand(room);
  }, 8000);
}

function startNewHand(room) {
  const g = room.game;
  room.rebuildPlayers();
  // 新手在下一手上桌
  for (const p of g.players) p.sittingOut = false;
  if (g.players.filter(p => p.chips > 0).length < 2) {
    dealerSay(room, '筹码不足两位玩家，等待补充', 'warn');
    return;
  }
  g.startHand();
  // 播报
  const blinds = g.players.filter(p => p.lastAction === '小盲' || p.lastAction === '大盲');
  dealerSay(room, `第 ${g.handNumber} 手，开始发牌。小盲 ${g.smallBlind}，大盲 ${g.bigBlind}`, 'deal');
  broadcast(room);
}

// ---------- Socket 事件 ----------
io.on('connection', (socket) => {
  socket.on('createRoom', ({ name, opts } = {}, cb) => {
    const code = genRoomCode();
    const room = new Room(code, socket.id, opts || {});
    rooms.set(code, room);
    const m = room.addMember(socket.id, (name || '玩家').slice(0, 12));
    socket.join(code);
    socket.data.roomCode = code;
    cb && cb({ ok: true, roomCode: code, playerId: m.id });
    dealerSay(room, `欢迎来到房间 ${code}，等待玩家加入`, 'info');
    broadcast(room);
  });

  socket.on('joinRoom', ({ name, code } = {}, cb) => {
    if (!code) return cb && cb({ ok: false, msg: '请输入房间号' });
    code = String(code).trim();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, msg: '房间不存在，请检查房间号' });
    if (room.members.size >= 9) return cb && cb({ ok: false, msg: '房间已满（最多9人）' });
    const m = room.addMember(socket.id, (name || '玩家').slice(0, 12));
    if (!m) return cb && cb({ ok: false, msg: '没有空座位' });
    socket.join(code);
    socket.data.roomCode = code;
    cb && cb({ ok: true, roomCode: code, playerId: m.id });
    if (room.game.running) {
      // 本手进行中：可旁观，下一手自动上桌
      dealerSay(room, `${m.name} 加入了房间，将在下一手上桌`, 'join');
    } else {
      dealerSay(room, `${m.name} 加入了房间`, 'join');
    }
    broadcast(room);
  });

  socket.on('rejoin', ({ code, playerId, name } = {}, cb) => {
    const room = rooms.get(String(code || '').trim());
    if (!room) return cb && cb({ ok: false, msg: '房间已关闭' });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    // 找空位或复用
    let m = [...room.members.values()].find(x => x.id === playerId);
    if (m) {
      room.members.delete(m.socketId);
      m.socketId = socket.id;
      m.connected = true;
      room.members.set(socket.id, m);
    } else {
      m = room.addMember(socket.id, name || '玩家');
    }
    cb && cb({ ok: true, roomCode: room.code, playerId: m.id });
    broadcast(room);
  });

  socket.on('startHand', () => {
    const room = getRoomOf(socket.id);
    if (!room) return;
    if (!room.isHost(socket.id)) {
      socket.emit('dealer', { text: '只有房主可以开始游戏', kind: 'warn' });
      return;
    }
    if (room.game.running) return;
    if (room.autoNextTimer) { clearTimeout(room.autoNextTimer); room.autoNextTimer = null; }
    startNewHand(room);
  });

  socket.on('action', ({ action, amount } = {}, cb) => {
    const room = getRoomOf(socket.id);
    if (!room) return cb && cb({ ok: false, msg: '不在房间中' });
    const m = room.members.get(socket.id);
    const g = room.game;
    const before = g.street;
    const res = g.act(m.id, action, amount);
    if (!res.ok) return cb && cb(res);

    const p = g.getPlayerById(m.id);

    // 发牌员播报关键动作
    if (action === 'fold') dealerSay(room, `${m.name} 弃牌`, 'action');
    else if (action === 'call') dealerSay(room, `${m.name} 跟注 ${p.bet}`, 'action');
    else if (action === 'check') dealerSay(room, `${m.name} 过牌`, 'action');
    else if (action === 'raise' || action === 'allin')
      dealerSay(room, `${m.name} ${action === 'allin' ? '全下' : '加注到'} ${p.bet}`, 'action');

    // 街道推进播报
    if (g.street !== before && g.board.length) {
      const names = ['', '翻牌', '转牌', '河牌'];
      if (g.street >= 1 && g.street <= 3) {
        dealerSay(room, `${names[g.street]}：${g.board.join(' ')}`, 'board');
      }
    }

    // 结算播报
    if (!g.running && g.lastWinners && g.lastWinners.length) {
      const txt = g.lastWinners.map(w => `${w.name} 以${w.hand || '对手弃牌'}赢得 ${w.amount}`).join('，');
      dealerSay(room, txt, 'win');
    }

    broadcast(room);
    cb && cb({ ok: true });
    checkAutoNext(room);
  });

  socket.on('chat', ({ text } = {}) => {
    const room = getRoomOf(socket.id);
    if (!room) return;
    const m = room.members.get(socket.id);
    const t = String(text || '').slice(0, 100);
    if (!t) return;
    for (const [sid] of room.members) {
      const s = io.sockets.sockets.get(sid);
      if (s) s.emit('chat', { name: m.name, text: t, ts: Date.now() });
    }
  });

  socket.on('rebuy', () => {
    const room = getRoomOf(socket.id);
    if (!room || room.game.running) return;
    const m = room.members.get(socket.id);
    room.rebuildPlayers();
    const p = room.game.getPlayerById(m.id);
    if (p && p.chips < room.game.bigBlind) {
      p.chips = room.game.startChips;
      dealerSay(room, `${m.name} 补充筹码到 ${room.game.startChips}`, 'info');
    }
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const room = getRoomOf(socket.id);
    if (!room) return;
    const m = room.members.get(socket.id);
    room.removeMember(socket.id);
    if (m) dealerSay(room, `${m.name} 断开了连接`, 'warn');
    if (room.members.size === 0) {
      if (room.autoNextTimer) clearTimeout(room.autoNextTimer);
      rooms.delete(room.code);
      console.log(`房间 ${room.code} 已关闭`);
      return;
    }
    // 房主走了，转移给下一个人
    if (room.hostId === socket.id) {
      room.hostId = [...room.members.keys()][0];
    }
    broadcast(room);
  });
});

// 定期清理 12 小时无人的空房
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.members.size === 0 || now - room.createdAt > 12 * 3600 * 1000) {
      rooms.delete(code);
    }
  }
}, 60 * 60 * 1000);

// ---------- 启动 ----------
function localIPs() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    }
  }
  return out;
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = localIPs();
  console.log('\n  🃏  德州扑克之夜 — 服务器已启动\n');
  console.log('  本机访问:  http://localhost:' + PORT);
  if (ips.length) {
    console.log('  局域网访问（iPad 输这个）:');
    for (const ip of ips) console.log('     http://' + ip + ':' + PORT);
  } else {
    console.log('  ⚠ 未检测到局域网 IP，请确认已连 Wi-Fi');
  }
  console.log('\n  让 iPad 连同一个 Wi-Fi，浏览器打开上面地址，输入房间号即可。');
  console.log('  按 Ctrl+C 停止服务器。\n');

  // 二维码
  if (ips.length) {
    try {
      const qr = require('qrcode-terminal');
      const url = 'http://' + ips[0] + ':' + PORT;
      console.log('  扫码直达 (' + url + ')：');
      qr.generate(url, { small: true }, (q) => console.log(q));
    } catch (e) { /* 可选依赖 */ }
  }
});
