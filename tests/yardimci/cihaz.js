// Test cihaz ayarı: VP=genişlikxyükseklik, UA=ios|android|masaustu, INSET=sol,sag,alt (iPhone çentik/ana ekran çizgisi payı)
const fs = require('fs');
const path = require('path');
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const [VW, VH] = (process.env.VP || '852x276').split('x').map(Number);
const UA = process.env.UA || (VW < 1000 ? 'ios' : 'masaustu');
const INSET = (process.env.INSET || (UA === 'ios' && VW < 1000 ? '47,47,0' : '0,0,0')).split(',').map(Number);
const mobile = UA !== 'masaustu';
// Bağlam seçenekleri ve (iOS için) güvenli alan payını CSS'e işleyen yönlendirme
async function yeniSayfa(browser) {
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: mobile, isMobile: mobile && VW < 1100,
    userAgent: UA === 'ios' ? IOS_UA : UA === 'android' ? ANDROID_UA : undefined });
  const p = await ctx.newPage();
  if (INSET.some(Boolean)) {
    const css = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'style.css'), 'utf8')
      .replace(/env\(safe-area-inset-(top|right|bottom|left)\)/g, (_, k) => ({ top: 0, right: INSET[1], bottom: INSET[2], left: INSET[0] })[k] + 'px');
    await p.route('**/style.css', r => r.fulfill({ body: css, contentType: 'text/css' }));
  }
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
  return p;
}
module.exports = { VW, VH, UA, yeniSayfa, etiket: `${UA} ${VW}x${VH}` };
