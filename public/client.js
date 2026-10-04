const socket = io();
const $ = s => document.querySelector(s);
const COLORS = ['var(--red)', 'var(--yellow)', 'var(--blue)', 'var(--black)'];
const AVA = ['#c0392b', '#2e86c1', '#c47f0e', '#7d3c98'];
const COLS = 15, SLOTS = 30;
const TEAM = ['Takım 1', 'Takım 2'];
const QUICK = ['Merhaba 👋', 'Kolay gelsin', 'Hadi bekliyoruz 🙂', 'Güzel hamle 👏', 'Şansına küs 😅', 'Eyvallah', 'Tebrikler 🎉', 'İyi oyunlar'];

let token = localStorage.getItem('okey_token');
if (!token) {
  token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem('okey_token', token);
}

let S = null;                        // sunucudan gelen son durum
let slots = Array(SLOTS).fill(null); // ıstaka: 2 sıra x 15 yuva, taş id'leri
let sel = null;                      // seçili taş
let handKey = null;
let fresh = new Set();               // yeni çekilen taşlar
let drag = null;
let lastTap = { id: null, t: 0 };
let scoresOpen = false;
let wasMyTurn = false;
let muted = localStorage.getItem('okey_mute') === '1';

// ---------- Giriş ----------
const params = new URLSearchParams(location.search);
$('#name').value = localStorage.getItem('okey_name') || '';
if (params.get('oda')) $('#code').value = params.get('oda');

function myName() {
  const n = $('#name').value.trim();
  if (!n) { toast('Önce adını yaz'); $('#name').focus(); return null; }
  localStorage.setItem('okey_name', n);
  return n;
}
$('#btnCreate').onclick = () => { const n = myName(); if (n) socket.emit('create', { name: n, token }); };
$('#btnJoin').onclick = () => { const n = myName(); if (n) socket.emit('join', { code: $('#code').value, name: n, token }); };
$('#btnStart').onclick = () => socket.emit('start');
$('#btnCopy').onclick = () => { navigator.clipboard?.writeText($('#wLink').textContent); toast('Bağlantı kopyalandı'); };
$('#btnScores').onclick = () => { scoresOpen = true; renderModal(); };
$('#btnSound').onclick = () => { muted = !muted; localStorage.setItem('okey_mute', muted ? '1' : '0'); soundIcon(); };
$('#btnFull').onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      await document.documentElement.requestFullscreen();
      await screen.orientation?.lock?.('landscape');
    }
  } catch (e) { /* bazı tarayıcılar desteklemez */ }
};
$('#btnTipClose').onclick = () => { $('#rotateTip').classList.add('closed'); localStorage.setItem('okey_tip', '1'); };
if (localStorage.getItem('okey_tip')) $('#rotateTip').classList.add('closed');
function soundIcon() { $('#btnSound').textContent = muted ? '🔇' : '🔊'; }
soundIcon();

socket.on('connect', () => {
  const c = localStorage.getItem('okey_room');
  if (c) socket.emit('join', { code: c, token, auto: true });
});
socket.on('joined', ({ code }) => {
  localStorage.setItem('okey_room', code);
  history.replaceState(null, '', '?oda=' + code);
});
socket.on('leftRoom', () => localStorage.removeItem('okey_room'));
socket.on('kicked', () => { toast('Bu koltuğa başka bir sekmeden bağlanıldı'); S = null; render(); });
socket.on('err', m => toast(m));
socket.on('state', st => {
  S = st;
  if (!S.lobby) {
    const mine = myTurn();
    if (mine && !wasMyTurn) turnAlert();
    wasMyTurn = mine;
  }
  render();
});

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), 2600);
}

let actx;
function turnAlert() {
  navigator.vibrate?.(60);
  if (muted) return;
  try {
    actx = actx || new AudioContext();
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.type = 'triangle';
    o.frequency.setValueAtTime(660, t);
    o.frequency.setValueAtTime(880, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + 0.32);
  } catch (e) { /* ses yok */ }
}

function show(id) {
  ['lobby', 'waiting', 'game'].forEach(x => $('#' + x).classList.toggle('hidden', x !== id));
}

function render() {
  if (!S) { show('lobby'); return; }
  if (S.lobby) { renderWaiting(); return; }
  show('game');
  renderGame();
}

function renderWaiting() {
  show('waiting');
  const o = S.opts;
  const esli = o.mode === 'esli';
  $('#wCode').textContent = S.code;
  $('#wLink').textContent = location.origin + '/?oda=' + S.code;

  // Mini masa: 0 alt, 1 sağ, 2 üst, 3 sol (eşli oyunda karşılıklı oturanlar eştir)
  const pos = ['b', 'r', 't', 'l'];
  $('#wTable').innerHTML = '<div class="felt"></div>' + S.seats.map((x, i) => {
    const team = esli ? `<small class="tbadge t${i % 2}">${TEAM[i % 2]}</small>` : '';
    if (x) return `<div class="wseat p${pos[i]} ${i === S.you ? 'me' : ''}"><b>${esc(x.name)}${i === S.you ? ' (sen)' : ''}</b>${team}</div>`;
    return `<button class="wseat p${pos[i]} empty" data-sit="${i}">Buraya otur${team}</button>`;
  }).join('');
  $('#wTable').querySelectorAll('[data-sit]').forEach(b => (b.onclick = () => socket.emit('sit', +b.dataset.sit)));

  const dis = S.isHost ? '' : 'disabled';
  $('#wSettings').innerHTML = `
    <div class="seg" role="group" aria-label="Oyun türü">
      <button data-mode="tekli" class="${!esli ? 'on' : ''}" ${dis}>Tekli</button>
      <button data-mode="esli" class="${esli ? 'on' : ''}" ${dis}>Eşli</button>
    </div>
    <div class="row2">
      <label class="field">El sayısı<select id="sHands" ${dis}>${[1, 3, 5, 7, 9, 11].map(n => `<option ${n === o.hands ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="field">Hamle süresi<select id="sTurn" ${dis}>${[30, 45, 60, 90].map(n => `<option value="${n}" ${n === o.turnSec ? 'selected' : ''}>${n} sn</option>`).join('')}</select></label>
    </div>
    <label class="check"><input type="checkbox" id="sKat" ${o.katlamali ? 'checked' : ''} ${dis}><span><b>Katlamalı</b><small>Rakipten sonra açan, onun açtığından en az 1 fazla açmalı (çiftte 1 çift fazla).</small></span></label>
    <label class="check"><input type="checkbox" id="sWait" ${o.waitAttach ? 'checked' : ''} ${dis}><span><b>Açtığı turda işleme yok</b><small>Elini açan, işleme yapmak için bir tur bekler.</small></span></label>`;
  if (S.isHost) {
    const push = extra => socket.emit('settings', Object.assign({
      hands: $('#sHands').value, turnSec: $('#sTurn').value,
      katlamali: $('#sKat').checked, waitAttach: $('#sWait').checked, mode: o.mode,
    }, extra));
    $('#wSettings').querySelectorAll('[data-mode]').forEach(b => (b.onclick = () => push({ mode: b.dataset.mode })));
    ['#sHands', '#sTurn', '#sKat', '#sWait'].forEach(id => ($(id).onchange = () => push()));
  }
  $('#btnStart').classList.toggle('hidden', !S.isHost);
  $('#wNote').textContent = S.isHost
    ? (esli ? 'Karşılıklı oturanlar eştir. Boş koltuklara bot oturur.' : 'Boş koltuklara bot oturur.')
    : 'Oda sahibinin oyunu başlatması bekleniyor.';
}

// ---------- Yardımcılar ----------
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
const myTurn = () => !!S && !S.lobby && S.turn === S.you && S.phase !== 'ended';
const playing = () => myTurn() && S.phase === 'play';
const me = () => S.players[S.you];
const tileById = id => S.hand.find(t => t.id === id);
const esli = () => S && S.opts && S.opts.mode === 'esli';
const partner = i => esli() && i !== S.you && i % 2 === S.you % 2;
const initials = n => n.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

function tileKey(t, pairFirst) {
  if (Rules.isJoker(t, S.okey)) return 9999;
  const e = Rules.eff(t, S.okey);
  return pairFirst ? e.v * 10 + e.c : e.c * 100 + e.v;
}

function tileEl(t, small) {
  const d = document.createElement('div');
  d.className = 'tile' + (small ? ' sm' : '');
  if (t.fake) {
    d.classList.add('fake');
    d.innerHTML = '<span>✿</span>';
    d.title = 'Sahte okey';
  } else {
    d.style.color = COLORS[t.c];
    d.innerHTML = `<span>${t.v}</span><i></i>`;
    if (S && t.id != null && Rules.isJoker(t, S.okey)) { d.classList.add('joker'); d.title = 'Okey'; }
  }
  return d;
}

// ---------- Istaka mantığı ----------
function arrange(groups, rest) {
  const out = Array(SLOTS).fill(null);
  let pos = 0;
  for (const g of groups) {
    if (!g.length) continue;
    if (g.length > COLS) return null;
    if ((pos % COLS) + g.length > COLS) pos = (Math.floor(pos / COLS) + 1) * COLS;
    if (pos + g.length > SLOTS) return null;
    for (const id of g) out[pos++] = id;
    if (pos % COLS) pos++; // perler arasında bir boşluk
  }
  for (const id of rest) {
    if (pos >= SLOTS) return null;
    out[pos++] = id;
  }
  return out;
}

function placeNew(id) {
  let last = -1;
  slots.forEach((x, i) => { if (x != null) last = i; });
  let p = last + 2;
  if (p >= SLOTS || slots[p] != null) p = slots.indexOf(null);
  if (p >= 0) slots[p] = id;
}

function syncHand() {
  const ids = S.hand.map(t => t.id);
  const key = S.handIndex + ':' + S.indicator.id + ':' + S.indicator.c;
  if (key !== handKey) {
    handKey = key;
    sel = null;
    fresh.clear();
    const sorted = S.hand.slice().sort((a, b) => tileKey(a) - tileKey(b)).map(t => t.id);
    slots = arrange([], sorted);
    autoArrange('seri', true);
    return;
  }
  slots = slots.map(id => (ids.includes(id) ? id : null));
  ids.forEach(id => {
    if (slots.includes(id)) return;
    placeNew(id);
    fresh.add(id);
    setTimeout(() => { fresh.delete(id); }, 2600);
  });
  if (sel != null && !ids.includes(sel)) sel = null;
}

function autoArrange(mode, quiet) {
  socket.emit('suggest', res => {
    if (!S || S.lobby) return;
    const inHand = id => !!tileById(id);
    let groups;
    if (mode === 'seri') {
      groups = res.melds.filter(g => g.every(inHand)).map(g => {
        const a = Rules.analyzeMeld(g.map(tileById), S.okey);
        return a ? a.order.map(t => t.id) : g;
      });
    } else {
      groups = res.pairs.filter(g => g.every(inHand));
    }
    const used = new Set(groups.flat());
    const rest = S.hand.filter(t => !used.has(t.id))
      .sort((a, b) => tileKey(a, mode === 'cift') - tileKey(b, mode === 'cift'))
      .map(t => t.id);
    let out = null;
    if (mode === 'cift') {
      // Çiftleri ayrı ayrı sığdıramazsa ikişer/üçer blok halinde diz
      for (const k of [1, 2, 3, 7]) {
        const blocks = [];
        for (let i = 0; i < groups.length; i += k) blocks.push(groups.slice(i, i + k).flat());
        out = arrange(blocks, rest);
        if (out) break;
      }
    } else {
      out = arrange(groups, rest);
    }
    slots = out || arrange([], groups.flat().concat(rest));
    sel = null;
    renderGame();
    if (!quiet) {
      const ev = evalRack();
      toast(mode === 'seri' ? `Seri: ${ev.score} puan` : `${ev.pairs.length} çift`);
    }
  });
}

function rackGroups() {
  const gs = [];
  for (let r = 0; r < 2; r++) {
    let cur = [];
    for (let c = 0; c < COLS; c++) {
      const id = slots[r * COLS + c];
      if (id != null) cur.push(id);
      else { if (cur.length) gs.push(cur); cur = []; }
    }
    if (cur.length) gs.push(cur);
  }
  return gs;
}

// Istakadaki dizilime göre per ve çiftleri bulur
function evalRack() {
  const ok = S.okey;
  const melds = [], pairs = [];
  for (const g of rackGroups()) {
    const ts = g.map(tileById);
    if (g.length >= 3) {
      const a = Rules.makeMeld(ts, ok);
      if (a) { melds.push({ ids: g, score: a.score }); continue; }
    }
    if (g.length % 2 === 0) {
      const chunks = [];
      for (let i = 0; i < g.length; i += 2) chunks.push(g.slice(i, i + 2));
      if (chunks.every(c => Rules.analyzePair(c.map(tileById), ok))) chunks.forEach(c => pairs.push({ ids: c }));
    }
  }
  return { melds, pairs, score: melds.reduce((s, m) => s + m.score, 0) };
}

function moveTile(id, target) {
  const from = slots.indexOf(id);
  if (from < 0 || from === target) return;
  slots[from] = null;
  if (slots[target] == null) { slots[target] = id; return; }
  const rowStart = target - (target % COLS), rowEnd = rowStart + COLS;
  let e = -1;
  for (let k = target; k < rowEnd; k++) if (slots[k] == null) { e = k; break; }
  if (e >= 0) {
    for (let k = e; k > target; k--) slots[k] = slots[k - 1];
    slots[target] = id;
    return;
  }
  for (let k = target - 1; k >= rowStart; k--) if (slots[k] == null) { e = k; break; }
  if (e >= 0) {
    for (let k = e; k < target; k++) slots[k] = slots[k + 1];
    slots[target] = id;
    return;
  }
  slots[from] = slots[target];
  slots[target] = id;
}

// ---------- Oyun ekranı ----------
function renderGame() {
  syncHand();
  $('#gCode').textContent = S.code;
  if (esli()) {
    const us = S.players[S.you].total + S.players[(S.you + 2) % 4].total;
    const them = S.players[(S.you + 1) % 4].total + S.players[(S.you + 3) % 4].total;
    $('#gHand').textContent = `El ${S.handIndex}/${S.hands}`;
    $('#gTeam').innerHTML = `Biz <b>${us}</b> · Onlar <b>${them}</b>`;
  } else {
    $('#gHand').textContent = `El ${S.handIndex}/${S.hands}`;
    $('#gTeam').textContent = '';
  }
  renderStatus();
  for (let r = 1; r <= 3; r++) renderPlayer($('#pos' + r), (S.you + r) % 4);
  for (let r = 0; r <= 3; r++) renderCorner(r);

  $('#indicator').replaceChildren(tileEl(S.indicator, true));
  const ok = tileEl({ c: S.okey.c, v: S.okey.v }, true);
  ok.classList.add('okeytile');
  $('#okeyTile').replaceChildren(ok);
  $('#pileCount').textContent = S.pile;
  const canDraw = myTurn() && S.phase === 'draw';
  $('#pile').classList.toggle('active', canDraw);
  $('#pile').onclick = () => canDraw && act({ type: 'drawPile' });

  renderMelds();
  renderMe();
  if (!(drag && drag.moved)) renderRack();
  renderActions();
  renderModal();
}

function renderStatus() {
  const st = $('#status');
  st.classList.toggle('myturn', myTurn());
  let txt;
  if (S.phase === 'ended') txt = S.over ? 'Oyun bitti' : 'El bitti, yeni el başlıyor…';
  else if (myTurn()) txt = S.phase === 'draw' ? 'Sıra sende: taş çek' : 'Sıra sende: bir taş at';
  else txt = `${S.players[S.turn].name} oynuyor`;
  st.textContent = txt;
}

function avaHtml(abs) {
  const p = S.players[abs];
  const team = esli() ? ` team t${abs % 2}` : '';
  return `<div class="ava${!p.bot && !p.connected ? ' away' : ''}${team}" style="--c:${AVA[abs]}">${p.bot ? '🤖' : esc(initials(p.name))}</div>`;
}

function renderPlayer(el, abs) {
  const p = S.players[abs];
  el.classList.toggle('turn', S.turn === abs && S.phase !== 'ended');
  const tags = [];
  if (partner(abs)) tags.push('<span class="badge mate">Eşin</span>');
  if (!p.bot && !p.connected) tags.push('<span class="badge off">Bot oynuyor</span>');
  if (p.opened) tags.push(`<span class="badge open">${p.openType === 'cift' ? 'Çift' : 'Açtı'}</span>`);
  if (p.penalty) tags.push(`<span class="badge off">+${p.penalty}</span>`);
  el.innerHTML = avaHtml(abs) +
    `<div class="pinfo"><b>${esc(p.name)}</b><small>${p.count} taş · ${p.total} puan</small><div class="tags">${tags.join('')}</div></div>`;
}

// Köşe r: (sen + r) numaralı oyuncunun attığı taş. 3 = soldaki (alabilirsin), 0 = senin atış alanın
function renderCorner(r) {
  const abs = (S.you + r) % 4;
  const p = S.players[abs];
  const el = $('#corner' + r);
  el.className = `corner ${['c-br', 'c-tr', 'c-tl', 'c-bl'][r]}`;
  const zone = document.createElement('div');
  zone.className = 'dropzone';
  if (p.discardTop) zone.appendChild(tileEl(p.discardTop));
  const lbl = document.createElement('small');
  lbl.textContent = r === 0 ? 'Senin attığın' : p.name;
  el.replaceChildren(zone, lbl);
  el.onclick = null;
  el.removeAttribute('title');
  if (r === 3 && p.discardTop && myTurn() && S.phase === 'draw' && !S.undoUsed) {
    el.classList.add('takeable');
    el.title = 'Bu taşı al';
    el.onclick = () => act({ type: 'drawDiscard' });
  }
  if (r === 0) {
    el.id = 'corner0';
    if (playing()) {
      el.classList.add('target');
      el.dataset.drop = 'discard';
      el.onclick = () => sel != null && discard(sel);
    } else delete el.dataset.drop;
  }
}

function renderMelds() {
  const box = $('#melds');
  box.innerHTML = '';
  if (!S.melds.length) {
    box.innerHTML = '<div class="empty">Açılan perler burada görünecek</div>';
    return;
  }
  const tid = drag ? drag.id : sel;
  const t = tid != null ? tileById(tid) : null;
  const canNow = playing() && me().opened;
  for (let r = 0; r < 4; r++) {
    const abs = (S.you + r) % 4;
    const list = S.melds.filter(m => m.owner === abs);
    if (!list.length) continue;
    const p = S.players[abs];
    const col = document.createElement('section');
    col.className = 'mcol';
    col.innerHTML = `<header style="--c:${AVA[abs]}"><i></i><b>${r === 0 ? 'Sen' : esc(p.name)}</b><span class="badge ${p.openType === 'cift' ? 'pairb' : 'open'}">${p.openType === 'cift' ? 'Çift' : 'Seri'}</span></header>`;
    list.filter(m => m.type !== 'pair').forEach(m => col.appendChild(meldEl(m, t, canNow)));
    const pairs = list.filter(m => m.type === 'pair');
    if (pairs.length) {
      const pw = document.createElement('div');
      pw.className = 'pairs';
      pairs.forEach(m => pw.appendChild(meldEl(m, t, canNow)));
      col.appendChild(pw);
    }
    box.appendChild(col);
  }
}

function meldEl(m, t, canNow) {
  const d = document.createElement('div');
  d.className = 'meld' + (m.type === 'pair' ? ' pair' : '');
  d.dataset.meld = m.id;
  const tiles = m.tiles.map(x => tileEl(x, true));
  const info = t ? Rules.attachInfo(m, t, S.okey) : null;
  if (info && canNow) {
    d.classList.add('can');
    if (info.kind === 'swap') {
      tiles[info.index].classList.add('swapme');
      d.title = 'Okeyi al: seçili taş okeyin yerine geçer';
    } else {
      const gh = document.createElement('div');
      gh.className = 'tile sm ghostslot';
      gh.textContent = '+';
      if (info.side === 'left') tiles.unshift(gh); else tiles.push(gh);
      d.title = 'Seçili taşı buraya işle';
    }
    d.onclick = () => attach(t.id, m.id);
  } else if (info) {
    d.classList.add('warn');
    d.title = 'Bu taş bu pere işler: atarsan 101 ceza';
  }
  tiles.forEach(x => d.appendChild(x));
  return d;
}

function renderMe() {
  const m = me();
  const chip = $('#meChip');
  chip.classList.toggle('turn', myTurn());
  const tags = [];
  if (m.opened) tags.push(`<span class="badge open">${m.openType === 'cift' ? 'Çift açtın' : 'Açtın'}</span>`);
  if (m.penalty) tags.push(`<span class="badge off">Ceza ${m.penalty}</span>`);
  chip.innerHTML = avaHtml(S.you) + `<div class="pinfo"><b>${esc(m.name)}</b><small>${m.total} puan</small><div class="tags">${tags.join('')}</div></div>`;

  const ev = evalRack();
  const hs = $('#handScore');
  if (!m.opened) {
    const b = S.barrier;
    hs.innerHTML = `Seri <b class="${ev.score >= b.per ? 'ok' : ''}">${ev.score}</b>/${b.per} · Çift <b class="${ev.pairs.length >= b.cift ? 'ok' : ''}">${ev.pairs.length}</b>/${b.cift}`;
  } else {
    const left = S.hand.reduce((s, t) => s + Rules.tilePoints(t, S.okey), 0);
    hs.innerHTML = `Elde kalan <b>${left}</b> puan`;
  }
}

function renderRack() {
  const rack = $('#rack');
  rack.innerHTML = '';
  const ev = evalRack();
  const inMeld = new Set(ev.melds.flatMap(m => m.ids));
  const inPair = new Set(ev.pairs.flatMap(p => p.ids));
  const showIsler = S.melds.length > 0;
  for (let r = 0; r < 2; r++) {
    const row = document.createElement('div');
    row.className = 'rackrow';
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.slot = i;
      const id = slots[i];
      if (id != null) {
        const t = tileById(id);
        const d = tileEl(t);
        d.dataset.id = id;
        if (sel === id) d.classList.add('sel');
        if (fresh.has(id)) d.classList.add('fresh');
        if (inMeld.has(id)) d.classList.add('grp');
        else if (inPair.has(id)) d.classList.add('grp', 'pair');
        if (showIsler && !Rules.isJoker(t, S.okey) && S.melds.some(m => Rules.canAttach(m, t, S.okey))) {
          d.classList.add('isler');
          d.title = 'İşlek taş: masadaki bir pere uyuyor';
        }
        slot.appendChild(d);
      } else if (sel != null) {
        slot.classList.add('target');
        slot.onclick = () => { moveTile(sel, i); sel = null; renderGame(); };
      }
      row.appendChild(slot);
    }
    rack.appendChild(row);
  }
}

function renderActions() {
  const m = me();
  const ev = evalRack();
  const btn = a => document.querySelector(`[data-act="${a}"]`);
  const ob = btn('open');
  let ready = false;
  if (!m.opened) {
    if (ev.score >= S.barrier.per) { ob.textContent = `Seri aç (${ev.score})`; ready = true; }
    else if (ev.pairs.length >= S.barrier.cift) { ob.textContent = `Çift aç (${ev.pairs.length})`; ready = true; }
    else ob.textContent = 'Elini aç';
  } else {
    const list = layable(ev);
    ob.textContent = list.length ? `İndir (${list.length})` : 'Perleri indir';
    ready = list.length > 0;
  }
  ob.disabled = !playing() || !ready;
  ob.classList.toggle('ready', playing() && ready);
  btn('seri').disabled = btn('cift').disabled = S.phase === 'ended';
  btn('undo').classList.toggle('hidden', S.mustOpenWith == null);

  let hint = '';
  const selT = sel != null ? tileById(sel) : null;
  const selIsler = selT && S.melds.some(x => Rules.canAttach(x, selT, S.okey));
  if (S.mustOpenWith != null) hint = 'Yandan aldığın taşı kullanarak elini açmalısın. Açamazsan ya da açmak istemezsen taşı geri koyabilirsin (101 ceza).';
  else if (S.takenJoker != null && S.hand.some(x => x.id === S.takenJoker)) hint = 'Aldığın okeyi bu tur bir pere işle ya da yeni seride kullan, yoksa 101 ceza.';
  else if (selIsler && !(playing() && me().opened)) hint = 'Bu taş işlek: masadaki kırmızı çerçeveli pere uyuyor. Atarsan 101 ceza yazılır.';
  else if (playing() && sel != null) hint = me().opened && selIsler ? 'Parlayan pere dokunarak işle (+ işaretli yere eklenir). Okeyi alabileceğin perde okey parlar.' : 'Sağ alttaki alana dokunarak at ya da boş bir yuvaya taşı.';
  else if (playing()) hint = 'Perlerin arasında bir boşluk bırak, puanın otomatik hesaplanır. Taşı sürükleyip sağ alt köşeye bırakarak at.';
  else if (myTurn()) hint = 'Ortadaki yığına ya da sol alttaki taşa dokunarak çek.';
  $('#hint').textContent = hint;
}

// ---------- Hamleler ----------
function act(a) { socket.emit('act', a); }
function discard(id) {
  if (!playing() || id == null) return;
  sel = null;
  act({ type: 'discard', id });
}
function attach(id, meldId) {
  if (!playing() || id == null) return;
  sel = null;
  act({ type: 'attach', id, meld: meldId });
}

// Açtıktan sonra ıstakadan indirilebilecekler: seri açan seri (+ masada çift alanı varsa çift), çift açan sadece çift
function layable(ev) {
  const m = me();
  const ciftArea = S.players.some(p => p.openType === 'cift');
  if (m.openType === 'cift') return ev.pairs.map(p => p.ids);
  return ev.melds.map(g => g.ids).concat(ciftArea ? ev.pairs.map(p => p.ids) : []);
}

function doOpen() {
  const m = me();
  const ev = evalRack();
  const n = S.hand.length;
  if (!m.opened) {
    if (ev.score >= S.barrier.per) {
      let groups = ev.melds.slice();
      const used = groups.reduce((s, g) => s + g.ids.length, 0);
      if (used >= n) {
        groups.sort((a, b) => a.score - b.score);
        if (ev.score - groups[0].score >= S.barrier.per) groups = groups.slice(1);
      }
      act({ type: 'open', groups: groups.map(g => g.ids) });
    } else if (ev.pairs.length >= S.barrier.cift) {
      act({ type: 'open', groups: ev.pairs.slice(0, Math.floor((n - 1) / 2)).map(p => p.ids) });
    }
  } else {
    let list = layable(ev);
    let used = list.reduce((s, g) => s + g.length, 0);
    while (list.length && used >= n) used -= list.pop().length;
    if (!list.length) return toast('Atmak için elinde bir taş kalmalı');
    act({ type: 'lay', groups: list });
  }
}

document.querySelector('.actions').onclick = e => {
  const a = e.target.dataset.act;
  if (!a || !S) return;
  if (a === 'seri' || a === 'cift') autoArrange(a);
  else if (a === 'open') doOpen();
  else if (a === 'undo') act({ type: 'undoTake' });
};

// ---------- Sürükle-bırak (fare ve dokunmatik) ----------
function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  return el.closest('[data-slot], [data-meld], [data-drop]');
}

$('#rack').addEventListener('pointerdown', e => {
  const t = e.target.closest('.tile[data-id]');
  if (!t || e.button > 0) return;
  drag = { id: +t.dataset.id, x: e.clientX, y: e.clientY, src: t, moved: false, over: null };
});

window.addEventListener('pointermove', e => {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7) return;
    drag.moved = true;
    drag.src = document.querySelector(`#rack .tile[data-id="${drag.id}"]`) || drag.src;
    const r = drag.src.getBoundingClientRect();
    drag.ghost = drag.src.cloneNode(true);
    drag.ghost.classList.remove('sel', 'fresh');
    drag.ghost.classList.add('ghost');
    drag.ghost.style.width = r.width + 'px';
    drag.ghost.style.height = r.height + 'px';
    document.body.appendChild(drag.ghost);
    drag.src.classList.add('dragging');
    sel = null;
    renderMelds();
    if (playing()) renderCorner(0);
  }
  e.preventDefault();
  const g = drag.ghost;
  g.style.transform = `translate(${e.clientX - g.offsetWidth / 2}px, ${e.clientY - g.offsetHeight * 0.7}px) scale(1.12)`;
  const tgt = dropTargetAt(e.clientX, e.clientY);
  if (tgt !== drag.over) {
    drag.over?.classList.remove('over');
    drag.over = tgt;
    tgt?.classList.add('over');
  }
}, { passive: false });

function endDrag(e) {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) {
    // Çift dokunma: at. Tek dokunma: seç / seçimi kaldır
    const now = Date.now();
    if (lastTap.id === d.id && now - lastTap.t < 380 && playing()) {
      lastTap = { id: null, t: 0 };
      discard(d.id);
      return;
    }
    lastTap = { id: d.id, t: now };
    sel = sel === d.id ? null : d.id;
    renderGame();
    if (sel != null) requestAnimationFrame(() => document.querySelector('.meld.can, .meld.warn')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    return;
  }
  d.ghost.remove();
  d.over?.classList.remove('over');
  const tgt = e.type === 'pointerup' ? dropTargetAt(e.clientX, e.clientY) : null;
  if (tgt?.dataset.slot != null) moveTile(d.id, +tgt.dataset.slot);
  else if (tgt?.dataset.meld != null) attach(d.id, +tgt.dataset.meld);
  else if (tgt?.dataset.drop === 'discard') discard(d.id);
  renderGame();
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// Süre halkası
setInterval(() => {
  if (!S || S.lobby) return;
  const p = S.deadline ? Math.max(0, Math.min(1, (S.deadline - Date.now()) / (S.turnMs || 45000))) : 1;
  document.querySelectorAll('.turn .ava').forEach(a => a.style.setProperty('--p', p));
}, 250);

// ---------- Puan tablosu / el sonu ----------
function renderModal() {
  const modal = $('#modal');
  const ended = S && !S.lobby && S.phase === 'ended' && S.result;
  if (!S || S.lobby || (!ended && !scoresOpen)) { modal.classList.add('hidden'); return; }
  modal.classList.remove('hidden');
  const r = S.result;
  const seats = [0, 1, 2, 3].map(i => (S.you + i) % 4);
  let html = ended ? `<h2>${S.over ? 'Oyun bitti' : r.void ? 'El iptal' : 'El bitti'}</h2><p>${esc(r.reason)}</p>` : '<h2>Puanlar</h2>';

  if (S.over && r.final) {
    const w = r.final.winners.map(i => esc(S.players[i].name));
    html += esli() && r.final.winners.length === 2
      ? `<p class="winner">Kazanan takım: <b>${w.join(' ve ')}</b>${r.final.winners.includes(S.you) ? ' 🎉' : ''}</p>`
      : `<p class="winner">Kazanan: <b>${w.join(', ')}</b>${r.final.winners.includes(S.you) ? ' 🎉' : ''}</p>`;
  }

  // Çetele: her el ayrı satır
  const cols = esli() ? [[S.you, (S.you + 2) % 4], [(S.you + 1) % 4, (S.you + 3) % 4]] : seats.map(i => [i]);
  const head = esli() ? ['Biz', 'Onlar'] : seats.map(i => (i === S.you ? 'Sen' : S.players[i].name));
  html += '<div class="tablewrap"><table class="scores"><tr><th>El</th>' + head.map(h => `<th>${esc(h)}</th>`).join('') + '</tr>';
  S.history.forEach(row => {
    html += `<tr><td>${row.hand}${row.mult > 1 ? ` <small>x${row.mult}</small>` : ''}</td>` + cols.map(c => `<td>${c.reduce((a, i) => a + row.scores[i], 0)}</td>`).join('') + '</tr>';
  });
  const tot = cols.map(c => c.reduce((a, i) => a + S.players[i].total, 0));
  const best = Math.min(...tot);
  html += '<tr class="total"><td>Toplam</td>' + tot.map(t => `<td class="${S.history.length && t === best ? 'lead' : ''}">${t}</td>`).join('') + '</tr></table></div>';

  html += '<div id="revealed"></div>';
  if (!ended) html += `<details><summary class="muted">Oyun akışı</summary><ul class="loglist">${S.log.slice().reverse().map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>`;
  html += '<div class="row" style="margin-top:14px">';
  if (S.over && S.isHost) html += '<button class="primary grow" id="btnNew">Yeni oyun</button>';
  if (!ended) html += '<button class="grow" id="btnClose">Kapat</button>';
  html += '</div>';
  $('#modalBody').innerHTML = html;

  if (ended) {
    const rv = $('#revealed');
    seats.forEach(i => {
      if (i === r.winner || !r.hands[i].length) return;
      const lbl = document.createElement('div');
      lbl.className = 'muted';
      lbl.textContent = `${S.players[i].name} elinde kalanlar (${r.scores[i]})`;
      const line = document.createElement('div');
      line.className = 'revealed';
      r.hands[i].forEach(t => line.appendChild(tileEl(t, true)));
      rv.append(lbl, line);
    });
  }
  const nb = $('#btnNew');
  if (nb) nb.onclick = () => socket.emit('newGame');
  const cb = $('#btnClose');
  if (cb) cb.onclick = () => { scoresOpen = false; renderModal(); };
}
$('#modal').addEventListener('click', e => {
  if (e.target.id === 'modal' && scoresOpen) { scoresOpen = false; renderModal(); }
});


// ---------- Sohbet ----------
const chatLog = [];
$('#quick').innerHTML = QUICK.map(q => `<button type="button" class="small">${q}</button>`).join('');
$('#quick').onclick = e => { if (e.target.tagName === 'BUTTON') socket.emit('chat', e.target.textContent); };
$('#chatForm').onsubmit = e => {
  e.preventDefault();
  const v = $('#chatInput').value.trim();
  if (v) socket.emit('chat', v);
  $('#chatInput').value = '';
};
$('#btnChat').onclick = () => {
  $('#chatPanel').classList.toggle('hidden');
  $('#btnChat').classList.remove('unread');
};
socket.on('chat', m => {
  chatLog.push(m);
  if (chatLog.length > 50) chatLog.shift();
  $('#chatLog').innerHTML = chatLog.map(x => `<div><b>${esc(x.name)}:</b> ${esc(x.text)}</div>`).join('');
  $('#chatLog').scrollTop = 1e9;
  if ($('#chatPanel').classList.contains('hidden')) $('#btnChat').classList.add('unread');
  showBubble(m.seat, m.text);
});

function showBubble(seat, text) {
  if (!S || S.lobby) return;
  const r = (seat - S.you + 4) % 4;
  const target = r === 0 ? $('#meChip') : $('#pos' + r);
  if (!target) return;
  const rect = target.getBoundingClientRect();
  const b = document.createElement('div');
  b.className = 'bubble';
  b.textContent = text;
  document.body.appendChild(b);
  const x = Math.min(window.innerWidth - b.offsetWidth - 8, Math.max(8, rect.left + rect.width / 2 - b.offsetWidth / 2));
  const y = r === 0 ? rect.top - b.offsetHeight - 8 : rect.bottom + 6;
  b.style.left = x + 'px';
  b.style.top = Math.max(8, y) + 'px';
  setTimeout(() => b.classList.add('out'), 3800);
  setTimeout(() => b.remove(), 4300);
}

render();
