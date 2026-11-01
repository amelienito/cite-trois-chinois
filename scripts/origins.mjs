#!/usr/bin/env node
// Ajoute les pays d'origine (parents, naissance, autre sélection) à des personnalités connues,
// pour que le jeu leur donne des demi-points dans ces pays. Idempotent : on peut le relancer
// après chaque élargissement de la base.
//   node scripts/origins.mjs          # affiche ce qui changerait
//   node scripts/origins.mjs --write  # écrit data/people.csv
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV, stringifyCSV, norm, PEOPLE_COLS } from './lib.mjs';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRITE = process.argv.includes('--write');

// nom : pays d'origine à ajouter (le pays principal reste celui de la base)
const ORIGINS = `
Kylian Mbappé: CM DZ
Karim Benzema: DZ
Paul Pogba: GN
N'Golo Kanté: ML
Ousmane Dembélé: ML MR SN
Aurélien Tchouaméni: CM
Eduardo Camavinga: CD AO
Ibrahima Konaté: ML
Dayot Upamecano: GW
Théo Hernandez: ES
Lucas Hernandez: ES
Jules Koundé: BJ
Randal Kolo Muani: CD
Désiré Doué: CI
Rayan Cherki: DZ
Ferland Mendy: SN
Youssouf Fofana: ML
Kurt Zouma: CF
Wissam Ben Yedder: TN
Nabil Fekir: DZ
Samir Nasri: DZ
Lamine Yamal: MA GQ
Nico Williams: GH
Iñaki Williams: GH
Ansu Fati: GW
Brahim Díaz: MA
Achraf Hakimi: ES
Romelu Lukaku: CD
Jérémy Doku: GH
Leroy Sané: SN
Antonio Rüdiger: SL
Jamal Musiala: NG GB
İlkay Gündoğan: TR
Mesut Özil: TR
Serge Gnabry: CI
Jonathan Tah: CI
Granit Xhaka: XK
Xherdan Shaqiri: XK
Bukayo Saka: NG
Raheem Sterling: JM
Jadon Sancho: TT
Eberechi Eze: NG
Declan Rice: IE
Erling Haaland: GB
Alphonso Davies: LR
Folarin Balogun: GB NG
Hakan Çalhanoğlu: DE
Kenan Yıldız: DE
Rafael Leão: AO
Renato Sanches: CV
Mario Balotelli: GH
Moise Kean: CI
Memphis Depay: GH
Virgil van Dijk: SR
Sofyan Amrabat: NL
Hakim Ziyech: NL
Noussair Mazraoui: NL
Riyad Mahrez: FR
Ismaël Bennacer: FR
Houssem Aouar: FR
Rayan Aït-Nouri: FR
Pierre-Emerick Aubameyang: FR
Zlatan Ibrahimović: BA HR
`;
const people = parseCSV(fs.readFileSync(path.join(root, 'data/people.csv'), 'utf8'));
const valid = new Set(parseCSV(fs.readFileSync(path.join(root, 'data/countries.csv'), 'utf8')).map(c => c.code));
const by = new Map();
people.forEach(p => { [p.name, ...String(p.aliases || '').split(';')].filter(Boolean).forEach(n => { const k = norm(n); if (!by.has(k)) by.set(k, p); }); });
let changed = 0; const missing = [];
for (const line of ORIGINS.trim().split('\n')) {
  const [name, rest] = line.split(':'); const add = rest.trim().split(/\s+/).filter(c => valid.has(c));
  const p = by.get(norm(name)); if (!p) { missing.push(name); continue; }
  const cur = p.countries.split('/').filter(Boolean), next = [...cur];
  add.forEach(c => { if (!next.includes(c)) next.push(c); });
  if (next.length !== cur.length) { p.countries = next.join('/'); changed++; console.log(`${p.name}: ${cur.join('/')} -> ${next.join('/')}`); }
}
console.log(`\n${changed} personnes modifiées` + (missing.length ? ` · absentes de la base : ${missing.join(', ')}` : ''));
if (WRITE && changed) fs.writeFileSync(path.join(root, 'data/people.csv'), stringifyCSV(people, PEOPLE_COLS));
