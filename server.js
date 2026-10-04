const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const { Game } = require('./game');
const Bot = require('./bot');

const PORT = process.env.PORT || 3000;
const BOT_MS = +(process.env.BOT_MS || 1100);   // bot düşünme süresi
const AWAY_MS = +(process.env.AWAY_MS || 3000); // bağlantısı kopan oyuncunun yerine bot oynamadan önce bekleme
const ROOM_TTL = 15 * 60 * 1000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('ok'));
const server = http.createServer(app);
const io = new Server(server);
const rooms = new Map();

const clean = (s, n = 16) => String(s || '').replace(/[<>&"']/g, '').trim().slice(0, n);

function newCode() {
  let c;
  do c = Math.random().toString(36).slice(2, 7).toUpperCase();
  while (rooms.has(c) || c.length < 5);
  return c;
}

const emptySeat = () => ({ name: null, token: null, isBot: false, connected: false, socketId: null });
const automated = (room, i) => room.seats[i].isBot || !room.seats[i].connected;
const humansOnline = room => room.seats.some(s => !s.isBot && s.connected);

const DEFAULT_OPTS = { hands: 5, mode: 'tekli', katlamali: false, waitAttach: false, turnSec: 45 };
const turnMs = room => room.opts.turnSec * 1000;

function cleanOpts(a = {}, base = DEFAULT_OPTS) {
  return {
    hands: [1, 3, 5, 7, 9, 11].includes(+a.hands) ? +a.hands : base.hands,
    mode: a.mode === 'esli' || a.mode === 'tekli' ? a.mode : base.mode,
    katlamali: a.katlamali != null ? !!a.katlamali : base.katlamali,
    waitAttach: a.waitAttach != null ? !!a.waitAttach : base.waitAttach,
    turnSec: [30, 45, 60, 90].includes(+a.turnSec) ? +a.turnSec : base.turnSec,
  };
}

function lobbyView(room, i) {
  return {
    lobby: true,
    code: room.code,
    you: i,
    isHost: room.seats[i].token === room.hostToken,
    opts: room.opts,
    seats: room.seats.map(s => (s.name ? { name: s.name, bot: s.isBot, connected: s.connected } : null)),
  };
}

function send(room) {
  room.seats.forEach((s, i) => {
    if (!s.socketId || !s.connected) return;
    const v = room.game
      ? Object.assign(room.game.view(i), { code: room.code, deadline: room.deadline, turnMs: turnMs(room), isHost: s.token === room.hostToken })
      : lobbyView(room, i);
    io.to(s.socketId).emit('state', v);
  });
}

function schedule(room) {
  const g = room.game;
  if (!g) return;
  if (!humansOnline(room)) {
    // Masada kimse kalmadıysa botlar boşuna oynamasın
    clearTimeout(room.timer);
    room.timerKey = null;
    room.deadline = null;
    return;
  }
  const i = g.turn;
  let key;
  if (g.phase === 'ended') key = 'end' + g.turnCount;
  else if (automated(room, i)) key = `${g.turnCount}:${g.phase}:auto`;
  else key = `${g.turnCount}:human`;
  if (key === room.timerKey) return;
  clearTimeout(room.timer);
  room.timerKey = key;
  room.deadline = null;

  if (g.phase === 'ended') {
    if (!g.over) room.timer = setTimeout(() => { g.startHand(); update(room); }, 10000);
    return;
  }
  if (automated(room, i)) {
    room.timer = setTimeout(() => botStep(room), room.seats[i].isBot ? BOT_MS : AWAY_MS);
  } else {
    room.deadline = Date.now() + turnMs(room);
    room.timer = setTimeout(() => {
      const before = g.turnCount;
      try { Bot.fullTurn(g, i); } catch (e) { console.error(e); }
      if (g.turnCount === before) Bot.fallback(g, i);
      g.addLog(`${room.seats[i].name} için süre doldu, hamle otomatik yapıldı`);
      update(room);
    }, turnMs(room));
  }
}

function botStep(room) {
  const g = room.game;
  const i = g.turn;
  const before = `${g.turnCount}:${g.phase}`;
  try {
    if (g.phase === 'draw') Bot.draw(g, i);
    else if (g.phase === 'play') Bot.play(g, i);
  } catch (e) {
    console.error(e);
  }
  if (`${g.turnCount}:${g.phase}` === before) Bot.fallback(g, i);
  update(room);
}

function update(room) {
  schedule(room);
  send(room);
}

function sit(room, i, socket, name, token) {
  const s = room.seats[i];
  if (s.socketId && s.socketId !== socket.id) io.to(s.socketId).emit('kicked');
  Object.assign(s, { name, token, isBot: false, connected: true, socketId: socket.id });
  socket.data.code = room.code;
  socket.data.seat = i;
  socket.emit('joined', { code: room.code });
}

const roomOf = socket => rooms.get(socket.data.code);

io.on('connection', socket => {
  socket.on('create', (a = {}) => {
    const name = clean(a.name), token = clean(a.token, 40);
    if (!name || !token) return socket.emit('err', 'Önce adını yaz');
    const room = { code: newCode(), hostToken: token, seats: [0, 1, 2, 3].map(emptySeat), game: null, opts: cleanOpts(a), timer: null, timerKey: null, deadline: null, lastHuman: Date.now(), lastChat: {} };
    rooms.set(room.code, room);
    sit(room, 0, socket, name, token);
    send(room);
  });

  socket.on('join', (a = {}) => {
    const room = rooms.get(clean(a.code, 8).toUpperCase());
    const token = clean(a.token, 40);
    if (!room) return socket.emit(a.auto ? 'leftRoom' : 'err', 'Oda bulunamadı');
    let i = room.seats.findIndex(s => s.token && s.token === token);
    if (i < 0) {
      if (a.auto) return socket.emit('leftRoom');
      const name = clean(a.name);
      if (!name) return socket.emit('err', 'Önce adını yaz');
      i = room.seats.findIndex(s => !s.token); // boş koltuk ya da botun koltuğu
      if (i < 0) return socket.emit('err', 'Oda dolu');
      sit(room, i, socket, name, token);
      if (room.game) room.game.addLog(`${name} masaya oturdu`);
    } else {
      sit(room, i, socket, room.seats[i].name, token);
    }
    update(room);
  });

  // Oda ayarları (sadece oda sahibi, oyun başlamadan)
  socket.on('settings', (a = {}) => {
    const room = roomOf(socket);
    if (!room || room.game || room.seats[socket.data.seat].token !== room.hostToken) return;
    room.opts = cleanOpts(a, room.opts);
    send(room);
  });

  // Boş koltuğa geç (eşini seçmek için)
  socket.on('sit', target => {
    const room = roomOf(socket);
    const i = socket.data.seat;
    target = +target;
    if (!room || room.game || !(target >= 0 && target < 4) || room.seats[target].name) return;
    room.seats[target] = room.seats[i];
    room.seats[i] = emptySeat();
    socket.data.seat = target;
    send(room);
  });

  // Sohbet ve hazır mesajlar
  socket.on('chat', text => {
    const room = roomOf(socket);
    if (!room) return;
    const i = socket.data.seat;
    const now = Date.now();
    if (now - (room.lastChat[i] || 0) < 1200) return;
    room.lastChat[i] = now;
    const msg = String(text || '').replace(/[<>]/g, '').trim().slice(0, 80);
    if (!msg) return;
    room.seats.forEach(s => s.socketId && io.to(s.socketId).emit('chat', { seat: i, name: room.seats[i].name, text: msg }));
  });

  socket.on('start', () => {
    const room = roomOf(socket);
    if (!room || room.game) return;
    if (room.seats[socket.data.seat].token !== room.hostToken) return;
    let b = 1;
    room.seats.forEach(s => {
      if (!s.name) Object.assign(s, { name: 'Bot ' + b++, isBot: true, connected: true, token: null });
    });
    room.game = new Game(room.seats, room.opts);
    room.game.startHand();
    update(room);
  });

  socket.on('newGame', () => {
    const room = roomOf(socket);
    if (!room || !room.game || !room.game.over) return;
    if (room.seats[socket.data.seat].token !== room.hostToken) return;
    room.game = new Game(room.seats, room.opts);
    room.game.startHand();
    room.timerKey = null;
    update(room);
  });

  socket.on('act', (a = {}) => {
    const room = roomOf(socket);
    if (!room || !room.game) return;
    const g = room.game;
    const i = socket.data.seat;
    let r;
    try {
      switch (a.type) {
        case 'drawPile': r = g.drawPile(i); break;
        case 'drawDiscard': r = g.drawDiscard(i); break;
        case 'undoTake': r = g.undoTake(i); break;
        case 'open': r = g.open(i, a.groups); break;
        case 'lay':
          r = { err: 'İndirilecek grup yok' };
          for (const ids of Array.isArray(a.groups) ? a.groups : []) {
            r = g.layMeld(i, ids);
            if (r.err) break;
          }
          break;
        case 'attach': r = g.addToMeld(i, a.id, a.meld); break;
        case 'discard': r = g.discard(i, a.id); break;
        default: r = { err: 'Bilinmeyen hamle' };
      }
    } catch (e) {
      console.error(e);
      r = { err: 'Hamle yapılamadı' };
    }
    if (r.err) socket.emit('err', r.err);
    update(room);
  });

  // "Öner" düğmesi: en iyi per dizilimi ve çiftler
  socket.on('suggest', cb => {
    const room = roomOf(socket);
    if (!room || !room.game || typeof cb !== 'function') return;
    const g = room.game;
    const hand = g.seats[socket.data.seat].hand;
    const sol = Bot.solve(hand, g.okey);
    const pairs = Bot.findPairs(hand, g.okey);
    cb({ melds: sol.melds.map(m => m.map(t => t.id)), score: sol.score, pairs: pairs.map(p => p.map(t => t.id)) });
  });

  // Oyundan / odadan isteyerek çıkış: oyunda yerine kalıcı olarak bot geçer
  socket.on('leave', () => {
    const room = roomOf(socket);
    socket.data.code = null;
    if (!room) return socket.emit('leftRoom');
    const i = socket.data.seat;
    const s = room.seats[i];
    if (!s || s.socketId !== socket.id) return socket.emit('leftRoom');
    const wasHost = s.token === room.hostToken;
    if (!room.game) {
      Object.assign(s, emptySeat());
    } else {
      room.game.addLog(`${s.name} oyundan çıktı, yerine bot oynuyor`);
      Object.assign(s, { token: null, isBot: true, connected: true, socketId: null });
    }
    if (wasHost) {
      const next = room.seats.find(x => x.token && x.connected);
      if (next) room.hostToken = next.token;
    }
    socket.emit('leftRoom');
    if (!room.seats.some(x => x.token)) {
      clearTimeout(room.timer);
      rooms.delete(room.code);
      return;
    }
    update(room);
  });

  socket.on('disconnect', () => {
    const room = roomOf(socket);
    if (!room) return;
    const s = room.seats[socket.data.seat];
    if (!s || s.socketId !== socket.id) return;
    s.connected = false;
    s.socketId = null;
    if (!room.game) {
      const wasHost = s.token === room.hostToken;
      Object.assign(s, emptySeat());
      if (wasHost) {
        const next = room.seats.find(x => x.token && x.connected);
        if (next) room.hostToken = next.token;
      }
    } else {
      room.game.addLog(`${s.name} ayrıldı, yerine bot oynuyor`);
    }
    update(room);
  });
});

// Boş kalan odaları temizle
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (humansOnline(room)) room.lastHuman = now;
    else if (now - room.lastHuman > ROOM_TTL) {
      clearTimeout(room.timer);
      rooms.delete(code);
    }
  }
}, 60 * 1000);

server.listen(PORT, () => console.log('101 Okey sunucusu çalışıyor: http://localhost:' + PORT));
