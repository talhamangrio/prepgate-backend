/**
 * Tiny CSV parser — handles quoted fields, doubled-quote escaping, embedded
 * newlines, and embedded commas inside quoted fields.
 *
 * Why hand-rolled? The backend currently has zero npm deps for CSV parsing,
 * and adding one (csv-parse, papaparse, etc.) for a single admin endpoint
 * is overkill. This implementation is ~30 lines and covers the full RFC 4180
 * spec well enough for the question-bulk-upload use case.
 *
 * Returns an array of arrays (rows of cells). The caller is responsible for
 * treating the first row as a header.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  // Strip BOM if present
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }

    // Not in quotes
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      // Swallow standalone CR; handle CRLF as just \n
      if (text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }
    cell += ch;
    i++;
  }

  // Flush trailing cell/row (file without final newline)
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // Drop trailing empty row (from final newline)
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') {
    rows.pop();
  }

  return rows;
}

/**
 * Parse CSV text into an array of row objects using the first row as headers.
 * Returns { rows, errors }. `errors` is an array of { row, message }.
 */
function parseCsvWithHeaders(text, requiredHeaders = []) {
  const raw = parseCsv(text);
  if (raw.length === 0) {
    return { rows: [], errors: [{ row: 0, message: 'File is empty.' }] };
  }
  const headers = raw[0].map(h => h.trim());
  const missing = requiredHeaders.filter(h => !headers.includes(h));
  if (missing.length) {
    return { rows: [], errors: [{ row: 0, message: `Missing required headers: ${missing.join(', ')}. Found: ${headers.join(', ')}` }] };
  }
  const idx = name => headers.indexOf(name);

  const rows = [];
  const errors = [];
  for (let i = 1; i < raw.length; i++) {
    const cells = raw[i];
    if (cells.length === 1 && cells[0] === '') continue; // skip blank
    const obj = {};
    headers.forEach((h, j) => { obj[h] = (cells[j] || '').trim(); });
    rows.push({ _rowNum: i + 1, ...obj });
  }
  return { rows, errors };
}

module.exports = { parseCsv, parseCsvWithHeaders };
