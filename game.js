const R = require('./public/rules.js');

function makeDeck() {
  const tiles = [];
  let id = 0;
  for (let k = 0; k < 2; k++)
    for (let c = 0; c < 4; c++)
      for (let v = 1; v <= 13; v++) tiles.push({ id: id++, c, v, fake: false });
  tiles.push({ id: id++, c: -1, v: 0, fake: true }, { id: id++, c: -1, v: 0, fake: true });
  return tiles; // 106 taş
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

class Game {
  // info: odadaki koltuk bilgileri (isim, bot mu, bağlı mı) — referans olarak tutulur
  constructor(info, opts) {
    this.info = info;
    // mode: 'tekli' | 'esli'; katlamali: açış barajı yükselir; waitAttach: açtığı turda işleme yok
    this.opts = Object.assign({ hands: 5, openScore: 101, mode: 'tekli', katlamali: false, waitAttach: false }, opts);
    this.esli = this.opts.mode === 'esli';
    this.history = [];
    this.totals = [0, 0, 0, 0];
    this.handNo = 0;
    this.handIndex = 0;
    this.turnCount = 0;
    this.over = false;
    this.log = [];
    this.meldSeq = 1;
  }

  addLog(s) {
    this.log.push(s);
    if (this.log.length > 40) this.log.shift();
  }

  name(i) { return this.info[i].name; }

  startHand() {
    const deck = shuffle(makeDeck());
    const idx = deck.findIndex(t => !t.fake);
    this.indicator = deck.splice(idx, 1)[0];
    this.okey = R.okeyOf(this.indicator);
    this.starter = this.handNo % 4;
    this.seats = [0, 1, 2, 3].map(() => ({ hand: [], opened: false, openType: null, openedAt: -1, openScore: 0, openPairs: 0, penalty: 0, discards: [] }));
    for (let i = 0; i < 4; i++) {
      const n = i === this.starter ? 22 : 21;
      this.seats[i].hand = deck.splice(0, n);
    }
    this.pile = deck;
    this.melds = [];
    this.turn = this.starter;
    this.phase = 'play'; // başlayan oyuncu 22 taşla başlar, çekmeden atar
    this.mustOpenWith = null;
    this.undoUsed = false;
    this.takenJoker = null;   // bu tur masadan alınan okey (aynı tur kullanılmalı)
    this.sideCount = {};      // bu tur her pere hangi yandan kaç taş işlendi
    this.result = null;
    this.handIndex = this.handNo + 1;
    this.turnCount++;
    this.addLog(`${this.handIndex}. el başladı. Gösterge ${R.tileName(this.indicator)}, ${this.name(this.starter)} başlıyor.`);
  }

  _check(seat, phase) {
    if (this.phase === 'ended') return 'El bitti';
    if (this.turn !== seat) return 'Sıra sende değil';
    if (phase === 'draw' && this.phase !== 'draw') return 'Bu tur zaten taş çektin';
    if (phase === 'play' && this.phase !== 'play') return 'Önce taş çek';
    return null;
  }

  _pick(me, ids) {
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length) return null;
    const ts = ids.map(id => me.hand.find(t => t.id === id));
    return ts.every(Boolean) ? ts : null;
  }

  _remove(me, ids) {
    me.hand = me.hand.filter(t => !ids.includes(t.id));
  }

  _nextTurn(seat) {
    this.turn = (seat + 1) % 4;
    this.phase = 'draw';
    this.undoUsed = false;
    this.mustOpenWith = null;
    this.takenJoker = null;
    this.sideCount = {};
    this.turnCount++;
  }

  drawPile(seat) {
    const e = this._check(seat, 'draw');
    if (e) return { err: e };
    if (!this.pile.length) return { err: 'Yığında taş kalmadı' };
    this.seats[seat].hand.push(this.pile.pop());
    this.phase = 'play';
    return { ok: true };
  }

  // Soldaki oyuncunun (bir önceki sıradaki) attığı taşı al
  drawDiscard(seat) {
    const e = this._check(seat, 'draw');
    if (e) return { err: e };
    if (this.undoUsed) return { err: 'Geri verdiğin taşı bu tur tekrar alamazsın' };
    const prev = this.seats[(seat + 3) % 4];
    const t = prev.discards.pop();
    if (!t) return { err: 'Alınacak taş yok' };
    const me = this.seats[seat];
    me.hand.push(t);
    this.phase = 'play';
    if (!me.opened) this.mustOpenWith = t.id;
    this.addLog(`${this.name(seat)} yerden ${R.tileName(t)} aldı`);
    return { ok: true };
  }

  // Açamayacağını anlayan oyuncu yerden aldığı taşı geri verir
  undoTake(seat) {
    const e = this._check(seat, 'play');
    if (e) return { err: e };
    if (this.mustOpenWith == null) return { err: 'Geri verilecek taş yok' };
    const me = this.seats[seat];
    const i = me.hand.findIndex(t => t.id === this.mustOpenWith);
    if (i < 0) return { err: 'Taş elinde değil' };
    const t = me.hand.splice(i, 1)[0];
    this.seats[(seat + 3) % 4].discards.push(t);
    this.mustOpenWith = null;
    this.undoUsed = true;
    this.phase = 'draw';
    me.penalty += 101;
    this.addLog(`${this.name(seat)} yandan aldığı taşla açamadı, taşı geri koydu: 101 ceza`);
    return { ok: true };
  }

  // Eşli oyunda karşıdaki oyuncu eştir (0-2, 1-3)
  sameTeam(a, b) { return this.esli && a % 2 === b % 2; }

  // Açış barajı. Katlamalıda rakiplerin en yüksek açışının bir fazlası (eşin açışı barajı yükseltmez)
  barrier(seat) {
    let per = this.opts.openScore, cift = 5;
    if (!this.opts.katlamali) return { per, cift };
    this.seats.forEach((s, i) => {
      if (!s.opened || i === seat || this.sameTeam(i, seat)) return;
      if (s.openType === 'per') per = Math.max(per, s.openScore + 1);
      else cift = Math.max(cift, s.openPairs + 1);
    });
    return { per, cift };
  }

  open(seat, groups) {
    const e = this._check(seat, 'play');
    if (e) return { err: e };
    const me = this.seats[seat];
    if (me.opened) return { err: 'Elini zaten açtın' };
    if (!Array.isArray(groups) || !groups.length || !groups.every(Array.isArray)) return { err: 'Açılacak grup yok' };
    const all = groups.flat();
    if (!this._pick(me, all)) return { err: 'Geçersiz taş seçimi' };
    if (me.hand.length - all.length < 1) return { err: 'Atmak için elinde en az bir taş kalmalı' };
    const byId = id => me.hand.find(t => t.id === id);
    const gTiles = groups.map(g => g.map(byId));
    const isPairs = gTiles.every(g => g.length === 2);
    let analyzed;
    if (isPairs) {
      const need = this.barrier(seat).cift;
      if (gTiles.length < need) return { err: `Çiftle açmak için en az ${need} çift gerekir` };
      if (!gTiles.every(g => R.analyzePair(g, this.okey))) return { err: 'Geçersiz bir çift var' };
      analyzed = gTiles.map(g => ({ type: 'pair', order: g }));
    } else {
      analyzed = gTiles.map(g => R.makeMeld(g, this.okey));
      const bad = analyzed.findIndex(a => !a);
      if (bad >= 0) return { err: `${bad + 1}. grup geçerli bir per değil` };
      const sc = analyzed.reduce((s, a) => s + a.score, 0);
      const need = this.barrier(seat).per;
      if (sc < need) return { err: `Toplam ${sc} puan; açmak için en az ${need} gerekir` };
    }
    if (this.mustOpenWith != null && !all.includes(this.mustOpenWith)) {
      return { err: 'Yerden aldığın taşı açışta kullanmalısın' };
    }
    this._remove(me, all);
    analyzed.forEach(a => this._pushMeld(seat, a));
    me.opened = true;
    me.openType = isPairs ? 'cift' : 'per';
    me.openedAt = this.turnCount;
    if (isPairs) me.openPairs = gTiles.length;
    else me.openScore = analyzed.reduce((s, a) => s + a.score, 0);
    this.mustOpenWith = null;
    const sc = isPairs ? `${gTiles.length} çift` : `${analyzed.reduce((s, a) => s + a.score, 0)} puan`;
    this.addLog(`${this.name(seat)} ${isPairs ? 'çift' : 'seri'} açtı (${sc})`);
    if (this.seats.every(x => x.openType === 'cift')) this._voidHand();
    return { ok: true };
  }

  _pushMeld(owner, a) {
    const m = { id: this.meldSeq++, owner, type: a.type, tiles: a.order };
    if (a.type === 'run') { m.start = a.start; m.color = a.color; }
    this.melds.push(m);
  }

  layMeld(seat, ids) {
    const e = this._check(seat, 'play');
    if (e) return { err: e };
    const me = this.seats[seat];
    if (!me.opened) return { err: 'Önce elini açmalısın' };
    const tiles = this._pick(me, ids);
    if (!tiles) return { err: 'Geçersiz taş seçimi' };
    if (me.hand.length - tiles.length < 1) return { err: 'Atmak için elinde en az bir taş kalmalı' };
    if (tiles.length === 2) {
      // Çift alanına çift: çift açtıysan ya da masada çift açan biri varsa
      if (!R.analyzePair(tiles, this.okey)) return { err: 'Bu iki taş çift değil' };
      if (me.openType !== 'cift' && !this.seats.some(x => x.openType === 'cift')) return { err: 'Masada çift açan olmadığı için çift indiremezsin' };
      this._pushMeld(seat, { type: 'pair', order: tiles });
    } else {
      if (me.openType === 'cift') return { err: 'Çift açtığın için yeni seri açamazsın, sadece işleyebilirsin' };
      const a = R.makeMeld(tiles, this.okey);
      if (!a) return { err: 'Bu grup geçerli bir per değil' };
      this._pushMeld(seat, a);
    }
    this._remove(me, ids);
    return { ok: true };
  }

  addToMeld(seat, tileId, meldId) {
    const e = this._check(seat, 'play');
    if (e) return { err: e };
    const me = this.seats[seat];
    if (!me.opened) return { err: 'İşlemek için önce elini açmalısın' };
    const meld = this.melds.find(m => m.id === meldId);
    if (!meld) return { err: 'Per bulunamadı' };
    if (meld.type === 'pair') return { err: 'Çiftlere taş işlenemez' };
    if (this.opts.waitAttach && me.openedAt === this.turnCount) return { err: 'Elini açtığın turda işleme yapamazsın, bir tur beklemelisin' };
    const tiles = this._pick(me, [tileId]);
    if (!tiles) return { err: 'Geçersiz taş' };
    const t = tiles[0];
    const info = R.attachInfo(meld, t, this.okey);
    if (!info) return { err: 'Bu taş o pere uymuyor' };

    if (info.kind === 'swap') {
      // Yerdeki okeyi al, yerine gerçek taşı koy
      const joker = meld.tiles[info.index];
      meld.tiles = meld.tiles.slice();
      meld.tiles[info.index] = t;
      this._remove(me, [tileId]);
      me.hand.push(joker);
      this.takenJoker = joker.id;
      this.addLog(`${this.name(seat)} yerdeki okeyi aldı (${R.tileName(t)} koydu)`);
      // Okeyi yere bağlayana 101 ceza (kendisi ya da eşli oyunda eşi aldıysa ceza yok)
      const owner = meld.owner;
      if (owner !== seat && !this.sameTeam(owner, seat)) {
        this.seats[owner].penalty += 101;
        this.addLog(`${this.name(owner)} okeyini kaptırdı: 101 ceza`);
      }
      return { ok: true, swapped: true };
    }

    if (me.hand.length < 2) return { err: 'Atmak için elinde en az bir taş kalmalı' };
    const cnt = this.sideCount[meld.id] || (this.sideCount[meld.id] = { left: 0, right: 0 });
    if (meld.type === 'run' && cnt[info.side] >= 2) {
      return { err: 'Bir pere aynı turda bir yandan en fazla 2 taş işleyebilirsin' };
    }
    cnt[info.side]++;
    meld.tiles = info.order;
    if (info.start != null) meld.start = info.start;
    this._remove(me, [tileId]);
    if (this.takenJoker === tileId) this.takenJoker = null;
    this.addLog(`${this.name(seat)} ${R.tileName(t)} işledi`);
    return { ok: true };
  }

  discard(seat, tileId) {
    const e = this._check(seat, 'play');
    if (e) return { err: e };
    if (this.mustOpenWith != null) return { err: 'Yerden aldığın taşla açmalı ya da taşı geri vermelisin' };
    const me = this.seats[seat];
    const tiles = this._pick(me, [tileId]);
    if (!tiles) return { err: 'Geçersiz taş' };
    const t = tiles[0];
    const joker = R.isJoker(t, this.okey);
    this._remove(me, [tileId]);
    me.discards.push(t);
    const finished = me.hand.length === 0;
    this.addLog(`${this.name(seat)} ${R.tileName(t)} attı`);
    if (!finished) {
      if (this.takenJoker != null && me.hand.some(x => x.id === this.takenJoker)) {
        me.penalty += 101;
        this.addLog(`${this.name(seat)} yerden aldığı okeyi kullanmadı: 101 ceza`);
      }
      if (joker) {
        me.penalty += 101;
        this.addLog(`${this.name(seat)} okey attı: 101 ceza`);
      } else if (this.melds.some(m => R.canAttach(m, t, this.okey))) {
        me.penalty += 101;
        this.addLog(`${this.name(seat)} işlek taş attı: 101 ceza`);
      }
    }
    if (finished) {
      this._endHand(seat, joker);
      return { ok: true };
    }
    if (!this.pile.length) {
      this._endHand(null, false);
      return { ok: true };
    }
    this._nextTurn(seat);
    return { ok: true };
  }

  // Puanlama: bitiren -101; açmayan 202; açan elindeki taş toplamı (çift açan x2),
  // elde kalan her okey +101. Okeyle, çiftten ya da elden (açtığı turda) bitirmek puanları ikiye katlar.
  _endHand(winner, okeyFinish) {
    let mult = 1;
    const how = [];
    if (winner != null) {
      const w = this.seats[winner];
      if (okeyFinish) { mult *= 2; how.push('okey atarak'); }
      if (w.openType === 'cift') { mult *= 2; how.push('çiftten'); }
      // Elden bitme: kimse açmamışken bütün taşlarını tek seferde açıp bitirmek
      const othersOpened = this.seats.some((x, i) => i !== winner && x.opened);
      if (w.openedAt === this.turnCount && !othersOpened) { mult *= 2; how.push('elden'); }
    }
    const scores = this.seats.map((s, i) => {
      if (i === winner) return -101 * mult + s.penalty;
      if (winner != null && this.sameTeam(i, winner)) return s.penalty; // eşi bitince cezası silinir
      if (!s.opened) return 202 * mult + s.penalty;
      let sum = 0, jokers = 0;
      s.hand.forEach(t => (R.isJoker(t, this.okey) ? jokers++ : (sum += R.eff(t, this.okey).v)));
      let p = sum * mult;
      if (s.openType === 'cift') p *= 2;
      return p + jokers * 101 + s.penalty;
    });
    scores.forEach((p, i) => (this.totals[i] += p));
    this.history.push({ hand: this.handIndex, scores: scores.slice(), mult });
    this.handNo++;
    this.phase = 'ended';
    this.turnCount++;
    this.result = {
      winner,
      okeyFinish,
      mult,
      scores,
      reason: winner == null
        ? 'Yığındaki taşlar bitti'
        : `${this.name(winner)} eli bitirdi${how.length ? ' (' + how.join(', ') + ', puanlar x' + mult + ')' : ''}`,
      hands: this.seats.map(s => s.hand),
    };
    if (this.handNo >= this.opts.hands) this.over = true;
    if (this.over) this.result.final = this.standings();
    this.addLog(this.result.reason);
  }

  // Dört oyuncu da çift açarsa el iptal edilir, kimseye puan yazılmaz ve el yeniden dağıtılır
  _voidHand() {
    this.phase = 'ended';
    this.turnCount++;
    this.result = {
      winner: null, okeyFinish: false, mult: 1, void: true,
      scores: [0, 0, 0, 0],
      reason: 'Dört oyuncu da çift açtı, el iptal edildi',
      hands: this.seats.map(s => s.hand),
    };
    this.addLog(this.result.reason);
  }

  // Sıralama: tekli oyuncu, eşli takım toplamına göre (düşük puan kazanır)
  standings() {
    if (this.esli) {
      const t = [this.totals[0] + this.totals[2], this.totals[1] + this.totals[3]];
      return { teams: t, winners: t[0] === t[1] ? [0, 1, 2, 3] : t[0] < t[1] ? [0, 2] : [1, 3] };
    }
    const min = Math.min(...this.totals);
    return { winners: [0, 1, 2, 3].filter(i => this.totals[i] === min) };
  }

  view(seat) {
    return {
      you: seat,
      handIndex: this.handIndex,
      hands: this.opts.hands,
      openScore: this.opts.openScore,
      hand: this.seats[seat].hand,
      players: this.seats.map((s, i) => ({
        name: this.info[i].name,
        bot: this.info[i].isBot,
        connected: this.info[i].connected,
        count: s.hand.length,
        opened: s.opened,
        openType: s.openType,
        penalty: s.penalty,
        openScore: s.openScore,
        openPairs: s.openPairs,
        discardTop: s.discards[s.discards.length - 1] || null,
        discards: s.discards,
        total: this.totals[i],
      })),
      indicator: this.indicator,
      okey: this.okey,
      pile: this.pile.length,
      melds: this.melds,
      turn: this.turn,
      phase: this.phase,
      mustOpenWith: this.turn === seat ? this.mustOpenWith : null,
      takenJoker: this.turn === seat ? this.takenJoker : null,
      barrier: this.barrier(seat),
      opts: this.opts,
      history: this.history,
      undoUsed: this.undoUsed,
      log: this.log.slice(-14),
      result: this.result,
      over: this.over,
    };
  }
}

module.exports = { Game };
