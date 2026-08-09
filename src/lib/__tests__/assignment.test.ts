import { riderForShop, unassignedOf } from '../assignment';
import type { Area, Shop } from '../../data/models';

const area = (name: string, riderId?: string): Area =>
  ({ id: `a-${name}`, name, active: true, riderId } as Area);
const shop = (areaName: string): Shop => ({ area: areaName } as Shop);

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
