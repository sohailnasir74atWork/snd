import { dueLabel, nextDay } from '../day';

describe('when the rider is told a round is due', () => {
  test('tomorrow says so AND carries the date', () => {
    // The word alone is what someone reads at 11pm and gets wrong; the date
    // alone is a sum. Both, always.
    expect(dueLabel('2026-08-12', '2026-08-11')).toBe('Tomorrow · 12 Aug');
  });

  test('further out is just the date — "in 3 days" is a sum nobody should do', () => {
    expect(dueLabel('2026-08-15', '2026-08-11')).toBe('15 Aug');
  });

  test('it crosses a month end', () => {
    expect(dueLabel('2026-09-01', '2026-08-31')).toBe('Tomorrow · 1 Sep');
    expect(nextDay('2026-08-31')).toBe('2026-09-01');
  });

  test('it crosses a year end', () => {
    expect(dueLabel('2027-01-01', '2026-12-31')).toBe('Tomorrow · 1 Jan');
  });

  test('a leap day is a real day', () => {
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
    expect(dueLabel('2028-02-29', '2028-02-28')).toBe('Tomorrow · 29 Feb');
  });

  test('rubbish in is echoed back — never a crash on a rider screen', () => {
    expect(dueLabel('', '2026-08-11')).toBe('');
    expect(dueLabel('not-a-date', '2026-08-11')).toBe('not-a-date');
    expect(dueLabel('2026-13-01', '2026-08-11')).toBe('2026-13-01');
  });
});
