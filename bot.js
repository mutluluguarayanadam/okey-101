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
    for (let len = Math.max(3, a - s + 1); s + len - 1 <= 13; len++) {
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

// Eldeki taşlardan en yüksek puanlı per kombinasyonunu bulur
function solve(tiles, okey, budget = 20000) {
  const items = tiles
    .map(t => ({ t, e: R.eff(t, okey) }))
    .sort((x, y) => (x.e.joker ? 99 : x.e.c * 20 + x.e.v) - (y.e.joker ? 99 : y.e.c * 20 + y.e.v));
  let best = { score: 0, melds: [] };
  let nodes = 0;
  const ub = rem => rem.reduce((s, x) => s + (x.e.joker ? 13 : x.e.v), 0);

  function rec(rem, melds, score) {
    if (nodes++ > budget) return;
    if (score > best.score) best = { score, melds: melds.slice() };
    const A = rem.find(x => !x.e.joker);
    if (!A) return;
    if (score + ub(rem) <= best.score) return;
    const cands = candidatesWith(A, rem).sort((p, q) => q.score - p.score);
    for (const cand of cands) {
      rec(rem.filter(x => !cand.items.includes(x)), melds.concat([cand.items.map(x => x.t)]), score + cand.score);
    }
    rec(rem.filter(x => x !== A), melds, score);
  }
  rec(items, [], 0);
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

function draw(g, seat) {
  if (g.turn !== seat || g.phase !== 'draw') return;
  const me = g.seats[seat];
  const ok = g.okey;
  const prev = g.seats[(seat + 3) % 4];
  const top = prev.discards[prev.discards.length - 1];
  if (top && !g.undoUsed) {
    if (me.opened) {
      let want = R.isJoker(top, ok) || g.melds.some(m => R.canAttach(m, top, ok));
      if (!want && me.openType === 'per') want = solve(me.hand.concat([top]), ok, 8000).score > solve(me.hand, ok, 8000).score;
      if (!want && me.openType === 'cift') want = me.hand.some(t => !R.isJoker(t, ok) && R.analyzePair([t, top], ok));
      if (want && g.drawDiscard(seat).ok) return;
    } else {
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

function tryOpen(g, seat) {
  const me = g.seats[seat];
  const ok = g.okey;
  const bar = g.barrier(seat);
  const sol = solve(me.hand, ok);
  let melds = sol.melds.slice();
  let score = sol.score;
  let used = melds.reduce((a, m) => a + m.length, 0);
  if (used >= me.hand.length && melds.length > 1) {
    // Elde atacak taş kalmalı: en düşük puanlı peri bırak
    const scored = melds.map(m => ({ m, s: R.analyzeMeld(m, ok).score })).sort((x, y) => x.s - y.s);
    melds = scored.slice(1).map(x => x.m);
    score -= scored[0].s;
    used -= scored[0].m.length;
  }
  if (score >= bar.per && used < me.hand.length) {
    if (g.open(seat, melds.map(m => m.map(t => t.id))).ok) return true;
  }
  const pairs = findPairs(me.hand, ok);
  const maxPairs = Math.floor((me.hand.length - 1) / 2);
  if (pairs.length >= bar.cift && score < bar.per) {
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
  const keep = new Set();
  if (me.openType !== 'cift') solve(hand, ok, 10000).melds.forEach(m => m.forEach(t => keep.add(t)));
  let best = null;
  let bestU = Infinity;
  for (const t of hand) {
    if (R.isJoker(t, ok)) continue;
    const e = R.eff(t, ok);
    let u = keep.has(t) ? 50 : 0;
    for (const o of hand) {
      if (o === t) continue;
      const f = R.eff(o, ok);
      if (f.joker) continue;
      const d = Math.abs(f.v - e.v);
      if (f.c === e.c && d === 1) u += 4;
      else if (f.c === e.c && d === 2) u += 2;
      if (f.v === e.v && f.c !== e.c) u += 3;
      if (f.v === e.v && f.c === e.c) u += me.openType === 'cift' ? 30 : 1;
    }
    if (g.melds.some(m => R.canAttach(m, t, ok))) u += 100; // işlek taş atma cezası
    u += (me.opened ? -e.v : e.v) * 0.1;
    if (u < bestU) {
      bestU = u;
      best = t;
    }
  }
  return best || hand[0];
}

function play(g, seat) {
  if (g.turn !== seat || g.phase !== 'play') return;
  const me = g.seats[seat];
  const ok = g.okey;

  if (!me.opened) {
    tryOpen(g, seat);
    if (g.mustOpenWith != null && !me.opened) {
      // Yerden aldığı taşla açamadı: geri ver, yığından çek
      g.undoTake(seat);
      g.drawPile(seat);
      if (g.phase !== 'play') return;
      tryOpen(g, seat);
    }
  }

  if (me.opened) {
    const ciftArea = () => g.seats.some(x => x.openType === 'cift');
    const isJ = t => R.isJoker(t, ok);
    let guard = 0;
    let changed = true;
    while (changed && guard++ < 60) {
      changed = false;
      // 1) Yeni seri indir (sadece seri açan)
      if (me.openType === 'per') {
        for (const m of solve(me.hand, ok).melds) {
          if (me.hand.length - m.length >= 1 && g.layMeld(seat, m.map(t => t.id)).ok) { changed = true; break; }
        }
        if (changed) continue;
      }
      // 2) Çift alanına çift indir
      if (me.openType === 'cift' || ciftArea()) {
        for (const p of findPairs(me.hand, ok)) {
          if (me.openType !== 'cift' && p.some(isJ)) continue;
          if (me.hand.length - 2 >= 1 && g.layMeld(seat, p.map(t => t.id)).ok) { changed = true; break; }
        }
        if (changed) continue;
      }
      // 3) Masadaki perlere işle ya da okey al
      if (me.hand.length > 1) {
        const mustUse = g.takenJoker != null && me.hand.some(t => t.id === g.takenJoker);
        const list = me.hand.filter(t => !isJ(t) || mustUse || me.hand.length <= 3);
        outer: for (const t of list) {
          for (const m of g.melds) {
            if (me.hand.length <= 1) break outer;
            const info = R.attachInfo(m, t, ok);
            if (!info) continue;
            if (info.kind === 'swap') {
              // Okeyi ancak sonra kullanabileceksek al
              const jokerTile = m.tiles[info.index];
              const usable = g.melds.some(o => o !== m && o.type !== 'pair' && R.attachInfo(o, jokerTile, ok));
              if (!usable) continue;
            }
            if (g.addToMeld(seat, t.id, m.id).ok) { changed = true; break outer; }
          }
        }
      }
    }
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

function fullTurn(g, seat) {
  if (g.phase === 'draw') draw(g, seat);
  if (g.phase === 'play' && g.turn === seat) play(g, seat);
}

module.exports = { solve, findPairs, draw, play, fullTurn, fallback };
