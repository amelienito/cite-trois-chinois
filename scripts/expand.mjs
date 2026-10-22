#!/usr/bin/env node
// Élargit la base : interroge Wikidata pour trouver, pays par pays, les personnes vivantes les plus
// notoires (nombre de pages Wikipédia), puis les créateurs de contenu les plus suivis. Les nouvelles
// personnes sont ajoutées à data/people.csv avec le tag « f » (mode libre uniquement, jamais dans le défi).
//
//   node scripts/expand.mjs                         # affiche ce qui serait ajouté (rien n'est écrit)
//   node scripts/expand.mjs --write                 # ajoute les personnes à data/people.csv
//   options : --per-country 120  --min-links 18  --min-followers 2000000  --only FR,US  --no-creators
//
// Hors ligne, on peut tester avec WIKIDATA_SPARQL=http://localhost:PORT/sparql (réponse JSON standard).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, stringifyCSV, norm, PEOPLE_COLS } from './lib.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const WRITE = opt('write', false) === true, CREATORS = opt('no-creators', false) !== true;
const PER = +opt('per-country', 120), MINL = +opt('min-links', 18), MINF = +opt('min-followers', 2000000);
const ONLY = (opt('only', '') || '').toString().split(',').filter(Boolean);
const ENDPOINT = process.env.WIKIDATA_SPARQL || 'https://query.wikidata.org/sparql';
const UA = 'Cite3Chinois-expand/1.0 (elargissement de base de donnees; voir le depot GitHub du projet)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const read = f => parseCSV(fs.readFileSync(path.join(root, f), 'utf8'));

async function sparql(query) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(ENDPOINT + '?' + new URLSearchParams({ query, format: 'json' }), { headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });
      if (res.status === 429 || res.status >= 500) { await sleep(4000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return (await res.json()).results.bindings;
    } catch (e) { if (attempt === 3) throw e; await sleep(2000 * (attempt + 1)); }
  }
  return [];
}
const val = (b, k) => b[k]?.value ?? '';
const qid = u => (u.match(/Q\d+$/) || [''])[0];

const countryQuery = (iso, minLinks, limit) => `
SELECT ?p ?pLabel ?links ?dob (GROUP_CONCAT(DISTINCT ?occL; separator=", ") AS ?occ) WHERE {
  ?c wdt:P297 "${iso}".
  ?p wdt:P27 ?c; wdt:P31 wd:Q5; wikibase:sitelinks ?links.
  FILTER(?links >= ${minLinks})
  FILTER NOT EXISTS { ?p wdt:P570 [] }
  OPTIONAL { ?p wdt:P569 ?dob }
  OPTIONAL { ?p wdt:P106 ?o. ?o rdfs:label ?occL FILTER(LANG(?occL) = "fr") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
} GROUP BY ?p ?pLabel ?links ?dob ORDER BY DESC(?links) LIMIT ${limit}`;

const creatorQuery = (minF, limit) => `
SELECT ?p ?pLabel ?links ?dob ?iso (MAX(?f) AS ?followers) (GROUP_CONCAT(DISTINCT ?occL; separator=", ") AS ?occ) WHERE {
  ?p wdt:P31 wd:Q5; p:P8687/psv:P8687/wikibase:quantityAmount ?f.
  FILTER(?f >= ${minF})
  FILTER NOT EXISTS { ?p wdt:P570 [] }
  ?p wdt:P27 ?c. ?c wdt:P297 ?iso.
  OPTIONAL { ?p wikibase:sitelinks ?links }
  OPTIONAL { ?p wdt:P569 ?dob }
  OPTIONAL { ?p wdt:P106 ?o. ?o rdfs:label ?occL FILTER(LANG(?occL) = "fr") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "fr,en". }
} GROUP BY ?p ?pLabel ?links ?dob ?iso ORDER BY DESC(?followers) LIMIT ${limit}`;

const people = read('data/people.csv'), dead = read('data/dead.csv'), countries = read('data/countries.csv');
const known = new Set(), byWd = new Set(people.map(r => r.wikidata).filter(Boolean));
people.forEach(r => { known.add(norm(r.name)); (r.aliases || '').split(';').forEach(a => a && known.add(norm(a))); });
dead.forEach(r => { known.add(norm(r.name)); (r.aliases || '').split(';').forEach(a => a && known.add(norm(a))); });
// Une étiquette qui n'est qu'un identifiant (« Q123 ») ou vide n'est pas un nom.
const usable = n => n && !/^Q\d+$/.test(n) && n.length >= 3 && n.length <= 60 && norm(n).length >= 3;

// « footballeur ou footballeuse » -> « Footballeur » (on garde la forme courte).
const flat = x => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pre = (a, b) => { let n = 0; while (n < a.length && flat(a)[n] === flat(b)[n]) n++; return n; };
const shortJob = j => { j = j.replace(/([^\s,]+) ou ([^\s,]+)/g, (m, a, b) => pre(a, b) >= 3 ? a : m); return j.charAt(0).toUpperCase() + j.slice(1); };
const found = new Map(); // wikidata -> { name, countries:Set, job, year, links }
function take(b, iso) {
  const id = qid(val(b, 'p')), name = val(b, 'pLabel').trim();
  if (!usable(name) || byWd.has(id) || known.has(norm(name))) return;
  const yy = /^(\d{4})/.exec(val(b, 'dob')); if (yy && +yy[1] > 2007) return; // pas de mineurs
  const e = found.get(id) || { name, countries: new Set(), job: '', year: '', links: 0, followers: 0 };
  e.countries.add(iso || val(b, 'iso'));
  e.job = e.job || shortJob(val(b, 'occ').split(', ').filter(Boolean).slice(0, 2).join(' et ') || '');
  const y = /^(\d{4})/.exec(val(b, 'dob')); e.year = e.year || (y && +y[1] >= 1900 && +y[1] <= 2015 ? y[1] : '');
  e.links = Math.max(e.links, +val(b, 'links') || 0); e.followers = Math.max(e.followers, +val(b, 'followers') || 0);
  found.set(id, e);
}

const todo = countries.map(c => c.code).filter(c => !ONLY.length || ONLY.includes(c));
let failed = [];
for (const iso of todo) {
  // Les grands pays dépassent le délai de Wikidata : on relève le seuil de notoriété jusqu'à obtenir une réponse.
  let ok = false;
  for (const mult of [1, 2, 4]) {
    try { (await sparql(countryQuery(iso, MINL * mult, PER))).forEach(b => take(b, iso)); ok = true; break; }
    catch (e) { await sleep(3000); }
  }
  if (!ok) failed.push(iso);
  process.stderr.write(`${iso} ${found.size}\r`);
  await sleep(1200);
}
if (CREATORS) {
  try { (await sparql(creatorQuery(MINF, 1500))).forEach(b => take(b, '')); }
  catch (e) { console.error('Créateurs : requête échouée (' + e.message + ')'); }
}

const valid = new Set(countries.map(c => c.code));
const rows = [...found.entries()].map(([id, e]) => ({ id, ...e, cc: [...e.countries].filter(c => valid.has(c)) })).filter(e => e.cc.length)
  .sort((a, b) => (b.links + b.followers / 1e5) - (a.links + a.followers / 1e5));
{ const seenN = new Set(); for (let i = 0; i < rows.length; i++) { const k = norm(rows[i].name); if (seenN.has(k)) rows.splice(i--, 1); else seenN.add(k); } }
console.log(`\n${rows.length} nouvelles personnes trouvées` + (failed.length ? ` (pays sans réponse : ${failed.join(' ')})` : ''));
rows.slice(0, 25).forEach(e => console.log(`  ${e.name} [${e.cc.join('/')}] ${e.job} ${e.year} (${e.links} pages${e.followers ? ', ' + e.followers + ' abonnés' : ''})`));

if (WRITE) {
  const today = new Date().toISOString().slice(0, 10);
  rows.forEach(e => people.push({ name: e.name, countries: e.cc.join('/'), tier: 'r', aliases: '', job: e.job, birth_year: e.year, hint: '', tags: 'f', wikidata: e.id, status: 'verified', verified_on: today, note: 'ajouté automatiquement depuis Wikidata (notoriété)' }));
  fs.writeFileSync(path.join(root, 'data/people.csv'), stringifyCSV(people, PEOPLE_COLS));
  console.log(`data/people.csv mis à jour (${people.length} lignes).`);
}
