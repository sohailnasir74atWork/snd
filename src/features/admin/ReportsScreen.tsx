/**
 * Reports — preset ranges (FR-9.2): sales, collections, who owes me, deliveries.
 * Every computation lives in a small pure helper so it can be unit-tested later.
 */
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card, Chip, Icon, IconTile, ListRow, Money, OptionBar, SectionLabel, color, font, space } from '../../components/ui';
// (Alert imported above with react-native)
import { useStore } from '../../data/store';
import { profitFor } from '../../lib/profit';
import { shareCsv } from '../../documents/share';
import type { Order, Payment, Shop } from '../../data/models';

// ---------- pure helpers (unit-testable) ----------

export type RangePreset = 'today' | 'week' | 'month' | 'lastMonth';

export interface DateRange {
  start: number; // inclusive, ms epoch
  end: number; // exclusive, ms epoch
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Range for a preset, anchored to `now` (passed in so tests can pin the clock). Weeks start Monday. */
export function rangeFor(preset: RangePreset, now: number): DateRange {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dayStart = d.getTime();
  if (preset === 'today') {
    return { start: dayStart, end: dayStart + DAY_MS };
  }
  if (preset === 'week') {
    const sinceMonday = (d.getDay() + 6) % 7; // Sun=0 … Sat=6 → days since Monday
    const start = dayStart - sinceMonday * DAY_MS;
    return { start, end: start + 7 * DAY_MS };
  }
  if (preset === 'lastMonth') {
    // "How much did I make last month?" asked on the 3rd (audit).
    return {
      start: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(),
      end: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
    };
  }
  return {
    start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
    end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(),
  };
}

export function inRange(t: number, r: DateRange): boolean {
  return t >= r.start && t < r.end;
}

/** The date an order counts under: delivery date, or booking date while it is still only booked. */
export function orderDate(o: Order): number {
  return o.deliveredAt ?? o.bookedAt;
}

/** Delivered (incl. closed — a closed order was delivered first). */
export function isDelivered(o: Order): boolean {
  return o.status === 'delivered' || o.status === 'closed';
}

/** Booked but not yet delivered (cancelled/returned orders count as neither). */
export function isStillToDeliver(o: Order): boolean {
  return o.status === 'booked' || o.status === 'assigned' || o.status === 'out_for_delivery';
}

export function deliveredOrdersIn(orders: Order[], r: DateRange): Order[] {
  return orders.filter(o => isDelivered(o) && inRange(orderDate(o), r));
}

export function stillToDeliverIn(orders: Order[], r: DateRange): Order[] {
  return orders.filter(o => isStillToDeliver(o) && inRange(orderDate(o), r));
}

/** Every order the range touches, newest first — the CSV export list. */
export function ordersInRange(orders: Order[], r: DateRange): Order[] {
  return orders
    .filter(o => inRange(orderDate(o), r))
    .sort((a, b) => orderDate(b) - orderDate(a));
}

/** Sum of billed grand totals across delivered orders. Integer rupees. */
export function salesTotal(delivered: Order[]): number {
  return delivered.reduce((sum, o) => sum + (o.billedTotals?.grandTotal ?? 0), 0);
}

export interface ProductLine {
  productId: string;
  name: string;
  pieces: number;
  rupees: number;
}

/** Per-product delivered pieces + rupees across delivered orders, biggest earner first. */
export function productTotals(delivered: Order[]): ProductLine[] {
  const byProduct = new Map<string, ProductLine>();
  for (const o of delivered) {
    for (const item of o.items) {
      const qty = item.deliveredQty ?? item.qty;
      if (qty <= 0) continue;
      const line = byProduct.get(item.productId) ?? {
        productId: item.productId, name: item.name, pieces: 0, rupees: 0,
      };
      line.pieces += qty;
      line.rupees += qty * item.unitPrice;
      byProduct.set(item.productId, line);
    }
  }
  return Array.from(byProduct.values()).sort((a, b) => b.rupees - a.rupees);
}

// Profit maths live in src/lib/profit.ts so the tests exercise the same code
// this screen renders.
export { profitFor };
export type { ProfitLine, ProfitSummary } from '../../lib/profit';

export interface CollectionSummary {
  count: number;
  total: number;
  confirmed: number; // owner has counted and confirmed the cash
  withStaff: number; // collected but not yet confirmed
}

/** Payments whose createdAt falls in the range, split by confirmation.
 *  Voided rows are crossed out of every total. */
export function collectionsIn(payments: Payment[], r: DateRange): CollectionSummary {
  const hits = payments.filter(p => !p.voided && inRange(p.createdAt, r));
  const confirmed = hits.filter(p => p.confirmed).reduce((s, p) => s + p.amount, 0);
  const withStaff = hits.filter(p => !p.confirmed).reduce((s, p) => s + p.amount, 0);
  return { count: hits.length, total: confirmed + withStaff, confirmed, withStaff };
}

/** Shops that owe money, biggest debt first — the call list. */
export function shopsThatOwe(shops: Shop[]): Shop[] {
  return shops
    .filter(s => s.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding);
}

// ---------- screen ----------

const PRESET_LABELS: Record<RangePreset, string> = {
  today: 'Today',
  week: 'This week',
  month: 'This month',
  lastMonth: 'Last month',
};

export function ReportsScreen() {
  const store = useStore();
  const [preset, setPreset] = React.useState<RangePreset>('today');
  const range = rangeFor(preset, Date.now());

  const delivered = deliveredOrdersIn(store.orders, range);
  const toDeliver = stillToDeliverIn(store.orders, range);
  const sales = salesTotal(delivered);
  const perProduct = productTotals(delivered);
  const profit = profitFor(delivered, store.products);
  const collections = collectionsIn(store.payments, range);
  const owed = shopsThatOwe(store.shops);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.subLine}>Numbers count delivered orders only</Text>

      <View style={styles.presetWrap}>
        <OptionBar
          options={['today', 'week', 'month', 'lastMonth'] as const}
          value={preset}
          render={v => PRESET_LABELS[v]}
          onChange={setPreset}
        />
      </View>

      <SectionLabel>Sales</SectionLabel>
      {delivered.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>No deliveries in this range yet</Text>
          <Text style={styles.meta}>Sales show up here once orders are delivered.</Text>
        </Card>
      ) : (
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>{delivered.length} {delivered.length === 1 ? 'order' : 'orders'} delivered</Text>
            <Money amount={sales} size={font.stat} bold />
          </View>
          <Text style={styles.meta}>Total billed for this range</Text>
          <Text style={styles.subHead}>By product</Text>
          {perProduct.map(line => (
            <View key={line.productId} style={styles.line}>
              <View style={styles.lineLeft}>
                <Text style={styles.lineName}>{line.name}</Text>
                <Text style={styles.meta}>{line.pieces} {line.pieces === 1 ? 'piece' : 'pieces'} delivered</Text>
              </View>
              <Money amount={line.rupees} bold />
            </View>
          ))}
        </Card>
      )}

      <SectionLabel>Profit</SectionLabel>
      {delivered.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>No profit to show yet</Text>
          <Text style={styles.meta}>Profit appears once orders are delivered.</Text>
        </Card>
      ) : (
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>What you made</Text>
            <Money
              amount={profit.gross}
              size={font.stat}
              bold
              color={profit.gross > 0 ? color.success : undefined}
            />
          </View>
          <Text style={styles.meta}>
            on {profit.orders} delivered {profit.orders === 1 ? 'order' : 'orders'}
          </Text>

          {profit.skippedProducts > 0 && (
            <View style={styles.warnRow}>
              <Icon name="alert-outline" size={15} color={color.warn} />
              <Text style={styles.warnText}>
                {profit.skippedProducts} {profit.skippedProducts === 1 ? 'product has' : 'products have'} no
                cost price — profit is understated.
              </Text>
            </View>
          )}

          {profit.lines.length > 0 && (
            <>
              <Text style={styles.subHead}>By product</Text>
              {profit.lines.map(line => (
                <View key={line.productId} style={styles.line}>
                  <View style={styles.lineLeft}>
                    <Text style={styles.lineName}>{line.name}</Text>
                    <Text style={styles.meta}>
                      {line.pieces} {line.pieces === 1 ? 'piece' : 'pieces'} sold
                    </Text>
                  </View>
                  <Money amount={line.profit} bold color={line.profit > 0 ? color.success : undefined} />
                </View>
              ))}
            </>
          )}
        </Card>
      )}

      <SectionLabel>Collections</SectionLabel>
      {collections.count === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>No payments in this range yet</Text>
          <Text style={styles.meta}>Money collected at shops will show up here.</Text>
        </Card>
      ) : (
        <Card>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Collected</Text>
            <Money amount={collections.total} size={font.stat} bold />
          </View>
          <View style={styles.line}>
            <Text style={styles.lineName}>Confirmed by you</Text>
            <Money amount={collections.confirmed} bold color={color.success} />
          </View>
          <View style={styles.line}>
            <Text style={styles.lineName}>Still with staff</Text>
            <Money amount={collections.withStaff} bold color={collections.withStaff > 0 ? color.warn : undefined} />
          </View>

          {/* Every receipt in the range — with the owner's one correction
              tool: VOID a wrong entry (the row stays, crossed out; the khata
              and bill allocations are restored). */}
          <Text style={styles.subHead}>Every receipt</Text>
          {store.payments
            .filter(p => inRange(p.createdAt, range))
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(p => (
              <View key={p.id} style={styles.line}>
                <View style={styles.lineLeft}>
                  <Text style={[styles.lineName, p.voided && styles.voidedText]}>
                    {p.receiptNo} • {store.shops.find(s => s.id === p.shopId)?.name ?? ''}
                  </Text>
                  <Text style={styles.meta}>
                    {store.staffNames[p.collectedBy] || 'staff'} • {p.mode}
                    {p.exception ? ' • EXCEPTION' : ''}{p.voided ? ' • VOIDED' : ''}
                  </Text>
                </View>
                <View style={styles.receiptRight}>
                  <Money amount={p.amount} bold color={p.voided ? color.textFaint : undefined} />
                  {!p.voided && (
                    <Chip small danger label="Void"
                      onPress={() =>
                        Alert.alert(
                          'Void this receipt?',
                          `${p.receiptNo} — Rs ${p.amount.toLocaleString()}. The shop's khata gets the amount back; the row stays, crossed out.`,
                          [
                            { text: 'Keep it', style: 'cancel' },
                            { text: 'Void', style: 'destructive', onPress: () => store.voidPayment(p.id) },
                          ],
                        )
                      } />
                  )}
                </View>
              </View>
            ))}
        </Card>
      )}

      <SectionLabel>Who owes me</SectionLabel>
      {owed.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>No shop owes you anything</Text>
          <Text style={styles.meta}>All shops are fully settled.</Text>
        </Card>
      ) : (
        <Card style={styles.tightCard}>
          {owed.map((s, i) => (
            <View key={s.id} style={i < owed.length - 1 && styles.rowDivider}>
              <ListRow
                icon="storefront-outline"
                tint={color.danger}
                bg={color.dangerSoft}
                title={s.name}
                sub={`${s.ownerName ? `${s.ownerName} • ` : ''}${s.phone} • ${s.area}`}
                right={<Money amount={s.outstanding} bold color={color.danger} />}
              />
            </View>
          ))}
        </Card>
      )}

      <SectionLabel>Deliveries</SectionLabel>
      {delivered.length === 0 && toDeliver.length === 0 ? (
        <Card>
          <Text style={styles.emptyTitle}>No deliveries in this range yet</Text>
          <Text style={styles.meta}>Delivered and pending orders will show up here.</Text>
        </Card>
      ) : (
        <Card style={styles.tightCard}>
          <View style={[styles.statRow, styles.rowDivider]}>
            <IconTile name="check-circle-outline" size={34} tint={color.success} bg={color.successSoft} />
            <Text style={styles.statLabel}>Delivered</Text>
            <Text style={styles.statValue}>{delivered.length}</Text>
          </View>
          <View style={styles.statRow}>
            <IconTile
              name="truck-outline" size={34}
              tint={toDeliver.length > 0 ? color.warn : color.primary}
              bg={toDeliver.length > 0 ? color.warnSoft : color.primarySoft}
            />
            <Text style={styles.statLabel}>Still to deliver</Text>
            <Text style={styles.statValue}>{toDeliver.length}</Text>
          </View>
        </Card>
      )}

      <SectionLabel>Export</SectionLabel>
      <Card style={styles.tightCard}>
        <View style={styles.exportRow}>
          <Chip
            label={`Orders CSV — ${PRESET_LABELS[preset]}`}
            onPress={() => {
              const rows: (string | number | undefined)[][] = [
                ['Order', 'Invoice', 'Date', 'Shop', 'Area', 'Status', 'Subtotal', 'Discount', 'Total', 'Paid', 'Balance'],
                ...ordersInRange(store.orders, range).map(o => {
                  const t = o.billedTotals ?? o.orderedTotals;
                  return [
                    o.orderNo, o.invoiceNo, new Date(o.bookedAt).toLocaleDateString(),
                    o.shopSnapshot.name, o.shopSnapshot.area, o.status,
                    t.subTotal, t.discountTotal, t.grandTotal, o.amountPaid,
                    t.grandTotal - o.amountPaid,
                  ];
                }),
              ];
              void shareCsv(`orders-${preset}`, rows)
                .catch(e => Alert.alert('Export failed', e instanceof Error ? e.message : String(e)));
            }}
          />
          <Chip
            label={`Payments CSV — ${PRESET_LABELS[preset]}`}
            onPress={() => {
              const rows: (string | number | undefined)[][] = [
                ['Receipt', 'Date', 'Shop', 'Amount', 'Mode', 'Collected by', 'Confirmed', 'Exception'],
                ...store.payments.filter(p => inRange(p.createdAt, range)).map(p => [
                  p.receiptNo, new Date(p.createdAt).toLocaleDateString(),
                  store.shops.find(s => s.id === p.shopId)?.name ?? p.shopId,
                  p.amount, p.mode, store.staffNames[p.collectedBy] || p.collectedBy,
                  p.confirmed ? 'yes' : 'no', p.exception ? 'yes' : '',
                ]),
              ];
              void shareCsv(`payments-${preset}`, rows)
                .catch(e => Alert.alert('Export failed', e instanceof Error ? e.message : String(e)));
            }}
          />
        </View>
        <Text style={styles.meta}>Opens the share sheet — send to WhatsApp, email or Drive.</Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingTop: space.s, paddingBottom: space.xl + space.l },
  subLine: {
    fontSize: font.sub, color: color.textSub,
    marginHorizontal: space.l, marginBottom: space.xs,
  },
  presetWrap: { marginHorizontal: space.l, marginTop: space.s },
  tightCard: { paddingVertical: space.xs },
  exportRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingTop: space.s },
  voidedText: { textDecorationLine: 'line-through', color: color.textFaint },
  receiptRight: { alignItems: 'flex-end', gap: 6 },

  cardTitle: { fontSize: font.h2 - 1, fontWeight: '700', color: color.text },
  subHead: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginTop: space.m },
  meta: { fontSize: font.sub, color: color.textSub, marginTop: 3 },
  emptyTitle: { fontSize: font.body, fontWeight: '700', color: color.text },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  line: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginTop: space.m - 2, paddingTop: space.m - 2,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border,
  },
  lineLeft: { flexShrink: 1, paddingRight: space.s },
  lineName: { fontSize: font.body, fontWeight: '600', color: color.text },
  warnRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: space.s },
  warnText: { fontSize: font.sub, color: color.warn, marginLeft: 6, flexShrink: 1 },

  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  statRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.m },
  statLabel: { flex: 1, fontSize: font.body, fontWeight: '600', color: color.text, marginLeft: 10 },
  statValue: { fontSize: font.stat, fontWeight: '800', color: color.text },
});
