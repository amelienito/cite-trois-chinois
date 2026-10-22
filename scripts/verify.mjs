#!/usr/bin/env node
// Vérifie chaque personne auprès de Wikidata : existe, est un humain, est vivante, a une notoriété
// suffisante (nombre de pages Wikipédia), a le bon pays et la bonne année de naissance.
//
//   node scripts/verify.mjs                      # tout vérifier, rapport seulement
//   node scripts/verify.mjs --write              # met à jour data/people.csv (statut, identifiant Wikidata)
//   node scripts/verify.mjs --since origin/main  # seulement les lignes ajoutées ou modifiées depuis cette révision
//   node scripts/verify.mjs --status unverified  # seulement un statut donné (unverified, review, verified)
//   node scripts/verify.mjs --only "Booba"       # un seul nom
//   node scripts/verify.mjs --strict             # code de sortie 1 si une ligne n'est pas « verified »
//   options : --min-sitelinks 8  --concurrency 4  --limit 100  --file people|history
//
// Statuts écrits :
//   verified  → humain vivant, notoire, pays et année cohérents (identifiant Wikidata enregistré)
//   review    → trouvé mais quelque chose cloche (pays, année, notoriété faible) : à relire à la main
//   rejected  → personne décédée ou entité qui n'est pas un humain : exclue du jeu
//   unverified→ introuvable sur Wikidata (ou erreur réseau) : à corriger (orthographe, alias) ou retirer
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCSV, stringifyCSV, norm, PEOPLE_COLS, HISTORY_COLS } from './lib.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const WRITE = opt('write', false) === true, STRICT = opt('strict', false) === true;
const MIN_LINKS = +opt('min-sitelinks', 8), CONC = +opt('concurrency', 4), LIMIT = +opt('limit', 0);
const FILE = opt('file', 'people');
const API = process.env.WIKIDATA_API || 'https://www.wikidata.org/w/api.php';
const UA = 'Cite3Chinois-verify/1.0 (verification de base de donnees; voir le depot GitHub du projet)';
const today = new Date().toISOString().slice(0, 10);

const sleep = ms => new Promise(r => setTimeout(r, ms));
export async function api(params, fetchFn = fetch) {
  const url = API + '?' + new URLSearchParams({ format: 'json', origin: '*', ...params });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetchFn(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
      if (res.status === 429 || res.status >= 500) { await sleep(1500 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (e) { if (attempt === 3) throw e; await sleep(800 * (attempt + 1)); }
  }
}
const claimIds = (e, p) => ((e.claims || {})[p] || []).map(c => c.mainsnak?.datavalue?.value?.id).filter(Boolean);
const claimYear = (e, p) => { const t = ((e.claims || {})[p] || [])[0]?.mainsnak?.datavalue?.value?.time; const m = t && /^[+-]?(\d{4})/.exec(t); return m ? +m[1] : null; };
const hasClaim = (e, p) => ((e.claims || {})[p] || []).length > 0;

const isoCache = new Map();
async function isoOf(countryIds) {
  const need = countryIds.filter(q => !isoCache.has(q));
  for (let i = 0; i < need.length; i += 50) {
    const ids = need.slice(i, i + 50);
    const r = await api({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims' });
    ids.forEach(q => {
      const e = r.entities?.[q];
      isoCache.set(q, e ? (((e.claims || {}).P297 || [])[0]?.mainsnak?.datavalue?.value || null) : null);
    });
  }
  return countryIds.map(q => isoCache.get(q)).filter(Boolean);
}

async function candidates(row) {
  const names = [row.name, ...(row.aliases || '').split(';').filter(Boolean)].slice(0, 3);
  const ids = new Set();
  for (const n of names) for (const lang of ['fr', 'en']) {
    const r = await api({ action: 'wbsearchentities', search: n, language: lang, uselang: lang, type: 'item', limit: '6' });
    (r.search || []).forEach(s => ids.add(s.id));
    if (ids.size >= 12) break;
  }
  const list = [...ids].slice(0, 20), out = [];
  for (let i = 0; i < list.length; i += 50) {
    const r = await api({ action: 'wbgetentities', ids: list.slice(i, i + 50).join('|'), props: 'claims|sitelinks|labels|descriptions', languages: 'fr|en' });
    Object.values(r.entities || {}).forEach(e => out.push(e));
  }
  return out;
}
function describe(e) {
  return {
    qid: e.id, human: claimIds(e, 'P31').includes('Q5'), dead: hasClaim(e, 'P570'),
    birth: claimYear(e, 'P569'), countries: claimIds(e, 'P27'), links: Object.keys(e.sitelinks || {}).length,
    label: e.labels?.fr?.value || e.labels?.en?.value || e.id, desc: e.descriptions?.fr?.value || e.descriptions?.en?.value || ''
  };
}

/** Rend le verdict pour une ligne du CSV. */
export async function judge(row, { isPeople = true } = {}) {
  let cands = [];
  if (row.wikidata) {
    const r = await api({ action: 'wbgetentities', ids: row.wikidata, props: 'claims|sitelinks|labels|descriptions', languages: 'fr|en' });
    cands = Object.values(r.entities || {}).filter(e => !e.missing);
  } else cands = await candidates(row);
  let infos = cands.map(describe).filter(d => d.human);
  if (!infos.length) return { status: 'unverified', note: row.wikidata ? 'identifiant Wikidata inconnu ou non humain' : 'aucun humain trouvé sur Wikidata : vérifier l’orthographe ou ajouter un alias' };
  const wanted = (row.countries || '').split('/').filter(Boolean);
  const year = +(row.birth_year || 0) || null;
  for (const d of infos) d.iso = await isoOf(d.countries);
  const score = d => (d.iso.some(c => wanted.includes(c)) ? 1000 : 0) + (year && d.birth && Math.abs(d.birth - year) <= 1 ? 500 : 0) + Math.min(d.links, 200) + (d.dead ? -50 : 0);
  infos.sort((a, b) => score(b) - score(a));
  const d = infos[0], base = { wikidata: d.qid };
  if (d.dead) return { ...base, status: 'rejected', note: `décédé(e) selon Wikidata (${d.label})` };
  const issues = [];
  if (d.links < MIN_LINKS) issues.push(`notoriété faible (${d.links} pages Wikipédia, seuil ${MIN_LINKS})`);
  if (d.iso.length && !d.iso.some(c => wanted.includes(c))) issues.push(`pays Wikidata ${d.iso.join('/')} ≠ ${wanted.join('/')}`);
  if (isPeople && year && d.birth && Math.abs(d.birth - year) > 1) issues.push(`année de naissance Wikidata ${d.birth} ≠ ${year}`);
  if (issues.length) return { ...base, status: 'review', note: `${d.label} : ${issues.join(' ; ')}` };
  return { ...base, status: 'verified', note: `${d.label}${d.desc ? ' — ' + d.desc : ''} (${d.links} pages)` };
}

async function pool(items, n, fn) {
  let i = 0; const out = new Array(items.length);
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

async function main() {
  const isPeople = FILE !== 'history';
  const file = path.join(root, 'data', isPeople ? 'people.csv' : 'history.csv');
  const cols = isPeople ? PEOPLE_COLS : HISTORY_COLS;
  const rows = parseCSV(fs.readFileSync(file, 'utf8'));
  let todo = rows.map((r, i) => ({ r, i }));
  const since = opt('since', null);
  if (since && since !== true) {
    let old = [];
    try { old = parseCSV(execFileSync('git', ['show', `${since}:data/${path.basename(file)}`], { cwd: root, encoding: 'utf8' })); } catch { /* fichier absent avant */ }
    const key = r => [r.name, r.countries, r.birth_year, r.aliases].join('|');
    const oldKeys = new Set(old.map(key));
    todo = todo.filter(({ r }) => !oldKeys.has(key(r)));
  }
  const st = opt('status', null); if (st && st !== true) todo = todo.filter(({ r }) => r.status === st);
  const only = opt('only', null); if (only && only !== true) todo = todo.filter(({ r }) => norm(r.name) === norm(only));
  if (LIMIT) todo = todo.slice(0, LIMIT);
  console.log(`Vérification de ${todo.length} ligne(s) sur ${rows.length} (${path.basename(file)}), seuil ${MIN_LINKS} pages…`);
  let done = 0;
  const results = await pool(todo, CONC, async ({ r }) => {
    let v; try { v = await judge(r, { isPeople }); } catch (e) { v = { status: 'unverified', note: 'erreur réseau : ' + e.message }; }
    if (++done % 25 === 0) console.log(`  ${done}/${todo.length}`);
    return v;
  });
  const report = { date: today, minSitelinks: MIN_LINKS, counts: {}, items: [] };
  results.forEach((v, k) => {
    const { r } = todo[k];
    report.counts[v.status] = (report.counts[v.status] || 0) + 1;
    if (v.status !== 'verified') report.items.push({ name: r.name, countries: r.countries, status: v.status, wikidata: v.wikidata || '', note: v.note });
    if (WRITE) { r.status = v.status; if (v.wikidata) r.wikidata = v.wikidata; r.verified_on = v.status === 'unverified' ? '' : today; r.note = v.note; }
  });
  if (WRITE) fs.writeFileSync(file, stringifyCSV(rows, cols));
  fs.writeFileSync(path.join(root, 'data', 'verification-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Résultat :', JSON.stringify(report.counts));
  report.items.filter(i => i.status === 'rejected').forEach(i => console.log(`  ✖ ${i.name} (${i.countries}) : ${i.note}`));
  report.items.filter(i => i.status === 'review').slice(0, 40).forEach(i => console.log(`  ? ${i.name} (${i.countries}) : ${i.note}`));
  report.items.filter(i => i.status === 'unverified').slice(0, 40).forEach(i => console.log(`  · ${i.name} (${i.countries}) : ${i.note}`));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ['## Vérification Wikidata', '', '```json', JSON.stringify(report.counts), '```', '', '| Nom | Pays | Statut | Note |', '|---|---|---|---|', ...report.items.slice(0, 200).map(i => `| ${i.name} | ${i.countries} | ${i.status} | ${i.note.replace(/\|/g, '/')} |`)];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
  }
  const bad = report.items.filter(i => i.status === 'rejected').length || (STRICT && report.items.length);
  if (bad && !WRITE) process.exit(1);
  if (STRICT && report.items.length) process.exit(1);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main().catch(e => { console.error(e); process.exit(2); });
