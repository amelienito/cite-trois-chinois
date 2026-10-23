// Assemble docs/index.html à partir des CSV (data/) et du code du jeu (src/).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV } from './lib.mjs';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const pkg = JSON.parse(read('package.json'));
let repo = (process.argv.find(a => a.startsWith('--repo=')) || '').slice(7) || process.env.GITHUB_REPOSITORY || (pkg.config && pkg.config.repo) || '';
if (/VOTRE/.test(repo)) repo = '';

const countries = parseCSV(read('data/countries.csv'));
const NAMES = {}, CONT = {}, TIER = {};
countries.forEach(c => { NAMES[c.code] = c.name_fr; CONT[c.code] = c.continent; TIER[c.code] = c.tier; });
// Les lignes « rejected » (personne décédée, erreur…) ne sont jamais embarquées dans le jeu.
const DB = parseCSV(read('data/people.csv')).filter(r => r.status !== 'rejected')
  .map(r => [r.name, r.countries, r.tier || 'r', r.aliases, r.job, r.birth_year, r.hint, r.tags]);
const HIST = parseCSV(read('data/history.csv')).filter(r => r.status !== 'rejected')
  .map(r => [r.name, r.countries, r.era, r.job, r.hint, r.alive]);
const EXCL = [];
const DEAD = parseCSV(read('data/dead.csv')).map(r => [r.name, r.countries, r.aliases, r.job, r.hint]);
const data = 'window.__HIST=' + JSON.stringify(HIST) + ';window.__NAMES=' + JSON.stringify(NAMES) + ';window.__CONT=' + JSON.stringify(CONT) +
  ';window.__TIER=' + JSON.stringify(TIER) + ';window.__DB=' + JSON.stringify(DB) + ';window.__EXCL=' + JSON.stringify(EXCL) + ';window.__DEAD=' + JSON.stringify(DEAD) + ';';
const shim = '<script>window.jsVectorMap={addMap:function(n,d){window.__WORLD=d;}};</script>\n<script>/* Carte : jsvectormap (MIT, voir vendor/LICENSE-jsvectormap) */\n' + read('vendor/world.js') + '</script>\n';
const html = '<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  (repo ? '<meta name="repo" content="' + repo + '">' : '') + '\n' + read('src/head.html') + '</head><body>\n' + read('src/body.html') + shim +
  '<script>' + data + '</script>\n<script>\n' + read('src/game.js') + '</script>\n</body></html>\n';
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/index.html'), html);
console.log(`docs/index.html : ${DB.length} personnes, ${HIST.length} figures historiques, ${countries.length} pays`);
