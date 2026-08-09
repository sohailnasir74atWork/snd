/**
 * When did each person start, when did they stop, and what did they do?
 *
 * Nobody clocks in. Asking a booker to press "start my day" adds a tap he will
 * forget on the one morning it matters, and a button he can press from his bed
 * measures nothing. So the day is READ OFF THE WORK: the first thing he did
 * for a shop is the start, the last thing is the end, and the gap between them
 * is how long he was out.
 *
 * The rider is the exception and gets the better answer — he already presses
 * [Start route] at the depot and [Hand over] at the end, and both now carry a
 * timestamp. Those are used when present because they bracket the real day,
 * including the ride to the first shop and the wait at the last.
 *
 * Deliberately pure: it takes the collections and returns numbers, so the rule
 * for "what counts as work" is one testable function rather than something
 * re-derived slightly differently on every screen.
 */
import type { DayState, Order, Payment, RewardClaim } from '../data/models';

export interface WorkdayInput {
  staffId: string;
  /** Start of the working day, in ms — everything before this belongs to yesterday. */
  dayStartMs: number;
  dayEndMs: number;
  orders: Order[];
  payments: Payment[];
  rewardClaims: RewardClaim[];
  day?: DayState;
}

export interface Workday {
  staffId: string;
  /** ms, or null when this person has done nothing today. */
  startedAt: number | null;
  /** ms of the last thing they did. Equal to startedAt when there is only one. */
  lastActionAt: number | null;
  /** Milliseconds between the two. 0 when there is nothing or only one action. */
  activeMs: number;
  /**
   * Where the start came from. `explicit` means the person pressed a button
   * that recorded the time; `derived` means it is the first piece of work and
   * therefore later than the true start by however long the first ride took.
   */
  startSource: 'explicit' | 'derived' | 'none';
  ordersBooked: number;
  deliveries: number;
  /** Distinct shops touched — the honest "how many did he cover". */
  shopsTouched: number;
  collected: number;
  claims: number;
  handedOver: boolean;
  /** No handover yet and something happened in the last 90 minutes. */
  stillWorking: boolean;
}

/** Anything after this much silence reads as "gone home", not "working". */
const IDLE_MS = 90 * 60 * 1000;

const within = (t: number | undefined, from: number, to: number) =>
  typeof t === 'number' && t >= from && t <= to;

export function computeWorkday(input: WorkdayInput, nowMs: number): Workday {
  const { staffId, dayStartMs, dayEndMs, orders, payments, rewardClaims, day } = input;

  const booked = orders.filter(o => o.bookedBy === staffId && within(o.bookedAt, dayStartMs, dayEndMs));
  const delivered = orders.filter(
    o => o.assignedTo === staffId && within(o.deliveredAt, dayStartMs, dayEndMs),
  );
  // Voided payments are struck off the record, so they are not work either —
  // counting them would let a mistake inflate somebody's day.
  const took = payments.filter(
    p => p.collectedBy === staffId && !p.voided && within(p.createdAt, dayStartMs, dayEndMs),
  );
  const claims = rewardClaims.filter(c => c.by === staffId && within(c.createdAt, dayStartMs, dayEndMs));

  const stamps: number[] = [
    ...booked.map(o => o.bookedAt),
    ...delivered.map(o => o.deliveredAt!),
    ...took.map(p => p.createdAt),
    ...claims.map(c => c.createdAt),
  ];

  const explicitStart = within(day?.routeStartedAt, dayStartMs, dayEndMs)
    ? day!.routeStartedAt!
    : null;
  const explicitEnd = within(day?.handedOverAt, dayStartMs, dayEndMs)
    ? day!.handedOverAt!
    : null;

  const firstWork = stamps.length ? Math.min(...stamps) : null;
  const lastWork = stamps.length ? Math.max(...stamps) : null;

  // The explicit start wins even when it is LATER than the first piece of work
  // would suggest — it cannot be, in practice, but if the clocks disagree the
  // button the person actually pressed is the more trustworthy of the two.
  const startedAt = explicitStart ?? firstWork;
  const lastActionAt = explicitEnd ?? lastWork ?? explicitStart;

  const shopsTouched = new Set([
    ...booked.map(o => o.shopId),
    ...delivered.map(o => o.shopId),
    ...took.map(p => p.shopId),
  ]).size;

  return {
    staffId,
    startedAt,
    lastActionAt,
    activeMs: startedAt !== null && lastActionAt !== null ? Math.max(0, lastActionAt - startedAt) : 0,
    startSource: explicitStart !== null ? 'explicit' : firstWork !== null ? 'derived' : 'none',
    ordersBooked: booked.length,
    deliveries: delivered.length,
    shopsTouched,
    collected: took.reduce((s, p) => s + p.amount, 0),
    claims: claims.length,
    handedOver: !!day?.handedOver,
    stillWorking:
      !day?.handedOver && lastActionAt !== null && nowMs - lastActionAt <= IDLE_MS,
  };
}

/** "7:15 am" — a wall clock, because that is how a day is talked about. */
export function clockTime(ms: number | null): string {
  if (ms === null) return '—';
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "6h 20m" — never "6.33 hours", which nobody says out loud. */
export function durationLabel(ms: number): string {
  if (ms <= 0) return '—';
  const mins = Math.round(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
