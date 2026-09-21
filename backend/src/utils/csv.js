// Minimal RFC4180-ish CSV stringify/parse. No external dependency — we control both the export
// and import format (they round-trip through the same column shape), so a hand-rolled parser that
// correctly handles quoted fields (commas/quotes/newlines inside a value) is enough.

function csvEscape(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows, columns) {
  const header = columns.map((c) => csvEscape(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => csvEscape(c.value(row))).join(','));
  return [header, ...lines].join('\r\n');
}

// Parses CSV text into an array of plain objects keyed by the header row's column names.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += char; i++; continue;
    }
    if (char === '"') { inQuotes = true; i++; continue; }
    if (char === ',') { pushField(); i++; continue; }
    if (char === '\r') { i++; continue; }
    if (char === '\n') { pushRow(); i++; continue; }
    field += char; i++;
  }
  if (field.length || row.length) pushRow();

  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1)
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(header.map((h, idx) => [h, r[idx] ?? ''])));
}

module.exports = { toCsv, parseCsv };
