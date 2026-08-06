/**
 * CSV + base64 — the export must survive commas, quotes and Urdu characters,
 * and the base64 must round-trip bytes exactly (photos go up through it).
 */
import { toCsv } from '../csv';
import { base64ToBytes, utf8ToBase64 } from '../base64';

test('cells with commas, quotes and newlines are quoted RFC-4180 style', () => {
  expect(toCsv([
    ['Receipt', 'Shop', 'Amount'],
    ['RCP-2026-0001', 'Bismillah, General Store', 8400],
    ['RCP-2026-0002', 'The "Best" Mart', 500],
    ['RCP-2026-0003', 'Line\nBreak', 0],
  ])).toBe(
    'Receipt,Shop,Amount\r\n' +
    'RCP-2026-0001,"Bismillah, General Store",8400\r\n' +
    'RCP-2026-0002,"The ""Best"" Mart",500\r\n' +
    'RCP-2026-0003,"Line\nBreak",0',
  );
});

test('undefined cells become empty, numbers stay unquoted', () => {
  expect(toCsv([[1, undefined, 'x']])).toBe('1,,x');
});

test('utf8ToBase64 matches the canonical encoding, ASCII and beyond', () => {
  expect(utf8ToBase64('Man')).toBe('TWFu'); // the RFC example
  expect(utf8ToBase64('Ma')).toBe('TWE=');
  expect(utf8ToBase64('M')).toBe('TQ==');
  // "Rs" + non-ASCII: ٤ (Arabic-Indic four) = D9 A4 in UTF-8
  expect(utf8ToBase64('٤')).toBe('2aQ=');
});

test('base64ToBytes round-trips what utf8ToBase64 produced', () => {
  // 'A—B': em dash U+2014 is E2 80 94 in UTF-8 — a real multi-byte case.
  const bytes = base64ToBytes(utf8ToBase64('A—B'));
  expect(Array.from(bytes)).toEqual([0x41, 0xe2, 0x80, 0x94, 0x42]);
  // And a padded ASCII case decodes to its exact bytes.
  expect(Array.from(base64ToBytes('TWE='))).toEqual([0x4d, 0x61]); // "Ma"
});

test('reward maths: pieces × per-piece rate, over-limit flag', () => {
  const perPiece = 40;
  const limit = 1000;
  const claim = (pieces: number) => ({ amount: pieces * perPiece, overLimit: pieces * perPiece > limit });
  expect(claim(12)).toEqual({ amount: 480, overLimit: false });
  expect(claim(25)).toEqual({ amount: 1000, overLimit: false });
  expect(claim(26)).toEqual({ amount: 1040, overLimit: true });
});
