import { formatAmount, formatMoney, amountInWords, amountInWordsLine } from '../money';
import { normalizeWhatsApp, formatLocal } from '../phone';
import { allocateFifo } from '../fifo';

describe('money — integers, separators, words (§8.2, §13)', () => {
  test('thousands separators, South-Asian grouping', () => {
    expect(formatAmount(0)).toBe('0');
    expect(formatAmount(939)).toBe('939');
    expect(formatAmount(9139)).toBe('9,139');
    expect(formatAmount(210400)).toBe('2,10,400');
    expect(formatAmount(12345678)).toBe('1,23,45,678');
    expect(formatAmount(-4139)).toBe('-4,139');
  });

  test('symbol comes from settings', () => {
    expect(formatMoney(9139, 'Rs')).toBe('Rs 9,139');
  });

  test('floats are refused — money is integers only', () => {
    expect(() => formatAmount(91.39)).toThrow();
  });

  test('amount in words matches the §8.3 sample bill', () => {
    expect(amountInWords(9139)).toBe('nine thousand one hundred thirty-nine');
    expect(amountInWordsLine(9139)).toBe('Rupees nine thousand one hundred thirty-nine only');
  });

  test('words across the lakh/crore ladder', () => {
    expect(amountInWords(0)).toBe('zero');
    expect(amountInWords(100000)).toBe('one lakh');
    expect(amountInWords(210400)).toBe('two lakh ten thousand four hundred');
    expect(amountInWords(10000000)).toBe('one crore');
    expect(amountInWords(10203045)).toBe('one crore two lakh three thousand forty-five');
  });
});

describe('phone — WhatsApp normalisation (FR-5.3)', () => {
  test('the plan §6 canonical case', () => {
    expect(normalizeWhatsApp('0300-1234567', '+92')).toBe('923001234567');
  });
  test('idempotent on re-save', () => {
    expect(normalizeWhatsApp('923001234567', '92')).toBe('923001234567');
  });
  test('handles 00-prefix and spaces', () => {
    expect(normalizeWhatsApp('0092 300 1234567', '92')).toBe('923001234567');
  });
  test('local display form round-trips', () => {
    expect(formatLocal('923001234567', '92')).toBe('0300-1234567');
  });
});

describe('fifo — oldest bill first (FR-7.4/7.8)', () => {
  const bills = [
    { orderId: 'B', balance: 4139, billedAt: 200 },
    { orderId: 'A', balance: 2300, billedAt: 100 }, // oldest
    { orderId: 'C', balance: 5000, billedAt: 300 },
  ];

  test('the §17.2 scenario: Rs 7,000 against a 4,139 bill + older khata', () => {
    const r = allocateFifo(7000, bills);
    expect(r.allocations).toEqual([
      { orderId: 'A', amount: 2300 },
      { orderId: 'B', amount: 4139 },
      { orderId: 'C', amount: 561 },
    ]);
    expect(r.unallocated).toBe(0);
  });

  test('overpayment surfaces as unallocated, never lost', () => {
    const r = allocateFifo(12000, bills);
    expect(r.unallocated).toBe(12000 - (2300 + 4139 + 5000));
  });

  test('zero amount allocates nothing', () => {
    expect(allocateFifo(0, bills).allocations).toEqual([]);
  });

  test('input order does not matter, billedAt does', () => {
    const r = allocateFifo(2300, [...bills].reverse());
    expect(r.allocations).toEqual([{ orderId: 'A', amount: 2300 }]);
  });
});
