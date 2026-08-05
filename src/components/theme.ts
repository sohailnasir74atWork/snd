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

export const font = {
  h1: 22,
  h2: 17,
  body: 15,
  sub: 13,
  tiny: 11,
  stat: 20,
} as const;

export const radius = {
  card: 14,
  pill: 26,
  tile: 12,
  chip: 18,
} as const;

export const space = {
  xs: 4, s: 8, m: 12, l: 16, xl: 24,
} as const;

export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
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
