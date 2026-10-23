// Kural denetimi: botlar ve rastgele "kaos" hamleleriyle çok sayıda el oynatır, her hamleden sonra değişmezleri kontrol eder:
// 106 taş, masadaki her per geçerli, açarken/indirirken seri en fazla 5 taş, tur başına bir yana en fazla 2 işleme,
// puanlar tutarlı. Çalıştırma: node tests/kural-denetimi.js   (oyun sayısı için N=200)
const { Game } = require('../game.js');
const Bot = require('../bot.js');
const R = require('../public/rules.js');

const N = +(process.env.N || 60);
const viol = {};
const bad = (k, extra) => { viol[k] = viol[k] || { n: 0, ex: extra }; viol[k].n++; };
const rnd = n => Math.floor(Math.random() * n);

function validMeld(m, okey) {
  const ts = m.tiles;
  if (m.type === 'pair') return ts.length === 2 && R.analyzePair(ts, okey);
  if (m.type === 'run') {
    // Her taş kendi sırasına uymalı; okey (joker) herhangi bir sırada durabilir
    if (ts.length < 3 || ts.length > 13 || m.start < 1 || m.start + ts.length - 1 > 13) return false;
    if (ts.every(t => R.isJoker(t, okey))) return false;
    return ts.every((t, i) => { const e = R.eff(t, okey); return e.joker || (e.c === m.color && e.v === m.start + i); });
  }
  const a = R.analyzeMeld(ts, okey, 13);
  return !!a && a.type === 'set' && ts.length <= 4;
}

function check(g, where) {
  const total = g.seats.reduce((s, x) => s + x.hand.length + x.discards.length, 0) + g.pile.length + g.melds.reduce((s, m) => s + m.tiles.length, 0) + 1;
  if (total !== 106) bad('taş sayısı ' + total + ' (' + where + ')');
  g.melds.forEach(m => { if (!validMeld(m, g.okey)) bad('geçersiz per masada (' + where + ')', JSON.stringify({ okey: R.tileName({ c: g.okey.c, v: g.okey.v }), type: m.type, start: m.start, color: m.color, tiles: m.tiles.map(t => R.tileName(t) + (R.isJoker(t, g.okey) ? '[OKEY]' : '')) })); });
  Object.values(g.attachCount).forEach(c => { if (c.left > 2 || c.right > 2) bad('tur başına 2den fazla işleme'); });
  g.seats.forEach(s => { if (s.hand.length === 0 && g.phase !== 'ended') bad('elinde taş kalmadı ama el bitmedi'); });
}

// Açma / indirme sonrası yeni gelen perlerde 5 sınırı
function wrap(g) {
  for (const fn of ['open', 'layMeld']) {
    const orig = g[fn].bind(g);
    g[fn] = (...a) => {
      const before = g.melds.length;
      const r = orig(...a);
      if (r.ok) g.melds.slice(before).forEach(m => {
        if (m.type === 'run' && m.tiles.length > R.MAX_OPEN_RUN) bad('açarken/indirirken ' + m.tiles.length + ' taşlı seri');
        if (m.type === 'set' && (m.tiles.length < 3 || m.tiles.length > 4)) bad('hatalı grup boyu ' + m.tiles.length);
      });
      return r;
    };
  }
}

// Rastgele kaos hamlesi: geçersiz ya da kuralsız hamle denenir, motor reddetmeli ya da kurala uygun uygulamalı
function chaos(g, seat) {
  const me = g.seats[seat];
  const pick = () => me.hand[rnd(me.hand.length)];
  const k = rnd(7);
  try {
    if (k === 0) g.open(seat, [[pick().id, pick().id, pick().id]]);
    else if (k === 1) g.open(seat, [[pick().id, pick().id], [pick().id, pick().id]]);
    else if (k === 2) g.layMeld(seat, [pick().id, pick().id]);
    else if (k === 3 && g.melds.length) g.addToMeld(seat, pick().id, g.melds[rnd(g.melds.length)].id, rnd(2) ? { kind: 'add', side: rnd(2) ? 'left' : 'right' } : undefined);
    else if (k === 4) g.layMeld(seat, [pick().id, pick().id, pick().id, pick().id, pick().id, pick().id]); // 6 taş: seri olarak asla kabul edilmemeli
    else if (k === 5) g.undoTake(seat);
    else if (k === 6) { const before = g.turnCount; Bot.timeoutTurn(g, seat); if (g.turn === seat && g.phase !== 'ended' && g.turnCount === before) bad('süre dolunca hamle yapılmadı (oyun takılırdı)'); } // süre dolması: çek + güvenli taş at
  } catch (e) { bad('istisna: ' + e.message); }
}

let hands = 0, errs = 0;
for (let n = 0; n < N; n++) {
  const info = [0, 1, 2, 3].map(i => ({ name: 'B' + i, isBot: true, connected: true }));
  const g = new Game(info, { hands: 3, mode: n % 2 ? 'esli' : 'tekli', katlamali: n % 3 === 0, waitAttach: n % 5 === 0 });
  wrap(g);
  g.startHand();
  let steps = 0;
  while (!g.over && steps++ < 20000) {
    if (g.phase === 'ended') {
      hands++;
      const r = g.result;
      if (!r.void && r.winner != null) {
        const w = g.seats[r.winner];
        if (r.scores[r.winner] !== -101 * r.mult + w.penalty) bad('kazanan puanı tutarsız');
      }
      if (r.scores.some(x => !Number.isFinite(x))) bad('puan sayı değil');
      if (!g.over) g.startHand();
      continue;
    }
    const seat = g.turn;
    const before = `${g.turnCount}:${g.phase}`;
    try {
      if (Math.random() < 0.25) chaos(g, seat);
      if (g.turn === seat) { if (g.phase === 'draw') Bot.draw(g, seat); else Bot.play(g, seat); }
    } catch (e) { errs++; bad('bot istisnası: ' + e.message); }
    if (g.phase !== 'ended' && `${g.turnCount}:${g.phase}` === before) Bot.fallback(g, g.turn);
    check(g, 'adım');
  }
  if (!g.over) bad('oyun bitmedi (takıldı)');
}
console.log({ oyun: N, el: hands, ihlal: Object.keys(viol).length });
Object.entries(viol).forEach(([k, v]) => console.log(' -', k, 'x' + v.n, v.ex || ''));
process.exit(Object.keys(viol).length ? 1 : 0);
