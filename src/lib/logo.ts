/**
 * The company logo — what counts as an acceptable one, and how a bill gets it.
 *
 * PURE, like `serials.ts` and for the same reason: `src/documents` renders a
 * bill in a plain Node test and may not pull a native module in. The picker
 * lives in `photos.ts` and the device cache in `logoCache.ts`; this file only
 * knows the rules and how to write a data URI.
 */

/**
 * The size standard, and why each number is where it is.
 *
 * A logo is not a photograph. Too small and it prints as a grey smudge on the
 * one document a shopkeeper keeps; too large and every bill PDF a booker sends
 * over 3G carries weight nobody can see. So it is clamped from both ends
 * rather than merely compressed:
 *
 *   maxEdge  512  — the picker downscales to this before it ever reaches us.
 *                   At the ~20 mm a logo occupies on an A5 sheet that is far
 *                   past what any phone screen or thermal printer resolves.
 *   minEdge  200  — measured AFTER downscaling, so it only ever rejects an
 *                   original that was genuinely small. A 150 px logo blown up
 *                   to fill a bill header is the blur this prevents.
 *   maxBytes 200k — the §10.3 photo budget. At 512 px and quality 0.8 a real
 *                   logo lands near 60 KB, so this is a backstop for a
 *                   pathological image, not a limit anyone will meet.
 */
export const LOGO = {
  maxEdge: 512,
  minEdge: 200,
  maxBytes: 200 * 1024,
} as const;

/**
 * Why this image cannot be the logo, or null if it can.
 *
 * Returns the sentence shown to the owner, not a code: he is standing in the
 * setup wizard with a file manager open, and "too small" is only useful if it
 * says how small and what would work.
 */
export function logoProblem(width: number, height: number, bytes: number): string | null {
  const edge = Math.min(width, height);
  if (!width || !height) {
    return 'That file could not be read as an image. Try a PNG or JPG.';
  }
  if (edge < LOGO.minEdge) {
    return `That image is ${width}×${height}. A logo needs at least ` +
      `${LOGO.minEdge}×${LOGO.minEdge} or it prints blurred on your bills.`;
  }
  if (bytes > LOGO.maxBytes) {
    return `That image is ${Math.round(bytes / 1024)} KB, over the ${
      Math.round(LOGO.maxBytes / 1024)} KB limit. Every bill carries it, so it has to stay light.`;
  }
  return null;
}

/** Bytes behind a base64 payload, without decoding it. */
export function base64Bytes(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/** What an <img src> wants. Undefined in, undefined out — bills print fine without one. */
export function logoDataUri(base64: string | undefined): string | undefined {
  return base64 ? `data:image/jpeg;base64,${base64}` : undefined;
}
