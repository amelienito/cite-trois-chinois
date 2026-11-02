#!/usr/bin/env node
// Muscle la base métier par métier, dans tous les pays : footballeurs, musique, acteurs, politique,
// autres sports, web/télé, autres. Pour chaque pays, on prend les plus notoires de chaque famille
// (nombre de pages Wikimedia), avec des quotas selon le rang du pays (A, B, C).
//
// Phase 1 : SPARQL sans libellés (rapide) pour lister les personnes vivantes par pays et métier.
// Phase 2 : API Wikidata (wbgetentities, 50 par appel) pour les noms et surnoms (fr, mul, en).
//
//   node scripts/expand-jobs.mjs                # affiche le bilan (rien n'est écrit)
//   node scripts/expand-jobs.mjs --write        # ajoute les personnes à data/people.csv
//   options : --only FR,US  --scale 1 (multiplie les quotas)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, stringifyCSV, norm, PEOPLE_COLS } from './lib.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const WRITE = opt('write', false) === true;
const ONLY = String(opt('only', '') || '').split(',').filter(Boolean);
const SCALE = +opt('scale', 1) || 1;
const SPARQL = process.env.WIKIDATA_SPARQL || 'https://query.wikidata.org/sparql';
const API = process.env.WIKIDATA_API || 'https://www.wikidata.org/w/api.php';
const UA = 'Cite3Chinois-expand-jobs/1.0 (jeu de culture generale; depot GitHub amelienito/cite-trois-chinois)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = f => parseCSV(fs.readFileSync(path.join(root, f), 'utf8'));
const log = (...a) => console.log(...a);

// Familles de métiers : identifiants Wikidata -> libellé affiché dans le jeu.
const CATS = {
  foot: { q: { Q937857: 'Footballeur' }, quota: [450, 220, 70] },
  music: { q: { Q177220: 'Chanteur', Q2252262: 'Rappeur', Q639669: 'Musicien', Q130857: 'DJ', Q488205: 'Auteur-compositeur-interprète', Q753110: 'Auteur-compositeur', Q855091: 'Guitariste', Q36834: 'Compositeur', Q183945: 'Producteur de musique' }, quota: [450, 200, 50] },
  actor: { q: { Q33999: 'Acteur', Q10800557: 'Acteur', Q10798782: 'Acteur', Q2405480: 'Acteur', Q2259451: 'Acteur de théâtre' }, quota: [400, 150, 30] },
  pol: { q: { Q82955: 'Personnalité politique', Q30461: 'Président', Q14212: 'Premier ministre', Q372436: 'Personnalité politique' }, quota: [250, 120, 40] },
  sport: { q: { Q3665646: 'Basketteur', Q10833314: 'Joueur de tennis', Q378622: 'Pilote de course', Q10841764: 'Pilote de F1', Q14089670: 'Rugbyman', Q13382576: 'Rugbyman', Q11513337: 'Athlète', Q11338576: 'Boxeur', Q11607585: 'Combattant de MMA', Q2309784: 'Cycliste', Q12840545: 'Handballeur', Q15117302: 'Volleyeur', Q10843402: 'Nageur', Q6665249: 'Judoka', Q12299841: 'Joueur de cricket', Q10871364: 'Joueur de baseball', Q11774891: 'Hockeyeur', Q19204627: 'Joueur de football américain', Q13156709: 'Golfeur', Q10873124: 'Joueur d’échecs', Q13474373: 'Catcheur', Q13381376: 'Skieur', Q13141064: 'Joueur de badminton', Q16004431: 'Joueur de tennis de table' }, quota: [300, 120, 30] },
  web: { q: { Q17125263: 'Vidéaste web', Q57414145: 'Streameur', Q2906862: 'Influenceur', Q947873: 'Animateur de télévision', Q245068: 'Humoriste', Q18545066: 'Humoriste', Q4610556: 'Mannequin', Q1930187: 'Journaliste', Q2722764: 'Animateur de radio' }, quota: [150, 60, 10] },
  other: { q: { Q2526255: 'Réalisateur', Q36180: 'Écrivain', Q43845: 'Entrepreneur', Q131524: 'Entrepreneur', Q3499072: 'Chef cuisinier', Q1028181: 'Peintre', Q42973: 'Architecte', Q901: 'Scientifique', Q11063: 'Astronaute', Q1650915: 'Chercheur' }, quota: [150, 60, 10] },
};
const FLOOR = { A: 6, B: 5, C: 4 };
const TIDX = { A: 0, B: 1, C: 2 };
// Territoires : on les rattache au pays souverain.
const TERR = { PR: 'US', GU: 'US', VI: 'US', AS: 'US', MP: 'US', GP: 'FR', MQ: 'FR', GF: 'FR', RE: 'FR', YT: 'FR', NC: 'FR', PF: 'FR', PM: 'FR', BL: 'FR', MF: 'FR', WF: 'FR', HK: 'CN', MO: 'CN', GL: 'DK', FO: 'DK', AW: 'NL', CW: 'NL', SX: 'NL', BQ: 'NL', BM: 'GB', KY: 'GB', VG: 'GB', AI: 'GB', MS: 'GB', TC: 'GB', GI: 'GB', FK: 'GB', IM: 'GB', JE: 'GB', GG: 'GB', CK: 'NZ', NU: 'NZ', AX: 'FI' };

async function sparql(query, tries = 3) {
  for (let a = 0; a < tries; a++) {
    try {
      const res = await fetch(SPARQL, { method: 'POST', headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ query }) });
      if (res.status === 429) { await sleep(15000 * (a + 1)); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return (await res.json()).results.bindings;
    } catch (e) { if (a === tries - 1) throw e; await sleep(3000 * (a + 1)); }
  }
  throw new Error('délai dépassé');
}
async function api(params) {
  for (let a = 0; a < 5; a++) {
    try {
      const res = await fetch(API + '?' + new URLSearchParams({ format: 'json', ...params }), { headers: { 'User-Agent': UA } });
      if (res.status === 429 || res.status >= 500) { await sleep(5000 * (a + 1)); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { if (a === 4) throw e; await sleep(2000 * (a + 1)); }
  }
}
const v = (b, k) => b[k]?.value ?? '';
const qid = u => (u.match(/Q\d+$/) || [''])[0];

const people = read('data/people.csv'), dead = read('data/dead.csv'), countries = read('data/countries.csv');
const tierOf = Object.fromEntries(countries.map(c => [c.code, c.tier || 'C']));
const known = new Set(), byWd = new Set(people.map(r => r.wikidata).filter(Boolean));
[...people, ...dead].forEach(r => { known.add(norm(r.name)); (r.aliases || '').split(';').forEach(a => a && known.add(norm(a))); });

// 1. Correspondance code ISO -> éléments Wikidata (pays + territoires rattachés).
log('Correspondance des pays…');
const isoRows = await sparql('SELECT ?c ?iso WHERE { ?c wdt:P297 ?iso }');
const qOfIso = {}, isoOfQ = {};
isoRows.forEach(b => {
  let iso = v(b, 'iso'); const q = qid(v(b, 'c')); iso = tierOf[iso] ? iso : TERR[iso]; if (!iso || !tierOf[iso]) return;
  (qOfIso[iso] = qOfIso[iso] || []).push(q); isoOfQ[q] = iso;
});
log(Object.keys(qOfIso).length + ' pays reconnus');

// 2. Phase 1 : par pays (et par famille pour les grands pays).
const found = new Map(); // id -> { cc:Set, sport:Set, links, year, job, cat }
const pool = {}; // iso -> cat -> [ids]
const JOB2CAT = {}; Object.entries(CATS).forEach(([c, d]) => Object.keys(d.q).forEach(j => { JOB2CAT[j] = JOB2CAT[j] || c; }));
function add(b, iso, cat) {
  const id = qid(v(b, 'p')); if (!id || byWd.has(id)) return;
  cat = cat || JOB2CAT[qid(v(b, 'job'))]; if (!cat) return;
  const y = /^(\d{4})/.exec(v(b, 'dob')); if (y && +y[1] > 2007) return; // pas de mineurs
  const job = CATS[cat].q[qid(v(b, 'job'))] || '';
  const e = found.get(id) || { cc: new Set(), sport: new Set(), links: 0, year: '', job: '', cat };
  e.cc.add(iso); e.links = Math.max(e.links, +v(b, 'links') || 0);
  if (y && +y[1] >= 1900) e.year = e.year || y[1];
  if (!e.job || cat === 'foot') { e.job = job || e.job; e.cat = e.cat || cat; }
  const sp = isoOfQ[qid(v(b, 'sp'))]; if (sp) e.sport.add(sp);
  found.set(id, e);
  ((pool[iso] = pool[iso] || {})[cat] = pool[iso][cat] || []).push(id);
}
const q = (iso, jobs, floor, limit) => `
SELECT ?p ?job ?links ?dob ?sp WHERE {
  VALUES ?c { ${qOfIso[iso].map(x => 'wd:' + x).join(' ')} }
  VALUES ?job { ${jobs.map(x => 'wd:' + x).join(' ')} }
  ?p wdt:P27 ?c; wdt:P106 ?job; wikibase:sitelinks ?links.
  FILTER(?links >= ${floor})
  FILTER NOT EXISTS { ?p wdt:P570 [] }
  OPTIONAL { ?p wdt:P569 ?dob }
  OPTIONAL { ?p wdt:P1532 ?sp }
} ORDER BY DESC(?links) LIMIT ${limit}`;
const todo = countries.map(c => c.code).filter(c => qOfIso[c] && (!ONLY.length || ONLY.includes(c)));
const failed = [];
const t0 = Date.now();
for (const iso of todo) {
  const t = tierOf[iso] || 'C';
  if (t === 'C') {
    // Petits pays : une seule requête pour toutes les familles.
    const jobs = Object.keys(JOB2CAT), lim = Math.round(Object.values(CATS).reduce((n, d) => n + d.quota[2], 0) * SCALE * 3);
    let ok = false;
    for (const mult of [1, 1.5, 2.5]) {
      try { (await sparql(q(iso, jobs, Math.round(FLOOR.C * mult), lim))).forEach(b => add(b, iso, null)); ok = true; break; }
      catch (e) { await sleep(4000); }
    }
    if (!ok) failed.push(iso);
    await sleep(700);
    log(`${iso} (C) : ${found.size} personnes en tout · ${Math.round((Date.now() - t0) / 60000)} min`);
    continue;
  }
  for (const [cat, def] of Object.entries(CATS)) {
    const jobs = Object.keys(def.q), quota = Math.round(def.quota[TIDX[t]] * SCALE);
    let ok = false;
    for (const mult of [1, 1.5, 2.5]) {
      try { (await sparql(q(iso, jobs, Math.round(FLOOR[t] * mult), quota * 3))).forEach(b => add(b, iso, cat)); ok = true; break; }
      catch (e) { await sleep(4000); }
    }
    if (!ok) failed.push(iso + ':' + cat);
    await sleep(700);
  }
  log(`${iso} (${t}) : ${found.size} personnes en tout · ${Math.round((Date.now() - t0) / 60000)} min`);
}

// 3. Sélection : par pays et par famille, les plus notoires jusqu'au quota.
const keep = new Set();
for (const [iso, cats] of Object.entries(pool)) {
  const t = tierOf[iso] || 'C';
  for (const [cat, ids] of Object.entries(cats)) {
    const quota = Math.round(CATS[cat].quota[TIDX[t]] * SCALE);
    [...new Set(ids)].sort((a, b) => found.get(b).links - found.get(a).links).slice(0, quota).forEach(id => keep.add(id));
  }
}
log(`\nPhase 1 terminée : ${keep.size} personnes retenues sur ${found.size}` + (failed.length ? ` · requêtes échouées : ${failed.join(' ')}` : ''));

// 4. Phase 2 : noms et surnoms.
const ids = [...keep];
const rows = [];
const usable = n => n && !/^Q\d+$/.test(n) && n.length >= 2 && n.length <= 60 && norm(n).length >= 2;
const seen = new Set();
for (let i = 0; i < ids.length; i += 50) {
  const chunk = ids.slice(i, i + 50);
  let d;
  try { d = await api({ action: 'wbgetentities', ids: chunk.join('|'), props: 'labels|aliases', languages: 'fr|mul|en' }); }
  catch (e) { log('API : lot ignoré (' + e.message + ')'); continue; }
  for (const id of chunk) {
    const ent = d?.entities?.[id]; if (!ent) continue;
    const L = ent.labels || {}, A = ent.aliases || {};
    const name = ((L.fr || L.mul || L.en) || {}).value?.replace(/\s+/g, ' ').trim();
    if (!usable(name)) continue;
    const k = norm(name); if (known.has(k) || seen.has(k)) continue;
    const alts = [];
    [L.fr, L.mul, L.en].forEach(x => x && alts.push(x.value));
    ['fr', 'mul', 'en'].forEach(l => (A[l] || []).forEach(x => alts.push(x.value)));
    const aliases = [...new Set(alts.map(s => s.replace(/[;,]/g, ' ').replace(/\s+/g, ' ').trim()).filter(s => usable(s) && norm(s) !== k && !known.has(norm(s))))].slice(0, 4);
    const e = found.get(id);
    // Pays principal : la sélection sportive si elle existe, puis les autres nationalités.
    const cc = [...e.cc];
    const main = [...e.sport].find(c => cc.includes(c)) || cc[0];
    const ordered = [main, ...cc.filter(c => c !== main)].slice(0, 3);
    seen.add(k);
    rows.push({ name, countries: ordered.join('/'), tier: 'r', aliases: aliases.join(';'), job: e.job, birth_year: e.year, hint: '', tags: 'f', wikidata: id, status: 'verified', verified_on: new Date().toISOString().slice(0, 10), note: '' });
  }
  if (i % 2500 === 0) log(`noms : ${i + chunk.length}/${ids.length}`);
  await sleep(150);
}
const byCat = {}; rows.forEach(r => { const c = found.get(r.wikidata).cat; byCat[c] = (byCat[c] || 0) + 1; });
log(`\n${rows.length} nouvelles personnes · ` + Object.entries(byCat).map(([c, n]) => c + ' ' + n).join(' · '));
rows.slice(0, 30).forEach(r => log(`  ${r.name} [${r.countries}] ${r.job} ${r.birth_year}${r.aliases ? ' (' + r.aliases + ')' : ''}`));
if (WRITE && rows.length) {
  fs.writeFileSync(path.join(root, 'data/people.csv'), stringifyCSV([...people, ...rows], PEOPLE_COLS));
  log(`data/people.csv mis à jour (${people.length + rows.length} lignes).`);
}
