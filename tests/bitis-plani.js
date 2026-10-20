// Bitiş planı (plan.js) testleri: açma, 5 taş sınırı, işleme (turda bir yana 2), okey alma, çift indirme.
// Çalıştırma: node tests/bitis-plani.js
const { Game } = require('../game.js');
const R = require('../public/rules.js');
const { finishPlan, takeAdvice } = require('../plan.js');
let fails = 0;
const check = (name, ok, extra = '') => { if (!ok) fails++; console.log(`${ok ? 'TAMAM' : 'HATA '}  ${name}${extra ? '  (' + extra + ')' : ''}`); };

let nid = 0;
const T = (c, v) => ({ id: 5000 + nid++, c, v, fake: false });
const OKEY = { c: 3, v: 13 };            // siyah 13 okey (gösterge siyah 12)
const J = () => ({ id: 5000 + nid++, c: 3, v: 13, fake: false });

function setup(hand, { opened = false, openType = 'per', melds = [], opts = {}, others = {} } = {}) {
  const info = [0, 1, 2, 3].map(i => ({ name: 'B' + i, isBot: true, connected: true }));
  const g = new Game(info, Object.assign({ hands: 3 }, opts));
  g.startHand();
  g.okey = OKEY; g.indicator = { id: 4999, c: 3, v: 12, fake: false };
  g.turn = 0; g.phase = 'play'; g.melds = []; g.meldSeq = 1; g.attachCount = {};
  const me = g.seats[0];
  me.hand = hand; me.opened = opened; me.openType = opened ? openType : null; me.openedAt = -5; me.openScore = opened && openType === 'per' ? 105 : 0;
  melds.forEach(m => g.melds.push({ id: g.meldSeq++, owner: 1, ...m }));
  Object.entries(others).forEach(([i, o]) => Object.assign(g.seats[i], o));
  return g;
}
const run = (c, from, to) => { const ts = []; for (let v = from; v <= to; v++) ts.push(T(c, v)); return { type: 'run', tiles: ts, start: from, color: c }; };
const ids = a => a.flat();

// 1) Masadaki 5'li seriye sağdan ve soldan işleme; zaten per olan 3 taş işlenmez, indirilir
{
  const g = setup([T(0, 9), T(0, 10), T(0, 3), T(0, 2), T(1, 5), T(2, 12)], { opened: true, melds: [run(0, 4, 8)] });
  const p = finishPlan(g, 0);
  check('Masadaki seriye iki yandan 2\'şer taş işlenir', p.attach.length === 4 && p.attach.filter(a => a.side === 'right').length === 2 && p.attach.filter(a => a.side === 'left').length === 2, JSON.stringify(p.attach.map(a => a.side)));
  const h = setup([T(0, 9), T(0, 10), T(0, 11), T(1, 5), T(2, 12)], { opened: true, melds: [run(0, 4, 8)] });
  const q = finishPlan(h, 0);
  check('Elde hazır per varsa işlemek yerine indirir', q.lay.length === 1 && q.attach.length === 0, JSON.stringify({ lay: q.lay.length, attach: q.attach.length }));
  // turda sağa zaten 1 taş işlenmişse bir tane daha işlenir (sınır 2)
  const k = setup([T(0, 9), T(0, 10), T(1, 5), T(2, 12)], { opened: true, melds: [run(0, 4, 8)] });
  k.attachCount[1] = { left: 0, right: 1 };
  const r = finishPlan(k, 0);
  check('Tur başına bir yana en fazla 2 işleme sınırı uygulanır', r.attach.length === 1, String(r.attach.length));
}
// 2) Elde 7'li seri: açarken/indirirken 5'ten uzun grup çıkmaz, bölünür
{
  const g = setup([...run(1, 1, 7).tiles, T(0, 2), T(2, 12), T(3, 5)], { opened: true });
  const p = finishPlan(g, 0);
  check('7 taşlık seri en fazla 5 taşlık gruplara bölünür', p.lay.length >= 1 && p.lay.every(x => x.length <= 5) && ids(p.lay).length >= 6, JSON.stringify(p.lay.map(x => x.length)));
}
// 3) Okey alma: masadaki serinin okeyi yerine gelen taş okeyle takas edilir ve okey kullanılır
{
  const jk = J();
  const g = setup([T(1, 5), T(2, 2), T(2, 9)], { opened: true, melds: [{ type: 'run', tiles: [T(1, 4), jk, T(1, 6)], start: 4, color: 1 }] });
  const p = finishPlan(g, 0);
  check('Okey alma planlanır', p.swaps.length === 1 && p.swaps[0].joker === jk.id);
}
// 4) Çift açan: yeni seri indirmez, çiftleri indirir, kalanları işler
{
  const g = setup([T(0, 2), T(0, 2), T(1, 5), T(1, 5), T(2, 9), T(2, 10), T(2, 11)], { opened: true, openType: 'cift' });
  const p = finishPlan(g, 0);
  check('Çift açan seri indirmez', p.lay.length === 0);
  check('Çift açan çiftleri indirir', p.pairs.length === 2);
}
// 5) Seri açan, masada çift alanı varsa çift indirir; yoksa indirmez
{
  const hand = () => [T(0, 2), T(0, 2), T(1, 5), T(1, 5), T(2, 9), T(3, 3), T(2, 1)];
  const a = finishPlan(setup(hand(), { opened: true }), 0);
  const b = finishPlan(setup(hand(), { opened: true, others: { 1: { opened: true, openType: 'cift' } } }), 0);
  check('Masada çift yokken seri açan çift indirmez', a.pairs.length === 0);
  check('Masada çift varken seri açan çift indirir', b.pairs.length === 2);
}
// 6) Açmadan önce: seri yolu (iki 5'li seri) ve çift yolu karşılaştırılır; 5'ten uzun grup açılmaz
{
  const hand = [...run(0, 9, 13).tiles, ...run(2, 9, 13).tiles, T(1, 1), T(3, 3), T(1, 5), T(0, 2), T(3, 7), T(1, 8), T(2, 4), T(3, 1), T(0, 6), T(1, 12), T(3, 8), T(2, 1)];
  const g = setup(hand);
  const p = finishPlan(g, 0);
  check('Açmadan önce seri yolu seçilir', p.path === 'seri' && p.open.length >= 2 && p.open.every(x => x.length <= 5), JSON.stringify(p.open.map(x => x.length)));
  const sc = p.openScore;
  check('Açış puanı barajı geçer', sc >= 101, String(sc));
}
{
  const hand = [T(0, 2), T(0, 2), T(1, 5), T(1, 5), T(2, 7), T(2, 7), T(3, 9), T(3, 9), T(0, 11), T(0, 11), T(1, 4), T(1, 12), T(2, 3), T(3, 1), T(0, 8), T(1, 10), T(2, 6), T(3, 6), T(1, 13), T(2, 12), T(3, 2), T(0, 13)];
  const p = finishPlan(setup(hand), 0);
  check('5 çiftli el çift yolunu önerir', p.path === 'cift' && p.pairCount >= 5, p.path + ' ' + p.pairCount);
}
// 7) Açılamayan el: plan açma yolu önermez
{
  const g = setup([T(0, 1), T(1, 3), T(2, 5), T(3, 7), T(0, 9), T(1, 11), T(2, 13), T(3, 2), T(0, 4), T(1, 6), T(2, 8)]);
  const p = finishPlan(g, 0);
  check('Açılamıyorsa yol yok, potansiyel döner', p.path === null && p.potential && p.canFinish === false);
}
// 7b) İstenen yol uygulanamıyorsa (7 çift varken seri istenirse) hata vermez, yol yok döner
{
  const hand = [T(0, 2), T(0, 2), T(1, 5), T(1, 5), T(2, 7), T(2, 7), T(3, 9), T(3, 9), T(0, 11), T(0, 11), T(1, 4), T(1, 4), T(2, 12), T(2, 12), T(3, 1), T(1, 13), T(2, 3), T(3, 6), T(0, 8), T(1, 10), T(2, 6), T(1, 2)];
  let p, err = null;
  try { p = finishPlan(setup(hand), 0, undefined, 'seri'); } catch (e) { err = e.message; }
  check('Uygulanamayan yol istenirse hata vermez', !err && p.path === null && p.potential.pairs >= 5, err || JSON.stringify(p && p.potential));
  const q = finishPlan(setup(hand.slice()), 0, undefined, 'cift');
  check('7 çiftli elde çift yolu istenince çift planı döner', q.path === 'cift' && q.pairCount >= 5, String(q.pairCount));
}
// 8) Atılacak taş işlek olmamalı
{
  const g = setup([T(0, 9), T(1, 2), T(2, 12), T(0, 3)], { opened: true, melds: [run(0, 4, 8)] });
  const p = finishPlan(g, 0);
  const d = g.seats[0].hand.find(t => t.id === p.discard);
  check('Atılacak taş işlek değil', !!d && !g.melds.some(m => g.canAttachNow(m, d)), d && R.tileName(d));
}
// 9) Plan oyun durumunu değiştirmez
{
  const g = setup([T(0, 9), T(0, 3), T(1, 5)], { opened: true, melds: [run(0, 4, 8)] });
  const before = JSON.stringify([g.seats[0].hand, g.melds, g.attachCount]);
  finishPlan(g, 0);
  check('Plan oyun durumunu değiştirmez', before === JSON.stringify([g.seats[0].hand, g.melds, g.attachCount]));
}
// 10) Açtığı turda işleme yok seçeneği
{
  const g = setup([T(0, 9), T(0, 3), T(1, 5)], { opened: true, melds: [run(0, 4, 8)], opts: { waitAttach: true } });
  g.seats[0].openedAt = g.turnCount;
  const p = finishPlan(g, 0);
  check('"Açtığı turda işleme yok" ise işleme planlanmaz', p.attach.length === 0 && p.swaps.length === 0);
}
// 10b) Yandan alma önerisi
{
  const mk = (hand, top, extra = {}) => { const g = setup(hand, extra); g.seats[3].discards = [top]; return g; };
  const run48 = run(0, 4, 8);
  const a = takeAdvice(mk([T(0, 2), T(1, 5), T(2, 12), T(3, 3)], T(0, 9), { opened: true, melds: [run48] }), 0);
  check('Açmış oyuncu: masadaki seriye işlenen taş işe yarar', a && a.use === true, JSON.stringify(a));
  const b = takeAdvice(mk([T(0, 2), T(1, 5), T(2, 12), T(3, 3)], T(2, 1), { opened: true, melds: [run48] }), 0);
  check('Açmış oyuncu: işe yaramayan taş işaretlenir', b && b.use === false);
  // açmamış: bu taşla seri tamamlanıp barajı geçiliyorsa alınabilir; geçmiyorsa uyarılır
  const hand = [...run(0, 9, 13).tiles.slice(0, 4), ...run(2, 9, 13).tiles, T(1, 1), T(3, 3), T(1, 5), T(0, 2), T(3, 7), T(1, 8), T(2, 4), T(3, 1), T(0, 6), T(1, 12), T(3, 8), T(2, 1)];
  const c = takeAdvice(mk(hand, T(0, 13)), 0);
  check('Açmamış oyuncu: taşla açabiliyorsa alınabilir', c && c.canOpenWith === true && c.path === 'seri', JSON.stringify(c));
  const d = takeAdvice(mk(hand, T(1, 2)), 0);
  check('Açmamış oyuncu: taşla açamıyorsa uyarılır', d && d.canOpenWith === false, JSON.stringify(d));
  check('Soldan atılmış taş yoksa öneri yok', takeAdvice(setup(hand), 0) === null);
}
// 11) Rastgele oyunlar: koltuk 0 her turda bitiş planını motora uygular; motor hiçbir hamleyi reddetmemeli
{
  const Bot = require('../bot.js');
  const rej = {}; let turns = 0, finished = 0, hands = 0, planned = 0;
  const N = +(process.env.N || 25);
  const apply = (g, plan) => {
    const bad = (what, r) => { if (r.err) { const k = what + ': ' + r.err; rej[k] = (rej[k] || 0) + 1; } return !r.err; };
    if (plan.phase === 'closed' && plan.path) { if (!bad('aç ' + plan.path, g.open(0, plan.open))) return false; }
    for (const w of plan.swaps) if (!bad('okey al', g.addToMeld(0, w.tile, w.meld, { kind: 'swap' }))) return false;
    for (const grp of plan.lay) if (!bad('per indir', g.layMeld(0, grp))) return false;
    for (const pr of plan.pairs) if (!bad('çift indir', g.layMeld(0, pr))) return false;
    for (const a of plan.attach) if (!bad('işle', g.addToMeld(0, a.tile, a.meld, { kind: 'add', side: a.side }))) return false;
    return true;
  };
  for (let n = 0; n < N; n++) {
    const info = [0, 1, 2, 3].map(i => ({ name: 'B' + i, isBot: true, connected: true }));
    const g = new Game(info, { hands: 3, mode: n % 2 ? 'esli' : 'tekli', katlamali: n % 3 === 0, waitAttach: n % 4 === 0 });
    g.startHand();
    let steps = 0;
    while (!g.over && steps++ < 20000) {
      if (g.phase === 'ended') { hands++; if (g.result.winner === 0) finished++; if (!g.over) g.startHand(); continue; }
      const b = `${g.turnCount}:${g.phase}`;
      if (g.turn === 0) {
        if (g.phase === 'draw') Bot.draw(g, 0);
        if (g.phase === 'play' && g.turn === 0) {
          turns++;
          let plan = null;
          try { plan = finishPlan(g, 0); } catch (e) { rej['plan istisnası: ' + e.message] = (rej['plan istisnası: ' + e.message] || 0) + 1; }
          if (g.mustOpenWith != null && !(plan && plan.path)) { g.undoTake(0); g.drawPile(0); plan = null; }
          if (plan && (plan.path || plan.phase === 'opened')) { planned++; if (apply(g, plan) && g.phase === 'play' && g.turn === 0 && g.seats[0].hand.length) { const r = g.discard(0, plan.discard); if (r.err) rej['at: ' + r.err] = (rej['at: ' + r.err] || 0) + 1; } }
        }
      } else if (g.phase === 'draw') Bot.draw(g, g.turn); else Bot.play(g, g.turn);
      if (g.phase !== 'ended' && `${g.turnCount}:${g.phase}` === b) Bot.fallback(g, g.turn);
    }
  }
  const nrej = Object.keys(rej).length;
  check('Plan her oyunda motorda uygulanabilir (reddedilen hamle yok)', nrej === 0, nrej ? JSON.stringify(rej) : `${planned} planlı tur, ${turns} tur, ${finished}/${hands} el planla bitti`);
}
console.log(fails ? `\n${fails} test başarısız` : '\nTüm bitiş planı testleri geçti');
process.exit(fails ? 1 : 0);
