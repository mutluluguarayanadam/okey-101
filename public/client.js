const socket = io();
const $ = s => document.querySelector(s);
const COLORS = ['var(--red)', 'var(--yellow)', 'var(--blue)', 'var(--black)'];
const AVA = ['#c0392b', '#2e86c1', '#c47f0e', '#7d3c98'];
// Istakanın her sırasındaki yuva sayısı: en az 15; telefonda ıstaka ne kadar taş alıyorsa o kadar (fitRackCols)
let COLS = 15, SLOTS = 30;
// Avatarlar: emoji + arka plan rengi (sunucu sadece sıra numarasını tutar)
const AV_E = ['🦊', '🐻', '🐼', '🐯', '🦁', '🐸', '🐵', '🐧', '🦉', '🐺', '🐱', '🐶', '🐰', '🐨', '🦄', '🐙', '🐢', '🦅', '🐝', '🐞', '🌻', '⭐', '🍀', '🔥'];
const AV_C = ['#c0392b', '#2e86c1', '#c47f0e', '#7d3c98', '#1e8449', '#d35400', '#34495e', '#b03a6e'];
let myAvatar = (() => {
  try { const a = JSON.parse(localStorage.getItem('okey_avatar')); if (a && AV_E[a.e] && AV_C[a.c]) return a; } catch (e) {}
  return { e: Math.floor(Math.random() * AV_E.length), c: Math.floor(Math.random() * AV_C.length) };
})();
localStorage.setItem('okey_avatar', JSON.stringify(myAvatar));
const avatarFace = a => `<span class="avface" style="background:${AV_C[a.c]}">${AV_E[a.e]}</span>`;
const TEAM = ['Takım 1', 'Takım 2'];
const QUICK = ['Merhaba 👋', 'Kolay gelsin', 'Hadi bekliyoruz 🙂', 'Güzel hamle 👏', 'Şansına küs 😅', 'Eyvallah', 'Tebrikler 🎉', 'İyi oyunlar'];

let token = localStorage.getItem('okey_token');
if (!token) {
  token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  localStorage.setItem('okey_token', token);
}

let S = null;                        // sunucudan gelen son durum
let slots = Array(SLOTS).fill(null); // ıstaka: 2 sıra x COLS yuva, taş id'leri
let sel = null;                      // seçili taş
let handKey = null;
let fresh = new Set();               // yeni çekilen taşlar
let drag = null;
let lastTap = { id: null, t: 0 };
let pendingSlot = null;
// Istaka dizilimini geri alma (↶): kullanıcının yaptığı dizme/taşıma işlemlerinden önceki hâller
let rackHistory = [];
function pushRack() { rackHistory.push(slots.slice()); if (rackHistory.length > 15) rackHistory.shift(); }
function undoRack() {
  const prev = rackHistory.pop();
  if (!prev) return;
  const ids = new Set(S.hand.map(t => t.id));
  slots = prev.map(id => (ids.has(id) ? id : null));
  S.hand.forEach(t => { if (!slots.includes(t.id)) placeNew(t.id); });
  renderGame();
} // sürükleyerek çekilen taşın bırakıldığı yuva
let scoresOpen = false;
let wasMyTurn = false;
const PREF_DEFAULT = { sound: true, vibrate: true, autoSort: true, confirmRisky: true, shapes: false };
let prefs = Object.assign({}, PREF_DEFAULT, (() => { try { return JSON.parse(localStorage.getItem('okey_prefs')) || {}; } catch (e) { return {}; } })());
if (localStorage.getItem('okey_mute') === '1' && !localStorage.getItem('okey_prefs')) prefs.sound = false;
function savePrefs() {
  localStorage.setItem('okey_prefs', JSON.stringify(prefs));
  document.body.classList.toggle('shapes', !!prefs.shapes);
}
savePrefs();

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
$('#btnCreate').onclick = () => { const n = myName(); if (n) socket.emit('create', { name: n, token, avatar: myAvatar }); };
$('#btnJoin').onclick = () => { const n = myName(); if (n) socket.emit('join', { code: $('#code').value, name: n, token, avatar: myAvatar }); };
$('#btnRefresh').onclick = () => socket.emit('rooms');
function paintAvatarBtn() { $('#btnAvatar').innerHTML = avatarFace(myAvatar); }
paintAvatarBtn();
$('#btnAvatar').onclick = () => {
  const draw = () => {
    $('#modalBody').innerHTML = `<h2>Avatarını seç</h2>
      <div class="avbig">${avatarFace(myAvatar)}</div>
      <div class="avgrid">${AV_E.map((e, i) => `<button class="avopt ${i === myAvatar.e ? 'on' : ''}" data-e="${i}">${e}</button>`).join('')}</div>
      <div class="avcolors">${AV_C.map((c, i) => `<button class="avcol ${i === myAvatar.c ? 'on' : ''}" data-c="${i}" style="background:${c}" aria-label="Renk ${i + 1}"></button>`).join('')}</div>
      <div class="row" style="margin-top:14px"><button class="primary grow" id="avOk">Tamam</button></div>`;
    $('#modalBody').querySelectorAll('[data-e]').forEach(b => (b.onclick = () => { myAvatar.e = +b.dataset.e; draw(); }));
    $('#modalBody').querySelectorAll('[data-c]').forEach(b => (b.onclick = () => { myAvatar.c = +b.dataset.c; draw(); }));
    $('#avOk').onclick = () => {
      localStorage.setItem('okey_avatar', JSON.stringify(myAvatar));
      paintAvatarBtn();
      $('#modal').classList.add('hidden');
    };
  };
  $('#modal').classList.remove('hidden');
  draw();
};
let roomList = [];
socket.on('rooms', list => { roomList = list || []; renderRooms(); });

function renderRooms() {
  const box = $('#roomList');
  if (!roomList.length) {
    box.innerHTML = '<p class="muted empty">Şu an açık masa yok. Bir oda kur, arkadaşların burada görsün.</p>';
    return;
  }
  box.innerHTML = roomList.map(r => {
    if (r.permanent) {
      return `<button class="roomcard botroom" data-code="${esc(r.code)}">
        <span class="rc-main"><b>🤖 ${esc(r.title)}</b> <span class="badge open">Sürekli oyun</span></span>
        <span class="rc-sub">${r.mode === 'esli' ? 'Eşli' : 'Tekli'}${r.katlamali ? ' · Katlamalı' : ''} · ${r.humans ? r.humans + ' kişi oynuyor · ' : ''}${r.free} koltuk botta</span>
        <span class="rc-go">Otur ›</span>
      </button>`;
    }
    const st = r.status === 'bekliyor' ? '<span class="badge open">Bekliyor</span>'
      : r.status === 'oyunda' ? `<span class="badge">Oyunda · ${r.hand}. el</span>` : '<span class="badge">Bitti</span>';
    const seats = r.status === 'bekliyor' ? `${4 - r.free}/4 oyuncu` : `${r.free} koltukta bot var`;
    return `<button class="roomcard" data-code="${esc(r.code)}">
      <span class="rc-main"><b>${esc(r.host)}</b> masası ${st}</span>
      <span class="rc-sub">${r.mode === 'esli' ? 'Eşli' : 'Tekli'} · ${r.hands} el${r.katlamali ? ' · Katlamalı' : ''} · ${seats}</span>
      <span class="rc-go">Otur ›</span>
    </button>`;
  }).join('');
  box.querySelectorAll('.roomcard').forEach(b => (b.onclick = () => {
    const n = myName();
    if (n) socket.emit('join', { code: b.dataset.code, name: n, token, avatar: myAvatar });
  }));
}
renderRooms();
$('#btnStart').onclick = () => socket.emit('start');
$('#btnCopy').onclick = () => { navigator.clipboard?.writeText($('#wLink').textContent); toast('Bağlantı kopyalandı'); };
$('#btnShare').onclick = async () => {
  const url = $('#wLink').textContent, text = '101 Okey masama gel! 🎲';
  if (navigator.share) { try { await navigator.share({ title: '101 Okey', text, url }); } catch (e) { /* vazgeçildi */ } }
  else window.open('https://wa.me/?text=' + encodeURIComponent(text + ' ' + url), '_blank');
};
$('#btnTrack').onclick = () => S && !S.lobby && openDiscards(S.you);
$('#btnScores').onclick = () => { scoresOpen = true; renderModal(); };
$('#btnSettings').onclick = () => openSettings();
const touch = matchMedia('(pointer: coarse)').matches;
// Telefonda oyun yatay oynanır: tam ekrana geçip ekranı yatayda kilitle (Android). iPhone kilitlemeye izin
// vermez; orada dikey tutulunca "yan çevir" ekranı çıkar.
async function goLandscape() {
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    await screen.orientation?.lock?.('landscape');
  } catch (e) { /* desteklenmiyor: kullanıcı telefonu kendisi çevirir */ }
}
$('#btnRotate').onclick = goLandscape;
$('#rotateLock').addEventListener('pointerup', goLandscape);
let fsTried = false;
$('#game').addEventListener('pointerdown', () => {
  if (!touch || fsTried || document.fullscreenElement || !document.documentElement.requestFullscreen) return;
  fsTried = true;
  document.documentElement.requestFullscreen()
    .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
    .catch(() => {});
}, { capture: true });
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


socket.on('connect', () => {
  $('#netbar').classList.add('hidden');
  const c = localStorage.getItem('okey_room');
  if (c) socket.emit('join', { code: c, token, auto: true, avatar: myAvatar });
  else if (S) goLobby('Oda kapanmış. Yeni oda kurabilirsin.');
});
socket.on('disconnect', () => {
  $('#netbar').textContent = 'Sunucuyla bağlantı koptu, yeniden bağlanılıyor…';
  $('#netbar').classList.remove('hidden');
});
socket.io.on('reconnect_attempt', n => {
  if (n >= 3) $('#netbar').textContent = 'Sunucu uyanıyor olabilir (ücretsiz sunucu), lütfen bekle…';
});
socket.on('joined', ({ code }) => {
  localStorage.setItem('okey_room', code);
  history.replaceState(null, '', '?oda=' + code);
});
function goLobby(msg) {
  const wasIn = !!S;
  if (wasIn) socket.emit('leave');
  localStorage.removeItem('okey_room');
  S = null;
  handKey = null;
  scoresOpen = false;
  history.replaceState(null, '', '/');
  $('#code').value = '';
  discardsOpen = null;
  leaving = false;
  $('#modal').classList.add('hidden');
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  render();
  if (msg && wasIn) toast(msg);
}
socket.on('leftRoom', why => goLobby(why === 'gone' ? 'Oda kapanmış (sunucu yeniden başlamış olabilir). Yeni oda kurabilirsin.' : null));

function confirmLeave() {
  const inGame = S && !S.lobby && !S.over;
  $('#modalBody').innerHTML = `<h2>${inGame ? 'Oyundan çık' : 'Odadan çık'}</h2>
    <p>${inGame ? 'Oyundan çıkarsan yerine bot oynamaya devam eder. Aynı bağlantıyla geri girersen, bot koltuğuna oturabilirsin.' : 'Odadan çıkmak istediğine emin misin?'}</p>
    <div class="row" style="margin-top:14px"><button class="grow" id="btnStay">Vazgeç</button><button class="danger grow" id="btnLeaveOk">Çık</button></div>`;
  $('#modal').classList.remove('hidden');
  leaving = true;
  $('#btnStay').onclick = () => { leaving = false; $('#modal').classList.add('hidden'); render(); };
  $('#btnLeaveOk').onclick = () => { socket.emit('leave'); goLobby(); };
}
let leaving = false;
$('#btnLeave').onclick = confirmLeave;
$('#btnLeaveRoom').onclick = confirmLeave;
socket.on('kicked', () => { toast('Bu koltuğa başka bir sekmeden bağlanıldı'); S = null; render(); });
socket.on('err', m => toast(m));
socket.on('state', st => {
  const prev = S;
  S = st;
  if (!S.lobby) {
    // Kalan süre yerel saate çevrilir (sunucu ile cihaz saati farklı olabilir); aynı süre için gelen sonraki güncellemelerde bitiş zamanı sabit kalır
    S.deadline = S.timeLeft != null ? Date.now() + S.timeLeft : null;
    if (S.deadline && prev && prev.deadline && prev.timerId === S.timerId) S.deadline = prev.deadline;
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
// Kısa sesler: notalar [frekans, ...], her biri ~90ms
function beep(notes, vol = 0.18, type = 'triangle') {
  if (!prefs.sound) return;
  try {
    actx = actx || new AudioContext();
    const t = actx.currentTime, len = notes.length * 0.09 + 0.2;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    notes.forEach((f, i) => o.frequency.setValueAtTime(f, t + i * 0.09));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(actx.destination);
    o.start(t);
    o.stop(t + len + 0.02);
  } catch (e) { /* ses yok */ }
}
const buzz = ms => prefs.vibrate && navigator.vibrate?.(ms);
function turnAlert() {
  buzz([60, 40, 60]);
  beep([660, 880]);
  const f = $('#turnFlash');
  f.classList.remove('show'); void f.offsetWidth; f.classList.add('show');
  if (document.hidden) blinkTitle();
}
// Başka sekmedeyken başlık yanıp söner
let titleTimer = null;
function blinkTitle() {
  clearInterval(titleTimer);
  let on = false;
  titleTimer = setInterval(() => {
    if (!document.hidden || !myTurn()) { clearInterval(titleTimer); document.title = '101 Okey'; return; }
    on = !on; document.title = on ? '🔔 Sıra sende!' : '101 Okey';
  }, 900);
}
// Taş sesi: kısa, yumuşak bir "tak"
function clack(vol = 0.08) {
  if (!prefs.sound) return;
  try {
    actx = actx || new AudioContext();
    const t = actx.currentTime, o = actx.createOscillator(), g = actx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.05);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(actx.destination);
    o.start(t); o.stop(t + 0.09);
  } catch (e) { /* ses yok */ }
}

// Oyun sırasında telefon ekranı kararmasın
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) { /* desteklenmiyor */ }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && S && !S.lobby) keepAwake(true); });
// Android geri tuşu: oyundan atmak yerine sor
let backGuard = false;
window.addEventListener('popstate', () => {
  if (!backGuard) return;
  history.pushState({ g: 1 }, '');
  if (S && !leaving) confirmLeave();
});

function show(id) {
  const inGame = id === 'game' || id === 'waiting';
  if (inGame && !backGuard) { backGuard = true; history.pushState({ g: 1 }, ''); }
  if (!inGame) backGuard = false;
  keepAwake(id === 'game');
  if (id === 'lobby' && $('#lobby').classList.contains('hidden')) socket.emit('rooms'); // lobiye dönünce listeyi tazele
  ['lobby', 'waiting', 'game'].forEach(x => $('#' + x).classList.toggle('hidden', x !== id));
  document.body.classList.toggle('ingame', id === 'game');
  if (id === 'game') fitLayout();
}

// Taş boyunu ekranın gerçek ölçüsüne göre hesapla (her telefonda ıstaka tam sığsın)
// Telefon yatayda (kısa ekran) üst çubuk ve düğmeler sağdaki tek sütuna taşınır
// Telefon yatayda: üst çubuk kalkar; simgeler ☰ menüsüne, durum ıstakanın üstündeki çubuğa,
// yığın ve gösterge sol alt köşeye (çekme bölgesi) taşınır.
// Telefon yatayda öğeler yeni düzene taşınır; masaüstünde eski yerlerine döner
function placeControls(short) {
  const top = $('.topbar'), bar = $('.dockbar'), status = $('#status'), tb = $('.tbtns');
  const stock = $('.stock'), pile = $('#pile'), ind = $('#indicator').parentNode;
  const acts = $('.actions'), hs = $('#handScore'), menu = $('#btnMenu'), pos2 = $('#pos2'), table = $('.table');
  if (short) {
    if (tb.parentNode === $('#menuPop')) return;
    $('#menuPop').append(tb);
    $('.mt-left').append(menu);
    $('.mt-right').append(pos2);
    $('.mt-left').append(status);
    $('#infoCol').append(ind, pile);
    table.append(acts, $('#ciftBoard'));
    $('#rackline').append(hs);
  } else {
    if (tb.parentNode === top) return;
    top.append(status, tb);
    stock.append(ind, pile);
    $('#melds').append($('#ciftBoard'));
    bar.insertBefore(menu, $('#meChip'));
    bar.append(hs, acts);
    table.insertBefore(pos2, table.firstChild);
    $('#menuPop').classList.add('hidden');
  }
}
$('#bigSeri').onclick = () => S && !S.lobby && autoArrange('seri');
$('#bigCift').onclick = () => S && !S.lobby && autoArrange('cift');
$('#btnMenu').onclick = e => { e.stopPropagation(); $('#menuPop').classList.toggle('hidden'); };
$('#menuPop').addEventListener('click', () => $('#menuPop').classList.add('hidden'));
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('#menuPop, #btnMenu')) $('#menuPop').classList.add('hidden');
});

// Yatay ekran: telefon için kurulan Okey Plus düzeni kullanılır. Geniş ekranlarda (masaüstü, tablet)
// aynı düzen 1100 piksel genişliğinde tasarlanıp ekrana orantılı olarak büyütülür (CSS zoom);
// böylece oranlar fotoğraflardaki gibi kalır, hiçbir öğe ekranı kaplamaz.
let ZOOM = 1;
const DESIGN_W = 1100;
function fitLayout() {
  // Masaüstü/tablet (yatay, geniş): telefondaki Okey Plus düzeni 1100 px'te kurulup ekrana büyütülür;
  // böylece üstte süre çubuğu, yanlarda oyuncu şeritleri, sağda düğmeler aynen kalır, ekran boş kalmaz.
  const rvw = window.innerWidth, rvh = window.innerHeight;
  const land = rvw / rvh >= 1.3;
  ZOOM = land && rvw > DESIGN_W ? rvw / DESIGN_W : 1;
  const g = $('#game');
  if (g) g.style.zoom = ZOOM === 1 ? '' : ZOOM;
  document.body.classList.toggle('zoomed', ZOOM > 1);
  const vw = rvw / ZOOM, vh = rvh / ZOOM;
  const short = land && vh < 720;
  document.body.classList.toggle('short', short);
  placeControls(short);
  const gap = vw < 700 ? 2 : 3;
  const bar = 0;
  const PHI = 1.618;
  // Telefon: ıstakanın iki yanında büyük ÇİFT DİZ / SERİ DİZ düğmeleri (2 x 55px); ıstaka yüksekliğin ~%27'si
  // Taş: telefonda ekran genişliğinin ~%4,2'si (Okey Plus); büyütülmüş geniş ekranda ~%3,9'u (boş alan kalmasın)
  // Dar dikey ekran (düzen 'short' değilse): altın oran — ıstaka genişliği ekranın 1/φ'si
  const byW = short ? (vw - 22 - 112 - 14 * gap) / 15 : (vw / PHI - 40 - 14 * gap) / 15;
  const byH = short ? Math.min(((vh * 0.27 - 14) / 2) / 1.38, vw * (ZOOM > 1 ? 0.039 : 0.042)) : (((vh - 110) * (1 - 1 / PHI) - 30) / 2) / 1.38;
  const tw = Math.max(16, Math.min(short ? 54 : 96, byW, byH));
  const root = document.documentElement.style;
  root.setProperty('--tw', tw.toFixed(1) + 'px');
  root.setProperty('--gap', gap + 'px');
  root.setProperty('--bar', bar + 'px');
  root.setProperty('--sw', Math.max(14, Math.min(short ? 30 : 38, tw * (short ? 0.62 : 0.5))).toFixed(1) + 'px');
  // Per tahtasındaki taşlar: telefonda ıstakadakilerin yarısı kadar (daha çok per görünsün)
  root.setProperty('--bw', Math.max(15, Math.min(short ? 30 : 38, tw * 0.5)).toFixed(1) + 'px');
  // Telefonda çekme bölgesi (gösterge, yığın) ıstaka taşı boyunda; köşe taşları ~%90'ı
  root.setProperty('--dw', (short ? Math.max(24, tw * 1.0) : tw * 0.68).toFixed(1) + 'px');
  root.setProperty('--cw', (short ? Math.max(22, tw * 0.9) : tw).toFixed(1) + 'px');
}
window.addEventListener('resize', () => { if (S && !S.lobby) { fitLayout(); renderGame(); } });
window.addEventListener('orientationchange', () => setTimeout(fitLayout, 250));

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
    if (x) return `<div class="wseat p${pos[i]} ${i === S.you ? 'me' : ''}">${x.avatar ? avatarFace(x.avatar) : ''}<b>${esc(x.name)}${i === S.you ? ' (sen)' : ''}</b>${team}</div>`;
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
    <label class="check"><input type="checkbox" id="sWait" ${o.waitAttach ? 'checked' : ''} ${dis}><span><b>Açtığı turda işleme yok</b><small>Elini açan, işleme yapmak için bir tur bekler.</small></span></label>
    <label class="check"><input type="checkbox" id="sList" ${o.listed ? 'checked' : ''} ${dis}><span><b>Açık masalarda göster</b><small>Kapatırsan masaya sadece bağlantı ya da kodla girilir.</small></span></label>`;
  if (S.isHost) {
    const push = extra => socket.emit('settings', Object.assign({
      hands: $('#sHands').value, turnSec: $('#sTurn').value,
      katlamali: $('#sKat').checked, waitAttach: $('#sWait').checked, listed: $('#sList').checked, mode: o.mode,
    }, extra));
    $('#wSettings').querySelectorAll('[data-mode]').forEach(b => (b.onclick = () => push({ mode: b.dataset.mode })));
    ['#sHands', '#sTurn', '#sKat', '#sWait', '#sList'].forEach(id => ($(id).onchange = () => push()));
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
  const e = Rules.isJoker(t, S.okey) ? t : Rules.eff(t, S.okey);
  return pairFirst ? e.v * 10 + e.c : e.c * 100 + e.v;
}

// Elde ters çevrilen taşlar (sağ tık / uzun basma). Sadece bu tarayıcıda, sadece görünüm.
let flipped = new Set();

// inRack: ıstakadaki kendi taşın — okey de normal yüzüyle görünür (oyuncu kendisi tanır/çevirir)
function tileEl(t, small, inRack) {
  const d = document.createElement('div');
  if (t.id != null) d.dataset.tid = t.id;
  d.className = 'tile' + (small ? ' sm' : '');
  if (t.fake) {
    d.classList.add('fake');
    d.innerHTML = '<span>✿</span>';
    d.title = 'Sahte okey';
  } else {
    if (inRack && flipped.has(t.id)) {
      d.classList.add('joker', 'flipped');
      d.innerHTML = S && Rules.isJoker(t, S.okey) ? '<em class="okeylbl">OKEY</em>' : '';
      d.title = 'Ters çevrilmiş taş: okey olarak sayılır (sağ tık / uzun bas: yüzünü aç)';
    } else if (!inRack && S && t.id != null && Rules.isJoker(t, S.okey)) {
      // Gerçek okey masadaki gibi ters çevrilmiş görünür: numarasız, sade bir taş
      d.classList.add('joker');
      d.innerHTML = '';
      d.title = 'Okey (' + Rules.tileName(t) + ')';
    } else {
      d.style.color = COLORS[t.c];
      d.dataset.c = t.c;
      d.innerHTML = `<span>${t.v}</span><i></i>`;
    }
  }
  return d;
}

// ---------- Istaka mantığı ----------
// Istaka değerlendirmesi: okey ele ters çevrili gelir ve okeydir (joker); oyuncu yüzünü açarsa
// yüzündeki sayıdır. Sahte okey her zaman okeyin yerine geçtiği taştır.
const VOKEY = { c: -9, v: -9 };
function vt(t) {
  if (!t) return t;
  if (t.fake) return { id: t.id, c: S.okey.c, v: S.okey.v, fake: false };
  if (Rules.isJoker(t, S.okey)) return flipped.has(t.id) ? { id: t.id, c: VOKEY.c, v: VOKEY.v, fake: false } : { id: t.id, c: t.c, v: t.v, fake: false };
  return t;
}
const vts = ids => ids.map(id => vt(tileById(id)));
const meldOf = ids => Rules.makeMeld(vts(ids), VOKEY);

// Grupları iki sıraya (COLS'ar yuva) aralarında birer boşlukla paketler; kalan taşlar bir boşluk sonra gelir.
// Hiçbir zaman iki grubu bitişik koymaz. Sığmazsa null.
function arrange(groups, rest) {
  const tryOrder = list => {
    const rows = [[], []];
    for (const g of list) {
      if (!g.length) continue;
      // en sıkı sığan satırı seç (boşluk gerekiyorsa hesaba kat)
      let best = -1, bestFree = 99;
      rows.forEach((row, i) => {
        const need = g.length + (row.length ? 1 : 0), free = COLS - row.length;
        if (need <= free && free - need < bestFree) { best = i; bestFree = free - need; }
      });
      if (best < 0) return null;
      if (rows[best].length) rows[best].push(null);
      rows[best].push(...g);
    }
    const left = rest.slice();
    for (const row of rows) {
      if (!left.length) break;
      const gap = row.length ? 1 : 0;
      const room = COLS - row.length - gap;
      if (room <= 0) continue;
      if (gap) row.push(null);
      row.push(...left.splice(0, room));
    }
    if (left.length) return null;
    const out = Array(SLOTS).fill(null);
    rows.forEach((row, i) => row.forEach((id, k) => (out[i * COLS + k] = id)));
    return out;
  };
  return tryOrder(groups) || tryOrder(groups.slice().sort((a, b) => b.length - a.length));
}
function arrangeLegacy(groups, rest) {
  const out = Array(SLOTS).fill(null);
  let pos = 0;
  for (const id of groups.flat().concat(rest)) {
    if (pos >= SLOTS) return null;
    out[pos++] = id;
  }
  return out;
}

// Yeni çekilen taşı, ıstakada uyduğu grubun yanına koy (per tamamlıyor/uzatıyorsa ya da çift oluyorsa).
// Yanındaki yuva boş değilse grupları birleştirmemek için dokunmaz; uygun yer yoksa sona koyar.
function placeNew(id) {
  const t = tileById(id);
  const fits = ids => {
    const ts = ids.map(x => vt(x === id ? t : tileById(x)));
    if (ts.length >= 3) return !!Rules.makeMeld(ts, VOKEY);
    return ts.length === 2 && Rules.analyzePair(ts, VOKEY);
  };
  if (!Rules.isJoker(t, S.okey)) {
    for (let r = 0; r < 2; r++) {
      let c = 0;
      while (c < COLS) {
        if (slots[r * COLS + c] == null) { c++; continue; }
        const start = c;
        while (c < COLS && slots[r * COLS + c] != null) c++;
        const ids = slots.slice(r * COLS + start, r * COLS + c);
        const right = c, left = start - 1;
        const free = k => k >= 0 && k < COLS && slots[r * COLS + k] == null;
        // sağa: hedef yuva boş ve ondan sonraki de boş/sıra sonu olmalı (başka grupla birleşmesin)
        if (free(right) && (right + 1 >= COLS || free(right + 1)) && fits(ids.concat([id]))) { slots[r * COLS + right] = id; return; }
        if (free(left) && (left - 1 < 0 || free(left - 1)) && fits([id].concat(ids))) { slots[r * COLS + left] = id; return; }
      }
    }
  }
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
    // Okey ele ters çevrilmiş (joker olarak) gelir; istenirse sağ tık / uzun basma ile yüzü açılır
    flipped = new Set(S.hand.filter(t => Rules.isJoker(t, S.okey)).map(t => t.id));
    rackHistory = [];
    const sorted = S.hand.slice().sort((a, b) => tileKey(a) - tileKey(b)).map(t => t.id);
    slots = arrange([], sorted);
    if (prefs.autoSort) autoArrange('seri', true);
    return;
  }
  slots = slots.map(id => (ids.includes(id) ? id : null));
  ids.forEach(id => {
    if (slots.includes(id)) return;
    const nt = tileById(id);
    if (nt && Rules.isJoker(nt, S.okey)) flipped.add(id); // çekilen / masadan alınan okey de ters gelir
    placeNew(id);
    if (pendingSlot != null) { moveTile(id, pendingSlot); pendingSlot = null; }
    fresh.add(id);
    setTimeout(() => { fresh.delete(id); }, 2600);
  });
  if (sel != null && !ids.includes(sel)) sel = null;
}

function autoArrange(mode, quiet, done) {
  socket.emit('suggest', { flipped: [...flipped] }, res => {
    if (!S || S.lobby) return;
    const inHand = id => !!tileById(id);
    let groups;
    if (mode === 'seri') {
      groups = res.melds.filter(g => g.every(inHand)).map(g => {
        const a = Rules.analyzeMeld(vts(g), VOKEY);
        return a ? a.order.map(t => t.id) : g;
      });
    } else {
      groups = res.pairs.filter(g => g.every(inHand));
    }
    const used = new Set(groups.flat());
    const rest = S.hand.filter(t => !used.has(t.id))
      .sort((a, b) => tileKey(a, mode === 'cift') - tileKey(b, mode === 'cift'))
      .map(t => t.id);
    // Amaca göre kalanları grupla: açtıysan masaya işlenebilenler bir arada (işle / at ayrımı net),
    // açmadıysan yarım perler (iki taşı hazır seriler/gruplar) ikişer ikişer — neye ihtiyacın olduğu görünsün
    let extra = [], loose = rest;
    if (mode === 'seri') {
      const m = me();
      if (m.opened && S.melds.length) {
        const att = rest.filter(id => { const t = tileById(id); return !(Rules.isJoker(t, S.okey) && !flipped.has(id)) && S.melds.some(x => Rules.canAttach(x, t, S.okey)); });
        if (att.length) { extra.push(att); loose = rest.filter(id => !att.includes(id)); }
      } else if (!m.opened) {
        const pool = loose.slice(), partial = [];
        const ev = id => vt(tileById(id));
        for (let i = 0; i < pool.length; i++) {
          if (pool[i] == null) continue;
          const a = ev(pool[i]);
          for (let j = i + 1; j < pool.length; j++) {
            if (pool[j] == null) continue;
            const b = ev(pool[j]);
            const run = a.c === b.c && a.c >= 0 && Math.abs(a.v - b.v) >= 1 && Math.abs(a.v - b.v) <= 2;
            const set = a.v === b.v && a.c !== b.c;
            if (run || set) { partial.push(a.v <= b.v ? [pool[i], pool[j]] : [pool[j], pool[i]]); pool[i] = pool[j] = null; break; }
          }
        }
        extra = partial;
        loose = pool.filter(x => x != null);
      }
    }
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
      out = arrange(groups.concat(extra), loose) || arrange(groups, rest);
    }
    if (!quiet) pushRack();
    slots = out || arrangeLegacy(groups, rest);
    sel = null;
    renderGame();
    if (!quiet) {
      const ev = evalRack();
      if (!done) toast(mode === 'seri' ? `Seri: ${ev.score} puan` : `${ev.pairs.length} çift`);
    }
    if (done) done();
  });
}

// Elin gücü: ıstakadaki dizilişten bağımsız, eldeki tüm taşlarla kurulabilecek en iyi seri puanı ve çift sayısı
// (Seri diz / Çift diz'in kuracağı dizilimle aynı hesap). El değişince sunucudan bir kez istenir.
let pot = { key: null, score: 0, pairs: 0 };
let potPending = null;
function potKey() { return S.handIndex + '|' + S.hand.map(t => t.id).sort((a, b) => a - b).join(',') + '|' + [...flipped].sort((a, b) => a - b).join(','); }
function refreshPotential() {
  if (!S || S.lobby || !S.hand || me().opened) return;
  const k = potKey();
  if (k === pot.key || k === potPending) return;
  potPending = k;
  socket.emit('suggest', { flipped: [...flipped] }, res => {
    if (potPending === k) potPending = null;
    if (!S || S.lobby || !res) return;
    pot = { key: k, score: res.score || 0, pairs: (res.pairs || []).length };
    if (potKey() === k) { renderMe(); renderActions(); }
  });
}
// Güncel el için bilinen en iyi değerler (hesap gelmeden önce ıstakadaki dizilimle)
function handPotential(ev) {
  const fresh = S && pot.key === potKey();
  return { score: Math.max(ev.score, fresh ? pot.score : 0), pairs: Math.max(ev.pairs.length, fresh ? pot.pairs : 0) };
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
    if (g.length >= 3) {
      const a = meldOf(g);
      if (a) { melds.push({ ids: g, score: a.score }); continue; }
    }
    if (g.length % 2 === 0) {
      const chunks = [];
      for (let i = 0; i < g.length; i += 2) chunks.push(g.slice(i, i + 2));
      if (chunks.every(c => Rules.analyzePair(vts(c), VOKEY))) chunks.forEach(c => pairs.push({ ids: c }));
    }
  }
  const tooLong = rackGroups().filter(g => g.length > Rules.MAX_OPEN_RUN && Rules.isTooLongRun(vts(g), VOKEY));
  return { melds, pairs, tooLong, score: melds.reduce((s, m) => s + m.score, 0) };
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
  // Animasyon için: güncellemeden önce taşların ekrandaki yerleri
  const fresh_state = S !== animS;
  const before = captureRects();
  syncHand();
  $('#gCode').textContent = S.permanent ? '🤖 ' + S.title : S.code;
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
  $('#indicator').title = 'Gösterge: bunun bir üstü (aynı renk) okeydir';
  $('#pileCount').textContent = S.pile;
  const canDraw = myTurn() && S.phase === 'draw';
  $('#pile').classList.toggle('active', canDraw);
  $('#pile').classList.toggle('low', S.pile <= 6 && S.pile > 3);
  $('#pile').classList.toggle('crit', S.pile <= 3);
  $('#pile').title = canDraw ? 'Taş çek: dokun ya da ıstakaya sürükle' : `Yığında ${S.pile} taş`;
  document.body.classList.toggle('awaitdraw', canDraw);
  document.body.classList.toggle('myturn', myTurn());
  pileWarning();
  ticker();

  renderMelds();
  const o = S.opts || {};
  $('#modeInfo').innerHTML = `<span>${o.mode === 'esli' ? 'Eşli' : 'Tekli'}</span><span>${o.katlamali ? 'Katlamalı' : 'Katlamasız'}</span><span>${S.handIndex}/${S.hands} El</span>`;
  renderMe();
  if (!(drag && drag.moved)) renderRack();
  renderActions();
  renderModal();
  refreshPotential();
  tickTimer();
  runAnimations(before, fresh_state);
}

// ================= Animasyonlar =================
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let animS = null, animPrev = null;
let dragged = { draw: false, discard: false }; // sürükleyerek yapılan hamlede uçuşu tekrar oynatma
const rect = el => (el ? el.getBoundingClientRect() : null);
const visible = r => r && r.width > 0 && r.height > 0;

function captureRects() {
  if (!S || S.lobby) return null;
  const rack = new Map();
  document.querySelectorAll('#rack .tile[data-id]').forEach(el => rack.set(+el.dataset.id, rect(el)));
  const corners = [0, 1, 2, 3].map(r => rect(document.querySelector(`#corner${r} .tile`) || document.querySelector(`#corner${r} .dropzone`)));
  const avatars = [1, 2, 3].reduce((o, r) => ((o[r] = rect(document.querySelector(`#pos${r} .ava`))), o), {});
  return { rack, corners, avatars, pile: rect($('#pile')) };
}

function snap() {
  return {
    handKey, pile: S.pile,
    hand: new Set(S.hand.map(t => t.id)),
    count: S.players.map(p => p.count),
    disc: S.players.map(p => p.discards.length),
    melds: new Map(S.melds.map(m => [m.id, m.tiles.length])),
  };
}

// Bir kopyayı A noktasından B elemanının yerine uçurur; varışta asıl eleman görünür olur
function fly(from, toEl, proto, opts = {}) {
  if (reduceMotion || !visible(from) || !toEl) return;
  const to = rect(toEl);
  if (!visible(to)) return;
  const c = (proto || toEl).cloneNode(true);
  c.classList.remove('just', 'fresh', 'sel');
  c.classList.add('flyer');
  Object.assign(c.style, { zoom: ZOOM, left: to.left / ZOOM + 'px', top: to.top / ZOOM + 'px', width: to.width / ZOOM + 'px', height: to.height / ZOOM + 'px' });
  document.body.appendChild(c);
  if (!opts.keep) toEl.style.visibility = 'hidden';
  const dx = (from.left + from.width / 2 - (to.left + to.width / 2)) / ZOOM, dy = (from.top + from.height / 2 - (to.top + to.height / 2)) / ZOOM;
  const sc = from.width / to.width;
  const a = c.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${sc})`, opacity: opts.fadeIn ? 0.4 : 1 },
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
  ], { duration: opts.dur || 380, easing: 'cubic-bezier(.2,.8,.25,1)', delay: opts.delay || 0, fill: 'backwards' });
  const done = () => { c.remove(); toEl.style.visibility = ''; };
  a.onfinish = done; a.oncancel = done;
  setTimeout(done, 1500); // her ihtimale karşı
}

// Hedef bir nokta (eleman değil) ise: kopyayı oraya uçurup söndür
function flyTo(fromEl, from, to, opts = {}) {
  if (reduceMotion || !visible(from) || !visible(to) || !fromEl) return;
  const c = fromEl.cloneNode(true);
  c.classList.add('flyer');
  Object.assign(c.style, { zoom: ZOOM, left: from.left / ZOOM + 'px', top: from.top / ZOOM + 'px', width: from.width / ZOOM + 'px', height: from.height / ZOOM + 'px' });
  document.body.appendChild(c);
  const dx = (to.left + to.width / 2 - (from.left + from.width / 2)) / ZOOM, dy = (to.top + to.height / 2 - (from.top + from.height / 2)) / ZOOM;
  const a = c.animate([
    { transform: 'translate(0,0) scale(1)', opacity: 1 },
    { transform: `translate(${dx}px, ${dy}px) scale(.6)`, opacity: 0.2 },
  ], { duration: opts.dur || 420, easing: 'cubic-bezier(.4,.1,.3,1)' });
  a.onfinish = a.oncancel = () => c.remove();
  setTimeout(() => c.remove(), 1500); // her ihtimale karşı
}

function runAnimations(before, changed) {
  if (!S || S.lobby) return;
  const now = snap();
  const prev = animPrev;
  animS = S;
  animPrev = now;
  if (!before) return;

  // Istakada taşların kayarak yer değiştirmesi (FLIP)
  if (!reduceMotion) {
    document.querySelectorAll('#rack .tile[data-id]').forEach(el => {
      const id = +el.dataset.id, old = before.rack.get(id);
      if (!old || fresh.has(id) && changed) return;
      const nw = rect(el);
      const dx = (old.left - nw.left) / ZOOM, dy = (old.top - nw.top) / ZOOM;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }],
        { duration: 220, easing: 'cubic-bezier(.2,.8,.25,1)' });
    });
  }
  if (!changed || !prev || prev.handKey !== now.handKey) return;

  const you = S.you;
  const relOf = abs => (abs - you + 4) % 4;
  const leftAbs = (you + 3) % 4;

  if ([...now.hand].some(id => !prev.hand.has(id)) || now.disc.some((d, i) => d > prev.disc[i])) clack();
  // Benim çektiğim taş: yığından ya da soldakinden ıstakadaki yerine
  const skipDraw = dragged.draw, skipDisc = dragged.discard;
  if (now.disc[S.you] > prev.disc[S.you]) dragged.discard = false;
  if ([...now.hand].some(id => !prev.hand.has(id))) dragged.draw = false;
  S.hand.forEach(t => {
    if (prev.hand.has(t.id) || skipDraw) return;
    const el = document.querySelector(`#rack .tile[data-id="${t.id}"]`);
    const fromDiscard = now.disc[leftAbs] < prev.disc[leftAbs];
    fly(fromDiscard ? before.corners[3] : before.pile, el, null, { fadeIn: !fromDiscard });
  });

  // Benim attığım taş: ıstakadan atış köşesine
  if (now.disc[you] > prev.disc[you] && !skipDisc) {
    const top = S.players[you].discardTop;
    if (top) fly(before.rack.get(top.id), document.querySelector('#corner0 .tile'));
  }

  // Elimden masaya inen taşlar (açma, indirme, işleme)
  S.melds.forEach(m => m.tiles.forEach(t => {
    if (!prev.hand.has(t.id) || now.hand.has(t.id)) return;
    const el = document.querySelector(`.meld .tile[data-tid="${t.id}"]`);
    if (el) fly(before.rack.get(t.id), el, null, { dur: 420 });
  }));

  // Rakipler: atış avatarından köşeye, çekiş yığından/soldakinden avatara
  for (let r = 1; r <= 3; r++) {
    const abs = (you + r) % 4;
    if (now.disc[abs] > prev.disc[abs]) {
      fly(before.avatars[r], document.querySelector(`#corner${r} .tile`), null, { fadeIn: true });
    }
    if (now.count[abs] > prev.count[abs]) {
      const srcAbs = (abs + 3) % 4;
      const tookDiscard = now.disc[srcAbs] < prev.disc[srcAbs];
      const back = Object.assign(document.createElement('div'), { className: 'tile back' });
      const from = tookDiscard ? before.corners[relOf(srcAbs)] : before.pile;
      if (from) {
        back.style.width = from.width / ZOOM + 'px';
        back.style.height = from.height / ZOOM + 'px';
        flyTo(back, from, before.avatars[r]);
      }
    }
  }

  // Yeni açılan perler belirerek gelir, işlenen perler parlar
  S.melds.forEach(m => {
    const el = document.querySelector(`.meld[data-meld="${m.id}"]`);
    if (!el) return;
    if (!prev.melds.has(m.id)) el.classList.add('meldin');
    else if (prev.melds.get(m.id) !== m.tiles.length) el.classList.add('meldflash');
  });
}

// Yığın azalınca uyarı (her eşik bir kez)
let lastPile = null;
function pileWarning() {
  if (S.phase === 'ended') { lastPile = null; return; }
  const p = S.pile;
  if (lastPile != null && p < lastPile) {
    const hit = [6, 3, 1].find(x => p <= x && lastPile > x);
    if (hit) {
      toast(p === 1 ? '⚠️ Yığında SON TAŞ kaldı!' : `⚠️ Yığında ${p} taş kaldı`);
      beep([520, 420], 0.12, 'sine');
    }
  }
  lastPile = p;
}

// Son hamle şeridi: masada kısa süreliğine görünür
let lastLogLine = null;
function ticker() {
  const line = S.log[S.log.length - 1];
  const el = $('#ticker');
  if (!line || line === lastLogLine) return;
  lastLogLine = line;
  el.textContent = line;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(ticker.h);
  ticker.h = setTimeout(() => el.classList.remove('show'), 3500);
}

function renderStatus() {
  const st = $('#status');
  st.classList.toggle('myturn', myTurn());
  let txt;
  if (S.phase === 'ended') txt = S.over ? 'Oyun bitti' : 'El bitti, yeni el başlıyor…';
  else if (myTurn()) txt = S.phase === 'draw' ? 'Sıra sende: taş çek' : 'Sıra sende: bir taş at';
  else txt = `${S.players[S.turn].name} oynuyor`;
  if (S.phase !== 'ended' && S.pile <= 3) txt += ` · Yığında ${S.pile} taş!`;
  st.textContent = txt;
}

function avaHtml(abs) {
  const p = S.players[abs];
  const crown = leaders().includes(abs) ? '<i class="crown" title="Önde">👑</i>' : '';
  const team = esli() ? ` team t${abs % 2}` : '';
  const bg = p.avatar ? AV_C[p.avatar.c] : AVA[abs];
  const face = p.bot ? '🤖' : p.avatar ? AV_E[p.avatar.e] : esc(initials(p.name));
  return `<div class="ava${!p.bot && !p.connected ? ' away' : ''}${team}${p.avatar && !p.bot ? ' emo' : ''}" style="--c:${bg}">${face}${crown}</div>`;
}

function renderPlayer(el, abs) {
  const p = S.players[abs];
  el.classList.toggle('turn', S.turn === abs && S.phase !== 'ended');
  const tags = [];
  if (partner(abs)) tags.push('<span class="badge mate">Eşin</span>');
  if (!p.bot && !p.connected) tags.push('<span class="badge off">Bot oynuyor</span>');
  if (p.opened) tags.push(`<span class="badge ${p.openType === 'cift' ? 'pairb' : 'open'}">${p.openType === 'cift' ? 'Çift ' + (p.openPairs || '') : 'Seri ' + (p.openScore || '')}</span>`);
  if (p.penalty) tags.push(`<span class="badge off">+${p.penalty}</span>`);
  el.classList.toggle('opened', !!p.opened);
  el.innerHTML = avaHtml(abs).replace(/<\/div>$/, `<i class="acount" title="Elindeki taş">${p.count}</i></div>`) +
    `<div class="pinfo"><b>${esc(p.name)}</b><small>${p.count} taş<span class="tot"> · ${p.total} puan</span></small><div class="tags">${tags.join('')}</div></div>`;
}

const prevDiscards = {};
// Köşe r: (sen + r) numaralı oyuncunun attığı taş. 3 = soldaki (alabilirsin), 0 = senin atış alanın
function renderCorner(r) {
  const abs = (S.you + r) % 4;
  const p = S.players[abs];
  const el = $('#corner' + r);
  el.className = `corner ${['c-br', 'c-tr', 'c-tl', 'c-bl'][r]}`;
  const zone = document.createElement('div');
  zone.className = 'dropzone';
  if (p.discardTop) {
    const te = tileEl(p.discardTop);
    if (prevDiscards[abs] != null && p.discards.length > prevDiscards[abs]) te.classList.add('just');
    zone.appendChild(te);
  }
  prevDiscards[abs] = p.discards.length;
  if (p.discards.length > 1) {
    const n = document.createElement('span');
    n.className = 'dcount';
    n.textContent = p.discards.length;
    zone.appendChild(n);
  }
  const lbl = document.createElement('small');
  lbl.textContent = r === 0 ? 'Senin attığın' : p.name;
  el.replaceChildren(zone, lbl);
  el.onclick = () => openDiscards(abs);
  el.title = 'Atılan taşları gör';
  if (r === 3 && p.discardTop && myTurn() && S.phase === 'draw' && !S.undoUsed) {
    el.classList.add('takeable');
    el.title = 'Bu taşı al: dokun ya da ıstakaya sürükle';
    el.onclick = null; // dokunma/sürükleme aşağıdaki işaretçi olaylarıyla

  }
  if (r === 0) {
    el.id = 'corner0';
    if (playing()) {
      el.classList.add('target');
      el.dataset.drop = 'discard';
      el.onclick = () => (sel != null ? discard(sel) : openDiscards(abs));
    } else delete el.dataset.drop;
  }
}

// Per tahtası: seriler solda, çiftler sağda; perler alt alta ve sütun sütun dizilir.
// Kimin peri olduğu, perin solundaki renkli çizgiyle gösterilir (oyuncunun avatar rengi).
function ownerColor(abs) {
  const p = S.players[abs];
  return p.avatar && !p.bot ? AV_C[p.avatar.c] : AVA[abs];
}
// Per tahtası (Okey Plus gibi): tahta ortadan iki eşit yarıdır; her per ayrı bir satır, satırda 1'den 13'e
// kutu var ve taşlar sayılarına denk gelen kutuya oturur (her taşın yeri belli). Perler önce sol yarıyı,
// sığmazsa sağ yarıyı doldurur. Kutu boyu tahtanın genişliğinden: taşlar sığabilecekleri en büyük boyda.
// Satırın başındaki renkli nokta perin sahibini gösterir. İşlenebilecek boş kutuya "+" konur. Çiftler ayrı alanda.
function meldValue(m) {
  const real = m.tiles.find(x => !Rules.isJoker(x, S.okey));
  return real ? Rules.eff(real, S.okey).v : 1;
}
// Satırdaki taşları kutularına yerleştir (sütun 1 = sahip noktası, sütun n+1 = sayı n)
function layoutRow(el, m) {
  el.classList.add('mrow');
  const n = m.tiles.length;
  let start;
  if (m.type === 'run') start = m.start;
  else { const v = meldValue(m); start = v + n - 1 <= 13 ? v : v - n + 1; }
  let col = start;
  [...el.children].forEach(k => {
    if (k.classList.contains('ghostslot')) {
      let c = k.dataset.choice === 'add-left' ? start - 1 : start + n;
      if (c > 13) c = start - 1;
      k.style.gridColumn = String(c + 1);
    } else {
      k.style.gridColumn = String(col + 1);
      col++;
    }
  });
  const mk = document.createElement('i');
  mk.className = 'omark';
  mk.style.gridColumn = '1';
  el.prepend(mk);
}
function renderMelds() {
  const bs = $('#seriBoard'), bc = $('#ciftBoard');
  const W = bs.clientWidth, H = bs.clientHeight;
  if (!W || !H) { requestAnimationFrame(() => S && !S.lobby && bs.clientWidth && renderMelds()); }
  const tw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tw')) || 40;
  const slotSvg = (w, h, rects) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${rects}</svg>`)}")`;
  const slotRect = (x, c, ch) => `<rect x='${x + 1.5}' y='1.5' width='${c - 3}' height='${ch - 3}' rx='${Math.max(2, Math.round(c * 0.16))}' fill='rgba(255,255,255,0.025)' stroke='rgba(255,255,255,0.055)'/>`;
  // Yatay ekranda tahta ortadan iki eşit yarı; dikey (dar, uzun) ekranda yarıya 13 kutu sığmaz, tek yarı olur
  const nH = W >= H ? 2 : 1;
  bs.innerHTML = '<div class="half"></div>'.repeat(nH);
  const halves = bs.querySelectorAll('.half');
  // Çiftler alanı: kendi kutu boyuyla (seri tahtasından bağımsız), çift biçiminde (yan yana iki taş) yuvalar.
  // Kutu, alanın genişliğine ve çift sayısına göre seçilir; çiftin iki taşı hep yan yana kalır.
  const pg = 8, pad = 16;
  const pcap = Math.round(tw * 0.75);
  const short = document.body.classList.contains('short');
  // Geniş olmayan düzende çift alanı tahtanın en çok ~%30'u kadar (dikey telefonda seriler sıkışmasın)
  if (!short) bc.style.width = Math.min(2 * (2 * pcap + 4) + pg + pad, Math.round(($('#melds').clientWidth || 1e4) * 0.3)) + 'px'; else bc.style.width = '';
  const bcw = Math.max(20, (bc.clientWidth || (2 * (2 * pcap + 4) + pg + pad)) - pad);
  const bch = bc.clientHeight || H;
  const nPairs = S.melds.filter(m => m.type === 'pair').length;
  const pcols = Math.max(1, Math.min(2, Math.floor((bcw + pg) / (2 * 10 + 4 + pg))));
  const pRows = Math.max(1, Math.ceil(nPairs / pcols));
  const pcell = Math.max(8, Math.min(pcap, Math.floor(((bcw - pg * (pcols - 1)) / pcols - 4) / 2), Math.floor(((bch - 10) / pRows - 4) / 1.36)));
  const pcellH = Math.round(pcell * 1.36);
  const pw = 2 * pcell + 4;
  bc.style.setProperty('--pcols', pcols);
  bc.style.setProperty('--pw', pw + 'px');
  bc.style.setProperty('--cell', pcell + 'px');
  bc.style.setProperty('--cellh', pcellH + 'px');
  let prects = '';
  for (let k = 0; k < pcols; k++) {
    const x = k * (pw + pg) + 2;
    prects += slotRect(x, pcell, pcellH) + slotRect(x + pcell, pcell, pcellH);
  }
  bc.style.backgroundImage = slotSvg(pcols * (pw + pg), pcellH + 4, prects);
  bc.style.backgroundSize = `${pcols * (pw + pg)}px ${pcellH + 4}px`;
  bc.style.backgroundPosition = '9px 5px';
  bc.style.backgroundRepeat = 'repeat-y';
  bc.innerHTML = '';
  const tid = drag ? drag.id : sel;
  let t = tid != null ? tileById(tid) : null;
  // Çevrilmemiş okey seçilince perler parlamaz (okey olduğunu belli etmesin); çevirince okey gibi işlenir
  if (t && Rules.isJoker(t, S.okey) && !flipped.has(t.id)) t = null;
  const canNow = playing() && me().opened;
  const rel = m => (m.owner - S.you + 4) % 4;
  const runs = [];
  S.melds.slice().sort((a, b) => rel(a) - rel(b) || a.id - b.id).forEach(m => {
    const el = meldEl(m, t, canNow);
    el.classList.add('own');
    el.style.setProperty('--oc', ownerColor(m.owner));
    el.title = (el.title ? el.title + ' · ' : '') + (m.owner === S.you ? 'Senin perin' : S.players[m.owner].name);
    if (m.type === 'pair') { bc.appendChild(el); return; }
    layoutRow(el, m);
    runs.push(el);
  });
  // Kutu boyu: her yarıya 1 nokta + 13 kutu sığsın (genişlik), ıstaka taşını geçmesin; perler iki yarının
  // satırlarına sığmıyorsa satırlar sığana dek küçülür. Kaydırma çıkmaz.
  const DOT = 12, MID = 14, GY = 4;
  const halfW = (W - MID * (nH - 1)) / nH;
  let cell = Math.max(8, Math.min(Math.round(tw), Math.floor((halfW - DOT) / 13)));
  const rowsFor = c => Math.max(1, Math.floor((H - 6 + GY) / (Math.round(c * 1.36) + GY)));
  while (cell > 8 && rowsFor(cell) * nH < runs.length) cell--;
  const cellH = Math.round(cell * 1.36), rowH = cellH + GY;
  bs.style.setProperty('--cell', cell + 'px');
  bs.style.setProperty('--cellh', cellH + 'px');
  bs.style.setProperty('--rowh', rowH + 'px');
  // Boş yuvalar: her yarıda 13 taş biçiminde dikdörtgen, satır satır (taşlarla birebir hizalı)
  let rects = '';
  for (let k = 0; k < 13; k++) rects += slotRect(k * cell, cell, cellH);
  halves.forEach(hf => {
    hf.style.backgroundImage = slotSvg(13 * cell, rowH, rects);
    hf.style.backgroundSize = `${13 * cell}px ${rowH}px`;
    hf.style.backgroundPosition = DOT + 'px 0';
    hf.style.backgroundRepeat = 'repeat-y';
  });
  const cap = rowsFor(cell);
  runs.forEach((el, i) => halves[Math.min(nH - 1, Math.floor(i / cap))].appendChild(el));
  if (!runs.length) halves[0].innerHTML = '<span class="blabel">Açılan seriler burada görünecek</span>';
  if (!bc.children.length) bc.innerHTML = '<span class="blabel">Çiftler</span>';
}

function meldEl(m, t, canNow) {
  const d = document.createElement('div');
  d.className = 'meld' + (m.type === 'pair' ? ' pair' : '');
  d.dataset.meld = m.id;
  const tiles = m.tiles.map(x => tileEl(x, true));
  // Bu tur o yana 2 taş işlendiyse o yan artık önerilmez (okey alma her zaman serbest)
  const used = (S.attachCount || {})[m.id] || { left: 0, right: 0 };
  const opts = t ? Rules.attachOptions(m, t, S.okey).filter(o => o.kind === 'swap' || (used[o.side] || 0) < 2) : [];
  if (opts.length && canNow) {
    d.classList.add('can');
    // Her seçenek ayrı bir hedef: "+" başa/sona ekler, "Al" okeyi alır. Uygulama kendi seçmez.
    opts.forEach(o => {
      if (o.kind === 'swap') {
        const jt = tiles[o.index];
        jt.classList.add('swapme');
        jt.dataset.meld = m.id;
        jt.dataset.choice = 'swap';
        jt.title = 'Okeyi al (seçili taş okeyin yerine geçer)';
        jt.onclick = e => { e.stopPropagation(); attach(t.id, m.id, { kind: 'swap' }); };
      } else {
        const gh = document.createElement('div');
        gh.className = 'tile sm ghostslot';
        gh.textContent = '+';
        gh.dataset.meld = m.id;
        gh.dataset.choice = 'add-' + o.side;
        gh.title = o.side === 'left' ? 'Başa ekle' : 'Sona ekle';
        gh.onclick = e => { e.stopPropagation(); attach(t.id, m.id, { kind: 'add', side: o.side }); };
        if (o.side === 'left') tiles.unshift(gh); else tiles.push(gh);
      }
    });
    d.title = opts.length > 1 ? 'Nereye koyacağını seç: + ya da Al' : 'Seçili taşı buraya işle';
    d.onclick = () => (opts.length === 1 ? attach(t.id, m.id, choiceOf(opts[0])) : toast('Birden fazla yol var: + (ekle) ya da Al (okeyi al) üzerine dokun'));
  } else if (opts.length) {
    d.classList.add('warn');
    d.title = 'Bu taş bu pere işler: atarsan 101 ceza';
  }
  tiles.forEach(x => d.appendChild(x));
  return d;
}
const choiceOf = o => (o.kind === 'swap' ? { kind: 'swap' } : { kind: 'add', side: o.side });

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
    const b = S.barrier, hp = handPotential(ev);
    const sOk = hp.score >= b.per, cOk = hp.pairs >= b.cift;
    // Hangi yola gitmeli: barajı geçen, geçen yoksa barajına oranla daha yakın olan
    const lead = sOk !== cOk ? (sOk ? 's' : 'c') : (hp.score / b.per >= hp.pairs / b.cift ? 's' : 'c');
    hs.classList.toggle('ready', sOk || cOk);
    hs.title = 'Istakadaki dizilişten bağımsız: elindeki taşlarla kurulabilecek en iyi seri puanı ve çift sayısı. ▲ gitmen gereken yön.';
    hs.innerHTML = `<span class="${lead === 's' ? 'lead' : ''}">Seri <b class="${sOk ? 'ok' : ''}">${hp.score}</b>/${b.per}</span><span class="${lead === 'c' ? 'lead' : ''}">Çift <b class="${cOk ? 'ok' : ''}">${hp.pairs}</b>/${b.cift}</span>`;
  } else {
    // El sonunda yazılacak gibi: elde kalan her okey 101
    const left = S.hand.reduce((s, t) => s + Rules.tilePoints(t, S.okey), 0);
    hs.classList.remove('ready');
    hs.innerHTML = `<span>Elde kalan <b>${left}</b></span>`;
  }
}

// Telefon yatayda ıstaka ekran boyunca uzanır: her sıraya ıstakanın alabildiği kadar yuva konur (en az 15).
// Yuva sayısı değişince taşlar yerlerinde kalır; daralırken sığmayan taşlar boşluklar kısaltılarak içeri alınır.
function rackColsFit() {
  const rack = $('#rack');
  if (!document.body.classList.contains('short') || document.body.classList.contains('zoomed') || !rack.clientWidth) return 15;
  const cs = getComputedStyle(rack), css = getComputedStyle(document.documentElement);
  const inner = rack.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const tw = parseFloat(css.getPropertyValue('--tw')) || 40, gap = parseFloat(css.getPropertyValue('--gap')) || 2;
  return Math.max(15, Math.floor((inner + gap) / (tw + gap)));
}
function setRackCols(n) {
  if (n === COLS) return;
  const rows = [0, 1].map(r => slots.slice(r * COLS, r * COLS + COLS));
  const over = [];
  rows.forEach(row => {
    while (row.length > n && row[row.length - 1] == null) row.pop();
    // grupları ayıran tek boşluklara dokunmadan fazla boşlukları sağdan kısalt; yine sığmazsa fazlası başka yere
    for (let k = row.length - 1; row.length > n && k > 0; k--) if (row[k] == null && row[k - 1] == null) row.splice(k, 1);
    while (row.length > n) { const id = row.pop(); if (id != null) over.push(id); }
    while (row.length < n) row.push(null);
  });
  COLS = n; SLOTS = 2 * n;
  slots = rows[0].concat(rows[1]);
  rackHistory = [];
  over.forEach(id => (S ? placeNew(id) : (slots[slots.indexOf(null)] = id)));
}
function renderRack() {
  const rack = $('#rack');
  rack.innerHTML = '';
  setRackCols(rackColsFit());
  const ev = evalRack();
  const inMeld = new Set(ev.melds.flatMap(m => m.ids));
  const inPair = new Set(ev.pairs.flatMap(p => p.ids));
  const firstOf = new Map(ev.melds.map(m => [m.ids[0], m.score]));
  const longFirst = new Set(ev.tooLong.map(g => g[0]));
  const longIds = new Set(ev.tooLong.flat());
  const showIsler = S.melds.length > 0;
  for (let r = 0; r < 2; r++) {
    const row = document.createElement('div');
    row.className = 'rackrow';
    row.style.gridTemplateColumns = `repeat(${COLS}, var(--tw))`;
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.slot = i;
      const id = slots[i];
      if (id != null) {
        const t = tileById(id);
        const d = tileEl(t, false, true);
        d.dataset.id = id;
        if (sel === id) d.classList.add('sel');
        if (fresh.has(id)) d.classList.add('fresh');
        if (inMeld.has(id)) d.classList.add('grp');
        if (firstOf.has(id)) { const b = document.createElement('span'); b.className = 'gscore'; b.textContent = firstOf.get(id); d.appendChild(b); }
        if (longFirst.has(id)) { const b = document.createElement('span'); b.className = 'gscore long'; b.textContent = '≤5'; b.title = 'Seri en fazla 5 taşla açılır: araya boşluk koyup ikiye böl'; d.appendChild(b); }
        if (longIds.has(id)) d.classList.add('toolong');
        else if (inPair.has(id)) d.classList.add('grp', 'pair');
        if (showIsler && !Rules.isJoker(t, S.okey) && S.melds.some(m => Rules.canAttach(m, t, S.okey))) {
          d.classList.add('isler');
          d.title = 'İşlek taş: masadaki bir pere uyuyor';
        }
        slot.appendChild(d);
      } else if (sel != null) {
        slot.classList.add('target');
        slot.onclick = () => { pushRack(); moveTile(sel, i); sel = null; renderGame(); };
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
  // İki ayrı düğme (Okey Plus gibi): SERİ AÇ ve ÇİFT AÇ; açtıktan sonra SERİ / ÇİFT İNDİR
  const os = btn('openSeri'), oc = btn('openCift');
  const ciftArea = S.players.some(p => p.openType === 'cift');
  let sReady, cReady;
  if (!m.opened) {
    const hp = handPotential(ev);
    sReady = hp.score >= S.barrier.per;
    cReady = hp.pairs >= S.barrier.cift;
    os.textContent = sReady ? `Seri aç (${hp.score})` : 'Seri aç';
    oc.textContent = cReady ? `Çift aç (${hp.pairs})` : 'Çift aç';
    os.classList.remove('hidden');
    oc.classList.remove('hidden');
  } else {
    const nm = m.openType === 'per' ? ev.melds.length : 0;
    const np = m.openType === 'cift' || ciftArea ? ev.pairs.length : 0;
    sReady = nm > 0;
    cReady = np > 0;
    os.textContent = nm ? `Seri indir (${nm})` : 'Seri indir';
    oc.textContent = np ? `Çift indir (${np})` : 'Çift indir';
    os.classList.toggle('hidden', m.openType === 'cift');
    oc.classList.toggle('hidden', m.openType === 'per' && !ciftArea);
  }
  os.disabled = !playing() || !sReady;
  oc.disabled = !playing() || !cReady;
  os.classList.toggle('ready', playing() && sReady);
  oc.classList.toggle('ready', playing() && cReady);
  btn('seri').disabled = btn('cift').disabled = S.phase === 'ended';
  btn('undo').classList.toggle('hidden', S.mustOpenWith == null);
  // "İşle": işlenebilen normal taşları tek dokunuşla masaya işler (okey ve okey alma hariç)
  const islek = playing() && m.opened ? S.hand.filter(t => !Rules.isJoker(t, S.okey) &&
    S.melds.some(x => Rules.attachOptions(x, t, S.okey).filter(o => o.kind === 'add').length === 1)).length : 0;
  btn('auto').classList.toggle('hidden', !islek);
  btn('auto').textContent = `İşle (${islek})`;
  btn('undoRack').classList.toggle('hidden', !rackHistory.length);
  btn('hint').classList.toggle('hidden', !playing() || S.mustOpenWith != null);

  let hint = '';
  const selT = sel != null ? tileById(sel) : null;
  const selIsler = selT && S.melds.some(x => Rules.canAttach(x, selT, S.okey));
  if (S.mustOpenWith != null) hint = 'Yandan aldığın taşı kullanarak elini açmalısın. Açamazsan ya da açmak istemezsen taşı geri koyabilirsin (101 ceza).';
  else if (selIsler && !(playing() && me().opened)) hint = 'Bu taş işlek: masadaki kırmızı çerçeveli pere uyuyor. Atarsan 101 ceza yazılır.';
  else if (playing() && sel != null) hint = me().opened && selIsler ? 'Parlayan pere dokunarak işle (+ işaretli yere eklenir). Okeyi alabileceğin perde okey parlar.' : 'Sağ alttaki alana dokunarak at ya da boş bir yuvaya taşı.';
  else if (playing() && evalRack().tooLong.length) hint = 'Seri en fazla 5 taşla açılır: uzun seriyi araya boşluk koyarak ikiye böl (örn. 1-2-3-4 ve 5-6-7).';
  else if (playing()) hint = 'Perlerin arasında bir boşluk bırak, puanın otomatik hesaplanır. Taşı sürükleyip sağ alt köşeye bırakarak at.';
  else if (myTurn()) hint = 'Ortadaki yığından ya da sol alttaki taştan çek: dokun ya da ıstakada istediğin yuvaya sürükle.';
  $('#hint').textContent = hint;
}

// ---------- Hamleler ----------
function act(a) { socket.emit('act', a); }
function discard(id, force) {
  if (!playing() || id == null) return;
  const t = tileById(id);
  if (!force && prefs.confirmRisky && t && S.hand.length > 1 && !Rules.isJoker(t, S.okey)) {
    let warn = null;
    if (S.melds.some(m => Rules.canAttach(m, t, S.okey))) warn = 'Bu taş masadaki bir pere işlenebiliyor (işlek). Atarsan <b>101 ceza</b> yazılır.';
    if (warn) {
      renderGame();
      return confirmBox('Emin misin?', warn, 'Yine de at', () => discard(id, true));
    }
  }
  sel = null;
  act({ type: 'discard', id });
}

// Genel açılır pencere (oyun güncellemeleri üzerine yazmasın diye kilitlenir)
function openPanel(html, bind) {
  $('#modalX').hidden = false;
  leaving = true;
  $('#modalBody').className = 'panel';
  $('#modalBody').innerHTML = html;
  $('#modal').classList.remove('hidden');
  if (bind) bind();
}
function closePanel() {
  leaving = false;
  $('#modal').classList.add('hidden');
  if (S && !S.lobby) renderModal();
}
function confirmBox(title, text, yes, onYes) {
  openPanel(`<h2>${title}</h2><p>${text}</p><div class="row"><button class="grow" id="cbNo">Vazgeç</button><button class="danger grow" id="cbYes">${yes}</button></div>`, () => {
    $('#cbNo').onclick = closePanel;
    $('#cbYes').onclick = () => { closePanel(); onYes(); };
  });
}

function openSettings() {
  const items = [
    ['sound', 'Ses', 'Sıra sana gelince, süre azalınca ve yığın biterken kısa sesler'],
    ['vibrate', 'Titreşim', 'Telefonda sıra sana gelince titrer'],
    ['autoSort', 'Yeni elde otomatik diz', 'Taşlar dağıtılınca en iyi seri dizilimi kurulur'],
    ['confirmRisky', 'Riskli atışta sor', 'İşlek taş atılırken onay ister (101 ceza)'],
    ['shapes', 'Renk körlüğü desteği', 'Her rengin altındaki işaret farklı şekilde olur (● ■ ◆ ▲)'],
  ];
  openPanel(`<h2>Ayarlar</h2><div class="prefs">${items.map(([k, t, d]) =>
    `<label class="check"><input type="checkbox" data-k="${k}" ${prefs[k] ? 'checked' : ''}><span><b>${t}</b><small>${d}</small></span></label>`).join('')}</div>
    <div class="row" style="margin-top:14px"><button class="grow" id="pfHelp">❔ Nasıl oynanır</button><button class="primary grow" id="pfOk">Tamam</button></div>`, () => {
    $('#modalBody').querySelectorAll('[data-k]').forEach(c => (c.onchange = () => { prefs[c.dataset.k] = c.checked; savePrefs(); if (S && !S.lobby) renderGame(); }));
    $('#pfOk').onclick = closePanel;
    $('#pfHelp').onclick = openHelp;
  });
}

function openHelp() {
  openPanel(`<h2>Nasıl oynanır?</h2><div class="help">
    <h3>Amaç</h3><p>Taşlarını perlere dizip elini açmak, sonra hepsini yere bırakıp eli bitirmek. Oyun sonunda <b>en az puanı</b> olan kazanır.</p>
    <h3>Sıra sende</h3><p>Önce bir taş çek: ortadaki <b>yığından</b> ya da soldaki oyuncunun attığı taşı <b>sol alttan</b> al (dokun ya da ıstakada bir yuvaya sürükle). Sonra bir taş at: taşı <b>sağ alttaki</b> alana sürükle ya da taşa iki kez dokun.</p>
    <h3>Per ve açma</h3><p>Seri: aynı renk ardışık en az 3 taş (12-13-1 olmaz). Grup: aynı sayı farklı renk 3-4 taş. Istakada perlerin arasına bir boşluk bırak, puanı üstünde görünür. Toplam <b>101</b> ya da <b>5 çift</b> olunca "Elini aç". Seri en fazla <b>5 taşla</b> açılır (1234567 → 1234 + 567). <b>Okey</b>, göstergenin bir üstüdür (aynı renk) ve her taşın yerine geçer; elinde kendi yüzüyle durur, tanımak sana kalmış. Sahte okey (✿) okeyin kendisi olarak sayılır. Masada okey ters çevrilmiş (numarasız) görünür.</p>
    <h3>Taşı ters çevirme</h3><p>Istakadaki bir taşa <b>sağ tıkla</b> (telefonda <b>uzun bas</b>): taş ters döner, bir daha yapınca düzelir. Okeyi böyle işaretleyebilirsin.</p>
    <h3>İşleme</h3><p>Elini açtıktan sonra taş seç; uyduğu perler parlar. <b>+</b> başa/sona ekler, <b>Al</b> perdeki okeyi alır; aldığın okeyi istediğin zaman kullanırsın, ama el bittiğinde hâlâ elindeyse 101 ceza yazılır. Okey seriden, 4'lü gruptan ya da çiftten alınabilir; alana ceza yoktur. Bir perin <b>sağına bir turda en fazla 2, soluna en fazla 2</b> taş işlenir; toplamda sınır yoktur. Kırmızı yıldızlı taşlar işlektir.</p>
    <h3>Cezalar</h3><p>Okey atmak, işlek taş atmak, yandan alıp açamamak: 101. Elini açmadan biten elde 202. Okeyle, çiftten ya da elden bitirmek puanları ikiye katlar.</p>
    <h3>Kısayollar (bilgisayar)</h3><p><kbd>Boşluk</kbd> yığından çek · <kbd>A</kbd> soldakini al · <kbd>S</kbd> seri diz · <kbd>C</kbd> çift diz · <kbd>Delete</kbd> seçili taşı at · <kbd>Enter</kbd> elini aç · <kbd>Esc</kbd> seçimi kaldır</p>
  </div><div class="row" style="margin-top:12px"><button class="primary grow" id="hpOk">Anladım</button></div>`, () => { $('#hpOk').onclick = closePanel; });
}
function attach(id, meldId, choice) {
  if (!playing() || id == null) return;
  sel = null;
  act({ type: 'attach', id, meld: meldId, choice });
}

// Açtıktan sonra ıstakadan indirilebilecekler: seri açan seri (+ masada çift alanı varsa çift), çift açan sadece çift
function layable(ev) {
  const m = me();
  const ciftArea = S.players.some(p => p.openType === 'cift');
  if (m.openType === 'cift') return ev.pairs.map(p => p.ids);
  return ev.melds.map(g => g.ids).concat(ciftArea ? ev.pairs.map(p => p.ids) : []);
}

// Açmadan / indirmeden önce önizleme: hangi perler gidecek, oyuncu seçer
// Aç: ıstaka barajı geçecek gibi dizili değilse önce Seri/Çift diz yapılır, sonra önizleme açılır
function openWith(mode) {
  const m = me(), ev = evalRack();
  const enough = m.opened || (mode === 'seri' ? ev.score >= S.barrier.per : ev.pairs.length >= S.barrier.cift);
  if (enough) doOpen(mode);
  else autoArrange(mode, false, () => doOpen(mode));
}

function doOpen(mode) {
  const m = me();
  const ev = evalRack();
  if (!mode) mode = !m.opened ? (ev.score >= S.barrier.per ? 'seri' : 'cift') : (m.openType === 'cift' ? 'cift' : 'seri');
  const pairMode = mode === 'cift';
  const groups = pairMode ? ev.pairs.map(p => p.ids) : ev.melds.map(g => g.ids);
  if (!groups.length) return;
  const picked = groups.map(() => true);
  const draw = () => {
    const chosen = groups.filter((_, i) => picked[i]);
    const used = chosen.reduce((a, g) => a + g.length, 0);
    const score = chosen.reduce((a, g) => a + (g.length >= 3 ? (meldOf(g) || { score: 0 }).score : 0), 0);
    let status = '', ok = chosen.length > 0;
    if (!m.opened) {
      if (pairMode) { ok = chosen.length >= S.barrier.cift; status = `${chosen.length} çift (en az ${S.barrier.cift})`; }
      else { ok = score >= S.barrier.per; status = `Toplam ${score} (en az ${S.barrier.per})`; }
    } else status = `${chosen.length} grup indirilecek`;
    if (used >= S.hand.length) { ok = false; status += ' · atmak için bir taş bırakmalısın'; }
    $('#modalBody').innerHTML = `<h2>${m.opened ? 'Perleri indir' : pairMode ? 'Çift aç' : 'Seri aç'}</h2>
      <p class="muted">İndirmek istemediğin grubun işaretini kaldır.</p>
      <div class="preview">${groups.map((g, i) => `<label class="pv ${picked[i] ? '' : 'off'}"><input type="checkbox" data-i="${i}" ${picked[i] ? 'checked' : ''}><span class="pvt" data-i="${i}"></span></label>`).join('')}</div>
      <p class="pvstatus ${ok ? 'ok' : ''}">${status}</p>
      <div class="row"><button class="grow" id="pvNo">Vazgeç</button><button class="primary grow" id="pvYes" ${ok ? '' : 'disabled'}>${m.opened ? 'İndir' : 'Aç'}</button></div>`;
    groups.forEach((g, i) => {
      const box = $(`.pvt[data-i="${i}"]`);
      g.forEach(id => box.appendChild(tileEl(tileById(id), true)));
      if (g.length >= 3) { const sc = document.createElement('small'); sc.textContent = (meldOf(g) || {}).score || ''; box.appendChild(sc); }
    });
    $('#modalBody').querySelectorAll('input[data-i]').forEach(c => (c.onchange = () => { picked[+c.dataset.i] = c.checked; draw(); }));
    $('#pvNo').onclick = close;
    $('#pvYes').onclick = () => { close(); act({ type: m.opened ? 'lay' : 'open', groups: chosen }); };
  };
  const close = () => { leaving = false; $('#modal').classList.add('hidden'); renderModal(); };
  leaving = true; // modalı başka bir şey ezmesin
  $('#modal').classList.remove('hidden');
  draw();
}

function doOpenDirect() {
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
  else if (a === 'openSeri') openWith('seri');
  else if (a === 'openCift') openWith('cift');
  else if (a === 'undo') act({ type: 'undoTake' });
  else if (a === 'auto') act({ type: 'autoAttach' });
  else if (a === 'undoRack') undoRack();
  else if (a === 'hint') {
    socket.emit('hint', id => {
      if (id == null || !tileById(id)) return toast('Şu an öneri yok');
      sel = id;
      renderGame();
      const el = document.querySelector(`#rack .tile[data-id="${id}"]`);
      if (el) { el.classList.add('hinted'); setTimeout(() => el.classList.remove('hinted'), 2600); }
      toast('💡 Öneri: işaretli taşı at (sağ alttaki alana dokun)');
    });
  }
};

// ---------- Sürükle-bırak (fare ve dokunmatik) ----------
function dropTargetAt(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  return el.closest('[data-choice], [data-slot], [data-meld], [data-drop]');
}

// Yığından ya da sol alttaki taştan sürükleyerek (ya da dokunarak) çekme
function canDrawNow() { return myTurn() && S.phase === 'draw'; }
$('#pile').addEventListener('pointerdown', e => {
  if (!S || S.lobby || !canDrawNow() || e.button > 0) return;
  drag = { draw: 'pile', x: e.clientX, y: e.clientY, src: $('#pile'), moved: false, over: null };
});
$('#corner3').addEventListener('pointerdown', e => {
  if (!S || S.lobby || !canDrawNow() || !$('#corner3').classList.contains('takeable') || e.button > 0) return;
  drag = { draw: 'discard', x: e.clientX, y: e.clientY, src: $('#corner3 .tile') || $('#corner3'), moved: false, over: null };
});

function flipTile(id) {
  flipped.has(id) ? flipped.delete(id) : flipped.add(id);
  buzz(25);
  renderGame();
}
$('#rack').addEventListener('contextmenu', e => {
  const t = e.target.closest('.tile[data-id]');
  if (!t) return;
  e.preventDefault();
  // Uzun basma zamanlayıcısı zaten çevirdiyse tekrar çevirme
  if (longPressed) { longPressed = false; return; }
  if (drag && drag.id === +t.dataset.id) { clearTimeout(drag.lp); drag = null; }
  flipTile(+t.dataset.id);
});
let longPressed = false;
$('#rack').addEventListener('pointerdown', e => {
  longPressed = false;
  const t = e.target.closest('.tile[data-id]');
  if (!t || e.button > 0) return;
  drag = { id: +t.dataset.id, x: e.clientX, y: e.clientY, src: t, moved: false, over: null };
  // Dokunmatik: yerinde uzun basma taşı çevirir
  if (e.pointerType !== 'mouse') {
    const d = drag;
    d.lp = setTimeout(() => {
      if (drag === d && !d.moved) { longPressed = true; drag = null; flipTile(d.id); }
    }, 550);
  }
});

window.addEventListener('pointermove', e => {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 7) return;
    drag.moved = true;
    clearTimeout(drag.lp);
    if (drag.draw) {
      // Çekilen taşın hayaleti: yığından ise ters taş, yandan ise o taş
      const ref = $('#rack .slot') || drag.src;
      const r0 = ref.getBoundingClientRect();
      drag.ghost = drag.draw === 'pile' ? Object.assign(document.createElement('div'), { className: 'tile back' }) : drag.src.cloneNode(true);
      drag.ghost.classList.add('ghost');
      drag.ghost.style.zoom = ZOOM;
      drag.ghost.style.width = r0.width / ZOOM + 'px';
      drag.ghost.style.height = r0.height / ZOOM + 'px';
      document.body.appendChild(drag.ghost);
      document.body.classList.add('drawing');
    } else {
    drag.src = document.querySelector(`#rack .tile[data-id="${drag.id}"]`) || drag.src;
    const r = drag.src.getBoundingClientRect();
    drag.ghost = drag.src.cloneNode(true);
    drag.ghost.classList.remove('sel', 'fresh');
    drag.ghost.classList.add('ghost');
    drag.ghost.style.zoom = ZOOM;
    drag.ghost.style.width = r.width / ZOOM + 'px';
    drag.ghost.style.height = r.height / ZOOM + 'px';
    document.body.appendChild(drag.ghost);
    drag.src.classList.add('dragging');
    sel = null;
    renderMelds();
    if (playing()) renderCorner(0);
    }
  }
  e.preventDefault();
  const g = drag.ghost;
  g.style.transform = `translate(${e.clientX / ZOOM - g.offsetWidth / 2}px, ${e.clientY / ZOOM - g.offsetHeight * 0.7}px) scale(1.12)`;
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
  clearTimeout(d.lp);
  if (d.draw) {
    document.body.classList.remove('drawing');
    const type = d.draw === 'pile' ? 'drawPile' : 'drawDiscard';
    if (!d.moved) { if (e.type === 'pointerup' && canDrawNow()) act({ type }); return; }
    d.ghost.remove();
    d.over?.classList.remove('over');
    const tgt = e.type === 'pointerup' ? dropTargetAt(e.clientX, e.clientY) : null;
    const onRack = e.type === 'pointerup' && document.elementFromPoint(e.clientX, e.clientY)?.closest('#rack, .dock');
    if (tgt?.dataset.slot != null) { pendingSlot = +tgt.dataset.slot; dragged.draw = true; act({ type }); }
    else if (onRack) { dragged.draw = true; act({ type }); }
    else toast('Taşı çekmek için ıstakaya bırak');
    return;
  }
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
  if (tgt?.dataset.slot != null) { pushRack(); moveTile(d.id, +tgt.dataset.slot); }
  else if (tgt?.dataset.choice) {
    const c = tgt.dataset.choice;
    attach(d.id, +tgt.dataset.meld, c === 'swap' ? { kind: 'swap' } : { kind: 'add', side: c.slice(4) });
  } else if (tgt?.dataset.meld != null) {
    const m = S.melds.find(x => x.id === +tgt.dataset.meld);
    const usedD = m ? (S.attachCount || {})[m.id] || { left: 0, right: 0 } : {};
    const opts = m ? Rules.attachOptions(m, tileById(d.id), S.okey).filter(o => o.kind === 'swap' || (usedD[o.side] || 0) < 2) : [];
    if (opts.length === 1) attach(d.id, m.id, choiceOf(opts[0]));
    else if (opts.length > 1) toast('Birden fazla yol var: taşı + ya da Al üzerine bırak');
  }
  else if (tgt?.dataset.drop === 'discard') { dragged.discard = true; discard(d.id); }
  renderGame();
}
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

let hurryFor = null;
// Süre halkası (sırası gelenin avatarı) ve üstteki süre çubuğu. Her çizimden hemen sonra da çağrılır;
// yeni çizilen avatar bir an dolu halka göstermesin.
function tickTimer() {
  if (!S || S.lobby) return;
  const left = S.deadline ? S.deadline - Date.now() : Infinity;
  const p = S.deadline ? Math.max(0, Math.min(1, left / (S.turnMs || 45000))) : (S.phase === 'ended' ? 0 : 1);
  const low = S.deadline && left < Math.min(10000, (S.turnMs || 45000) * 0.25);
  document.querySelectorAll('.turn .ava').forEach(a => { a.style.setProperty('--p', p); a.classList.toggle('low', !!low); });
  $('#turnbar').style.setProperty('--p', S.phase === 'ended' ? 0 : p);
  $('#turnbar').classList.toggle('low', !!low);
  $('.mt-bar').style.setProperty('--p', S.phase === 'ended' ? 0 : p);
  $('.mt-bar').classList.toggle('low', !!low);
  $('#turnbar').classList.toggle('on', myTurn());
  const hurry = myTurn() && left < 10000;
  document.body.classList.toggle('hurry', hurry);
  if (hurry && hurryFor !== S.deadline) { hurryFor = S.deadline; beep([300, 300], 0.14, 'square'); buzz([80, 60, 80]); }
}
setInterval(tickTimer, 100);

// ---------- Puan tablosu / el sonu ----------
let discardsOpen = null; // açık olan atılanlar penceresi (oyuncu sırası)
function openDiscards(abs) { discardsOpen = abs; renderModal(); }

// Çıkan taşlar: her taşın 2 kopyasından kaçı görünür (atılanlar + masadaki perler + gösterge + kendi elin)
function trackerHtml() {
  const seen = {};
  const add = t => { if (!t || t.fake) return; const k = t.c + '-' + t.v; seen[k] = (seen[k] || 0) + 1; };
  S.players.forEach(p => p.discards.forEach(add));
  S.melds.forEach(m => m.tiles.forEach(add));
  add(S.indicator);
  S.hand.forEach(add);
  const names = ['Kırmızı', 'Sarı', 'Mavi', 'Siyah'];
  let h = '<section class="tracker"><header>Çıkan taşlar <small>(masada + elinde görünen; her taştan 2 tane var)</small></header><div class="tgrid">';
  for (let c = 0; c < 4; c++) {
    h += `<span class="tlabel" style="color:${COLORS[c]}">${names[c]}</span>`;
    for (let v = 1; v <= 13; v++) {
      const n = seen[c + '-' + v] || 0;
      h += `<span class="tcell n${Math.min(n, 2)}" style="color:${COLORS[c]}" title="${names[c]} ${v}: ${n}/2 görünüyor">${v}</span>`;
    }
  }
  h += '</div><p class="tlegend"><span class="tcell n0">7</span> hiç görünmedi (rakipte olabilir) <span class="tcell n1">7</span> biri görünüyor <span class="tcell n2">7</span> ikisi de görünüyor</p></section>';
  return h;
}

function renderDiscards() {
  const order = [0, 1, 2, 3].map(r => (S.you + r) % 4);
  let html = '<h2>Atılan ve çıkan taşlar</h2>' + trackerHtml() + '<p class="muted dnote">Atılanlar, soldan sağa atılış sırası; çerçeveli olan en son atılan.</p><div class="dgrid">';
  html += order.map(i => {
    const p = S.players[i];
    const title = i === S.you ? 'Sen' : esc(p.name) + (partner(i) ? ' <span class="badge mate">Eşin</span>' : '');
    return `<section class="drow ${i === discardsOpen ? 'focus' : ''}"><header><i style="background:${AVA[i]}"></i>${title}<small>${p.discards.length} taş</small></header><div class="dline" data-p="${i}"></div></section>`;
  }).join('');
  html += '</div><div class="row" style="margin-top:10px"><button class="grow" id="btnDClose">Kapat</button></div>';
  $('#modalBody').innerHTML = html;
  order.forEach(i => {
    const line = $(`.dline[data-p="${i}"]`);
    const list = S.players[i].discards;
    if (!list.length) line.innerHTML = '<span class="muted">Henüz taş atmadı</span>';
    list.forEach((t, k) => {
      const el = tileEl(t, true);
      if (k === list.length - 1) el.classList.add('last');
      line.appendChild(el);
    });
  });
  $('#btnDClose').onclick = () => { discardsOpen = null; renderModal(); };
  $('#modalBody').classList.add('wide');
}

// Küçük avatar (sonuç ekranları için)
function avaMini(i) {
  const p = S.players[i];
  if (p.bot) return '<span class="amini" style="background:#555">🤖</span>';
  if (p.avatar) return `<span class="amini" style="background:${AV_C[p.avatar.c]}">${AV_E[p.avatar.e]}</span>`;
  return `<span class="amini" style="background:${AVA[i]}">${esc(initials(p.name))}</span>`;
}
const pname = i => (i === S.you ? 'Sen' : esc(S.players[i].name));

// Önde olan(lar): en az toplam puan (eşli oyunda takım toplamı)
function leaders() {
  if (!S || !S.history || !S.history.length) return [];
  if (esli()) {
    const t = [S.players[0].total + S.players[2].total, S.players[1].total + S.players[3].total];
    if (t[0] === t[1]) return [];
    return t[0] < t[1] ? [0, 2] : [1, 3];
  }
  const min = Math.min(...S.players.map(p => p.total));
  const w = [0, 1, 2, 3].filter(i => S.players[i].total === min);
  return w.length === 4 ? [] : w;
}

// El / oyun sonu: kazanan büyük ve net, sonra sıralı tablo
function resultHtml() {
  const r = S.result;
  const all = [0, 1, 2, 3];
  let html = '';
  if (S.over && r.final) {
    const w = r.final.winners;
    const ck = S.code + ':' + S.history.length + ':' + S.handIndex;
    if (w.includes(S.you) && celebrated !== ck) { celebrated = ck; setTimeout(confetti, 200); }
    const mine = w.includes(S.you);
    html += `<div class="rbanner final ${mine ? 'me' : ''}"><div class="trophy">🏆</div><div>
      <small>${esli() && w.length === 2 ? 'Oyunu kazanan takım' : 'Oyunu kazanan'}</small>
      <div class="rnames">${w.map(i => avaMini(i) + '<b>' + pname(i) + '</b>').join('<span class="amp">&</span>')}</div>
      ${mine ? '<div class="congrats">Tebrikler! 🎉</div>' : ''}</div></div>`;
  }
  // Bu elin kazananı
  let handWin, sub;
  if (r.void) { handWin = []; sub = 'Dört oyuncu da çift açtı, el iptal edildi.'; }
  else if (r.winner != null) {
    handWin = esli() ? [r.winner, (r.winner + 2) % 4] : [r.winner];
    sub = `${pname(r.winner)} eli bitirdi` + (r.mult > 1 ? ` · puanlar x${r.mult}` : '');
    if (r.okeyFinish) sub += ' · okey atarak';
  } else if (esli()) {
    const t0 = r.scores[0] + r.scores[2], t1 = r.scores[1] + r.scores[3];
    handWin = t0 === t1 ? [] : t0 < t1 ? [0, 2] : [1, 3];
    sub = `Yığın bitti · takım cezaları ${Math.min(t0, t1)} / ${Math.max(t0, t1)}`;
  } else {
    const best = Math.min(...r.scores);
    handWin = all.filter(i => r.scores[i] === best);
    sub = `Yığın bitti · en az ceza ${best}`;
  }
  html += `<div class="rbanner hand"><div class="trophy">${r.void ? '↺' : '🥇'}</div><div>
    <small>${S.handIndex}. elin ${handWin.length > 1 && !esli() ? 'en iyileri' : 'kazananı'}</small>
    <div class="rnames">${handWin.length ? handWin.map(i => avaMini(i) + '<b>' + pname(i) + '</b>').join('<span class="amp">&</span>') : '—'}</div>
    <div class="rsub">${sub}</div></div></div>`;

  // Sıralı tablo: oyun bittiyse toplama, değilse bu ele göre
  // Eşli oyunda sıralama takım bazında: aynı takımın iki oyuncusu aynı madalyayı alır
  const teamKey = i => (S.over ? S.players[i].total + S.players[(i + 2) % 4].total : r.scores[i] + r.scores[(i + 2) % 4]);
  const key = i => (esli() ? teamKey(i) : S.over ? S.players[i].total : r.scores[i]);
  const rows = all.slice().sort((a, b) => key(a) - key(b) || (a % 2) - (b % 2) || (S.over ? S.players[a].total - S.players[b].total : r.scores[a] - r.scores[b]));
  const medal = ['🥇', '🥈', '🥉', '4.'];
  html += '<table class="scores rtable"><tr><th></th><th>Oyuncu</th><th>Bu el</th><th>Toplam</th></tr>';
  let rank = 0;
  rows.forEach((i, k) => {
    if (k > 0 && key(i) !== key(rows[k - 1])) rank = esli() ? 1 : k;
    const team = esli() ? `<span class="tdot t${i % 2}"></span>` : '';
    html += `<tr class="${i === S.you ? 'me' : ''} ${handWin.includes(i) ? 'win' : ''}">
      <td class="rk">${medal[rank]}</td><td class="nm">${avaMini(i)}${team}${pname(i)}</td>
      <td>${r.scores[i] > 0 ? '+' : ''}${r.scores[i]}</td><td><b>${S.players[i].total}</b></td></tr>`;
  });
  html += '</table>';
  if (esli()) {
    const us = S.players[S.you].total + S.players[(S.you + 2) % 4].total;
    const them = S.players[(S.you + 1) % 4].total + S.players[(S.you + 3) % 4].total;
    html += `<p class="teamsum">Biz <b>${us}</b> · Onlar <b>${them}</b></p>`;
  }
  return html;
}

function renderModal() {
  const modal = $('#modal');
  if (leaving) return;
  const endedNow = S && !S.lobby && S.phase === 'ended' && S.result;
  $('#modalX').hidden = !!endedNow && discardsOpen == null; // el sonu sonucu ✕ ile kapanmaz (sonraki el kendiliğinden başlar)
  $('#modalBody').classList.remove('wide');
  if (S && !S.lobby && discardsOpen != null && !endedNow) {
    modal.classList.remove('hidden');
    renderDiscards();
    return;
  }
  const ended = endedNow;
  if (!S || S.lobby || (!ended && !scoresOpen)) { modal.classList.add('hidden'); return; }
  modal.classList.remove('hidden');
  const seats = [0, 1, 2, 3].map(i => (S.you + i) % 4);
  let html = '';
  if (ended) {
    html += resultHtml();
    html += '<details class="revealbox"><summary>Ellerde kalan taşlar</summary><div id="revealed"></div></details>';
  } else {
    html += '<h2>Puanlar</h2>';
    const cols = esli() ? [[S.you, (S.you + 2) % 4], [(S.you + 1) % 4, (S.you + 3) % 4]] : seats.map(i => [i]);
    const head = esli() ? ['Biz', 'Onlar'] : seats.map(i => (i === S.you ? 'Sen' : S.players[i].name));
    html += '<div class="tablewrap"><table class="scores"><tr><th>El</th>' + head.map(h => `<th>${esc(h)}</th>`).join('') + '</tr>';
    S.history.forEach(row => {
      html += `<tr><td>${row.hand}${row.mult > 1 ? ` <small>x${row.mult}</small>` : ''}</td>` + cols.map(c => `<td>${c.reduce((a, i) => a + row.scores[i], 0)}</td>`).join('') + '</tr>';
    });
    const tot = cols.map(c => c.reduce((a, i) => a + S.players[i].total, 0));
    const best = Math.min(...tot);
    html += '<tr class="total"><td>Toplam</td>' + tot.map(t => `<td class="${S.history.length && t === best ? 'lead' : ''}">${t}${S.history.length && t === best ? ' 👑' : ''}</td>`).join('') + '</tr></table></div>';
    html += `<details><summary class="muted">Oyun akışı</summary><ul class="loglist">${S.log.slice().reverse().map(l => `<li>${esc(l)}</li>`).join('')}</ul></details>`;
  }
  html += '<div class="row" style="margin-top:12px">';
  if (S.over && S.permanent) html += '<p class="muted grow">Yeni oyun birkaç saniye içinde kendiliğinden başlayacak.</p>';
  else if (S.over) html += '<button class="primary grow" id="btnNew">Yeni oyun</button>';
  else if (ended) html += '<p class="muted grow">Sonraki el birazdan başlıyor…</p>';
  if (S.over) html += '<button class="grow" id="btnMainMenu">Ana menü</button>';
  if (!ended) html += '<button class="grow" id="btnClose">Kapat</button>';
  html += '</div>';
  $('#modalBody').innerHTML = html;
  $('#modalBody').classList.toggle('result', !!ended);
  $('#modalBody').classList.toggle('two', !!(ended && S.over));

  if (ended) {
    const r = S.result;
    const rv = $('#revealed');
    seats.forEach(i => {
      if (i === r.winner || !r.hands[i].length) return;
      const lbl = document.createElement('div');
      lbl.className = 'muted';
      lbl.textContent = `${S.players[i].name} (${r.scores[i]})`;
      const line = document.createElement('div');
      line.className = 'revealed';
      r.hands[i].forEach(t => line.appendChild(tileEl(t, true)));
      rv.append(lbl, line);
    });
  }
  const nb = $('#btnNew');
  if (nb) nb.onclick = () => socket.emit('newGame');
  const mb = $('#btnMainMenu');
  if (mb) mb.onclick = () => { socket.emit('leave'); goLobby(); };
  const cb = $('#btnClose');
  if (cb) cb.onclick = () => { scoresOpen = false; renderModal(); };
}
$('#modal').addEventListener('click', e => {
  if (e.target.id !== 'modal') return;
  if (discardsOpen != null) { discardsOpen = null; renderModal(); }
  else if (scoresOpen) { scoresOpen = false; renderModal(); }
});


// ---------- Sohbet ----------
const chatLog = [];
$('#quick').innerHTML = QUICK.map(q => `<button type="button" class="small">${q}</button>`).join('');
// Sohbet penceresi diğer menüler gibi kolay kapanır: ✕, dışarı dokunma, Esc ya da hazır mesaj gönderme
const chatOpen = () => !$('#chatPanel').classList.contains('hidden');
function closeChat() { $('#chatPanel').classList.add('hidden'); $('#chatInput').blur(); }
$('#quick').onclick = e => { if (e.target.tagName === 'BUTTON') { socket.emit('chat', e.target.textContent); closeChat(); } };
$('#chatForm').onsubmit = e => {
  e.preventDefault();
  const v = $('#chatInput').value.trim();
  if (v) socket.emit('chat', v);
  $('#chatInput').value = '';
};
$('#btnChat').onclick = e => {
  e.stopPropagation();
  $('#menuPop').classList.add('hidden');
  $('#chatPanel').classList.toggle('hidden');
  $('#btnChat').classList.remove('unread');
  if (chatOpen()) $('#chatLog').scrollTop = 1e9;
};
$('#chatClose').onclick = closeChat;
document.addEventListener('pointerdown', e => {
  if (chatOpen() && !e.target.closest('#chatPanel, #btnChat, #menuPop')) closeChat();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && chatOpen()) { e.stopImmediatePropagation(); closeChat(); } }, true);
socket.on('chat', m => {
  chatLog.push(m);
  if (chatLog.length > 50) chatLog.shift();
  $('#chatLog').innerHTML = chatLog.map(x => `<div><b>${esc(x.name)}:</b> ${esc(x.text)}</div>`).join('');
  $('#chatLog').scrollTop = 1e9;
  if (!chatOpen()) $('#btnChat').classList.add('unread');
  showBubble(m.seat, m.text);
});

// Mesaj balonu yazan oyuncunun yanında çıkar: soldaki oyuncunun sağında, sağdakinin solunda, üsttekinin altında,
// kendi mesajın ıstakanın üstünde. Balonun oku avatara döner; balon ekrandan taşmaz.
const bubbles = {};
function bubbleAnchor(r) {
  const vis = el => el && el.getClientRects().length && el.getBoundingClientRect().width > 0;
  if (r === 0) {
    const chip = $('#meChip .ava');
    return vis(chip) ? chip : $('#rack');
  }
  const pos = $('#pos' + r);
  const ava = pos && pos.querySelector('.ava');
  return vis(ava) ? ava : pos;
}
function showBubble(seat, text) {
  if (!S || S.lobby) return;
  const r = (seat - S.you + 4) % 4;
  const target = bubbleAnchor(r);
  if (!target) return;
  if (bubbles[r]) bubbles[r].remove();
  const rect = target.getBoundingClientRect();
  const b = document.createElement('div');
  b.textContent = text;
  // Yön: sağdaki oyuncu → balon solda, soldaki → sağda, üstteki → altta, sen → üstte
  // Dar (dikey) ekranda yandaki oyuncuların balonları ortada çakışmasın diye avatarın altına konur
  const dir = r === 2 || ((r === 1 || r === 3) && window.innerWidth < 600) ? 'b' : r === 1 ? 'l' : r === 3 ? 'r' : 't';
  b.className = 'bubble at-' + dir;
  document.body.appendChild(b);
  bubbles[r] = b;
  const bw = b.offsetWidth, bh = b.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, M = 8, G = 10;
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  let x, y;
  if (dir === 'l') { x = rect.left - bw - G; y = cy - bh / 2; }
  else if (dir === 'r') { x = rect.right + G; y = cy - bh / 2; }
  else if (dir === 'b') { x = cx - bw / 2; y = rect.bottom + G; }
  else { x = r === 0 && target.id === 'rack' ? rect.left + rect.width * 0.25 - bw / 2 : cx - bw / 2; y = rect.top - bh - G; }
  x = Math.min(vw - bw - M, Math.max(M, x));
  y = Math.min(vh - bh - M, Math.max(M, y));
  b.style.left = x + 'px';
  b.style.top = y + 'px';
  // Ok avatarı göstersin (balon kenara kaydırıldıysa da)
  b.style.setProperty('--ax', Math.min(bw - 14, Math.max(14, cx - x)) + 'px');
  b.style.setProperty('--ay', Math.min(bh - 12, Math.max(12, cy - y)) + 'px');
  setTimeout(() => b.classList.add('out'), 4500);
  setTimeout(() => { b.remove(); if (bubbles[r] === b) delete bubbles[r]; }, 5000);
}

render();

// ---------- Klavye kısayolları (bilgisayar) ----------
document.addEventListener('keydown', e => {
  if (!S || S.lobby || e.target.closest('input, textarea, select')) return;
  if (e.key === 'Escape') { if (leaving) closePanel(); else { sel = null; renderGame(); } return; }
  if (leaving || !$('#modal').classList.contains('hidden')) return;
  const k = e.key.toLocaleLowerCase('tr');
  if (k === ' ' && canDrawNow()) { e.preventDefault(); act({ type: 'drawPile' }); }
  else if (k === 'a' && canDrawNow() && $('#corner3').classList.contains('takeable')) act({ type: 'drawDiscard' });
  else if (k === 's') autoArrange('seri');
  else if (k === 'c' || k === 'ç') autoArrange('cift');
  else if ((k === 'delete' || k === 'backspace') && sel != null) { e.preventDefault(); discard(sel); }
  else if (k === 'enter') {
    if (!document.querySelector('[data-act="openSeri"]').disabled) openWith('seri');
    else if (!document.querySelector('[data-act="openCift"]').disabled) openWith('cift');
  }
});

// ---------- Hemen oyna ----------
let quickStart = false;
$('#btnQuick').onclick = () => {
  const n = myName();
  if (!n) return;
  const r = roomList.find(x => x.permanent && x.free > 0) || roomList.find(x => x.status === 'bekliyor' && x.free > 0);
  if (r) socket.emit('join', { code: r.code, name: n, token, avatar: myAvatar });
  else { quickStart = true; socket.emit('create', { name: n, token, avatar: myAvatar }); }
};
socket.on('state', st => {
  if (quickStart && st.lobby && st.isHost) { quickStart = false; socket.emit('start'); }
});
$('#btnHelpL').onclick = openHelp;
$('#btnSettingsL').onclick = openSettings;

// ---------- Kazanma kutlaması: konfeti ----------
let celebrated = null;
function confetti() {
  if (reduceMotion) return;
  const cv = $('#confetti'), cx = cv.getContext('2d');
  cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
  cv.classList.add('on');
  const cols = ['#c8231f', '#d98500', '#1459c2', '#f5c044', '#2f9a5f', '#fbf5e4'];
  const P = Array.from({ length: 160 }, () => ({
    x: Math.random() * cv.width, y: -Math.random() * cv.height * 0.5,
    vx: (Math.random() - 0.5) * 4 * devicePixelRatio, vy: (2 + Math.random() * 4) * devicePixelRatio,
    s: (6 + Math.random() * 8) * devicePixelRatio, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3,
    c: cols[Math.floor(Math.random() * cols.length)],
  }));
  const t0 = performance.now();
  (function frame(t) {
    cx.clearRect(0, 0, cv.width, cv.height);
    P.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.05 * devicePixelRatio; p.r += p.vr;
      cx.save(); cx.translate(p.x, p.y); cx.rotate(p.r); cx.fillStyle = p.c; cx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); cx.restore();
    });
    if (t - t0 < 4000) requestAnimationFrame(frame);
    else { cx.clearRect(0, 0, cv.width, cv.height); cv.classList.remove('on'); }
  })(t0);
  beep([523, 659, 784, 1047], 0.15);
}

// Pencerelerin sağ üstündeki ✕: kaydırmaya gerek kalmadan her zaman kapatılabilir
$('#modalX').onclick = () => {
  if (leaving) { closePanel(); return; }
  discardsOpen = null;
  scoresOpen = false;
  if (S && !S.lobby) renderModal(); else $('#modal').classList.add('hidden');
};
