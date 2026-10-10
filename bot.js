const R = require('./public/rules.js');

const runScore = (s, len) => (len * (2 * s + len - 1)) / 2;

// A taşını içeren tüm olası perler (kalan taşlar + okeyler ile)
function candidatesWith(A, rem) {
  const out = [];
  const jokers = rem.filter(x => x.e.joker);
  const others = rem.filter(x => x !== A && !x.e.joker);
  const a = A.e.v, c = A.e.c;

  // Seriler (1..13, 12-13-1 yok)
  for (let s = Math.max(1, a - 12); s <= a; s++) {
    for (let len = Math.max(3, a - s + 1); s + len - 1 <= 13 && len <= R.MAX_OPEN_RUN; len++) {
      const parts = [A];
      let miss = 0;
      for (let p = s; p < s + len; p++) {
        if (p === a) continue;
        const x = others.find(y => y.e.c === c && y.e.v === p && !parts.includes(y));
        if (x) parts.push(x);
        else miss++;
      }
      if (miss > jokers.length) break;
      if (len - miss < 2 && len > 3) continue;
      for (let j = 0; j < miss; j++) parts.push(jokers[j]);
      out.push({ items: parts, score: runScore(s, len) });
    }
  }

  // Gruplar (aynı sayı, farklı renk)
  const otherColors = [0, 1, 2, 3]
    .filter(k => k !== c)
    .map(k => others.find(x => x.e.c === k && x.e.v === a))
    .filter(Boolean);
  const m = otherColors.length;
  for (let mask = 0; mask < 1 << m; mask++) {
    const chosen = otherColors.filter((_, i) => mask & (1 << i));
    for (const size of [3, 4]) {
      const miss = size - 1 - chosen.length;
      if (miss < 0 || miss > jokers.length) continue;
      out.push({ items: [A, ...chosen, ...jokers.slice(0, miss)], score: a * size });
    }
  }
  return out;
}

// Eldeki taşlardan en iyi per kombinasyonunu bulur.
// obj = 'score': en yüksek puan (açmak için) · obj = 'tiles': en çok taş, eşitse yüksek puan (bitirmek için)
function solve(tiles, okey, budget = 20000, obj = 'score') {
  const W = obj === 'tiles' ? 1000 : 0;
  const items = tiles
    .map(t => ({ t, e: R.eff(t, okey) }))
    .sort((x, y) => (x.e.joker ? 99 : x.e.c * 20 + x.e.v) - (y.e.joker ? 99 : y.e.c * 20 + y.e.v));
  let best = { score: 0, melds: [] };
  let nodes = 0;
  const ub = rem => rem.reduce((s, x) => s + W + (x.e.joker ? 13 : x.e.v), 0);

  function rec(rem, melds, score) {
    if (nodes++ > budget) return;
    if (score > best.score) best = { score, melds: melds.slice() };
    const A = rem.find(x => !x.e.joker);
    if (!A) return;
    if (score + ub(rem) <= best.score) return;
    const cands = candidatesWith(A, rem).sort((p, q) => q.score - p.score);
    for (const cand of cands) {
      rec(rem.filter(x => !cand.items.includes(x)), melds.concat([cand.items.map(x => x.t)]), score + cand.score + W * cand.items.length);
    }
    rec(rem.filter(x => x !== A), melds, score);
  }
  rec(items, [], 0);
  if (W) best.score = best.melds.reduce((a, m) => a + (R.analyzeMeld(m, okey) || { score: 0 }).score, 0);
  return best;
}

// Eldeki çiftler (okeyler tekleri tamamlar)
function findPairs(tiles, okey) {
  const jokers = tiles.filter(t => R.isJoker(t, okey));
  const groups = {};
  tiles
    .filter(t => !R.isJoker(t, okey))
    .forEach(t => {
      const e = R.eff(t, okey);
      (groups[e.c + '-' + e.v] = groups[e.c + '-' + e.v] || []).push(t);
    });
  const pairs = [];
  const singles = [];
  for (const k in groups) {
    const g = groups[k];
    while (g.length >= 2) pairs.push([g.pop(), g.pop()]);
    if (g.length) singles.push(g[0]);
  }
  singles.sort((a, b) => R.eff(b, okey).v - R.eff(a, okey).v);
  let j = 0;
  for (const s of singles) {
    if (j >= jokers.length) break;
    pairs.push([s, jokers[j++]]);
  }
  if (jokers.length - j >= 2) pairs.push([jokers[j], jokers[j + 1]]);
  return pairs;
}

// ======================================================================
//  BOT ZEKÂSI
//  Bot yalnızca herkesin görebildiği bilgiyi kullanır: kendi eli, masadaki
//  perler, herkesin attığı taşlar, kimin yandan hangi taşı aldığı, yığın sayısı.
// ======================================================================

const key = (c, v) => c * 20 + v;
// Karar ağırlıkları (simülasyonla ayarlandı)
const W = {
  pot: +(process.env.W_POT || 50), dng: +(process.env.W_DNG || 34), dngV: +(process.env.W_DNGV || 2),
  keep: +(process.env.W_KEEP || 600), spare: +(process.env.W_SPARE || 60), strong: +(process.env.W_STRONG || 1), strongBonus: +(process.env.W_SB || 0),
};

// Görünmeyen (henüz kimsenin görmediği) taş sayısı: her taştan 2 tane var
function knowledge(g, seat) {
  const ok = g.okey;
  const seen = new Map();
  const add = t => {
    const e = R.eff(t, ok);
    if (e.joker) return;
    const k = key(e.c, e.v);
    seen.set(k, (seen.get(k) || 0) + 1);
  };
  const onTable = new Set();
  g.seats[seat].hand.forEach(add);
  g.melds.forEach(m => m.tiles.forEach(t => { add(t); onTable.add(t.id); }));
  g.seats.forEach(s => s.discards.forEach(t => { add(t); onTable.add(t.id); }));
  add(g.indicator);
  // Başkasının yandan aldığı ve hâlâ elinde olan taşlar da bize gelmeyecek
  g.seats.forEach((s, i) => {
    if (i !== seat) (s.picked || []).forEach(t => { if (!onTable.has(t.id)) add(t); });
  });
  return { unseen: (c, v) => (v < 1 || v > 13 ? 0 : Math.max(0, 2 - (seen.get(key(c, v)) || 0))) };
}

// İki eksik taşın gelme ihtimali (okey varsa zayıf olanın yerine geçer)
function both(a, b, jokers) {
  if (jokers > 0) return Math.max(a, b);
  return a * b;
}

// Taşın elde işe yarama potansiyeli: onu içeren 3'lü seri/grupların tamamlanma ihtimali
function potential(t, hand, ok, kn, pairMode) {
  const e = R.eff(t, ok);
  if (e.joker) return 10;
  const mine = new Map();
  let jokers = 0;
  hand.forEach(x => {
    if (x === t) return;
    const f = R.eff(x, ok);
    if (f.joker) { jokers++; return; }
    mine.set(key(f.c, f.v), (mine.get(key(f.c, f.v)) || 0) + 1);
  });
  // Elimizdeyse 1, görünmüyorsa gelme ihtimali (iki tanesi de görünmüyorsa ~%45)
  const p = (c, v) => (v < 1 || v > 13 ? 0 : mine.get(key(c, v)) ? 1 : kn.unseen(c, v) * 0.22);
  let sum = 0;
  for (let s = e.v - 2; s <= e.v; s++) {
    if (s < 1 || s + 2 > 13) continue;
    const o = [s, s + 1, s + 2].filter(v => v !== e.v);
    sum += both(p(e.c, o[0]), p(e.c, o[1]), jokers);
  }
  const oc = [0, 1, 2, 3].filter(k => k !== e.c);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) sum += both(p(oc[i], e.v), p(oc[j], e.v), jokers);
  if (pairMode) sum += mine.get(key(e.c, e.v)) ? 2 : kn.unseen(e.c, e.v) * 0.45;
  return sum;
}

// Rakip için bir taşın genel işe yarama ihtimali (bizim bildiklerimize göre)
function liveness(e, kn) {
  const p = (c, v) => kn.unseen(c, v) / 2;
  let sum = 0;
  for (let s = e.v - 2; s <= e.v; s++) {
    if (s < 1 || s + 2 > 13) continue;
    const o = [s, s + 1, s + 2].filter(v => v !== e.v);
    sum += p(e.c, o[0]) * p(e.c, o[1]);
  }
  const oc = [0, 1, 2, 3].filter(k => k !== e.c);
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) sum += p(oc[i], e.v) * p(oc[j], e.v);
  return sum;
}

// Bu taşı atarsak sağdaki oyuncunun (sıradaki, yerden alabilecek kişi) işine yarama tehlikesi
function danger(g, seat, t, kn) {
  const ok = g.okey;
  const N = g.seats[(seat + 1) % 4];
  const e = R.eff(t, ok);
  if (e.joker) return 3;
  let d = 1;
  // Açmış oyuncu yerden ancak yeni per kurmak için alır, tehlike düşük
  if (N.opened) d *= N.openType === 'cift' ? 0.2 : 0.3;
  const nd = N.discards.map(x => R.eff(x, ok)).filter(x => !x.joker);
  const np = (N.picked || []).map(x => R.eff(x, ok)).filter(x => !x.joker);
  // Attığı taşlar: neye ihtiyacı olmadığını gösterir
  if (nd.some(x => x.c === e.c && x.v === e.v)) d *= 0.12;
  else if (nd.some(x => x.v === e.v)) d *= 0.55;
  if (nd.some(x => x.c === e.c && Math.abs(x.v - e.v) === 1)) d *= 0.6;
  if (nd.some(x => x.c === e.c && Math.abs(x.v - e.v) === 2)) d *= 0.8;
  // Bizim daha önce attığımız ve onun ALMADIĞI taşlar: o taş işine yaramamış
  const passed = g.seats[seat].discards.map(x => R.eff(x, ok)).filter(x => !x.joker);
  if (!N.opened) {
    if (passed.some(x => x.c === e.c && x.v === e.v)) d *= 0.15;
    else if (passed.some(x => x.v === e.v || (x.c === e.c && Math.abs(x.v - e.v) <= 1))) d *= 0.75;
  }
  // Yerden aldığı taşlar: o bölgeyi topladığını gösterir
  if (np.some(x => (x.c === e.c && Math.abs(x.v - e.v) <= 2) || (x.v === e.v && x.c !== e.c))) d *= 2.2;
  // Taşın tamamlanma ihtimali hiç kalmamışsa kimseye yaramaz
  d *= Math.max(0.15, Math.min(1.3, liveness(e, kn) / 0.9));
  if (!N.opened) {
    d *= 0.55 + (e.v / 13) * 0.75;                      // yüksek taş 101'e ulaştırır
    d *= 1 + Math.max(0, 1 - g.pile.length / 20) * 0.7; // oyun ilerledikçe açmaya yakındır
  }
  return d;
}

function draw(g, seat) {
  if (g.turn !== seat || g.phase !== 'draw') return;
  const me = g.seats[seat];
  const ok = g.okey;
  const prev = g.seats[(seat + 3) % 4];
  const top = prev.discards[prev.discards.length - 1];
  if (top && !g.undoUsed) {
    if (me.opened) {
      let want = R.isJoker(top, ok) || g.melds.some(m => m.type !== 'pair' && R.attachInfo(m, top, ok));
      if (!want && me.openType === 'per') want = solve(me.hand.concat([top]), ok, 8000).score > solve(me.hand, ok, 8000).score;
      if (!want && (me.openType === 'cift' || g.seats.some(x => x.openType === 'cift'))) {
        want = me.hand.some(t => !R.isJoker(t, ok) && R.analyzePair([t, top], ok));
      }
      if (want && g.drawDiscard(seat).ok) return;
    } else {
      // Açmadıysak: yalnızca o taşla hemen açabiliyorsak al (yoksa 101 ceza riski)
      const hand = me.hand.concat([top]);
      const sol = solve(hand, ok);
      const used = sol.melds.reduce((a, m) => a + m.length, 0);
      if (sol.score >= g.barrier(seat).per && used < hand.length && sol.melds.some(m => m.includes(top))) {
        if (g.drawDiscard(seat).ok) return;
      }
    }
  }
  g.drawPile(seat);
}

// ---------------- Uzman stratejileri ----------------
const X = {
  slowK: +(process.env.X_SLOW ?? 3),       // açmayı bekletmek için en fazla kaç taş eksik olabilir (0 = kapalı)
  slowPile: +(process.env.X_SLOWPILE ?? 9), // yığında en az bu kadar taş varken beklet
  slowAll: +(process.env.X_SLOWALL ?? 1),  // başkası açmış olsa da (risk düşükse) bitirmek için beklet (ölçümde zararsız, uzman davranışı)
  minOpen: +(process.env.X_MIN ?? 1),      // açarken barajı geçecek kadar per indir, gerisini sakla
  hold: +(process.env.X_HOLD ?? 0),        // açtıktan sonra perleri elde tut (ölçümde zarar ettirdi, kapalı)
  holdPile: +(process.env.X_HOLDPILE ?? 8),
  holdRival: +(process.env.X_HOLDRIVAL ?? 6),
  look: +(process.env.X_LOOK ?? 1),          // taş atarken ileriye bakış (örnekleme)
  lookN: +(process.env.X_LOOKN ?? 16),
  lookW: +(process.env.X_LOOKW ?? 3),
  lookC: +(process.env.X_LOOKC ?? 3),
  early: +(process.env.X_EARLY ?? 0),      // erken oyunda (yığın >= bu sayı) kimse açmamışken açmayı beklet (0 = kapalı)
  hold1: +(process.env.X_HOLD1 ?? 0),      // açtığı turda sadece açılışı indir, kalan perleri sonraki turda (ölçümde zarar, kapalı)
  keepJ: +(process.env.X_KEEPJ ?? 1),      // okeyi sakla: okeysiz açabiliyorsan öyle aç, okeyi risk artınca ya da bitişte kullan
};

// Bu tur eli bitirebilir miyim? (en çok taşlı dizilim + masaya işlenebilecek kalanlar, en az 1 taş atmak için kalır)
function finishable(g, seat) {
  const me = g.seats[seat];
  const ok = g.okey;
  const sol = solve(me.hand, ok, 20000, 'tiles');
  const used = new Set(sol.melds.flat());
  const left = me.hand.filter(t => !used.has(t));
  const notAttach = left.filter(t => !g.melds.some(m => m.type !== 'pair' && R.canAttach(m, t, ok)));
  return { left: left.length, stuck: notAttach.length, can: notAttach.length <= 1 };
}

// Risk arttı mı? (yığın azaldı ya da açmış bir rakip bitirmeye yaklaştı)
function riskHigh(g, seat) {
  if (g.pile.length <= X.holdPile) return true;
  return g.seats.some((s, i) => i !== seat && !g.sameTeam(i, seat) && s.opened && s.hand.length <= X.holdRival);
}

// Açmayı bekletmeli mi? Elden bitme (puanlar x2) için: kimse açmamış, yığın dolu, bitirmeye 2-3 taş kalmış
function delayOpen(g, seat) {
  if (g.mustOpenWith != null) return false;
  // Erken oyun: yığın doluyken ve kimse açmamışken açma (el gelişsin, bilgi verme); bitirebiliyorsa beklemez
  if (X.early && g.pile.length >= X.early && !g.seats.some((s, i) => i !== seat && s.opened) && !finishable(g, seat).can) return true;
  if (!X.slowK) return false;
  if (!X.slowAll && g.seats.some((s, i) => i !== seat && s.opened)) return false;
  if (riskHigh(g, seat)) return false;
  if (g.pile.length < X.slowPile) return false;
  const f = finishable(g, seat);
  if (f.can) return false; // şimdi bitirebiliyor: aç ve bitir
  return f.stuck <= X.slowK + 1 && f.stuck >= 2;
}

// Barajı geçen en az taşlı per alt kümesi (gerisi elde saklanır)
function minimalOpen(melds, need, ok) {
  const sc = melds.map(m => ({ m, s: R.analyzeMeld(m, ok).score })).sort((a, b) => b.s / b.m.length - a.s / a.m.length);
  const out = [];
  let sum = 0;
  for (const x of sc) { if (sum >= need) break; out.push(x.m); sum += x.s; }
  return sum >= need ? out : melds;
}

function tryOpen(g, seat) {
  const me = g.seats[seat];
  const ok = g.okey;
  const bar = g.barrier(seat);
  const sol = solve(me.hand, ok);
  let melds = sol.melds.slice();
  let score = sol.score;
  let used = melds.reduce((a, m) => a + m.length, 0);
  if (used >= me.hand.length && melds.length > 1) {
    const scored = melds.map(m => ({ m, s: R.analyzeMeld(m, ok).score })).sort((x, y) => x.s - y.s);
    melds = scored.slice(1).map(x => x.m);
    score -= scored[0].s;
    used -= scored[0].m.length;
  }
  if (score >= bar.per && used < me.hand.length) {
    if (delayOpen(g, seat)) return false; // uzman: açmayı beklet
    let toOpen = melds;
    if (X.minOpen && !riskHigh(g, seat) && !finishable(g, seat).can) toOpen = minimalOpen(melds, bar.per, ok);
    // Uzman: okey olmadan da baraj geçiliyorsa okeyi açışta harcama (sona sakla: okeyle bitiş puanları x2)
    if (X.keepJ && !riskHigh(g, seat) && toOpen.some(m => m.some(t => R.isJoker(t, ok)))) {
      const noJ = me.hand.filter(t => !R.isJoker(t, ok));
      const s2 = solve(noJ, ok);
      const used2 = s2.melds.reduce((a, m) => a + m.length, 0);
      if (s2.score >= bar.per && used2 < me.hand.length) {
        const alt = X.minOpen ? minimalOpen(s2.melds, bar.per, ok) : s2.melds;
        if (g.open(seat, alt.map(m => m.map(t => t.id))).ok) return true;
      }
    }
    if (g.open(seat, toOpen.map(m => m.map(t => t.id))).ok) return true;
    if (toOpen !== melds && g.open(seat, melds.map(m => m.map(t => t.id))).ok) return true;
  }
  // Çift açmak cezayı ikiye katlar: seri umudu zayıfsa, çift çoksa ya da yığın azaldıysa aç
  const pairs = findPairs(me.hand, ok);
  const maxPairs = Math.floor((me.hand.length - 1) / 2);
  const realPairs = pairs.filter(p => !p.some(t => R.isJoker(t, ok))).length;
  const worthIt = realPairs >= bar.cift + 1 || score < bar.per * 0.6 || g.pile.length <= 8;
  if (pairs.length >= bar.cift && worthIt) {
    const use = pairs.slice(0, maxPairs);
    if (use.length >= bar.cift && g.open(seat, use.map(p => p.map(t => t.id))).ok) return true;
  }
  return false;
}

function chooseDiscard(g, seat) {
  const me = g.seats[seat];
  const ok = g.okey;
  const hand = me.hand;
  if (hand.length === 1) return hand[0];
  const kn = knowledge(g, seat);
  // Per taşlarının koruma değeri: peri bozacak taş (3'lü perin taşı, serinin ortası) kesinlikle atılmaz;
  // 4+ serinin ucundaki ya da 4'lü grubun fazla taşı "yedek"tir, gerekirse atılabilir (per yine geçerli kalır)
  const keepW = new Map();
  if (me.openType !== 'cift') {
    solve(hand, ok, 10000).melds.forEach(m => {
      const a = R.analyzeMeld(m, ok);
      const order = a ? a.order : m;
      order.forEach((t, i) => {
        const spare = order.length >= 4 && (a && a.type === 'set' ? true : i === 0 || i === order.length - 1);
        keepW.set(t, spare ? W.spare : W.keep);
      });
    });
  }
  const pairMode = me.openType === 'cift' || (!me.opened && findPairs(hand, ok).length >= 4);

  // Puan baskısı: açtıysak eldeki sayı ceza olur; biri bitirmeye yaklaştıkça artar
  const rivals = g.seats.filter((s, i) => i !== seat && !g.sameTeam(i, seat));
  const rivalClose = rivals.some(s => s.opened && s.hand.length <= 4);
  let pts = 0;
  if (me.opened) pts = 0.35 + (g.pile.length <= 6 ? 0.35 : 0) + (rivalClose ? 0.7 : 0);
  else pts = -0.25; // açmadan önce büyük taşlar 101'e ulaştırır, tutulur

  // Umutsuz el: yığın azaldı ve açmaya çok uzağız -> kendi elini bırak, sadece savun
  let potW = W.pot;
  if (!me.opened && g.pile.length <= 6) {
    const sc = solve(hand, ok, 6000).score;
    if (sc < g.barrier(seat).per * 0.7 && findPairs(hand, ok).length < g.barrier(seat).cift - 1) potW *= 0.3;
  }
  const scored = [];
  let best = null, bestScore = Infinity;
  for (const t of hand) {
    if (R.isJoker(t, ok)) continue;
    const e = R.eff(t, ok);
    // Hazır perdeki taşı rakibi engellemek için asla bozma (ancak başka seçenek yoksa)
    let k = keepW.get(t) || 0;
    const pot = potential(t, hand, ok, kn, pairMode);
    k += pot * potW;
    // Güçlü yarım dizilimleri (iki taşı elde, üçüncüsü gelebilir) de koru
    if (!keepW.has(t) && pot >= W.strong) k += W.strongBonus;
    k += danger(g, seat, t, kn) * (W.dng + e.v * W.dngV);
    k -= e.v * pts * 2;
    if (g.melds.some(m => g.canAttachNow(m, t))) k += 1000; // işlek taş atmak 101 ceza
    scored.push({ t, k });
    if (k < bestScore) { bestScore = k; best = t; }
  }
  // İleriye bakış: en iyi 3 aday için, görünmeyen taşlardan örnekler çekip elin ortalama gelişimine bak
  if (X.look && scored.length > 1) {
    scored.sort((a, b) => a.k - b.k);
    const cands = scored.slice(0, X.lookC).filter(c => c.k < 500);
    if (cands.length > 1) {
      const pool = [];
      for (let c = 0; c < 4; c++) for (let v = 1; v <= 13; v++) for (let n = kn.unseen(c, v); n > 0; n--) pool.push({ id: -1 - pool.length, c, v, fake: false });
      if (pool.length) {
        const N = Math.min(X.lookN, pool.length);
        const sample = [];
        for (let i = 0; i < N; i++) sample.push(pool[Math.floor(Math.random() * pool.length)]);
        const obj = me.opened ? 'tiles' : 'score';
        const val = sol => (me.opened ? sol.melds.reduce((a, m) => a + m.length, 0) * 10 : Math.min(sol.score, g.barrier(seat).per + 15));
        let bestAdj = Infinity;
        for (const c of cands) {
          const rest = hand.filter(x => x !== c.t);
          let ev = 0;
          for (const u of sample) ev += val(solve(rest.concat([u]), ok, 2500, obj));
          ev /= N;
          const adj = c.k - X.lookW * ev;
          if (adj < bestAdj) { bestAdj = adj; best = c.t; }
        }
      }
    }
  }
  return best || hand[0];
}

// Açtıktan sonra: perleri indir, çift alanına çift koy, masaya işle
function layAndAttach(g, seat, reserve) {
  const me = g.seats[seat];
  const ok = g.okey;
  // Açtığı turda (uzman gibi) sadece açılışı indir; kalan perler sonraki turda
  const justOpened = X.hold1 && me.openedAt === g.turnCount;
  const holdMelds = me.openType === 'per' && !finishable(g, seat).can && ((X.hold && !riskHigh(g, seat)) || justOpened);
  const isJ = t => R.isJoker(t, ok);
  const usable = () => me.hand.filter(t => t !== reserve);
  const ciftArea = () => g.seats.some(x => x.openType === 'cift');
  let guard = 0;
  let changed = true;
  while (changed && guard++ < 60) {
    changed = false;
    if (me.openType === 'per' && !holdMelds) {
      for (const m of solve(usable(), ok, 20000, 'tiles').melds) {
        if (me.hand.length - m.length >= 1 && g.layMeld(seat, m.map(t => t.id)).ok) { changed = true; break; }
      }
      if (changed) continue;
    }
    if (me.openType === 'cift' || ciftArea()) {
      for (const p of findPairs(usable(), ok)) {
        if (me.openType !== 'cift' && p.some(isJ)) continue;
        if (me.hand.length - 2 >= 1 && g.layMeld(seat, p.map(t => t.id)).ok) { changed = true; break; }
      }
      if (changed) continue;
    }
    if (me.hand.length > 1) {
      // Okeyi masaya ancak eli bitirmeye yakınken işle; öncesinde elde per kurmak için sakla
      const list = usable().filter(t => !isJ(t) || me.hand.length <= 3);
      outer: for (const t of list) {
        for (const m of g.melds) {
          if (me.hand.length <= 1) break outer;
          const opts = R.attachOptions(m, t, ok);
          if (!opts.length) continue;
          // Yerdeki okeyi her fırsatta al: eldeki taş sayısı değişmez, sabit bir taş her yere uyan okeye döner
          const info = opts.find(o => o.kind === 'swap') || opts.find(o => o.kind === 'add');
          if (!info) continue;
          if (g.addToMeld(seat, t.id, m.id, info).ok) { changed = true; break outer; }
        }
      }
    }
  }
}

function play(g, seat) {
  if (g.turn !== seat || g.phase !== 'play') return;
  const me = g.seats[seat];
  const ok = g.okey;

  if (!me.opened) {
    tryOpen(g, seat);
    if (g.mustOpenWith != null && !me.opened) {
      g.undoTake(seat);
      g.drawPile(seat);
      if (g.phase !== 'play') return;
      tryOpen(g, seat);
    }
  }

  if (me.opened) {
    // Okeyle bitirme fırsatı: bir okeyi sona sakla, kalan her şeyi yerleştirebiliyorsak okeyi atarak bitir (puanlar x2)
    const jok = me.hand.find(t => R.isJoker(t, ok));
    if (jok) layAndAttach(g, seat, jok);
    const useJ = X.keepJ !== 1 || riskHigh(g, seat) || me.hand.length <= 4 || finishable(g, seat).can; // keepJ=2: sadece açarken sakla
    if (!(jok && me.hand.length === 1 && me.hand[0] === jok) && (!jok || useJ)) layAndAttach(g, seat, null);
  }

  const t = chooseDiscard(g, seat);
  const r = g.discard(seat, t.id);
  if (r.err) fallback(g, seat);
}

// Her ihtimale karşı: oyunun takılmaması için zorla bir taş at
function fallback(g, seat) {
  if (g.turn !== seat) return;
  if (g.phase === 'draw') {
    if (g.drawPile(seat).err) return;
  }
  if (g.mustOpenWith != null) {
    g.undoTake(seat);
    g.drawPile(seat);
  }
  const me = g.seats[seat];
  if (g.phase === 'play' && me.hand.length) g.discard(seat, me.hand[me.hand.length - 1].id);
}

// "Seri diz" / "Çift diz" önerisi. Okey, oyuncu onu ters çevirdiyse okey (joker) olarak,
// çevirmediyse yüzündeki sayı olarak değerlendirilir (okeyi tanımak oyuncuya kalır).
// Açmadan önce: barajı geçen en çok taşlı dizilim (yoksa en yüksek puan). Açtıktan sonra: en çok taş (bitirmek için).
function suggest(g, seat, flippedIds) {
  const me = g.seats[seat];
  const flip = new Set(flippedIds || []);
  const V = { c: -9, v: -9 }; // sanal okey: sadece çevrilmiş okeyler joker sayılır
  const vt = me.hand.map(t => {
    if (t.fake) return { id: t.id, c: g.okey.c, v: g.okey.v, fake: false };
    if (R.isJoker(t, g.okey)) return flip.has(t.id) ? { id: t.id, c: V.c, v: V.v, fake: false } : { id: t.id, c: t.c, v: t.v, fake: false };
    return t;
  });
  const byTiles = solve(vt, V, 150000, 'tiles');
  let best = byTiles;
  if (!me.opened && byTiles.score < g.barrier(seat).per) {
    const byScore = solve(vt, V, 150000, 'score');
    if (byScore.score > byTiles.score) best = byScore;
  }
  return {
    melds: best.melds.map(m => m.map(t => t.id)),
    score: best.score,
    pairs: findPairs(vt, V).map(p => p.map(t => t.id)),
  };
}

function timeoutTurn(g, seat) {
  if (g.turn !== seat) return;
  if (g.phase === 'play' && g.mustOpenWith != null) { g.undoTake(seat); }
  if (g.phase === 'draw') g.drawPile(seat);
  if (g.phase !== 'play' || g.turn !== seat) return;
  const t = chooseDiscard(g, seat);
  if (g.discard(seat, t.id).err) fallback(g, seat);
}

function fullTurn(g, seat) {
  if (g.phase === 'draw') draw(g, seat);
  if (g.phase === 'play' && g.turn === seat) play(g, seat);
}

// "💡 Öneri": oyuncuya hangi taşı atması gerektiğini söyler (bot zekâsıyla)
function hint(g, seat) {
  if (g.turn !== seat || g.phase !== 'play') return null;
  const t = chooseDiscard(g, seat);
  return t ? t.id : null;
}

// Elde per kuran taşlar (İşle düğmesi bunları bozmaz)
function keepIds(g, seat) {
  const me = g.seats[seat];
  return solve(me.hand, g.okey, 20000, 'tiles').melds.flat().map(t => t.id);
}

module.exports = { keepIds, hint, solve, suggest, findPairs, draw, play, fullTurn, timeoutTurn, fallback };
