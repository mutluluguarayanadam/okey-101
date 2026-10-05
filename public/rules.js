// 101 Okey kuralları — hem sunucu (Node) hem tarayıcı kullanır.
(function (root) {
  const COLOR_NAMES = ['Kırmızı', 'Sarı', 'Mavi', 'Siyah'];

  // Göstergenin bir üstü okeydir (gösterge 13 ise okey 1). Bu dönüş SADECE okey belirlemede geçerlidir.
  function okeyOf(ind) {
    return { c: ind.c, v: ind.v === 13 ? 1 : ind.v + 1 };
  }

  function isJoker(t, okey) {
    return !t.fake && t.c === okey.c && t.v === okey.v;
  }

  // Taşın oyundaki karşılığı: sahte okey = okeyin kendisi, gerçek okey = joker
  function eff(t, okey) {
    if (t.fake) return { c: okey.c, v: okey.v, joker: false };
    if (isJoker(t, okey)) return { joker: true };
    return { c: t.c, v: t.v, joker: false };
  }

  function tileName(t) {
    if (t.fake) return 'Sahte Okey';
    return COLOR_NAMES[t.c] + ' ' + t.v;
  }

  // Elde kalan taşın ceza değeri (okey elde kalırsa 101)
  function tilePoints(t, okey) {
    if (isJoker(t, okey)) return 101;
    return eff(t, okey).v;
  }

  const sumRange = (s, n) => n * (2 * s + n - 1) / 2;

  // Taşlar verilen sırayla bir seri oluşturuyor mu? (okeyler bulundukları yerin değerini alır)
  // Seriler 1..13 arasıdır: 12-13-1 ve 13-1-2 GEÇERSİZ.
  function runFromOrder(tiles, okey) {
    const n = tiles.length;
    if (n < 3 || n > 13) return null;
    let c = null, s = null;
    for (let i = 0; i < n; i++) {
      const e = eff(tiles[i], okey);
      if (e.joker) continue;
      if (c === null) { c = e.c; s = e.v - i; }
      else if (e.c !== c || e.v !== s + i) return null;
    }
    if (c === null || s < 1 || s + n - 1 > 13) return null;
    return { type: 'run', score: sumRange(s, n), order: tiles.slice(), start: s, color: c };
  }

  // Sıradan bağımsız en iyi değerlendirme (botlar ve öneriler için)
  function analyzeMeld(tiles, okey) {
    const n = tiles.length;
    if (n < 3 || n > 13) return null;
    const items = tiles.map(t => ({ t, e: eff(t, okey) }));
    const real = items.filter(x => !x.e.joker);
    const jok = items.filter(x => x.e.joker).map(x => x.t);
    if (!real.length) return null;
    let best = null;

    if (n <= 4) {
      const v = real[0].e.v;
      const sameV = real.every(x => x.e.v === v);
      const distinctC = new Set(real.map(x => x.e.c)).size === real.length;
      if (sameV && distinctC) best = { type: 'set', score: v * n, value: v, order: real.map(x => x.t).concat(jok) };
    }

    const c = real[0].e.c;
    if (real.every(x => x.e.c === c)) {
      const vals = real.map(x => x.e.v);
      if (new Set(vals).size === vals.length) {
        const mn = Math.min(...vals), mx = Math.max(...vals);
        const sMin = Math.max(1, mx - n + 1), sMax = Math.min(mn, 14 - n);
        for (let s = sMax; s >= sMin; s--) {
          const jq = jok.slice();
          const order = [];
          for (let p = s; p < s + n; p++) {
            const i = vals.indexOf(p);
            order.push(i >= 0 ? real[i].t : jq.shift());
          }
          const score = sumRange(s, n);
          if (!best || score > best.score) best = { type: 'run', score, order, start: s, color: c };
          break; // en yüksek başlangıç en yüksek puandır
        }
      }
    }
    return best;
  }

  // Oyuncunun dizdiği sıraya saygı göstererek per oluşturur (soldan sağa ya da sağdan sola seri)
  function makeMeld(tiles, okey) {
    const a = analyzeMeld(tiles, okey);
    if (!a) return null;
    if (a.type === 'set') return a;
    return runFromOrder(tiles, okey) || runFromOrder(tiles.slice().reverse(), okey) || a;
  }

  // Çift: iki aynı taş ya da bir taş + okey
  function analyzePair(tiles, okey) {
    if (tiles.length !== 2) return false;
    const a = eff(tiles[0], okey), b = eff(tiles[1], okey);
    if (a.joker || b.joker) return true;
    return a.c === b.c && a.v === b.v;
  }

  // Masadaki perde bu taşla değiştirilip alınabilecek okeyin sırası; yoksa -1.
  // Aynı sayı perindeki okey ancak per 4 taşlıysa (eksik renk belliyse) alınabilir.
  function jokerSwapIndex(meld, t, okey) {
    if (meld.type === 'pair' || isJoker(t, okey)) return -1;
    const e = eff(t, okey);
    for (let i = 0; i < meld.tiles.length; i++) {
      if (!isJoker(meld.tiles[i], okey)) continue;
      let rep;
      if (meld.type === 'run') rep = { c: meld.color, v: meld.start + i };
      else {
        if (meld.tiles.length < 4) continue;
        const reals = meld.tiles.filter(y => !isJoker(y, okey)).map(y => eff(y, okey));
        const missing = [0, 1, 2, 3].filter(k => !reals.some(r => r.c === k));
        if (missing.length !== 1) continue;
        rep = { c: missing[0], v: reals[0].v };
      }
      if (e.c === rep.c && e.v === rep.v) return i;
    }
    return -1;
  }

  // Taş masadaki pere nasıl işlenir: okey alma (swap) ya da sağa/sola ekleme (add). Uymuyorsa null.
  function attachInfo(meld, t, okey) {
    if (meld.type === 'pair') return null;
    const si = jokerSwapIndex(meld, t, okey);
    if (si >= 0) return { kind: 'swap', index: si };
    if (meld.type === 'run') {
      const n = meld.tiles.length, s = meld.start;
      if (n >= 13) return null;
      if (isJoker(t, okey)) {
        if (s + n <= 13) return { kind: 'add', side: 'right', order: meld.tiles.concat([t]), start: s };
        if (s > 1) return { kind: 'add', side: 'left', order: [t].concat(meld.tiles), start: s - 1 };
        return null;
      }
      const e = eff(t, okey);
      if (e.c !== meld.color) return null;
      if (e.v === s - 1) return { kind: 'add', side: 'left', order: [t].concat(meld.tiles), start: s - 1 };
      if (e.v === s + n) return { kind: 'add', side: 'right', order: meld.tiles.concat([t]), start: s };
      return null;
    }
    const a = analyzeMeld(meld.tiles.concat([t]), okey);
    if (!a || a.type !== 'set') return null;
    return { kind: 'add', side: 'right', order: a.order };
  }

  // Bir taşın bir pere işlenebileceği TÜM yollar: okeyi alma, başa ekleme, sona ekleme.
  // Birden fazla seçenek varsa oyuncuya sorulur; uygulama kendi kendine seçmez.
  function attachOptions(meld, t, okey) {
    if (meld.type === 'pair') return [];
    const out = [];
    const si = jokerSwapIndex(meld, t, okey);
    if (si >= 0) out.push({ kind: 'swap', index: si });
    if (meld.type === 'run') {
      const n = meld.tiles.length, s = meld.start;
      if (n < 13) {
        if (isJoker(t, okey)) {
          if (s > 1) out.push({ kind: 'add', side: 'left', order: [t].concat(meld.tiles), start: s - 1 });
          if (s + n <= 13) out.push({ kind: 'add', side: 'right', order: meld.tiles.concat([t]), start: s });
        } else {
          const e = eff(t, okey);
          if (e.c === meld.color && e.v === s - 1) out.push({ kind: 'add', side: 'left', order: [t].concat(meld.tiles), start: s - 1 });
          if (e.c === meld.color && e.v === s + n) out.push({ kind: 'add', side: 'right', order: meld.tiles.concat([t]), start: s });
        }
      }
    } else {
      const a = analyzeMeld(meld.tiles.concat([t]), okey);
      if (a && a.type === 'set') out.push({ kind: 'add', side: 'right', order: a.order });
    }
    return out;
  }

  function canAttach(meld, t, okey) {
    return !!attachInfo(meld, t, okey);
  }

  const api = { COLOR_NAMES, okeyOf, isJoker, eff, tileName, tilePoints, runFromOrder, analyzeMeld, makeMeld, analyzePair, jokerSwapIndex, attachInfo, attachOptions, canAttach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rules = api;
})(this);
