/**
 * CSV building (FR-9 Must) — pure text, unit-tested. Sharing the file lives
 * in src/documents/share.ts with the other share-sheet code.
 */

/** RFC-4180 style: quote any cell containing comma, quote or newline. */
export function toCsv(rows: (string | number | undefined)[][]): string {
  return rows
    .map(row =>
      row
        .map(cell => {
          const s = cell === undefined ? '' : String(cell);
          return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(','),
    )
    .join('\r\n');
}
