import {
  bookersOf, riderForShop, shopsForBooker, unassignedOf, visitCycleDays,
} from '../assignment';
import type { Area, Shop } from '../../data/models';

const area = (name: string, riderId?: string): Area =>
  ({ id: `a-${name}`, name, active: true, riderId } as Area);
const shop = (areaName: string): Shop => ({ area: areaName } as Shop);
/** A round carrying the LEGACY single-booker field — the pre-sharing shape. */
const round = (name: string, bookerId?: string): Area =>
  ({ id: `a-${name}`, name, active: true, bookerId } as Area);
/** A round in the current shape: any number of bookers, including none. */
const shared = (name: string, ...bookerIds: string[]): Area =>
  ({ id: `a-${name}`, name, active: true, bookerIds } as Area);

describe('riderForShop — the assignment ladder', () => {
  const areas = [area('Saddar', 'ali'), area('Gulberg', 'usman'), area('Bund Road')];

  it('uses the rider on the shop\'s round', () => {
    expect(riderForShop(shop('Saddar'), areas, {})).toBe('ali');
    expect(riderForShop(shop('Gulberg'), areas, {})).toBe('usman');
  });

  it('falls back to the company default when the round has nobody', () => {
    expect(riderForShop(shop('Bund Road'), areas, { defaultRiderId: 'kamran' })).toBe('kamran');
  });

  it('prefers the round over the default — this is the whole point', () => {
    // The bug this replaces: every order in the company went to one uid.
    expect(riderForShop(shop('Saddar'), areas, { defaultRiderId: 'kamran' })).toBe('ali');
  });

  it('honours the pre-multi-rider setting so old companies keep delivering', () => {
    expect(riderForShop(shop('Bund Road'), areas, { autoAssignRiderId: 'legacy' })).toBe('legacy');
    // …but never in preference to a real assignment.
    expect(riderForShop(shop('Saddar'), areas, { autoAssignRiderId: 'legacy' })).toBe('ali');
    expect(riderForShop(shop('Bund Road'), areas, {
      defaultRiderId: 'kamran', autoAssignRiderId: 'legacy',
    })).toBe('kamran');
  });

  it('returns null rather than guessing', () => {
    expect(riderForShop(shop('Bund Road'), areas, {})).toBeNull();
    expect(riderForShop(shop('Nowhere'), areas, {})).toBeNull();
    expect(riderForShop(undefined, areas, {})).toBeNull();
  });

  it('matches the area by name, which is what a shop actually stores', () => {
    // Renaming an area is a fan-out over shops; until it lands, an unmatched
    // name must degrade to the default rather than throw.
    expect(riderForShop(shop('saddar'), areas, { defaultRiderId: 'kamran' })).toBe('kamran');
  });
});

describe('unassignedOf', () => {
  const staff = { ali: 'Ali', usman: 'Usman' };

  it('finds orders with no rider at all', () => {
    const orders = [{ status: 'booked' as const, assignedTo: undefined }];
    expect(unassignedOf(orders, staff)).toHaveLength(1);
  });

  it('finds orders addressed to someone who has left', () => {
    const orders = [{ status: 'assigned' as const, assignedTo: 'departed' }];
    expect(unassignedOf(orders, staff)).toHaveLength(1);
  });

  it('leaves properly addressed orders alone', () => {
    const orders = [{ status: 'assigned' as const, assignedTo: 'ali' }];
    expect(unassignedOf(orders, staff)).toHaveLength(0);
  });

  it('ignores orders that are already done or dead', () => {
    const orders = [
      { status: 'delivered' as const, assignedTo: 'departed' },
      { status: 'cancelled' as const, assignedTo: undefined },
      { status: 'returned' as const, assignedTo: undefined },
    ];
    expect(unassignedOf(orders, staff)).toHaveLength(0);
  });
});

describe('shopsForBooker — territories', () => {
  const shops = [shop('Saddar'), shop('Gulberg'), shop('Bund Road'), shop('Untyped')];

  it('shows everyone everything while no round has a booker', () => {
    // A one-booker business must behave exactly as it did before territories.
    const areas = [round('Saddar'), round('Gulberg'), round('Bund Road')];
    expect(shopsForBooker('ali', shops, areas)).toHaveLength(4);
    expect(shopsForBooker('anyone', shops, areas)).toHaveLength(4);
  });

  it('gives a booker exactly his rounds once he has any', () => {
    const areas = [round('Saddar', 'ali'), round('Gulberg', 'usman'), round('Bund Road')];
    expect(shopsForBooker('ali', shops, areas).map(s => s.area)).toEqual(['Saddar']);
    expect(shopsForBooker('usman', shops, areas).map(s => s.area)).toEqual(['Gulberg']);
  });

  it('never returns an empty screen: an unassigned booker gets the uncovered rounds', () => {
    const areas = [round('Saddar', 'ali'), round('Gulberg', 'usman'), round('Bund Road')];
    // Bund Road has no booker, and 'Untyped' has no area document at all —
    // both are work nobody else is doing, so the spare booker gets them.
    expect(shopsForBooker('newcomer', shops, areas).map(s => s.area).sort())
      .toEqual(['Bund Road', 'Untyped']);
  });

  it('does not hand a covered round to a second booker', () => {
    const areas = [round('Saddar', 'ali')];
    expect(shopsForBooker('newcomer', shops, areas).map(s => s.area)).not.toContain('Saddar');
  });

  /**
   * Every test above builds its areas with the legacy single `bookerId`, so
   * the whole block doubles as the regression suite for the migration shim: a
   * company that has not touched its rounds since sharing arrived must behave
   * exactly as it did. These add the shared case on top.
   */
  describe('a round may be worked by more than one booker', () => {
    it('puts a shared round on every one of their screens', () => {
      const areas = [shared('Saddar', 'ali', 'usman'), round('Gulberg', 'kamran')];
      expect(shopsForBooker('ali', shops, areas).map(s => s.area)).toEqual(['Saddar']);
      expect(shopsForBooker('usman', shops, areas).map(s => s.area)).toEqual(['Saddar']);
    });

    it('still hides the rounds a sharer is not on', () => {
      const areas = [shared('Saddar', 'ali', 'usman'), round('Gulberg', 'kamran')];
      expect(shopsForBooker('ali', shops, areas).map(s => s.area)).not.toContain('Gulberg');
    });

    it('counts a shared round as covered, so a spare booker does not get it too', () => {
      const areas = [shared('Saddar', 'ali', 'usman')];
      expect(shopsForBooker('newcomer', shops, areas).map(s => s.area)).not.toContain('Saddar');
    });

    it('treats an empty array as unclaimed, exactly like an absent field', () => {
      // setAreaBooker deletes the key rather than writing [], but a document
      // written by an older build must not become a round nobody can see.
      const areas = [shared('Saddar'), round('Gulberg', 'usman')];
      expect(shopsForBooker('newcomer', shops, areas).map(s => s.area)).toContain('Saddar');
    });

    it('prefers the array when a document somehow carries both fields', () => {
      const both = { ...shared('Saddar', 'usman'), bookerId: 'ali' } as Area;
      expect(shopsForBooker('usman', shops, [both]).map(s => s.area)).toEqual(['Saddar']);
      // 'ali' was replaced when the owner edited the round, not kept alongside.
      expect(shopsForBooker('ali', shops, [both]).map(s => s.area)).not.toContain('Saddar');
    });
  });
});

describe('bookersOf — the one place that knows the old shape', () => {
  it('reads the array, the legacy field, or neither', () => {
    expect(bookersOf(shared('Saddar', 'ali', 'usman'))).toEqual(['ali', 'usman']);
    expect(bookersOf(round('Saddar', 'ali'))).toEqual(['ali']);
    expect(bookersOf(round('Saddar'))).toEqual([]);
    expect(bookersOf(shared('Saddar'))).toEqual([]);
  });
});

describe('visitCycleDays', () => {
  it('is the whole territory divided by a day\'s work', () => {
    expect(visitCycleDays(200, 20)).toBe(10);
    expect(visitCycleDays(60, 20)).toBe(3);
  });

  it('never returns zero, so a shop can always become due', () => {
    expect(visitCycleDays(0, 20)).toBe(1);
    expect(visitCycleDays(5, 20)).toBe(1);
    expect(visitCycleDays(10, 0)).toBe(10); // a nonsense setting must not divide by zero
  });

  it('is the bug it replaces when handed the whole company', () => {
    // 2,000 shops at 20/day = a 100-day cycle: a shop counted as "due" only
    // once a quarter had passed. Fed one booker's territory it is sane again.
    expect(visitCycleDays(2000, 20)).toBe(100);
    expect(visitCycleDays(200, 20)).toBe(10);
  });
});
