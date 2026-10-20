// Bitiş planı: elindeki taşlarla bu turda neyin açılıp indirileceğini, masadaki perlere neyin işleneceğini,
// hangi okeyin alınacağını ve hangi taşın atılacağını hesaplar. "Seri diz / Çift diz" önerileri ve (sonraki adımda) botlar
// aynı hesabı kullanır. Oyun durumunu DEĞİŞTİRMEZ; yalnızca plan döndürür.
//
// Kurallar (README ile aynı): açarken/indirirken seri en fazla 5 taş; çift açan yeni seri açamaz; bir perin her yanına
// turda en fazla 2 taş işlenir (okey alma bu sınıra sayılmaz); atmak için elde en az 1 taş kalır.
const R = require('./public/rules.js');
const Bot = require('./bot.js');

const MAX_OPEN = R.MAX_OPEN_RUN;

// Oyuncunun görünümü: ters çevrilmiş (joker) okeyler joker kalır, yüzü açık okey ve sahte okey kendi sayısıyla sayılır.
// Çözücü için sanal okey (V) kullanılır; sadece "flipped" taşlar joker olur.
const V = { c: -9, v: -9 };
function solverTile(t, okey, flip) {
  if (t.fake) return { id: t.id, c: okey.c, v: okey.v, fake: false };
  if (R.isJoker(t, okey)) return flip.has(t.id) ? { id: t.id, c: V.c, v: V.v, fake: false } : { id: t.id, c: t.c, v: t.v, fake: false };
  return t;
}

const cloneMelds = melds => melds.map(m => ({ id: m.id, owner: m.owner, type: m.type, tiles: m.tiles.slice(), start: m.start, color: m.color }));
const cloneCount = cnt => { const o = {}; for (const k in cnt) o[k] = { left: cnt[k].left, right: cnt[k].right }; return o; };

// Perlerin ids'ini çözücü sonucundan gerçek taşlara çevirir
function meldsFromSolve(sol, byId) {
  return sol.melds.map(m => m.map(t => byId.get(t.id)));
}

// Açıkken: bu eldeki tüm taşlarla yapılacak hamleler
//  hand: gerçek taşlar; ctx: { okey, melds (kopya), cnt (kopya), openType, ciftArea, canAttach, flip }
function afterOpen(hand, ctx) {
  const { okey, flip } = ctx;
  const ops = { lay: [], pairs: [], swaps: [], attach: [] };
  let rest = hand.slice();
  const isJ = t => R.isJoker(t, okey);
  const keepOne = () => rest.length > 1; // atmak için en az bir taş kalmalı

  const byId = () => new Map(rest.map(t => [t.id, t]));
  const solveRest = () => {
    const vts = rest.map(t => solverTile(t, okey, flip));
    const sol = Bot.solve(vts, V, 60000, 'tiles');
    return meldsFromSolve(sol, byId());
  };

  // 1) Elde per kuracak taşlar (seri açan için)
  let layGroups = [];
  if (ctx.openType === 'per') {
    layGroups = solveRest();
    // hepsini indirirsek atacak taş kalmaz: en küçük perden vazgeç
    let usedN = layGroups.reduce((a, g) => a + g.length, 0);
    while (layGroups.length && usedN >= rest.length) {
      layGroups.sort((a, b) => (R.analyzeMeld(a, V) || { score: 0 }).score - (R.analyzeMeld(b, V) || { score: 0 }).score);
      usedN -= layGroups.shift().length;
    }
  }
  const inLay = new Set(layGroups.flat().map(t => t.id));

  // 2) Okey alma: perlerde kullanılmayan bir taş masadaki okeyin yerine geçiyorsa al (el sayısı değişmez)
  const meldsNow = ctx.melds;
  let swapped = true, guard = 0;
  while (ctx.canAttach && swapped && guard++ < 6) { // okey alma da işleme sayılır (açtığı turda işleme yok seçeneğinde yapılamaz)
    swapped = false;
    for (const t of rest) {
      if (isJ(t) || inLay.has(t.id)) continue;
      for (const m of meldsNow) {
        const si = R.jokerSwapIndex(m, t, okey);
        if (si < 0) continue;
        const joker = m.tiles[si];
        m.tiles = m.tiles.slice(); m.tiles[si] = t;
        rest = rest.filter(x => x !== t); rest.push(joker);
        ops.swaps.push({ tile: t.id, meld: m.id, joker: joker.id });
        flip.add(joker.id); // alınan okey ters gelir, joker sayılır
        swapped = true; break;
      }
      if (swapped) break;
    }
    if (swapped && ctx.openType === 'per') {
      // okey eline geçti: perler yeniden hesaplanır
      layGroups = solveRest();
      let usedN = layGroups.reduce((a, g) => a + g.length, 0);
      while (layGroups.length && usedN >= rest.length) { usedN -= layGroups.pop().length; }
      inLay.clear(); layGroups.flat().forEach(t => inLay.add(t.id));
    }
  }
  ops.lay = layGroups.map(g => g.map(t => t.id));
  rest = rest.filter(t => !inLay.has(t.id));

  // 3) Çiftler: çift açan ya da masada çift alanı varsa
  if (ctx.openType === 'cift' || ctx.ciftArea) {
    const vts = rest.map(t => solverTile(t, okey, flip));
    const prs = Bot.findPairs(vts, V).filter(p => ctx.openType === 'cift' || !p.some(t => R.isJoker(t, V)));
    const idMap = byId();
    for (const p of prs) {
      if (rest.length - 2 < 1) break;
      const real = p.map(t => idMap.get(t.id));
      if (!real.every(Boolean)) continue;
      ops.pairs.push(real.map(t => t.id));
      rest = rest.filter(t => !real.includes(t));
    }
  }

  // 4) Masaya işleme (okey kullanılmaz; tur başına bir yana en fazla 2)
  if (ctx.canAttach) {
    let changed = true;
    while (changed && keepOne()) {
      changed = false;
      const cands = [];
      for (const t of rest) {
        if (isJ(t)) continue;
        const targets = [];
        for (const m of ctx.melds) {
          const c = ctx.cnt[m.id] || { left: 0, right: 0 };
          for (const o of R.attachOptions(m, t, okey)) if (o.kind === 'add' && c[o.side] < 2) targets.push({ m, o });
        }
        if (targets.length) cands.push({ t, targets });
      }
      if (!cands.length) break;
      cands.sort((a, b) => a.targets.length - b.targets.length); // tek yere gidebilen önce
      const { t, targets } = cands[0];
      const used = x => { const c = ctx.cnt[x.m.id]; return c ? c.left + c.right : 0; };
      targets.sort((a, b) => used(a) - used(b));
      const { m, o } = targets[0];
      const c = ctx.cnt[m.id] || (ctx.cnt[m.id] = { left: 0, right: 0 });
      c[o.side]++;
      m.tiles = o.order;
      if (o.start != null) m.start = o.start;
      ops.attach.push({ tile: t.id, meld: m.id, side: o.side });
      rest = rest.filter(x => x !== t);
      changed = true;
    }
  }

  // 5) Atılacak taş: işlek olmayan, ceza değeri en yüksek (elde kalırsa puan yazar) taş; hepsi işlekse en küçüğü
  const isIslek = t => ctx.melds.some(m => R.attachOptions(m, t, okey).some(o => o.kind === 'swap' || (ctx.cnt[m.id] || { left: 0, right: 0 })[o.side] < 2));
  let discard = null;
  if (rest.length) {
    const val = t => (isJ(t) ? 101 : R.eff(t, okey).v);
    const safe = rest.filter(t => !isJ(t) && !isIslek(t)).sort((a, b) => val(b) - val(a));
    discard = (safe[0] || rest.slice().sort((a, b) => val(a) - val(b)).find(t => !isJ(t)) || rest[0]).id;
  }
  return { ...ops, rest: rest.map(t => t.id), discard };
}

// Ana giriş. flippedIds: oyuncunun ters çevirdiği (joker) okeylerin id'leri (varsayılan: elindeki bütün okeyler)
function finishPlan(g, seat, flippedIds) {
  const me = g.seats[seat];
  const okey = g.okey;
  const hand = me.hand;
  const flip = new Set(flippedIds || hand.filter(t => R.isJoker(t, okey)).map(t => t.id));
  const base = () => ({ okey, flip: new Set(flip), melds: cloneMelds(g.melds), cnt: cloneCount(g.attachCount || {}) });
  const ciftArea = g.seats.some(s => s.openType === 'cift');
  const bar = g.barrier(seat);
  const attachOk = !(g.opts.waitAttach && (!me.opened || me.openedAt === g.turnCount)); // "açtığı turda işleme yok" seçeneği
  const finish = (plan, extra) => {
    const left = plan.rest.length;
    return { ...plan, ...extra, toGo: Math.max(0, left - 1), canFinish: left <= 1 };
  };

  // ---- Zaten açtı ----
  if (me.opened) {
    const ctx = { ...base(), openType: me.openType, ciftArea, canAttach: attachOk };
    return finish(afterOpen(hand, ctx), { phase: 'opened', path: me.openType === 'cift' ? 'cift' : 'seri', open: [] });
  }

  // ---- Açmadı: iki yolu kıyasla ----
  const vts = hand.map(t => solverTile(t, okey, flip));
  const byId = new Map(hand.map(t => [t.id, t]));
  const options = [];

  // seri yolu
  {
    let sol = Bot.solve(vts, V, 150000, 'tiles');
    if (sol.score < bar.per) { const alt = Bot.solve(vts, V, 150000, 'score'); if (alt.score > sol.score) sol = alt; }
    let groups = meldsFromSolve(sol, byId);
    let usedN = groups.reduce((a, x) => a + x.length, 0);
    const sc = x => (R.analyzeMeld(x, V) || { score: 0 }).score;
    groups.sort((a, b) => sc(a) - sc(b));
    while (groups.length > 1 && usedN >= hand.length) usedN -= groups.shift().length;
    const score = groups.reduce((a, x) => a + sc(x), 0);
    const potential = { score: sol.score };
    if (score >= bar.per && usedN < hand.length) {
      const openIds = new Set(groups.flat().map(t => t.id));
      const rest = hand.filter(t => !openIds.has(t.id));
      const ctx = { ...base(), openType: 'per', ciftArea, canAttach: attachOk };
      const post = afterOpen(rest, ctx);
      options.push({ path: 'seri', open: groups.map(x => x.map(t => t.id)), openScore: score, post });
    } else options.push({ path: 'seri', infeasible: true, potential });
  }
  // çift yolu
  {
    const prs = Bot.findPairs(vts, V);
    const maxPairs = Math.floor((hand.length - 1) / 2);
    if (prs.length >= bar.cift && maxPairs >= bar.cift) {
      const take = prs.slice(0, maxPairs).map(p => p.map(t => byId.get(t.id)));
      const openIds = new Set(take.flat().map(t => t.id));
      const rest = hand.filter(t => !openIds.has(t.id));
      const ctx = { ...base(), openType: 'cift', ciftArea: true, canAttach: attachOk };
      const post = afterOpen(rest, ctx);
      options.push({ path: 'cift', open: take.map(x => x.map(t => t.id)), pairCount: take.length, post });
    } else options.push({ path: 'cift', infeasible: true, potential: { pairs: prs.length } });
  }

  const feasible = options.filter(o => !o.infeasible);
  if (!feasible.length) {
    return { phase: 'closed', path: null, open: [], lay: [], pairs: [], swaps: [], attach: [], rest: hand.map(t => t.id), discard: null, toGo: null, canFinish: false,
      potential: { score: options[0].potential.score, pairs: options[1].potential.pairs }, barrier: bar };
  }
  // Çift açmak puanı ikiye katlar: eşit uzaklıkta seri tercih edilir
  feasible.sort((a, b) => (a.post.rest.length - b.post.rest.length) || (a.path === 'seri' ? -1 : 1));
  const best = feasible[0];
  const plan = {
    phase: 'closed', path: best.path, open: best.open, openScore: best.openScore, pairCount: best.pairCount,
    lay: best.post.lay, pairs: best.post.pairs, swaps: best.post.swaps, attach: best.post.attach, rest: best.post.rest, discard: best.post.discard,
    alternatives: feasible.slice(1).map(o => ({ path: o.path, toGo: Math.max(0, o.post.rest.length - 1) })),
  };
  return finish(plan, {});
}

module.exports = { finishPlan, afterOpen };
