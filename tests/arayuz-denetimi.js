// Arayüz denetimi: sunucuyu ayrı bir portta başlatır, gerçek tarayıcıda (masaüstü 1920x940 ve telefon 844x390)
// "Hemen oyna" ile bir oyun açar ve son düzeltmeleri kontrol eder.
// Çalıştırma: npm i --no-save playwright && npx playwright install chromium && npm run test:ui
const { spawn } = require('child_process');
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

async function run(browser, label, vp, mobile) {
  console.log(`\n--- ${label} (${vp.width}x${vp.height}) ---`);
  const ctx = await browser.newContext({ viewport: vp, hasTouch: mobile, isMobile: mobile });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(URL);
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
  } catch (e) { console.error(e); results.push(false); }
  await browser.close();
  srv.kill();
  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} kontrol geçti`);
  process.exit(ok === results.length ? 0 : 1);
})();
