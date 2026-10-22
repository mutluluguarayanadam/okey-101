// Arayüz denetimi: sunucuyu ayrı bir portta başlatır, gerçek tarayıcıda (masaüstü 1920x940 ve telefon 844x390)
// ve iPhone Safari benzetimi (çentik payı, tam ekran yok) için "Hemen oyna" ile bir oyun açar ve son düzeltmeleri kontrol eder.
// Çalıştırma: npm i --no-save playwright && npx playwright install chromium && npm run test:ui
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch {
  console.error('playwright bulunamadı. Önce: npm i --no-save playwright && npx playwright install chromium');
  process.exit(2);
}

const PORT = 3000 + Math.floor(Math.random() * 1000) + 1000;
const URL = `http://localhost:${PORT}`;
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'TAMAM' : 'HATA '}  ${name}${extra ? '  (' + extra + ')' : ''}`); };

async function startServer() {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT }, stdio: 'pipe' });
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('sunucu açılmadı')), 10000);
    srv.stdout.on('data', d => { if (String(d).includes('http://localhost')) { clearTimeout(t); res(); } });
  });
  return srv;
}

const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function run(browser, label, vp, mobile, ios) {
  console.log(`\n--- ${label} (${vp.width}x${vp.height}) ---`);
  const ctx = await browser.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile, userAgent: ios ? IOS_UA : undefined });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  if (ios) {
    // iPhone yatay: çentik payı solda/sağda 47px, ana ekran çizgisi 21px; Safari tam ekran vermez
    const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8')
      .replace(/env\(safe-area-inset-(top|right|bottom|left)\)/g, (_, k) => ({ top: 0, right: 47, bottom: 21, left: 47 })[k] + 'px');
    await p.route('**/style.css', r => r.fulfill({ body: css, contentType: 'text/css' }));
    await p.addInitScript(() => {
      Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });
      Object.defineProperty(Document.prototype, 'webkitFullscreenEnabled', { get: () => false });
    });
  }
  await p.goto(URL);
  if (ios) {
    const tip = await p.evaluate(() => { const t = document.querySelector('#iosTip'); return !!t && t.getBoundingClientRect().bottom <= innerHeight + 200; });
    check('Girişte "Ana Ekrana Ekle" ipucu', tip);
    await p.click('#iosTip');
    check('İpucu tam ekran yolunu anlatıyor', await p.evaluate(() => /Ana Ekrana Ekle/.test(document.querySelector('#modalBody').textContent) && !document.querySelector('#modal').classList.contains('hidden')));
    await p.click('#iosOk');
  }
  await p.fill('#name', 'Denetim');
  await p.click('#btnQuick');
  await p.waitForSelector('#game:not(.hidden)', { timeout: 10000 });
  await p.waitForFunction(() => document.body.classList.contains('myturn'), null, { timeout: 15000 });
  await p.waitForTimeout(800);

  // Dokunarak Ara: yazı seçilemez, basılı tutma menüsü engellenir; yazı kutuları seçilebilir
  const sel = await p.evaluate(() => {
    const us = el => getComputedStyle(el).userSelect;
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    const label = document.querySelector('#seriBoard .blabel') || document.querySelector('#status');
    label.dispatchEvent(ev);
    const r = document.createRange(); r.selectNodeContents(document.querySelector('#status'));
    const s = document.getSelection(); s.removeAllRanges(); s.addRange(r);
    return { label: us(label), status: us(document.querySelector('#status')), input: us(document.querySelector('#chatInput')), menuBlocked: ev.defaultPrevented };
  });
  await p.waitForTimeout(50);
  const leftSel = await p.evaluate(() => String(document.getSelection()));
  check('Oyun yazıları seçilemez (Dokunarak Ara açılmaz)', sel.label === 'none' && sel.status === 'none', `${sel.label}/${sel.status}`);
  check('Basılı tutma menüsü engelli', sel.menuBlocked);
  check('Seçim hemen temizlenir', leftSel === '', JSON.stringify(leftSel));
  check('Sohbet kutusunda yazı seçilebilir', sel.input === 'text' || sel.input === 'auto', sel.input);

  // Sıra sende: ıstaka ışığı ve süre çubuğu
  const mine = await p.evaluate(() => {
    const b = getComputedStyle(document.querySelector('.rack'), '::before');
    const bar = document.querySelector('.mt-bar');
    const r = bar.getBoundingClientRect();
    return { anim: b.animationName, content: b.content, bar: r.width, barVis: getComputedStyle(bar).display !== 'none' && r.height > 0, glow: getComputedStyle(document.querySelector('.rack')).animationName };
  });
  check('Istakada akan ışık', mine.anim === 'racksweep' && mine.content !== 'none', mine.anim);
  check('Istakada nabız ışığı', /rackglow|rackhurry/.test(mine.glow), mine.glow);
  check('Süre çubuğu görünür', mine.barVis && mine.bar > vp.width * 0.5, Math.round(mine.bar) + 'px');

  // Taş at, botun sırasını izle
  await p.locator('.rack .tile[data-id]').first().dblclick();
  await p.waitForFunction(() => !document.body.classList.contains('myturn'), null, { timeout: 5000 });
  await p.waitForTimeout(150);
  const bot = await p.evaluate(() => {
    const a = document.querySelector('.player.turn .ava');
    return a && { cls: a.className, p: a.style.getPropertyValue('--p'), after: getComputedStyle(a, '::after').animationName, bar: document.querySelector('.mt-bar').className };
  });
  check('Botun avatarında "düşünüyor" ışığı', !!bot && bot.cls.includes('thinking') && bot.after === 'thinkspin', bot && bot.after);
  check('Süre çubuğunda "düşünüyor" ışığı', !!bot && bot.bar.includes('thinking'));
  check('Halka doğru değerle çizilir (dolu başlayıp düşmez)', !!bot && bot.p !== '' && +bot.p < 1, bot && bot.p);

  // Halka titremesi: botun sırası boyunca --p hiç artmamalı (aynı tur içinde)
  const mono = await p.evaluate(() => new Promise(res => {
    const seen = []; const t0 = performance.now();
    (function f() {
      const a = document.querySelector('.player.turn .ava');
      seen.push(a ? [a.closest('.player').id, +a.style.getPropertyValue('--p')] : null);
      if (performance.now() - t0 < 1500) requestAnimationFrame(f); else res(seen);
    })();
  }));
  let jumps = 0;
  for (let i = 1; i < mono.length; i++) if (mono[i] && mono[i - 1] && mono[i][0] === mono[i - 1][0] && mono[i][1] > mono[i - 1][1] + 0.05) jumps++;
  check('Halka titremiyor', jumps === 0, jumps + ' sıçrama');

  if (ios) {
    const fit = await p.evaluate(() => {
      const rl = document.querySelector('#rackline').getBoundingClientRect(), rk = document.querySelector('#rack').getBoundingClientRect();
      return { l: rl.left, r: innerWidth - rl.right, rk: rk.right <= rl.right + 1 && rk.left >= rl.left - 1 };
    });
    check('Istaka çentik payının içinde ve sığıyor', fit.l >= 46 && fit.r >= 46 && fit.rk, `sol ${Math.round(fit.l)} sağ ${Math.round(fit.r)}`);
    await p.evaluate(() => document.querySelector('#btnFull').click());
    check('Oyunda ⛶: iPhone tam ekran yardımı açılır', await p.evaluate(() => /iPhone'da tam ekran/.test(document.querySelector('#modalBody').textContent) && !document.querySelector('#modal').classList.contains('hidden')));
    await p.waitForTimeout(400);
    check('Yardım oyun güncellemesiyle kapanmaz', await p.evaluate(() => !document.querySelector('#modal').classList.contains('hidden')));
    await p.click('#iosOk');
  }
  // Sağ sütundaki açma düğmeleri gerçekten dokunulabilir olmalı (kısa ekranda yan sütuna taşıp gizlenmesinler)
  const touch = await p.evaluate(() => ['openSeri', 'openCift'].map(a => {
    const b = document.querySelector(`[data-act="${a}"]`), r = b.getBoundingClientRect();
    const h = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return !!h && (h === b || b.contains(h));
  }));
  check('Seri aç ve Çift aç düğmeleri dokunulabilir', touch.every(Boolean), JSON.stringify(touch));
  // Seri açtıktan sonra "Çift indir" görünür (masada çift yokken de), dokununca nedenini söyler
  await p.evaluate(() => { const m = S.players[S.you]; m.opened = true; m.openType = 'per'; m.openScore = 105; S.turn = S.you; S.phase = 'play'; renderGame(); });
  const ci = await p.evaluate(() => { const b = document.querySelector('[data-act="openCift"]'), r = b.getBoundingClientRect(); return { shown: getComputedStyle(b).display !== 'none' && r.height > 0 && r.bottom <= innerHeight && r.right <= innerWidth, dis: b.disabled }; });
  check('Seri açtıktan sonra "Çift indir" görünür', ci.shown, JSON.stringify(ci));
  const cur = await p.evaluate(() => { document.querySelector('[data-act="openCift"]').click(); return document.querySelector('#toast').textContent; });
  check('"Çift indir" indirilemiyorsa nedenini söyler', /çift/i.test(cur), cur);
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  check('Sayfa yana taşmıyor', !overflow);
  check('JavaScript hatası yok', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

(async () => {
  const srv = await startServer();
  const browser = await chromium.launch();
  try {
    await run(browser, 'Masaüstü', { width: 1920, height: 940 }, false);
    await run(browser, 'Telefon', { width: 844, height: 390 }, true);
    await run(browser, 'iPhone Safari', { width: 750, height: 340 }, true, true);
    await run(browser, 'iPhone Safari araçlı (kısa)', { width: 852, height: 276 }, true, true);
    await run(browser, 'iPhone SE Safari', { width: 667, height: 250 }, true, true);
  } catch (e) { console.error(e); results.push(false); }
  await browser.close();
  srv.kill();
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} kontrol geçti`);
  process.exit(ok === results.length ? 0 : 1);
})();
