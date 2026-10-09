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

// Avatar: { e: emoji sırası, c: renk sırası } — liste istemcide, burada sadece aralık kontrolü
const AVATAR_E = 24, AVATAR_C = 8;
function cleanAvatar(a) {
  if (!a || typeof a !== 'object') return null;
  const e = +a.e, c = +a.c;
  if (!Number.isInteger(e) || !Number.isInteger(c) || e < 0 || e >= AVATAR_E || c < 0 || c >= AVATAR_C) return null;
  return { e, c };
}

const clean = (s, n = 16) => String(s || '').replace(/[<>&"']/g, '').trim().slice(0, n);

function newCode() {
  let c;
  do c = Math.random().toString(36).slice(2, 7).toUpperCase();
  while (rooms.has(c) || c.length < 5);
  return c;
}

const emptySeat = () => ({ name: null, token: null, isBot: false, connected: false, socketId: null, avatar: null, awaySince: null });
const automated = (room, i) => room.seats[i].isBot || !room.seats[i].connected;
const humansOnline = room => room.seats.some(s => !s.isBot && s.connected);

const DEFAULT_OPTS = { hands: 5, mode: 'tekli', katlamali: false, waitAttach: false, turnSec: 45, listed: true };

// Giriş ekranındaki açık oda listesi
function roomSummary(room) {
  const host = room.seats.find(x => x.token === room.hostToken);
  const humans = room.seats.filter(x => x.token && !x.isBot && x.connected).length;
  const free = room.seats.filter(x => !x.token).length; // boş ya da botun oturduğu koltuk
  return {
    code: room.code,
    permanent: !!room.permanent,
    title: room.title || null,
    host: host ? host.name : room.seats.find(x => x.name && !x.isBot)?.name || '?',
    humans, free,
    mode: room.opts.mode, hands: room.opts.hands, katlamali: room.opts.katlamali,
    status: !room.game ? 'bekliyor' : room.game.over ? 'bitti' : 'oyunda',
    hand: room.game ? room.game.handIndex : 0,
  };
}
let roomsTimer = null;
function broadcastRooms() {
  if (roomsTimer) return;
  roomsTimer = setTimeout(() => {
    roomsTimer = null;
    io.to('lobby').emit('rooms', listRooms());
  }, 400);
}
function listRooms() {
  return [...rooms.values()]
    .filter(r => r.opts.listed && (r.permanent || humansOnline(r)) && r.seats.some(x => !x.token))
    .map(roomSummary)
    .sort((a, b) => (a.permanent ? 1 : 0) - (b.permanent ? 1 : 0) || (a.status === 'bekliyor' ? 0 : 1) - (b.status === 'bekliyor' ? 0 : 1));
}
const turnMs = room => room.opts.turnSec * 1000;

function cleanOpts(a = {}, base = DEFAULT_OPTS) {
  return {
    hands: [1, 3, 5, 7, 9, 11].includes(+a.hands) ? +a.hands : base.hands,
    mode: a.mode === 'esli' || a.mode === 'tekli' ? a.mode : base.mode,
    katlamali: a.katlamali != null ? !!a.katlamali : base.katlamali,
    waitAttach: a.waitAttach != null ? !!a.waitAttach : base.waitAttach,
    turnSec: [30, 45, 60, 90].includes(+a.turnSec) ? +a.turnSec : base.turnSec,
    listed: a.listed != null ? !!a.listed : base.listed,
  };
}

function lobbyView(room, i) {
  return {
    lobby: true,
    code: room.code,
    you: i,
    isHost: room.seats[i].token === room.hostToken,
    opts: room.opts,
    seats: room.seats.map(s => (s.name ? { name: s.name, bot: s.isBot, connected: s.connected, avatar: s.avatar } : null)),
  };
}

function send(room) {
  broadcastRooms();
  room.seats.forEach((s, i) => {
    if (!s.socketId || !s.connected) return;
    const v = room.game
      ? Object.assign(room.game.view(i), { code: room.code, deadline: room.deadline, turnMs: turnMs(room), isHost: s.token === room.hostToken, permanent: !!room.permanent, title: room.title || null })
      : lobbyView(room, i);
    io.to(s.socketId).emit('state', v);
  });
}

function schedule(room) {
  const g = room.game;
  if (!g) return;
  const alive = humansOnline(room) || (room.permanent && io.engine.clientsCount > 0);
  if (!alive) {
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
  else key = `${g.turnCount}:${g.openStamp || 0}:human`; // el açılınca süre baştan başlar
  if (key === room.timerKey) return;
  clearTimeout(room.timer);
  room.timerKey = key;
  room.deadline = null;

  if (g.phase === 'ended') {
    if (!g.over) room.timer = setTimeout(() => { g.startHand(); update(room); }, 10000);
    else if (room.permanent) room.timer = setTimeout(() => { newBotGame(room); update(room); }, 12000);
    return;
  }
  if (automated(room, i)) {
    room.timer = setTimeout(() => botStep(room), room.seats[i].isBot ? Math.round(BOT_MS * (0.7 + Math.random() * (g.phase === 'play' ? 1.1 : 0.5))) : AWAY_MS);
  } else {
    room.deadline = Date.now() + turnMs(room);
    room.timer = setTimeout(() => {
      const before = g.turnCount;
      // Süresi dolan oyuncu adına el açılmaz, işlenmez: sadece taş çekilir ve güvenli bir taş atılır
      try { Bot.timeoutTurn(g, i); } catch (e) { console.error(e); }
      if (g.turnCount === before) Bot.fallback(g, i);
      g.addLog(`${room.seats[i].name} için süre doldu: taş çekildi ve bir taş atıldı`);
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

function sit(room, i, socket, name, token, avatar) {
  const s = room.seats[i];
  if (s.socketId && s.socketId !== socket.id) io.to(s.socketId).emit('kicked');
  Object.assign(s, { name, token, isBot: false, connected: true, socketId: socket.id, avatar: avatar || s.avatar || null, awaySince: null });
  socket.data.code = room.code;
  socket.data.seat = i;
  socket.leave('lobby');
  socket.emit('joined', { code: room.code });
}

const roomOf = socket => rooms.get(socket.data.code);

// Beklenmedik bir hata sunucuyu (ve bütün odaları) çökertmesin
process.on('uncaughtException', e => console.error('Yakalanmamış hata:', e));
process.on('unhandledRejection', e => console.error('Yakalanmamış söz:', e));

io.on('connection', socket => {
  socket.join('lobby');
  socket.emit('rooms', listRooms());
  // Her olay işleyicisini hataya karşı koru
  const on0 = socket.on.bind(socket);
  socket.on = (ev, fn) => on0(ev, (...args) => {
    try { fn(...args); } catch (e) { console.error(`'${ev}' işlenirken hata:`, e); socket.emit('err', 'Sunucuda bir hata oldu, tekrar dene'); }
  });

  socket.on('create', (a = {}) => {
    const name = clean(a.name), token = clean(a.token, 40);
    if (!name || !token) return socket.emit('err', 'Önce adını yaz');
    const room = { code: newCode(), hostToken: token, seats: [0, 1, 2, 3].map(emptySeat), game: null, opts: cleanOpts(a), timer: null, timerKey: null, deadline: null, lastHuman: Date.now(), lastChat: {} };
    rooms.set(room.code, room);
    sit(room, 0, socket, name, token, cleanAvatar(a.avatar));
    send(room);
  });

  socket.on('join', (a = {}) => {
    const room = rooms.get(clean(a.code, 8).toUpperCase());
    const token = clean(a.token, 40);
    if (!room) return socket.emit(a.auto ? 'leftRoom' : 'err', a.auto ? 'gone' : 'Oda bulunamadı');
    let i = room.seats.findIndex(s => s.token && s.token === token);
    if (i < 0) {
      if (a.auto) return socket.emit('leftRoom');
      const name = clean(a.name);
      if (!name) return socket.emit('err', 'Önce adını yaz');
      i = room.seats.findIndex(s => !s.token); // boş koltuk ya da botun koltuğu
      if (i < 0) return socket.emit('err', 'Oda dolu');
      sit(room, i, socket, name, token, cleanAvatar(a.avatar));
      if (room.game) room.game.addLog(`${name} masaya oturdu`);
    } else {
      sit(room, i, socket, room.seats[i].name, token, cleanAvatar(a.avatar));
    }
    update(room);
  });

  socket.on('rooms', () => socket.emit('rooms', listRooms()));

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
    // Oda sahibi masada yoksa herhangi bir oyuncu yeni oyunu başlatabilir
    const host = room.seats.find(x => x.token === room.hostToken && x.connected);
    if (host && room.seats[socket.data.seat].token !== room.hostToken) return;
    if (!host) room.hostToken = room.seats[socket.data.seat].token;
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
        case 'open':
          r = g.open(i, a.groups);
          if (r.ok) room.timerKey = null; // elini açanın süresi sıfırlanıp yeniden başlar
          break;
        case 'lay':
          r = { err: 'İndirilecek grup yok' };
          for (const ids of Array.isArray(a.groups) ? a.groups : []) {
            r = g.layMeld(i, ids);
            if (r.err) break;
          }
          break;
        case 'attach': r = g.addToMeld(i, a.id, a.meld, a.choice && { kind: String(a.choice.kind), side: a.choice.side && String(a.choice.side) }); break;
        case 'autoAttach': r = g.autoAttach(i, Bot.keepIds(g, i)); break;
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
  socket.on('hint', cb => {
    const room = roomOf(socket);
    if (!room || !room.game || typeof cb !== 'function') return;
    cb(Bot.hint(room.game, socket.data.seat));
  });

  socket.on('suggest', (a, cb) => {
    if (typeof a === 'function') { cb = a; a = {}; }
    const room = roomOf(socket);
    if (!room || !room.game || typeof cb !== 'function') return;
    const flipped = Array.isArray(a && a.flipped) ? a.flipped.map(Number).filter(Number.isInteger).slice(0, 30) : [];
    cb(Bot.suggest(room.game, socket.data.seat, flipped));
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
      s.awaySince = Date.now();
    }
    update(room);
  });
});

// Boş kalan odaları temizle
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.permanent) {
      room.seats.forEach((x, i) => {
        if (x.token && !x.connected && x.awaySince && now - x.awaySince > 2 * 60 * 1000) {
          room.game && room.game.addLog(`${x.name} uzun süre dönmedi, koltuk bota geçti`);
          giveSeatToBot(room, i);
          update(room);
        }
      });
      continue;
    }
    if (humansOnline(room)) room.lastHuman = now;
    else if (now - room.lastHuman > ROOM_TTL) {
      clearTimeout(room.timer);
      rooms.delete(code);
      broadcastRooms();
    }
  }
}, 60 * 1000);

// ---------------- Sürekli oynayan bot masaları ----------------
const BOT_NAMES = ['Ayşe', 'Kemal', 'Zeynep', 'Murat', 'Elif', 'Hasan', 'Fatma', 'Can', 'Selin', 'Emre', 'Derya', 'Okan'];
let botNameIdx = 0;
const nextBotName = () => 'Bot ' + BOT_NAMES[botNameIdx++ % BOT_NAMES.length];

function giveSeatToBot(room, i) {
  Object.assign(room.seats[i], { name: nextBotName(), token: null, isBot: true, connected: true, socketId: null, avatar: null, awaySince: null });
}

function newBotGame(room) {
  room.game = new Game(room.seats, room.opts);
  room.game.startHand();
  room.timerKey = null;
}

function createBotTable(code, title, opts) {
  const room = {
    code, title, permanent: true, hostToken: null,
    seats: [0, 1, 2, 3].map(emptySeat), game: null,
    opts: cleanOpts(opts), timer: null, timerKey: null, deadline: null, lastHuman: Date.now(), lastChat: {},
  };
  room.seats.forEach((_, i) => giveSeatToBot(room, i));
  rooms.set(code, room);
  newBotGame(room);
}
server.listen(PORT, () => console.log('101 Okey sunucusu çalışıyor: http://localhost:' + PORT));
