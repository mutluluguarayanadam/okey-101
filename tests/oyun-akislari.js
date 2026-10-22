// Oyun akışları denetimi (gerçek tarayıcı): oda kur / katıl / ayrıl, sayfa yenileyince oyuna dönüş, yandan alıp geri koyma (101 ceza),
// elden bitiş ve el sonu ekranı, okeyi çevirme. Çalıştırma: node tests/oyun-akislari.js   (VP=852x276 ekran boyutu)
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch { console.error('playwright bulunamadı'); process.exit(2); }
}
const { VW, VH, yeniSayfa, etiket } = require('./yardimci/cihaz.js');
const HAND_FILE = path.join(os.tmpdir(), `okey-akis-${process.pid}.json`);
const results = [];
const check = (name, ok, extra = '') => { results.push(!!ok); console.log(`${ok ? 'TAMAM' : 'HATA '}  ${name}${extra ? '  (' + extra + ')' : ''}`); };

async function startServer() {
  const PORT = 8000 + Math.floor(Math.random() * 1500);
  const srv = spawn(process.execPath, ['-r', path.join(__dirname, 'yardimci', 'el-dagit.js'), path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, HAND_FILE, BOT_MS: '200' }, stdio: 'pipe' });
  let err = '';
  srv.stderr.on('data', d => (err += d));
  await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('sunucu açılmadı')), 10000); srv.stdout.on('data', d => { if (String(d).includes('http://localhost')) { clearTimeout(t); res(); } }); });
  return { srv, PORT, getErr: () => err };
}
const newPage = browser => yeniSayfa(browser);
const myTurn = p => p.waitForFunction(() => document.body.classList.contains('myturn'), null, { timeout: 15000 });
const hands = (hand, extra = {}) => fs.writeFileSync(HAND_FILE, JSON.stringify({ id: 'a' + Math.random(), hand, ...extra }));

(async () => {
  const { srv, PORT, getErr } = await startServer();
  const URL = `http://localhost:${PORT}`;
  const browser = await chromium.launch();
  try {
    // ---------- 1) Oda kur, ikinci oyuncu kodla katılır, oyun başlar ----------
    {
      console.log('\n--- Oda kur / katıl / ayrıl ---');
      const a = await newPage(browser), b = await newPage(browser);
      await a.goto(URL); await a.fill('#name', 'Ev Sahibi'); await a.click('#btnCreate');
      await a.waitForSelector('#waiting:not(.hidden)', { timeout: 8000 });
      const code = (await a.textContent('#wCode')).trim();
      check('Oda kuruldu, kod görünüyor', /^[A-Z0-9]{5}$/.test(code), code);
      check('Oda sahibi "Oyunu başlat" düğmesini görüyor', await a.evaluate(() => { const b = document.querySelector('#btnStart'); const r = b.getBoundingClientRect(); const h = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return !b.classList.contains('hidden') && r.height > 0 && (h === b || b.contains(h)); }));
      await b.goto(URL); await b.fill('#name', 'Misafir'); await b.click('details.bycode summary'); await b.fill('#code', code); await b.click('#btnJoin');
      await b.waitForSelector('#waiting:not(.hidden)', { timeout: 8000 });
      check('Katılan oyuncu bekleme odasında, başlat düğmesi yok', await b.evaluate(() => document.querySelector('#btnStart').classList.contains('hidden')));
      await a.waitForFunction(() => document.querySelector('#wTable').textContent.includes('Misafir'), null, { timeout: 5000 });
      await a.click('#btnStart');
      await a.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
      await b.waitForSelector('#game:not(.hidden)', { timeout: 8000 });
      check('İki oyuncu da oyun ekranında', true);
      check('Boş koltuklara bot oturdu', await a.evaluate(() => S.players.filter(p => p.bot).length === 2));
      // oyundan çık: yerine bot geçer, çıkan ana menüye döner
      await b.evaluate(() => document.querySelector('#btnMenu') && document.querySelector('#btnMenu').click());
      await b.evaluate(() => document.querySelector('#btnLeave').click());
      await b.waitForSelector('#modalBody #btnLeaveOk', { timeout: 3000 });
      await b.click('#btnLeaveOk');
      await b.waitForSelector('#lobby:not(.hidden)', { timeout: 5000 });
      check('Çıkan oyuncu ana menüye döndü', true);
      await a.waitForFunction(() => S.players.filter(p => p.bot).length === 3, null, { timeout: 5000 });
      check('Çıkanın yerine bot geçti', true);
      check('JavaScript hatası yok', a.errs.length + b.errs.length === 0, [...a.errs, ...b.errs].join(' | '));
      await a.context().close(); await b.context().close();
    }

    // ---------- 2) Sayfa yenilenince oyuna dönüş ----------
    {
      console.log('\n--- Sayfa yenileme ---');
      hands(['0:2', '0:6', '1:3', '1:9', '2:4', '2:11', '3:1', '3:7', '0:10', '1:12', '2:8', '3:5', '0:13', '1:1', '2:2', '3:9', '0:4', '1:6', '2:12', '3:3', '1:11', '2:9']);
      const p = await newPage(browser);
      await p.goto(URL); await p.fill('#name', 'Yenile'); await p.click('#btnQuick');
      await myTurn(p); await p.waitForTimeout(500);
      const before = await p.evaluate(() => ({ hand: S.hand.length, ids: S.hand.map(t => t.id).sort((x, y) => x - y).join(',') }));
      await p.reload();
      await p.waitForSelector('#game:not(.hidden)', { timeout: 10000 });
      await p.waitForFunction(() => typeof S !== 'undefined' && S && S.hand && S.hand.length > 0, null, { timeout: 10000 });
      await p.waitForTimeout(600);
      const after = await p.evaluate(() => ({ hand: S.hand.length, ids: S.hand.map(t => t.id).sort((x, y) => x - y).join(','), rack: slots.filter(x => x != null).length, turn: S.turn === S.you }));
      check('Yenileyince aynı oyun ve aynı el geri geldi', before.ids === after.ids, `${before.hand}→${after.hand}`);
      check('Istakada bütün taşlar görünüyor (taş kaybı yok)', after.rack === after.hand, `${after.rack}/${after.hand}`);
      check('Yenileyince sıra bilgisi korunuyor', after.turn === true);
      check('JavaScript hatası yok', p.errs.length === 0, p.errs.join(' | '));
      await p.context().close();
    }

    // ---------- 3) Yandan alıp açamazsa geri koy: 101 ceza ----------
    {
      console.log('\n--- Yandan taş alıp geri koyma ---');
      // açılamayan el; soldaki oyuncunun attığı taş da işe yaramaz
      hands(['0:2', '0:6', '1:3', '1:9', '2:4', '2:11', '3:1', '3:7', '0:10', '1:12', '2:8', '3:5', '0:13', '1:1', '2:2', '3:9', '0:4', '1:6', '2:12', '3:3', '1:11', '2:9'], { side: '0:5' });
      const p = await newPage(browser);
      await p.goto(URL); await p.fill('#name', 'Geri'); await p.click('#btnQuick');
      await myTurn(p); await p.waitForTimeout(500);
      await p.locator('#rack .tile[data-id]').first().dblclick();
      await p.waitForFunction(() => S.turn === S.you && S.phase === 'draw', null, { timeout: 25000 });
      await p.waitForTimeout(900);
      const advice = await p.evaluate(() => document.querySelector('#handScore').innerText);
      check('Çekme aşamasında soldaki taş için öneri rozeti var', /Soldaki/.test(advice), advice.replace(/\n/g, ' | '));
      await p.evaluate(() => act({ type: 'drawDiscard' }));
      await p.waitForFunction(() => S.mustOpenWith != null, null, { timeout: 5000 });
      await p.waitForTimeout(700);
      const u = await p.evaluate(() => { const b = document.querySelector('[data-act="undo"]'), r = b.getBoundingClientRect(); const h = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return { shown: getComputedStyle(b).display !== 'none' && r.height > 0, touchable: !!h && (h === b || b.contains(h)), badge: document.querySelector('#handScore').innerText.replace(/\n/g, ' | ') }; });
      check('"Geri koy" düğmesi görünüyor ve dokunulabiliyor', u.shown && u.touchable, JSON.stringify(u));
      check('Rozet bu taşla açılamadığını söylüyor', /açılamıyor|Geri koy|Seri \d+ puan|çift açarsın/.test(u.badge), u.badge);
      await p.evaluate(() => document.querySelector('[data-act="undo"]').click());
      await p.waitForFunction(() => S.mustOpenWith == null && S.phase === 'draw', null, { timeout: 4000 });
      const pen = await p.evaluate(() => S.players[S.you].penalty);
      check('Geri koyunca 101 ceza yazıldı ve çekme aşamasına dönüldü', pen === 101, 'ceza ' + pen);
      const again = await p.evaluate(() => new Promise(r => { socket.once('err', m => r(m)); act({ type: 'drawDiscard' }); setTimeout(() => r(null), 1500); }));
      check('Geri verilen taş aynı tur tekrar alınamıyor', !!again, String(again));
      await p.evaluate(() => act({ type: 'drawPile' }));
      await p.waitForFunction(() => S.phase === 'play', null, { timeout: 3000 });
      const hid = await p.evaluate(() => new Promise(r => socket.emit('hint', id => r(id))));
      await p.locator(hid != null ? `#rack .tile[data-id="${hid}"]` : '#rack .tile[data-id]').first().dblclick();
      await p.waitForTimeout(700);
      const passed = await p.evaluate(() => ({ turn: S.turn !== S.you, phase: S.phase, modal: !document.querySelector('#modal').classList.contains('hidden'), modalText: document.querySelector('#modalBody').innerText.slice(0, 100), toast: document.querySelector('#toast').textContent, mustOpen: S.mustOpenWith, hand: S.hand.length }));
      check('Yığından çekip taş atınca sıra geçiyor', passed.turn, JSON.stringify(passed));
      check('JavaScript hatası yok', p.errs.length === 0, p.errs.join(' | '));
      await p.context().close();
    }

    // ---------- 4) Elden bitiş: açıp son taşı at, el sonu ekranı, sonraki el ----------
    {
      console.log('\n--- Elden bitiş ve el sonu ---');
      hands(['0:1', '0:2', '0:3', '0:4', '0:5', '2:1', '2:2', '2:3', '2:4', '2:5', '3:1', '3:2', '3:3', '3:4', '3:5', '1:6', '1:7', '1:8', '1:9', '0:12', '2:12', '1:12']);
      const p = await newPage(browser);
      await p.goto(URL); await p.fill('#name', 'Bitiren'); await p.click('#btnQuick');
      await myTurn(p); await p.waitForTimeout(1200);
      await p.evaluate(() => document.querySelector('[data-act="seri"]') && autoArrange('seri', true));
      await p.waitForTimeout(500);
      await p.evaluate(() => document.querySelector('[data-act="openSeri"]').click());
      await p.waitForTimeout(800);
      await p.evaluate(() => { const y = document.querySelector('#pvYes'); y && !y.disabled && y.click(); });
      await p.waitForTimeout(900);
      const o = await p.evaluate(() => ({ opened: me().opened, hand: S.hand.length }));
      check('Her taşı perde olan el açıldı (21 taş indi, 1 taş kaldı)', o.opened && o.hand === 1, JSON.stringify(o));
      await p.locator('#rack .tile[data-id]').first().dblclick();
      await p.waitForFunction(() => S.phase === 'ended', null, { timeout: 6000 });
      await p.waitForTimeout(800);
      const e = await p.evaluate(() => ({ winner: S.result.winner, mult: S.result.mult, score: S.result.scores[0], modal: !document.querySelector('#modal').classList.contains('hidden'), text: document.querySelector('#modalBody').innerText.slice(0, 200) }));
      check('El bitti, oyuncu kazandı, elden bitiş x2', e.winner === 0 && e.mult >= 2, JSON.stringify({ w: e.winner, m: e.mult, s: e.score }));
      check('Kazanan puanı -101 x çarpan', e.score === -101 * e.mult, String(e.score));
      check('El sonu ekranı açıldı ve puanları gösteriyor', e.modal && /Bitiren|puan|El/i.test(e.text), e.text.replace(/\n/g, ' ').slice(0, 80));
      check('El sonu ekranı kaydırılabilir ve "sonraki el" bilgisi var', await p.evaluate(() => /Sonraki el/.test(document.querySelector('#modalBody').innerText) && /auto|scroll/.test(getComputedStyle(document.querySelector('#modalBody')).overflowY)));
      await p.waitForFunction(() => S.phase !== 'ended' && S.handIndex === 2, null, { timeout: 16000 });
      await p.waitForTimeout(700);
      const n = await p.evaluate(() => ({ hand: S.hand.length, rack: slots.filter(x => x != null).length, opened: me().opened, modal: !document.querySelector('#modal').classList.contains('hidden') }));
      check('Sonraki el kendiliğinden başladı, ıstaka yenilendi', n.rack === n.hand && !n.opened, JSON.stringify(n));
      check('JavaScript hatası yok', p.errs.length === 0, p.errs.join(' | '));
      await p.context().close();
    }

    // ---------- 4b) Tek elli oyun: oyun sonu ekranı, Yeni oyun ve Ana menü düğmeleri ----------
    {
      console.log('\n--- Oyun sonu (tek el) ---');
      hands(['0:1', '0:2', '0:3', '0:4', '0:5', '2:1', '2:2', '2:3', '2:4', '2:5', '3:1', '3:2', '3:3', '3:4', '3:5', '1:6', '1:7', '1:8', '1:9', '0:12', '2:12', '1:12']);
      const p = await newPage(browser);
      await p.goto(URL); await p.fill('#name', 'Final');
      await p.evaluate(() => socket.emit('create', { name: 'Final', token, hands: 1 }));
      await p.waitForSelector('#waiting:not(.hidden)', { timeout: 8000 });
      await p.click('#btnStart');
      await myTurn(p); await p.waitForTimeout(1200);
      await p.evaluate(() => autoArrange('seri', true));
      await p.waitForTimeout(500);
      await p.evaluate(() => document.querySelector('[data-act="openSeri"]').click());
      await p.waitForTimeout(800);
      await p.evaluate(() => { const y = document.querySelector('#pvYes'); y && !y.disabled && y.click(); });
      await p.waitForTimeout(900);
      await p.locator('#rack .tile[data-id]').first().dblclick();
      await p.waitForFunction(() => S.over === true, null, { timeout: 6000 });
      await p.waitForTimeout(900);
      const f = await p.evaluate(() => { const b = document.querySelector('#btnNew'), m = document.querySelector('#btnMainMenu'); return { yeni: !!b, ana: !!m, text: document.querySelector('#modalBody').innerText.slice(0, 120) }; });
      check('Oyun bitti: "Yeni oyun" ve "Ana menü" düğmeleri var', f.yeni && f.ana, f.text.replace(/\n/g, ' ').slice(0, 70));
      const reach = await p.evaluate(() => ['#btnNew', '#btnMainMenu'].map(s => { const b = document.querySelector(s); b.scrollIntoView({ block: 'center' }); const r = b.getBoundingClientRect(); const h = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return !!h && (h === b || b.contains(h)); }));
      check('Oyun sonu düğmelerine kaydırarak ulaşılabiliyor', reach.every(Boolean), JSON.stringify(reach));
      await p.evaluate(() => document.querySelector('#btnNew').click());
      await p.waitForFunction(() => S.over === false && S.phase !== 'ended' && S.handIndex === 1, null, { timeout: 6000 });
      check('"Yeni oyun" yeni bir oyun başlatır', true);
      check('JavaScript hatası yok', p.errs.length === 0, p.errs.join(' | '));
      await p.context().close();
    }

    // ---------- 5) Okeyi çevirme (sağ tık / uzun basma) ----------
    {
      console.log('\n--- Okey çevirme ---');
      hands(['J', '0:2', '0:6', '1:3', '1:9', '2:4', '2:11', '3:1', '3:7', '0:10', '1:12', '2:8', '3:5', '0:13', '1:1', '2:2', '3:9', '0:4', '1:6', '2:12', '3:3', '1:11']);
      const p = await newPage(browser);
      await p.goto(URL); await p.fill('#name', 'Okey'); await p.click('#btnQuick');
      await myTurn(p); await p.waitForTimeout(600);
      const info = await p.evaluate(() => { const t = S.hand.find(x => Rules.isJoker(x, S.okey)); return { id: t.id, flipped: flipped.has(t.id) }; });
      check('Okey ele ters çevrilmiş (joker) gelir', info.flipped === true);
      await p.evaluate(id => document.querySelector(`#rack .tile[data-id="${id}"]`).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })), info.id);
      await p.waitForTimeout(300);
      const after = await p.evaluate(id => flipped.has(id), info.id);
      check('Sağ tıkla okeyin yüzü açılır', after === false);
      await p.evaluate(() => new Promise(r => autoArrange('seri', true, r)));
      check('Okey çevrilmişken Seri diz hata vermez', p.errs.length === 0, p.errs.join(' | '));
      await p.context().close();
    }
  } catch (e) { console.error(e); results.push(false); }
  await browser.close();
  const serr = getErr();
  check('Sunucuda hata yok', !serr, serr.slice(0, 300));
  srv.kill();
  try { fs.unlinkSync(HAND_FILE); } catch { /* yok */ }
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} kontrol geçti (${etiket})`);
  process.exit(ok === results.length ? 0 : 1);
})();
