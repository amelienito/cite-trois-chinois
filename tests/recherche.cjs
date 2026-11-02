// Mesure la reconnaissance : base locale puis recherche en direct sur Wikidata (réseau réel).
//   node tests/recherche.cjs [url] [--live]
const fs = require('fs'), path = require('path');
const { chromium } = require(process.env.PW || 'playwright');
const url = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'file://' + path.join(__dirname, '..', 'docs', 'index.html');
const LIVE = process.argv.includes('--live');
const groups = []; let g = null;
fs.readFileSync(path.join(__dirname, 'noms-test.txt'), 'utf8').split('\n').forEach(l => { l = l.trim(); if (!l) return; if (l[0] === '#') { g = { name: l.slice(1).trim(), names: [] }; groups.push(g); } else g.names.push(...l.split('|').map(s => s.trim()).filter(Boolean)); });
(async () => {
  const b = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const p = await b.newPage();
  await p.goto(url); await p.waitForFunction(() => window.__c3c, null, { timeout: 30000 });
  const tot = { local: 0, fuzzy: 0, live: 0, livefuzzy: 0, ambig: 0, dead: 0, miss: 0, err: 0, n: 0 };
  for (const gr of groups) {
    const miss = [], via = [];
    for (const n of gr.names) {
      tot.n++;
      const r = await p.evaluate(t => { const r = window.__c3c.lookup(t); return r ? { e: r.entry && r.entry.name, cc: r.entry && r.entry.cc.join('/'), f: !!r.fuzzy, a: !!r.ambig } : null; }, n);
      if (r && r.e && !r.f) { tot.local++; continue; }
      if (!LIVE) { if (r && r.e) { tot.fuzzy++; via.push(n + ' ~ ' + r.e); } else if (r && r.a) { tot.ambig++; via.push(n + ' ?'); } else { tot.miss++; miss.push(n); } continue; }
      const a = await p.evaluate(t => window.__c3c.askWiki(t), n);
      if (a.ok && !a.fuzzy) { tot.live++; via.push(`${n} -> ${a.name} [${a.cc.join('/')}]`); }
      else if (a.ok) { tot.livefuzzy++; via.push(`${n} ~> ${a.name} [${a.cc.join('/')}]`); }
      else if (a.ambig) { tot.ambig++; via.push(`${n} ? ${a.ambig.join(', ')}`); }
      else if (a.dead) { tot.dead++; via.push(`${n} † ${a.dead}`); }
      else if (r && r.e) { tot.fuzzy++; via.push(`${n} ~ ${r.e} (local)`); }
      else if (a.err) { tot.err++; miss.push(n + ' (réseau)'); }
      else { tot.miss++; miss.push(n); }
      await new Promise(r => setTimeout(r, 250));
    }
    console.log(`\n## ${gr.name} (${gr.names.length})`);
    if (via.length) console.log('  via recherche : ' + via.join(' | '));
    console.log('  NON TROUVÉS (' + miss.length + ') : ' + miss.join(' | '));
  }
  console.log('\nBILAN ' + JSON.stringify(tot));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
