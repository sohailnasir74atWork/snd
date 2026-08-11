import { displayName } from '../name';

describe('shop names on paper', () => {
  test('the ordinary case — a booker typing fast', () => {
    expect(displayName('bismila pharmaci')).toBe('Bismila Pharmaci');
    expect(displayName('chaina super store')).toBe('Chaina Super Store');
    expect(displayName('kayani mini mart')).toBe('Kayani Mini Mart');
  });

  test('a word with no vowel is initials, and gets shouted', () => {
    // The name that started this: "Ss bakar" reads as a typo on a bill.
    expect(displayName('ss bakar')).toBe('SS Bakar');
    expect(displayName('Ss Bakar')).toBe('SS Bakar');
    expect(displayName('kfc road branch')).toBe('KFC Road Branch');
  });

  test('a single letter is always a letter, never a word', () => {
    expect(displayName('u mart')).toBe('U Mart');
  });

  test('someone who typed capitals meant them', () => {
    expect(displayName('ABC Traders')).toBe('ABC Traders');
  });

  test('but caps lock on a whole name is not an acronym', () => {
    // Five letters or more is a word being shouted, not initials.
    expect(displayName('DOLLAR MALL')).toBe('Dollar Mall');
  });

  test('hyphens and slashes split like spaces', () => {
    expect(displayName('al-madina traders')).toBe('Al-Madina Traders');
    expect(displayName('a/b store')).toBe('A/B Store');
  });

  test('punctuation that is not a separator survives', () => {
    expect(displayName('makkah+ pharmacy')).toBe('Makkah+ Pharmacy');
  });

  test('a name already written properly is left exactly alone', () => {
    // The case that matters most: this must never make a good name worse.
    for (const n of ['Royal Mini Mart', 'Evolver Skin Care', 'Al-Madina Traders']) {
      expect(displayName(n)).toBe(n);
    }
  });

  test('spacing is preserved, not normalised', () => {
    expect(displayName('u  mart')).toBe('U  Mart');
  });

  test('empty and odd input do not throw', () => {
    expect(displayName('')).toBe('');
    expect(displayName('   ')).toBe('   ');
    expect(displayName('123')).toBe('123');
  });
});
