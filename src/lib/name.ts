/**
 * Shop names as they should appear on paper.
 *
 * Bookers type at a counter, on a phone, in a hurry — "ss bakar", "u mart",
 * "bismila pharmaci". The name lands in the database exactly as typed, and it
 * should: correcting what a person typed about their own shop is not the app's
 * business. The BILL is a different matter. It is the document the shopkeeper
 * keeps, and "ss bakar" printed across the top of it looks careless in a way
 * that reflects on the distributor, not the booker.
 *
 * So this is presentation only. Nothing here is ever written back to the shop.
 */

/** Vowels, for the abbreviation test below. `y` counts — "Dry" is a word. */
const VOWELS = /[aeiouy]/i;

/**
 * Is this word an abbreviation rather than a word?
 *
 * Three signals, and each one exists because of a real name:
 *
 *  - **One letter.** "u mart" -> "U Mart". A single letter is never a word
 *    worth lowercasing.
 *  - **No vowel at all.** "ss bakar" -> "SS Bakar", and the same rule gets
 *    "KFC", "TCS", "MCB" right. A pronounceable word in any language this app
 *    serves has a vowel in it somewhere.
 *  - **Shouted while its neighbours are not.** Someone who typed "ABC
 *    Traders" meant ABC, and title-casing it to "Abc" would overrule them.
 *    This one needs CONTEXT, which is why `shouting` is passed in: in "DOLLAR
 *    MALL" every word is capitals, so the caps say nothing except that caps
 *    lock was on, and "MALL" is a word rather than initials. Four letters is
 *    the ceiling either way.
 *
 * Deliberately NOT a dictionary of known brands. A list like that is wrong the
 * first time a shop opens with a name nobody predicted, and it would need
 * maintaining forever by someone who does not know the bazaar.
 */
function isAbbreviation(word: string, shouting: boolean): boolean {
  const letters = word.replace(/[^A-Za-z]/g, '');
  if (letters.length === 0) return false;
  if (letters.length === 1) return true;
  if (!shouting && letters.length <= 4 && letters === letters.toUpperCase()) return true;
  return letters.length <= 4 && !VOWELS.test(letters);
}

/** Capitalise one word, leaving whatever punctuation it carries in place. */
function capitalise(word: string): string {
  return word.replace(/[A-Za-z]/, c => c.toUpperCase());
}

/**
 * Title-case a shop name, shouting the parts that look like initials.
 *
 * Hyphens and slashes split like spaces do — "al-madina" is two words wearing
 * a hyphen, and "Al-Madina" is how it is written on the shutter. Punctuation
 * that is not a separator survives untouched, so "makkah+ pharmacy" keeps its
 * plus and becomes "Makkah+ Pharmacy".
 *
 * A name already typed with care comes out unchanged, which is the case that
 * matters most: this must never make a correct name worse.
 */
export function displayName(raw: string): string {
  // Caps lock on the whole name, rather than deliberate initials in part of
  // it. "DOLLAR MALL" is a shop shouting; "ABC Traders" is a shop called ABC.
  const shouting = /[A-Za-z]/.test(raw) && raw === raw.toUpperCase();
  return raw
    .split(/(\s+)/) // captured, so the original spacing survives
    .map(chunk => {
      if (/^\s+$/.test(chunk)) return chunk;
      return chunk
        .split(/([-/])/)
        .map(part => {
          if (part === '-' || part === '/') return part;
          if (isAbbreviation(part, shouting)) return part.toUpperCase();
          // Lower-cased first so "BISMILA" comes down to "Bismila"; anything
          // the abbreviation test already claimed never reaches here.
          return capitalise(part.toLowerCase());
        })
        .join('');
    })
    .join('');
}
