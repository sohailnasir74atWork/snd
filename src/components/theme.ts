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
 * Two steps down from the first pass, and the second step is 2026-08-12.
 *
 * The owner put this app beside Vyapar on his own handset and the type was
 * visibly larger on every screen — which reads as a simpler app rather than a
 * clearer one, because size is what a phone uses to signal importance and a
 * screen where everything is large signals nothing. Vyapar's menu label sits
 * around 15pt with no subtitle; ours was 15pt bold with a 12pt line under it,
 * so our rows were half again as tall for the same information.
 *
 * Every size here moved down one step together. That is the whole reason this
 * is a scale and not a pile of numbers: the RATIOS carry the hierarchy, so
 * shifting the scale keeps every relationship that was designed on top of it.
 *
 * Nothing goes below 10pt. These phones are read at arm's length in daylight,
 * in a bazaar, by someone who is not going to squint — that floor is a field
 * constraint, not a taste, and `tiny` is deliberately unchanged because it was
 * already sitting on it.
 */
export const font = {
  h1: 18,
  h2: 15,
  body: 13,
  sub: 11,
  tiny: 10,
  stat: 17,
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
