// Oyun motoru denetimi: 4 botlu tam oyunlar oynatır; hata, takılma, taş sayısı (106) ve el bitirme oranını kontrol eder.
// Çalıştırma: npm test   (oyun sayısı için N=100 npm test)
const { Game } = require('../game.js');
const Bot = require('../bot.js');

const N = +(process.env.N || 40);
const st = { games: 0, hands: 0, errs: 0, stuck: 0, tileBad: 0, finished: 0, voided: 0 };
const errs = new Set();

for (let n = 0; n < N; n++) {
  const info = [0, 1, 2, 3].map(i => ({ name: 'B' + i, isBot: true, connected: true }));
  const g = new Game(info, { hands: 3, mode: n % 2 ? 'esli' : 'tekli', katlamali: n % 3 === 0, waitAttach: n % 5 === 0 });
  g.startHand();
  let steps = 0;
  while (!g.over && steps++ < 20000) {
    if (g.phase === 'ended') {
      st.hands++;
      if (g.result.void) st.voided++; else if (g.result.winner != null) st.finished++;
      if (!g.over) g.startHand();
      continue;
    }
    const before = `${g.turnCount}:${g.phase}`;
    try {
      const total = g.seats.reduce((s, x) => s + x.hand.length + x.discards.length, 0) + g.pile.length + g.melds.reduce((s, m) => s + m.tiles.length, 0) + 1;
      if (total !== 106) { st.tileBad++; errs.add('taş sayısı ' + total); }
      if (g.phase === 'draw') Bot.draw(g, g.turn); else Bot.play(g, g.turn);
    } catch (e) { st.errs++; errs.add(e.message); Bot.fallback(g, g.turn); }
    if (`${g.turnCount}:${g.phase}` === before) Bot.fallback(g, g.turn);
  }
  if (!g.over) st.stuck++;
  st.games++;
}
const rate = st.finished / Math.max(1, st.hands - st.voided);
console.log(st, `el bitirme oranı %${Math.round(rate * 100)}`, [...errs].join(' | '));
process.exit(st.errs || st.stuck || st.tileBad ? 1 : 0);
