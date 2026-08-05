/**
 * Rider screens — load list with [Start route] freeze (FR-14.1/6.2),
 * one-screen close-out with prefilled quantities and payment chips
 * (FR-14.4, FR-5.2), evening handover (FR-7.9/7.11).
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Card, Chip, EmptyState, IconTile, ListRow, Money, PrimaryButton,
  SectionLabel, Tag, color, font, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import type { Order } from '../../data/models';
import { computeTotals } from '../../lib/order';
import { amountInWordsLine } from '../../lib/money';
import { strings } from '../../i18n/strings';
import { billHtml } from '../../documents/templates';
import { sharePdf } from '../../documents/share';

export function RiderRouteScreen() {
  const store = useStore();
  const stops = store.orders.filter(o => o.status === 'assigned' || o.status === 'out_for_delivery');
  const done = store.orders.filter(o => o.status === 'delivered');
  const [openStop, setOpenStop] = React.useState<Order | null>(null);

  if (openStop) return <CloseOutScreen order={openStop} onDone={() => setOpenStop(null)} />;

  if (!store.day.routeStarted) {
    // Morning load list: every product summed across the day's stops.
    const load = store.products
      .map(p => ({
        name: p.name,
        qty: stops.reduce((s, o) => s + (o.items.find(i => i.productId === p.id)?.qty ?? 0), 0),
      }))
      .filter(l => l.qty > 0);
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.subLine}>Load the van — {stops.length} deliveries today</Text>
        {load.length > 0 && (
          <Card>
            {load.map(l => (
              <ListRow
                key={l.name}
                icon="package-variant"
                title={l.name}
                right={<Text style={styles.qty}>{l.qty} pcs</Text>}
              />
            ))}
          </Card>
        )}
        {load.length === 0 && (
          <EmptyState
            icon="truck-outline"
            title="No deliveries assigned yet"
            hint="Orders appear here as the booker confirms them."
          />
        )}
        <View style={styles.ctaWrap}>
          <PrimaryButton
            label={strings.delivery.startRoute}
            icon="truck-fast-outline"
            disabled={stops.length === 0}
            disabledReason="Nothing to deliver yet"
            onPress={() => store.startRoute()}
          />
          <Text style={styles.hint}>Starting the route freezes today's load — later orders go to tomorrow.</Text>
        </View>
      </ScrollView>
    );
  }

  const collected = store.payments.reduce((s, p) => s + p.amount, 0);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.subLine}>
        {done.length} of {done.length + stops.length} done • Rs {collected.toLocaleString()} collected
      </Text>
      {stops.map(o => {
        const shop = store.shops.find(s => s.id === o.shopId)!;
        return (
          <Card key={o.id} onPress={() => setOpenStop(o)}>
            <View style={styles.rowBetween}>
              <Text style={styles.big}>{o.shopSnapshot.name}</Text>
              <Money amount={o.orderedTotals.grandTotal} bold />
            </View>
            <View style={styles.rowBetween}>
              <Text style={styles.meta}>
                {o.shopSnapshot.area} • {o.items.reduce((s, i) => s + i.qty, 0)} pcs
              </Text>
              {shop.collectionFlagged ? <Tag label="COLLECT KHATA" tone="warn" /> : null}
            </View>
          </Card>
        );
      })}
      {stops.length === 0 && (
        <EmptyState
          icon="check-circle-outline"
          title="All stops closed"
          hint="Go to Handover to hand in the cash."
        />
      )}
    </ScrollView>
  );
}

function CloseOutScreen({ order, onDone }: { order: Order; onDone: () => void }) {
  const store = useStore();
  const shop = store.shops.find(s => s.id === order.shopId)!;
  // Quantities pre-filled as fully delivered — adjust only what changed (FR-14.4).
  const [qtys, setQtys] = React.useState<Record<string, number>>(
    Object.fromEntries(order.items.map(i => [i.productId, i.qty])),
  );
  const [payChoice, setPayChoice] = React.useState<'full' | 'khata' | 'none'>('full');
  const [result, setResult] = React.useState<{ invoiceNo: string; receiptNo?: string } | null>(null);

  const items = order.items.map(i => ({ ...i, deliveredQty: qtys[i.productId] }));
  const billed = computeTotals(items, order.discountPercent, true);
  const payAmount = payChoice === 'none' ? 0 : payChoice === 'full' ? billed.grandTotal : billed.grandTotal + shop.outstanding;

  if (result) {
    return (
      <View style={[styles.screen, styles.centerPad]}>
        <IconTile name="check-circle-outline" tint={color.success} bg={color.successSoft} size={64} />
        <Text style={styles.doneTitle}>Delivered</Text>
        <Text style={styles.big}>Bill {result.invoiceNo}</Text>
        {result.receiptNo && <Text style={styles.big}>Receipt {result.receiptNo}</Text>}
        <Money amount={billed.grandTotal} size={font.h1} bold />
        <Text style={styles.hint}>The bill covers exactly what was delivered — the ledger says the same number.</Text>
        <PrimaryButton
          label={`Send bill to ${order.shopSnapshot.name}'s WhatsApp`}
          icon="whatsapp"
          onPress={async () => {
            const billedOrder: Order = {
              ...order, items, billedTotals: billed, invoiceNo: result.invoiceNo,
              deliveredAt: Date.now(), status: 'delivered',
            };
            const html = billHtml({
              settings: store.settings,
              order: billedOrder,
              shop,
              amountInWordsLine: amountInWordsLine(billed.grandTotal),
              received: Math.min(payAmount, billed.grandTotal),
              previousBalance: shop.outstanding,
            });
            await sharePdf(
              html,
              result.invoiceNo,
              `Bill ${result.invoiceNo} — Rs ${billed.grandTotal.toLocaleString()}.`,
            ).catch(() => {});
          }}
        />
        <PrimaryButton label="Next stop" variant="quiet" onPress={onDone} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.shopTitle}>{order.shopSnapshot.name}</Text>
      <Text style={styles.subLine}>{order.orderNo} • adjust only what changed</Text>

      {order.items.map(i => (
        <Card key={i.productId}>
          <View style={styles.rowBetween}>
            <Text style={styles.big}>{i.name}</Text>
            <Text style={styles.meta}>ordered {i.qty}</Text>
          </View>
          <View style={styles.rowWrap}>
            {[i.qty, Math.floor(i.qty / 2), 0].filter((v, idx, a) => a.indexOf(v) === idx).map(q => (
              <Chip key={q} small label={q === i.qty ? `all ${q}` : `${q}`} selected={qtys[i.productId] === q}
                onPress={() => setQtys({ ...qtys, [i.productId]: q })} />
            ))}
          </View>
        </Card>
      ))}

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.big}>Bill (delivered)</Text>
          <Money amount={billed.grandTotal} size={font.stat} bold />
        </View>
        {shop.outstanding > 0 && (
          <View style={styles.rowBetween}>
            <Text style={styles.meta}>Old khata</Text>
            <Money amount={shop.outstanding} color={color.danger} />
          </View>
        )}
      </Card>

      <SectionLabel>Payment</SectionLabel>
      <View style={styles.payRow}>
        <Chip label={`${strings.delivery.full} Rs ${billed.grandTotal.toLocaleString()}`}
          selected={payChoice === 'full'} onPress={() => setPayChoice('full')} />
        {shop.outstanding > 0 && (
          <Chip label={`${strings.delivery.oldKhata} = Rs ${(billed.grandTotal + shop.outstanding).toLocaleString()}`}
            selected={payChoice === 'khata'} onPress={() => setPayChoice('khata')} />
        )}
        <Chip label="Nothing today" selected={payChoice === 'none'} onPress={() => setPayChoice('none')} />
      </View>

      <View style={styles.ctaWrap}>
        <PrimaryButton
          label={payAmount > 0 ? `Delivered — take Rs ${payAmount.toLocaleString()}` : 'Delivered — on credit'}
          icon="check-circle-outline"
          onPress={async () => {
            const r = await Promise.resolve(
              store.closeOutStop({
                orderId: order.id, deliveredQtys: qtys, paymentAmount: payAmount, mode: 'cash',
              }),
            );
            setResult(r);
          }}
        />
      </View>
    </ScrollView>
  );
}

export function RiderHistoryScreen() {
  const store = useStore();
  const done = store.orders.filter(o => o.status === 'delivered');
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {done.map(o => (
        <Card key={o.id}>
          <ListRow
            icon="receipt"
            tint={color.success}
            bg={color.successSoft}
            title={o.shopSnapshot.name}
            sub={`${o.invoiceNo} • paid Rs ${o.amountPaid.toLocaleString()}`}
            right={<Money amount={o.billedTotals?.grandTotal ?? 0} bold />}
          />
        </Card>
      ))}
      {done.length === 0 && (
        <EmptyState
          icon="truck-outline"
          title="No deliveries yet"
          hint="Deliveries you close out appear here."
        />
      )}
    </ScrollView>
  );
}

export function RiderHandoverScreen() {
  const store = useStore();
  const expected = store.payments.filter(p => !p.confirmed).reduce((s, p) => s + p.amount, 0);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <ListRow
          icon="cash-multiple"
          title="Expected cash"
          right={<Money amount={expected} size={font.stat} bold />}
        />
        {store.payments.filter(p => !p.confirmed).map(p => (
          <View key={p.id} style={styles.rowBetween}>
            <Text style={styles.meta}>{p.receiptNo}</Text>
            <Money amount={p.amount} />
          </View>
        ))}
      </Card>
      {!store.day.handedOver ? (
        <View style={styles.ctaWrap}>
          <PrimaryButton
            label={strings.money.handOver}
            icon="cash-multiple"
            disabled={expected === 0}
            disabledReason="No cash collected yet"
            onPress={() => store.handOver()}
          />
        </View>
      ) : (
        <Card>
          <Tag
            label={store.day.handoverConfirmed ? 'CONFIRMED' : 'WAITING'}
            tone={store.day.handoverConfirmed ? 'success' : 'warn'}
          />
          <Text style={styles.statusText}>
            {store.day.handoverConfirmed
              ? 'Confirmed by the owner — cash is company money now.'
              : 'Waiting for the owner to count and confirm…'}
          </Text>
        </Card>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingTop: space.s, paddingBottom: space.xl },
  centerPad: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  subLine: {
    fontSize: font.sub, color: color.textSub,
    marginHorizontal: space.l, marginTop: space.xs, marginBottom: space.s,
  },
  shopTitle: { fontSize: font.h1, fontWeight: '800', color: color.text, marginHorizontal: space.l },
  doneTitle: { fontSize: font.h1, fontWeight: '800', color: color.text, marginTop: space.m, marginBottom: space.xs },
  big: { fontSize: font.h2, fontWeight: '700', color: color.text },
  qty: { fontSize: font.h2 - 1, fontWeight: '700', color: color.text },
  meta: { fontSize: font.sub, color: color.textSub },
  hint: { fontSize: font.sub, color: color.textSub, marginTop: space.s, textAlign: 'center' },
  statusText: { fontSize: font.sub, color: color.textSub, marginTop: space.s },
  rowBetween: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xs,
  },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.xs },
  payRow: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: space.m },
  ctaWrap: { marginHorizontal: space.l, marginVertical: space.m },
});
