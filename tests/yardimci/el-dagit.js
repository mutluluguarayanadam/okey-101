// Test yardımcısı (üretim koduna dokunmaz): `node -r tests/yardimci/el-dagit.js server.js` ile yüklenir.
// HAND_FILE (JSON) dosyasından koltuk 0'ın elini ve (isteğe bağlı) koltuk 3'ün ilk attığı taşı belirler.
// Dosya: { id, hand: ["c:v", ..., "J" (okey), "F" (sahte okey)], side: "c:v" | null, preCift: bool }
// Okey her zaman siyah 13 (gösterge siyah 12).
const fs = require('fs');
const { Game } = require('../../game.js');
const R = require('../../public/rules.js');
let lastId = null, pending = null;
const orig = Game.prototype.startHand;
Game.prototype.startHand = function () {
  orig.call(this);
  const f = process.env.HAND_FILE;
  if (!f || !fs.existsSync(f)) return;
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  if (cfg.id === lastId) return;
  lastId = cfg.id;
  const all = [];
  this.seats.forEach(s => s.hand.forEach(t => all.push(t)));
  this.pile.forEach(t => all.push(t));
  all.push(this.indicator); // asıl gösterge de desteye geri konur (106 taş), yeni gösterge siyah 12 olur
  this.okey = { c: 3, v: 13 };
  const used = new Set(), mine = [];
  for (const w of cfg.hand) {
    let t;
    if (w === 'F') t = all.find(x => x.fake && !used.has(x.id));
    else if (w === 'J') t = all.find(x => !x.fake && x.c === 3 && x.v === 13 && !used.has(x.id));
    else { const [c, v] = w.split(':').map(Number); t = all.find(x => !x.fake && x.c === c && x.v === v && !R.isJoker(x, this.okey) && !used.has(x.id)); }
    if (!t) throw new Error('el-dagit: taş bulunamadı ' + w);
    used.add(t.id); mine.push(t);
  }
  // gösterge: siyah 12 (elde en çok bir kopyası kullanılabilir)
  const ind = all.find(x => !x.fake && x.c === 3 && x.v === 12 && !used.has(x.id));
  if (!ind) throw new Error('el-dagit: gösterge için siyah 12 kalmadı');
  used.add(ind.id);
  this.indicator = ind;
  const rest = all.filter(x => !used.has(x.id));
  const need = this.seats[0].hand.length;
  while (mine.length < need) mine.push(rest.pop());
  this.seats[0].hand = mine.slice(0, need);
  for (let i = 1; i < 4; i++) this.seats[i].hand = rest.splice(0, this.seats[i].hand.length);
  this.pile = rest;
  pending = cfg.side || null;
};
const od = Game.prototype.discard;
Game.prototype.discard = function (seat, id) {
  const r = od.call(this, seat, id);
  if (r.ok && seat === 3 && pending && this.phase !== 'ended') {
    const [c, v] = pending.split(':').map(Number);
    const want = x => !x.fake && x.c === c && x.v === v && !R.isJoker(x, this.okey);
    let arr = this.pile, i = arr.findIndex(want);
    for (const s of [1, 2, 3]) if (i < 0) { arr = this.seats[s].hand; i = arr.findIndex(want); }
    if (i >= 0) { pending = null; const out = this.seats[3].discards.pop(); this.seats[3].discards.push(arr[i]); arr[i] = out; }
  }
  return r;
};
