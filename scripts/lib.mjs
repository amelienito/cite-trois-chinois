// Petit lecteur/écrivain CSV (RFC 4180) sans dépendance.
export function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift();
  return rows.filter(r => r.length > 1 || r[0] !== '').map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
export function stringifyCSV(rows, cols) {
  const esc = v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n') + '\n';
}
export const norm = s => String(s).toLowerCase().replace(/[øłđßæœı]/g, c => ({ 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ı': 'i' }[c]))
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const PEOPLE_COLS = ['name', 'countries', 'tier', 'aliases', 'job', 'birth_year', 'hint', 'tags', 'wikidata', 'status', 'verified_on', 'note'];
export const HISTORY_COLS = ['name', 'countries', 'era', 'job', 'hint', 'alive', 'wikidata', 'status', 'verified_on', 'note'];
