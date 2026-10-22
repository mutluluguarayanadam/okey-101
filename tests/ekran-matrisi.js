// Ekran matrisi: iPhone (Safari araç çubuklu/çubuksuz, SE, ana ekran), Android, iPad ve masaüstü boyutlarında
// işlem düğmelerinin gerçekten dokunulabildiğini, ıstaka ve rozetin ekrana sığdığını, sayfanın yana taşmadığını denetler
// (atma aşaması, yandan taş alınmış, açmış oyuncu). Çalıştırma: node tests/ekran-matrisi.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  try { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); } catch { console.error('playwright bulunamadı'); process.exit(2); }
}
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const DEVICES = [
  ['iPhone 15 Pro Safari araçlı 852x276', 852, 276, 'ios', [59, 59, 0]],
  ['iPhone 15 Pro Safari 852x330', 852, 330, 'ios', [59, 59, 0]],
  ['iPhone 15 Pro ana ekran 852x393', 852, 393, 'ios', [59, 59, 21]],
  ['iPhone SE Safari 667x250', 667, 250, 'ios', [0, 0, 0]],
  ['iPhone 14 Safari 844x275', 844, 275, 'ios', [47, 47, 0]],
  ['Android Chrome 800x360', 800, 360, 'and', null],
  ['Android Chrome 915x412', 915, 412, 'and', null],
  ['Android küçük 640x300', 640, 300, 'and', null],
  ['iPad 1180x820', 1180, 820, 'ipad', null],
  ['Masaüstü 1366x700', 1366, 700, 'desk', null],
  ['Masaüstü 1920x940', 1920, 940, 'desk', null],
];
const HAND_FILE = path.join(os.tmpdir(), `okey-mx-${process.pid}.json`);
const HAND = ['0:9', '0:10', '0:11', '0:12', '0:13', '2:9', '2:10', '2:11', '2:12', '2:13', '1:1', '1:1', '3:3', '3:3', '1:5', '1:5', '0:2', '3:7', '2:4', '3:1', '0:6', '1:8'];
const results = [];
(async () => {
  const browser = await chromium.launch();
  for (const [name, vw, vh, kind, inset] of DEVICES) {
    fs.writeFileSync(HAND_FILE, JSON.stringify({ id: 'mx' + Math.random(), hand: HAND }));
    const PORT = 7000 + Math.floor(Math.random() * 1500);
    const srv = spawn(process.execPath, ['-r', path.join(__dirname, 'yardimci', 'el-dagit.js'), path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, HAND_FILE, BOT_MS: '300' }, stdio: 'pipe' });
    await new Promise(r => srv.stdout.on('data', d => String(d).includes('localhost') && r()));
    const mobile = kind !== 'desk';
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: mobile, isMobile: mobile && vw < 1100, userAgent: kind === 'ios' ? IOS_UA : kind === 'and' ? ANDROID_UA : undefined });
    const p = await ctx.newPage();
    if (inset) {
      const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8').replace(/env\(safe-area-inset-(top|right|bottom|left)\)/g, (_, k) => ({ top: 0, right: inset[1], bottom: inset[2], left: inset[0] })[k] + 'px');
      await p.route('**/style.css', r => r.fulfill({ body: css, contentType: 'text/css' }));
    }
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(`http://localhost:${PORT}`); await p.fill('#name', 'T'); await p.click('#btnQuick');
    await p.waitForFunction(() => document.body.classList.contains('myturn'), null, { timeout: 15000 });
    await p.waitForTimeout(700);
    const probe = () => p.evaluate(() => {
      const vis = el => { const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
      const acts = document.querySelector('.actions'), ab = acts.getBoundingClientRect();
      const btns = [...acts.querySelectorAll('button')].filter(vis).map(x => {
        const r = x.getBoundingClientRect(), cx = Math.round((r.left + r.right) / 2), cy = Math.round((r.top + r.bottom) / 2);
        const hit = document.elementFromPoint(cx, cy);
        return { a: x.dataset.act, touchable: !!hit && (hit === x || x.contains(hit)), essential: ['openSeri', 'openCift', 'undo'].includes(x.dataset.act) };
      });
      const rack = document.querySelector('#rack').getBoundingClientRect(), hs = document.querySelector('#handScore').getBoundingClientRect();
      const bu = document.querySelector('#handScore [data-undo]'); let undoBadge = false;
      if (bu) { const r = bu.getBoundingClientRect(), h = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); undoBadge = !!h && (h === bu || bu.contains(h)); }
      return { undoBadge, btns, rackIn: rack.left >= -1 && rack.right <= innerWidth + 1 && rack.bottom <= innerHeight + 1, hsIn: hs.left >= -1 && hs.right <= innerWidth + 1, xOverflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    const states = { atma: await probe() };
    await p.evaluate(() => { S.mustOpenWith = S.hand[0].id; S.phase = 'play'; S.turn = S.you; renderGame(); });
    await p.waitForTimeout(300);
    states['yandan-alinmis'] = await probe();
    await p.evaluate(() => { S.mustOpenWith = null; const m = S.players[S.you]; m.opened = true; m.openType = 'per'; S.players[1].opened = true; S.players[1].openType = 'cift'; renderGame(); });
    await p.waitForTimeout(300);
    states.acmis = await probe();
    for (const [k, v] of Object.entries(states)) {
      // zorunlu düğmeler (Seri/Çift aç-indir, Geri koy) dokunulabilir olmalı; ikincil olanlar (💡) kaydırarak ulaşılabilir
      const badBtns = v.btns.filter(b => b.essential && !b.touchable && !(b.a === 'undo' && v.undoBadge)); // Geri koy: sağ sütundan ya da rozetteki düğmeden
      const ok = !badBtns.length && v.rackIn && v.hsIn && !v.xOverflow && !errs.length;
      results.push(ok);
      console.log(`${ok ? 'TAMAM' : 'HATA '}  ${name.padEnd(36)} ${k.padEnd(15)} ${v.btns.map(b => b.a + (b.touchable ? '' : '(!)')).join(',')}${v.rackIn ? '' : ' ISTAKA-TAŞIYOR'}${v.hsIn ? '' : ' ROZET-TAŞIYOR'}${v.xOverflow ? ' YANA-TAŞMA' : ''}${errs.length ? ' JS:' + errs[0] : ''}`);
    }
    await ctx.close(); srv.kill();
  }
  await browser.close();
  try { fs.unlinkSync(HAND_FILE); } catch { /* yok */ }
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} kontrol geçti`);
  process.exit(ok === results.length ? 0 : 1);
})();
