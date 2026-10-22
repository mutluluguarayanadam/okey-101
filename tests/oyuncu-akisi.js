// Oyuncu akışı denetimi: yapısı bilinen (çok per, çiftler, okeyli, hepsi perde, rastgele) eller üretir, gerçek tarayıcıda
// aç / indir / işle / at adımlarını yürütür. Beklenen sonuç bağımsız bir hesaptan bilinir; arayüz uyuşmazsa HATA yazar.
// Çalıştırma: node tests/oyuncu-akisi.js   (N=60 senaryo sayısı, SEED=1 tohum, VP=852x276 ekran boyutu, ONLY=23 yalnızca o senaryo)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch {
    console.error('playwright bulunamadı. Önce: npm i --no-save playwright && npx playwright install chromium'); process.exit(2);
  }
}
const R = require('../public/rules.js');
const Bot = require('../bot.js');

const N = +(process.env.N || 60);
const SEED = +(process.env.SEED || 1);
const [VW, VH] = (process.env.VP || '852x276').split('x').map(Number);
const OKEY = { c: 3, v: 13 };
const HAND_FILE = path.join(os.tmpdir(), `okey-el-${process.pid}.json`);

// ---------- Tohumlu rastgele sayı ----------
let st = SEED >>> 0;
const rnd = () => { st = (st + 0x6D2B79F5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = a => a[Math.floor(rnd() * a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// ---------- El üretici ----------
// Taş kopya sayıları: her (renk, sayı) 2 adet; (siyah 13) okeydir ('J' x2); sahte okey 'F' x2
function newPool() {
  const cnt = {};
  for (let c = 0; c < 4; c++) for (let v = 1; v <= 13; v++) if (!(c === OKEY.c && v === OKEY.v)) cnt[c + ':' + v] = 2;
  cnt['3:12'] = 1; // diğer kopya gösterge olur
  cnt.J = 2; cnt.F = 2;
  return cnt;
}
const take = (pool, spec) => { if (!pool[spec]) return false; pool[spec]--; return true; };

function genMeld(pool, allowJoker) {
  for (let tries = 0; tries < 30; tries++) {
    if (rnd() < 0.62) { // seri 3-5
      const len = ri(3, 5), c = ri(0, 3), s = ri(1, 14 - len), specs = [];
      for (let v = s; v < s + len; v++) specs.push(c + ':' + v);
      if (allowJoker && rnd() < 0.25) specs[ri(0, len - 1)] = pick(['J', 'F']);
      // okey taşının (siyah 13) kendi yerine sahte okey konur
      const fixed = specs.map(x => (x === '3:13' ? 'F' : x));
      const t = { ...pool }, ok = fixed.every(x => (t[x] ? (t[x]--, true) : false));
      if (ok) { fixed.forEach(x => pool[x]--); return { type: 'run', specs: fixed }; }
    } else { // grup 3-4
      const v = ri(1, 13), size = ri(3, 4), cols = shuffle([0, 1, 2, 3]).slice(0, size);
      let specs = cols.map(c => c + ':' + v);
      specs = specs.map(x => (x === '3:13' ? 'F' : x));
      if (allowJoker && rnd() < 0.25) specs[ri(0, size - 1)] = pick(['J', 'F']);
      const t = { ...pool }, ok = specs.every(x => (t[x] ? (t[x]--, true) : false));
      if (ok) { specs.forEach(x => pool[x]--); return { type: 'set', specs }; }
    }
  }
  return null;
}
function genPair(pool, allowJoker) {
  for (let tries = 0; tries < 30; tries++) {
    const c = ri(0, 3), v = ri(1, 13);
    if (c === OKEY.c && v === OKEY.v) continue;
    const a = c + ':' + v;
    const b = allowJoker && rnd() < 0.2 ? pick(['J', 'F']) : a;
    const t = { ...pool };
    if ((t[a] ? (t[a]--, true) : false) && (t[b] ? (t[b]--, true) : false)) { pool[a]--; pool[b]--; return [a, b]; }
  }
  return null;
}
function junk(pool, n) {
  const out = [];
  const keys = () => Object.keys(pool).filter(k => pool[k] > 0 && k !== 'J' && k !== 'F');
  while (out.length < n && keys().length) { const k = pick(keys()); pool[k]--; out.push(k); }
  return out;
}

const KINDS = ['cokper', 'hepsiperde', 'ciftler', 'karma', 'rastgele', 'okeyli', 'dusuk'];
function genScenario(i) {
  const kind = KINDS[i % KINDS.length];
  const pool = newPool(), melds = [], pairs = [], rest = [];
  const hand = [];
  if (kind === 'cokper' || kind === 'hepsiperde' || kind === 'okeyli' || kind === 'karma') {
    let target = kind === 'hepsiperde' ? 22 : ri(12, 21);
    if (kind === 'hepsiperde') {
      // 22 taşı tam bölen perler: 3-5'lik parçalar
      for (let tries = 0; tries < 200 && hand.length !== 22; tries++) {
        const p2 = newPool(), ms = [], hh = [];
        while (hh.length < 22) { const m = genMeld(p2, false); if (!m) break; if (hh.length + m.specs.length > 22) continue; ms.push(m); hh.push(...m.specs); if (hh.length === 21 || hh.length > 22) break; }
        if (hh.length === 22) { melds.push(...ms); hand.push(...hh); Object.assign(pool, p2); }
      }
      if (hand.length !== 22) return genScenario(i + KINDS.length);
    } else {
      while (hand.length < target) { const m = genMeld(pool, kind === 'okeyli'); if (!m) break; if (hand.length + m.specs.length > 22) continue; melds.push(m); hand.push(...m.specs); }
    }
  }
  if (kind === 'ciftler' || kind === 'karma') {
    const want = kind === 'ciftler' ? ri(3, 11) : ri(1, 4);
    for (let k = 0; k < want && hand.length + 2 <= 22; k++) { const p = genPair(pool, kind === 'ciftler'); if (!p) break; pairs.push(p); hand.push(...p); }
  }
  if (kind === 'dusuk') { /* yalnızca dağınık taşlar: açılamaz */ }
  if (hand.length < 22) { const j = junk(pool, 22 - hand.length); rest.push(...j); hand.push(...j); }
  return { id: `${SEED}-${i}`, kind, hand: shuffle(hand.slice()), melds, pairs, size: hand.length };
}

// ---------- Bağımsız beklenti ----------
const idc = (() => { let n = 100; return () => n++; })();
function toTile(spec) {
  if (spec === 'J') return { id: idc(), c: OKEY.c, v: OKEY.v, fake: false };
  if (spec === 'F') return { id: idc(), c: -1, v: 0, fake: true };
  const [c, v] = spec.split(':').map(Number);
  return { id: idc(), c, v, fake: false };
}
function expectation(sc) {
  const hand = sc.hand.map(toTile);
  // alt sınır: üretilen perlerden (en az 1 taş kalacak şekilde) elde edilen puan
  const groups = sc.melds.map(m => m.specs.map(toTile));
  const fit = R.fitGroups(groups, 22, OKEY, 101);
  const lower = fit.reduce((a, g) => a + (R.analyzeMeld(g, OKEY) || { score: 0 }).score, 0);
  const lowerUsable = fit.length > 0 && fit.flat().length < 22;
  const lowerPairs = sc.pairs.length;
  // üst sınır: elde (atmak için bir taş kalma şartı olmadan) kurulabilecek en iyi puan ve çift sayısı
  const upper = Bot.solve(hand, OKEY, 600000, 'score').score;
  const upperPairs = Bot.findPairs(hand, OKEY).length;
  return { lowerSeri: lowerUsable ? lower : 0, lowerPairs, upper, upperPairs };
}

// ---------- Sunucu ve tarayıcı ----------
async function startServer() {
  const PORT = 6000 + Math.floor(Math.random() * 2000);
  const srv = spawn(process.execPath, ['-r', path.join(__dirname, 'yardimci', 'el-dagit.js'), path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, HAND_FILE, BOT_MS: '150' }, stdio: 'pipe' });
  let err = '';
  srv.stderr.on('data', d => (err += d));
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('sunucu açılmadı')), 10000); srv.stdout.on('data', d => { if (String(d).includes('http://localhost')) { clearTimeout(t); res(); } }); });
  return { srv, PORT, getErr: () => err };
}

const results = [];
const problems = [];
function report(sc, ok, msg, extra) {
  results.push(ok);
  if (!ok) problems.push({ sc, msg, extra });
  if (!ok || process.env.VERBOSE) console.log(`${ok ? 'TAMAM' : 'HATA '}  [${sc.id} ${sc.kind}] ${msg}${extra ? '  ' + extra : ''}`);
}

async function runScenario(browser, PORT, sc, getErr) {
  fs.writeFileSync(HAND_FILE, JSON.stringify({ id: sc.id, hand: sc.hand }));
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const exp = expectation(sc);
  const desc = `el=${sc.hand.join(' ')} | altSeri=${exp.lowerSeri} üstSeri=${exp.upper} altÇift=${exp.lowerPairs} üstÇift=${exp.upperPairs}`;
  const errStart = getErr().length;
  try {
    await p.goto(`http://localhost:${PORT}`);
    await p.fill('#name', 'T');
    await p.click('#btnQuick');
    await p.waitForFunction(() => document.body.classList.contains('myturn'), null, { timeout: 12000 });
    await p.waitForTimeout(500);

    const snap = () => p.evaluate(() => ({ opened: me().opened, type: me().openType, hand: S.hand.length, melds: S.melds.length, phase: S.phase, turn: S.turn, you: S.you, ended: S.phase === 'ended', toast: document.querySelector('#toast').textContent, modal: !document.querySelector('#modal').classList.contains('hidden'), pvYes: (() => { const y = document.querySelector('#pvYes'); return y ? !y.disabled : null; })(), pvStatus: (document.querySelector('.pvstatus') || {}).textContent || '' }));
    const btn = a => p.evaluate(a2 => { const b = document.querySelector(`[data-act="${a2}"]`); const r = b.getBoundingClientRect(); const h = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return { shown: getComputedStyle(b).display !== 'none' && r.height > 0, disabled: b.disabled, touchable: !!h && (h === b || b.contains(h)) }; }, a);

    // Açılabilir mi: önce plan hesabı gelsin (rozet/düğme hazır olsun)
    await p.waitForTimeout(900);
    const wantSeri = exp.lowerSeri >= 101, wantCift = !wantSeri && exp.lowerPairs >= 5;
    const impossible = exp.upper < 101 && exp.upperPairs < 5;
    const order = wantSeri ? ['openSeri'] : wantCift ? ['openCift'] : ['openSeri', 'openCift'];
    let s = await snap();
    for (const a of order) {
      const b = await btn(a);
      if (!b.shown || !b.touchable) { report(sc, false, `"${a}" düğmesi görünmüyor/dokunulamıyor`, JSON.stringify(b) + ' ' + desc); continue; }
      if (b.disabled && (wantSeri || wantCift)) { await p.waitForTimeout(1200); }
      await p.evaluate(a2 => document.querySelector(`[data-act="${a2}"]`).click(), a);
      await p.waitForTimeout(900);
      s = await snap();
      if (s.modal && s.pvYes === false && !s.opened) { report(sc, false, `önizleme kilitli: "${s.pvStatus}"`, desc); await p.evaluate(() => document.querySelector('#modalX').click()); break; }
      if (s.modal && s.pvYes) { await p.evaluate(() => document.querySelector('#pvYes').click()); await p.waitForTimeout(900); s = await snap(); }
      if (s.opened) break;
      await p.evaluate(() => { document.querySelector('#modal').classList.add('hidden'); });
    }

    if (wantSeri || wantCift) {
      const expType = wantSeri ? 'per' : 'cift';
      report(sc, s.opened && s.type === expType, `${wantSeri ? 'Seri' : 'Çift'} açılabilen el açıldı`, s.opened ? `tür=${s.type}` : `açılamadı: toast="${s.toast}" modal=${s.modal} ${desc}`);
    } else if (impossible) {
      report(sc, !s.opened, 'Açılamayan el açılmadı', s.opened ? 'AÇILDI ' + desc : '');
      // açılamıyorsa kullanıcıya bir neden gösterilmeli ya da düğme kapalı olmalı (sessiz kalmamalı)
      if (!s.opened) {
        const sb = await btn('openSeri'), cb = await btn('openCift');
        report(sc, sb.disabled || cb.disabled || !!s.toast || s.modal, 'Açılamayan elde sessiz kalmıyor (düğme kapalı ya da uyarı var)', JSON.stringify({ sb, cb, toast: s.toast }));
      }
    }

    // Açıldıysa: indir, işle, at. Elde 1 taş kaldıysa atınca el bitmeli (elden bitiş: puanlar x2)
    if (s.opened) {
      for (const a of ['openSeri', 'openCift', 'auto']) {
        const b = await btn(a);
        if (b.shown && !b.disabled) {
          await p.evaluate(a2 => document.querySelector(`[data-act="${a2}"]`).click(), a);
          await p.waitForTimeout(700);
          const m = await snap();
          if (m.modal && m.pvYes) { await p.evaluate(() => document.querySelector('#pvYes').click()); await p.waitForTimeout(700); }
          else if (m.modal) { report(sc, false, `indirme önizlemesi kilitli: "${m.pvStatus}"`, desc); await p.evaluate(() => document.querySelector('#modalX').click()); }
        }
      }
      s = await snap();
      const handBefore = s.hand;
      // at: sunucunun önerdiği taş (💡) ya da ilk taş
      const hid = await p.evaluate(() => new Promise(res => socket.emit('hint', id => res(id))));
      const sel = hid != null ? `#rack .tile[data-id="${hid}"]` : '#rack .tile[data-id]';
      let dropped = false;
      try { await p.locator(sel).first().dblclick({ timeout: 3000 }); dropped = true; } catch { /* taş görünmüyor */ }
      await p.waitForTimeout(900);
      const a = await snap();
      report(sc, dropped && (a.hand < handBefore || a.ended), 'Açtıktan sonra taş atılabiliyor', `el ${handBefore}→${a.hand} faz=${a.phase} toast="${a.toast}"`);
      if (handBefore === 1) {
        const res = await p.evaluate(() => S.result ? { winner: S.result.winner, mult: S.result.mult, reason: S.result.reason } : null);
        report(sc, !!res && res.winner === 0, 'Son taşı atınca el biter ve oyuncu kazanır', JSON.stringify(res));
        if (res) report(sc, res.mult >= 2, 'Elden bitiş puanları katlar', 'x' + res.mult + ' ' + res.reason);
      }
    }
    report(sc, errs.length === 0, 'JavaScript hatası yok', errs.slice(0, 2).join(' | '));
    const serr = getErr().slice(errStart);
    report(sc, !serr, 'Sunucuda hata yok', serr.slice(0, 200));
  } catch (e) {
    report(sc, false, 'senaryo çöktü: ' + String(e.message).split('\n')[0], desc + ' | sunucu: ' + getErr().slice(errStart, errStart + 200));
  }
  await ctx.close();
}

(async () => {
  const { srv, PORT, getErr } = await startServer();
  const browser = await chromium.launch();
  try {
    for (let i = 0; i < N; i++) { if (process.env.ONLY && +process.env.ONLY !== i) continue; await runScenario(browser, PORT, genScenario(i), getErr); }
  } catch (e) { console.error(e); results.push(false); }
  await browser.close();
  srv.kill();
  try { fs.unlinkSync(HAND_FILE); } catch { /* yok */ }
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} kontrol geçti (${N} senaryo, tohum ${SEED}, ekran ${VW}x${VH})`);
  process.exit(ok === results.length ? 0 : 1);
})();
