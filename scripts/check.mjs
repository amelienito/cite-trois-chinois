// Contrôles hors-ligne : format, doublons, indices qui révèlent le nom, cohérence des statuts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, norm } from './lib.mjs';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => parseCSV(fs.readFileSync(path.join(root, f), 'utf8'));
const countries = new Set(read('data/countries.csv').map(c => c.code));
const errors = [], warns = [];
const err = (m) => errors.push(m), warn = (m) => warns.push(m);
const STATUS = new Set(['unverified', 'verified', 'review', 'rejected']);

function common(r, where, ccKey = 'countries') {
  const codes = r[ccKey].split('/');
  if (!r.name || r.name.length < 2) err(`${where}: nom vide`);
  if (!r[ccKey]) err(`${where} ${r.name}: aucun pays`);
  codes.forEach(c => { if (!countries.has(c)) err(`${where} ${r.name}: code pays inconnu « ${c} »`); });
  if (!STATUS.has(r.status)) err(`${where} ${r.name}: statut inconnu « ${r.status} »`);
  if (r.status === 'verified' && !/^Q\d+$/.test(r.wikidata)) err(`${where} ${r.name}: statut verified sans identifiant Wikidata`);
  if (r.wikidata && !/^Q\d+$/.test(r.wikidata)) err(`${where} ${r.name}: identifiant Wikidata invalide « ${r.wikidata} »`);
  if (r.hint) {
    const last = norm(r.name).split(' ').pop();
    if (last.length >= 4 && norm(r.hint).includes(last)) err(`${where} ${r.name}: l'indice contient le nom de famille`);
  }
}
const people = read('data/people.csv');
const seen = new Map();
people.forEach((r, i) => {
  const w = `people.csv l.${i + 2}`;
  common(r, w);
  if (!['s', 'r'].includes(r.tier)) err(`${w} ${r.name}: tier doit valoir s ou r`);
  if (r.tags && !/^[gbchfn]+$/.test(r.tags)) err(`${w} ${r.name}: tags invalides « ${r.tags} » (g, b, c, h, f, n)`);
  if (r.birth_year && !/^(Groupe|Duo|Collectif)/.test(r.job) && !(/^\d{4}$/.test(r.birth_year) && +r.birth_year >= 1900 && +r.birth_year <= 2015)) err(`${w} ${r.name}: année de naissance douteuse « ${r.birth_year} »`);
  if (/[gbc]/.test(r.tags) && (!r.hint || !r.birth_year || !r.job)) warn(`${w} ${r.name}: figure du défi sans métier/année/indice`);
  const k = norm(r.name);
  if (seen.has(k)) err(`${w} ${r.name}: doublon avec la ligne ${seen.get(k)} (fusionner les pays avec « / »)`);
  seen.set(k, i + 2);
});
const hist = read('data/history.csv');
hist.forEach((r, i) => { common(r, `history.csv l.${i + 2}`); if (!['0', '1'].includes(r.alive)) err(`history.csv ${r.name}: alive doit valoir 0 ou 1`); });
const count = {}; people.forEach(r => r.countries.split('/').forEach(c => { count[c] = (count[c] || 0) + 1; }));
const empty = [...countries].filter(c => !count[c]);
if (empty.length) warn(`pays sans aucune personne : ${empty.join(' ')}`);
const pending = people.filter(r => r.status === 'unverified').length;
console.log(`${people.length} personnes (${people.filter(r => r.status === 'verified').length} vérifiées, ${pending} à vérifier, ${people.filter(r => r.status === 'review').length} à relire, ${people.filter(r => r.status === 'rejected').length} rejetées), ${hist.length} figures historiques`);
warns.forEach(m => console.log('⚠ ' + m));
errors.forEach(m => console.log('✖ ' + m));
process.exit(errors.length ? 1 : 0);
