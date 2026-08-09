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
} as const;

export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  fab: {
    shadowColor: '#E11D48',
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
} as const;
