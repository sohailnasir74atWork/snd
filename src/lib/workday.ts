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
import type { DayState, Order, Payment, RewardClaim, Shop } from '../data/models';

export interface WorkdayInput {
  staffId: string;
  /** Start of the working day, in ms — everything before this belongs to yesterday. */
  dayStartMs: number;
  dayEndMs: number;
  orders: Order[];
  payments: Payment[];
  rewardClaims: RewardClaim[];
  /**
   * Every shop in the company, so the ones REGISTERED today can be counted.
   *
   * Optional because the caller may not have them and a day computed without
   * them is still correct about everything else — but a booker sent into a
   * bazaar the company has never sold into can spend a morning finding
   * counters and book nothing, and without this his day reads as empty.
   */
  shops?: Shop[];
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
   * Where the start came from, so a screen can say so rather than implying a
   * precision the number does not have.
   *
   * `explicit` — he pressed a button that recorded the time. The rider's
   *   [Start route], and the only one of the three that brackets the real day.
   * `appOpen` — the first time the app was opened today. Nobody pressed
   *   anything; it is earlier than the first piece of work and later than
   *   leaving the house, and it is the best available answer for a booker.
   * `derived` — the first piece of work, and therefore later than the true
   *   start by however long the ride to the first shop took.
   */
  startSource: 'explicit' | 'appOpen' | 'derived' | 'none';
  ordersBooked: number;
  deliveries: number;
  /** Distinct shops touched — the honest "how many did he cover". */
  shopsTouched: number;
  /**
   * Shops REGISTERED today. Not a subset of anything else on this record:
   * a new shop usually gets an order in the same visit, but it need not, and
   * finding the counter is the work that made the order possible.
   */
  shopsAdded: number;
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
  const { staffId, dayStartMs, dayEndMs, orders, payments, rewardClaims, shops, day } = input;

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
  // Shops registered by this person today. `createdAt` is absent on every shop
  // created before it was declared, and `within` refuses undefined, so those
  // simply do not count — which is right: unknown is not today.
  const added = (shops ?? []).filter(
    s => s.createdBy === staffId && within(s.createdAt, dayStartMs, dayEndMs),
  );

  const stamps: number[] = [
    ...booked.map(o => o.bookedAt),
    ...delivered.map(o => o.deliveredAt!),
    ...took.map(p => p.createdAt),
    ...claims.map(c => c.createdAt),
    // Registering a shop is work, and on a new bazaar it can be the FIRST work
    // of the day and occasionally the only work of it. Left out of the stamps,
    // a morning spent finding eleven counters and booking none reads as a
    // person who did not turn up.
    ...added.map(s => s.createdAt!),
  ];

  const explicitStart = within(day?.routeStartedAt, dayStartMs, dayEndMs)
    ? day!.routeStartedAt!
    : null;
  const openedAt = within(day?.appOpenedAt, dayStartMs, dayEndMs)
    ? day!.appOpenedAt!
    : null;
  const explicitEnd = within(day?.handedOverAt, dayStartMs, dayEndMs)
    ? day!.handedOverAt!
    : null;

  const firstWork = stamps.length ? Math.min(...stamps) : null;
  const lastWork = stamps.length ? Math.max(...stamps) : null;

  /**
   * Best available start, in order of how much it is worth.
   *
   * The explicit start wins even when it is LATER than the first piece of work
   * would suggest — it cannot be, in practice, but if the clocks disagree the
   * button the person actually pressed is the more trustworthy of the two.
   *
   * The app-open sits between: earlier than the first booking (he opens it on
   * the way, not at the counter) and honest about being a proxy. It is used
   * only when it is genuinely earlier — a man who books an order and opens the
   * app afterwards, which happens on a re-install or a phone swap mid-round,
   * started at the order.
   *
   * A day with NO work at all is still no day, even with an app-open on it:
   * opening the app from bed is not a working day, and treating it as one is
   * the exact failure the clock-in button was rejected for.
   */
  const firstReal = explicitStart ?? firstWork;
  const startedAt = explicitStart
    ?? (openedAt !== null && firstWork !== null ? Math.min(openedAt, firstWork) : firstReal);
  const lastActionAt = explicitEnd ?? lastWork ?? explicitStart;

  const shopsTouched = new Set([
    ...booked.map(o => o.shopId),
    ...delivered.map(o => o.shopId),
    ...took.map(p => p.shopId),
    // A shop he registered is a shop he stood in. Counting it here is what
    // stops "shops 0 · new 3" appearing on one row.
    ...added.map(s => s.id),
  ]).size;

  return {
    staffId,
    startedAt,
    lastActionAt,
    activeMs: startedAt !== null && lastActionAt !== null ? Math.max(0, lastActionAt - startedAt) : 0,
    startSource: explicitStart !== null
      ? 'explicit'
      // 'appOpen' only when the app-open is what the start actually came FROM.
      // An app opened after the first booking changes no number, so claiming it
      // as the source would put a label on a row it does not describe.
      : startedAt !== null && openedAt !== null && startedAt === openedAt && openedAt !== firstWork
        ? 'appOpen'
        : firstWork !== null ? 'derived' : 'none',
    ordersBooked: booked.length,
    deliveries: delivered.length,
    shopsTouched,
    shopsAdded: added.length,
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
