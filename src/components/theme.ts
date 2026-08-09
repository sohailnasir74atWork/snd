/**
 * Design tokens — the app's single visual vocabulary.
 * Reference class: Vyapar-style business apps — light blue canvas, white
 * surfaces with soft shadows, pastel icon tiles, one bold pill CTA per
 * screen, quiet greys for secondary text. No component may hardcode a
 * colour, size or radius that exists here.
 */
export const color = {
  // canvas & surfaces
  bg: '#EDF3FA',          // light blue-grey page canvas
  surface: '#FFFFFF',
  surfaceAlt: '#F7FAFD',

  // brand & accents
  primary: '#2563EB',      // action blue (links, active states, selection)
  primaryDark: '#1D4FD7',
  primarySoft: '#DBEAFE',  // pastel tile behind icons
  cta: '#E11D48',          // the one bold pill per screen (Vyapar crimson)
  ctaSoft: '#FDE7EC',

  // semantic
  success: '#16A34A',
  successSoft: '#DCFCE7',
  warn: '#D97706',
  warnSoft: '#FEF3C7',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',

  // text
  text: '#0F172A',
  textSub: '#64748B',
  textFaint: '#94A3B8',
  onDark: '#FFFFFF',

  // lines
  border: '#E2E8F0',
  /**
   * The card's own edge — a shade lighter than `border`, sitting between the
   * canvas and the surface so it defines the card without drawing a box round
   * it. This is what carries a card's depth now that the Android drop shadow
   * is off; see `shadow.card`.
   */
  cardEdge: '#E7EDF6',
} as const;

/**
 * One step down from the first pass. The screens carry a lot of numbers per
 * card, and the old scale pushed rows into two lines and clipped labels in
 * the joined option bars. Nothing here goes below 10pt — these phones are
 * read at arm's length in daylight.
 */
export const font = {
  h1: 20,
  h2: 16,
  body: 14,
  sub: 12,
  tiny: 10,
  stat: 18,
} as const;

export const radius = {
  card: 12,
  pill: 22,
  tile: 10,
  chip: 16,
} as const;

export const space = {
  xs: 4, s: 6, m: 10, l: 14, xl: 20,
  /**
   * The screen gutter — the distance from the screen edge to a card edge, and
   * the line everything full-width aligns to.
   *
   * It is its own token rather than a reuse of `space.l` because it is not a
   * spacing step: it is one decision about how wide the content column is, and
   * it has to be changed in exactly one place. Card, OptionBar and
   * SectionLabel all read it, so a screen that uses those is aligned for free;
   * anything laid out by hand should use it too rather than picking a step off
   * the scale that happens to match today.
   */
  gutter: 7,
} as const;

export const shadow = {
  /**
   * A card should look SET INTO the canvas, not dropped on top of it.
   *
   * `elevation` is the only one of these Android reads, and at 2 it drew the
   * hard grey Material drop shadow under every card on the screen — on a list
   * of a hundred shops that is a hundred grey bars, which is what made a
   * simple screen feel heavy. It is off now: depth comes from the hairline
   * edge on `card` (see ui.tsx) plus a wide, almost invisible iOS shadow.
   * Wider and fainter reads as light falling on a surface; tight and dark
   * reads as a sticker.
   */
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.035,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 2 },
    elevation: 0,
  },
  fab: {
    shadowColor: '#E11D48',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
} as const;
