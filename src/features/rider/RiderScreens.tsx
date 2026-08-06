/**
 * Rider screens — load list with [Start route] freeze (FR-14.1/6.2),
 * one-screen close-out with prefilled quantities and a real payment amount —
 * full, full + old khata, part or nothing (FR-14.4, FR-5.2, FR-7.x) —
 * evening handover (FR-7.9/7.11).
 */
import React from 'react';
import { Alert, Linking, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Card, Chip, EmptyState, IconTile, ListRow, Money, OptionBar, PrimaryButton,
  SectionLabel, Tag, color, font, radius, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import type { Order } from '../../data/models';
import { todayKey } from '../../data/models';
import { computeTotals } from '../../lib/order';
import { amountInWordsLine } from '../../lib/money';
import { strings } from '../../i18n/strings';
import { billHtml } from '../../documents/templates';
import { sharePdf } from '../../documents/share';

export function RiderRouteScreen() {
  const store = useStore();
  const today = todayKey();
  // Everything still owed to shops rides today: today's stops AND anything
  // left over from earlier days (audit blocker: overdue orders vanished at
  // midnight with their stock still committed).
  const isDueNow = (o: Order) => (o.deliveryDate ?? today) <= today;
  const isOverdue = (o: Order) => (o.deliveryDate ?? today) < today;
  const stops = store.orders.filter(o => isDueNow(o) && (o.status === 'assigned' || o.status === 'out_for_delivery'));
  const done = store.orders.filter(o => (o.deliveryDate ?? today) === today && o.status === 'delivered');
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

  // TODAY's take, not the all-time total (audit) — voided rows don't count.
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const collected = store.payments
    .filter(p => !p.voided && p.createdAt >= dayStart.getTime())
    .reduce((s, p) => s + p.amount, 0);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.subLine}>
        {done.length} of {done.length + stops.length} done • Rs {collected.toLocaleString()} collected today
      </Text>
      {done.length === 0 && (
        <View style={styles.undoRow}>
          <Chip small label="Undo start — back to the load list"
            onPress={() => store.undoStartRoute()} />
        </View>
      )}
      {stops.map(o => {
        const shop = store.shops.find(s => s.id === o.shopId);
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
              <View style={styles.tagRow}>
                {isOverdue(o) ? <Tag label="FROM EARLIER" tone="danger" /> : null}
                {shop?.collectionFlagged ? <Tag label="COLLECT KHATA" tone="warn" /> : null}
              </View>
            </View>
            <View style={styles.rowWrap}>
              {o.shopSnapshot.phone ? (
                <Chip small label={strings.common.call}
                  onPress={() => { void Linking.openURL(`tel:${o.shopSnapshot.phone}`).catch(() => {}); }} />
              ) : null}
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

/** What the rider taps first — how much of the money is coming in today. */
type PayChoice = 'full' | 'khata' | 'part' | 'none';
/** Matches CloseOutInput['mode'] — the shape the store already stores. */
type PayMode = 'cash' | 'transfer' | 'cheque';

const QUICK_ADDS = [500, 1000, 2000, 5000] as const;

/** Whole rupees only, never negative, never more than the shop actually owes. */
function clampMoney(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value), max));
}

function CloseOutScreen({ order, onDone }: { order: Order; onDone: () => void }) {
  const store = useStore();
  const shop = store.shops.find(s => s.id === order.shopId)!;
  // FR-2.x: the owner may hide old balances — then the rider bills and
  // collects against TODAY only, and the khata stays the owner's business.
  const seesOld = store.settings.visibility.riderSeesOldBalance;
  const oldBalance = seesOld ? shop.outstanding : 0;
  // Quantities pre-filled as fully delivered — adjust only what changed (FR-14.4).
  const [qtys, setQtys] = React.useState<Record<string, number>>(
    Object.fromEntries(order.items.map(i => [i.productId, i.qty])),
  );
  const [payChoice, setPayChoice] = React.useState<PayChoice>('full');
  const [partText, setPartText] = React.useState('');
  const [modeChoice, setModeChoice] = React.useState<PayMode>('cash');
  // Typed delivered quantities — "took 10 of 12" is normal and the chips
  // alone could only bill all/half/none (audit blocker).
  const [qtyTexts, setQtyTexts] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<{ invoiceNo: string; receiptNo?: string } | null>(null);

  const setQty = (productId: string, ordered: number, q: number) => {
    const v = Math.max(0, Math.min(q, ordered));
    setQtys(prev => ({ ...prev, [productId]: v }));
    setQtyTexts(prev => ({ ...prev, [productId]: String(v) }));
  };

  const items = order.items.map(i => ({ ...i, deliveredQty: qtys[i.productId] }));
  const billed = computeTotals(items, order.discountPercent, true);
  // The ceiling on any payment: today's bill plus whatever he may see is owed.
  const maxPayable = billed.grandTotal + oldBalance;

  // Changing a quantity can shrink the ceiling — pull a too-large typed amount down with it.
  React.useEffect(() => {
    setPartText(t => {
      if (!t) return t;
      const n = Number.parseInt(t, 10);
      return Number.isFinite(n) && n > maxPayable ? String(maxPayable) : t;
    });
  }, [maxPayable]);

  const partAmount = clampMoney(Number.parseInt(partText, 10), maxPayable);
  const rawPay = payChoice === 'none' ? 0
    : payChoice === 'full' ? billed.grandTotal
    : payChoice === 'khata' ? maxPayable
    : partAmount;
  const payAmount = clampMoney(rawPay, maxPayable);
  const stillOwed = maxPayable - payAmount;

  const payOptions: readonly PayChoice[] = oldBalance > 0
    ? ['full', 'khata', 'part', 'none']
    : ['full', 'part', 'none'];
  const payLabel = (v: PayChoice) =>
    v === 'full' ? 'Full' : v === 'khata' ? strings.delivery.oldKhata : v === 'part' ? 'Part' : 'Nothing';

  // Cheque only exists if the owner switched it on in Settings (FR-12.1).
  const modeOptions: readonly PayMode[] = store.settings.acceptCheques
    ? ['cash', 'transfer', 'cheque']
    : ['cash', 'transfer'];
  const mode: PayMode = modeOptions.includes(modeChoice) ? modeChoice : 'cash';
  const modeLabel = (v: PayMode) => (v === 'cash' ? 'Cash' : v === 'transfer' ? 'Bank transfer' : 'Cheque');

  const addToPart = (add: number) =>
    setPartText(String(clampMoney(partAmount + add, maxPayable)));

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
              previousBalance: oldBalance,
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
          <View style={styles.qtyRow}>
            <TextInput
              style={styles.qtyInput}
              value={qtyTexts[i.productId] ?? String(qtys[i.productId] ?? i.qty)}
              onChangeText={t => {
                const digits = t.replace(/[^0-9]/g, '');
                setQtyTexts(prev => ({ ...prev, [i.productId]: digits }));
                setQtys(prev => ({
                  ...prev,
                  [i.productId]: digits ? Math.min(parseInt(digits, 10), i.qty) : 0,
                }));
              }}
              keyboardType="number-pad"
              placeholder={String(i.qty)}
              placeholderTextColor={color.textFaint}
            />
            <View style={styles.qtyChips}>
              {[i.qty, Math.floor(i.qty / 2), 0].filter((v, idx, a) => a.indexOf(v) === idx).map(q => (
                <Chip key={q} small label={q === i.qty ? `all ${q}` : `${q}`} selected={qtys[i.productId] === q}
                  onPress={() => setQty(i.productId, i.qty, q)} />
              ))}
            </View>
          </View>
        </Card>
      ))}

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.big}>Bill (delivered)</Text>
          <Money amount={billed.grandTotal} size={font.stat} bold />
        </View>
        {oldBalance > 0 && (
          <View style={styles.rowBetween}>
            <Text style={styles.meta}>Old khata</Text>
            <Money amount={oldBalance} color={color.danger} />
          </View>
        )}
      </Card>

      <SectionLabel>Payment</SectionLabel>
      <Card style={styles.tightCard}>
        <View style={[styles.payBlock, styles.payDivider]}>
          <View style={styles.payHead}>
            <IconTile name="cash-multiple" size={34} />
            <Text style={styles.payLabel}>How much is he paying?</Text>
          </View>
          <OptionBar options={payOptions} value={payChoice} render={payLabel} onChange={setPayChoice} />
        </View>

        {payChoice === 'part' && (
          <View style={[styles.payBlock, styles.payDivider]}>
            <Text style={styles.fieldLabel}>Amount he is handing over now</Text>
            <TextInput
              style={styles.input}
              value={partText}
              onChangeText={t => {
                const digits = t.replace(/[^0-9]/g, '');
                setPartText(digits ? String(clampMoney(Number.parseInt(digits, 10), maxPayable)) : '');
              }}
              keyboardType="number-pad"
              placeholder={String(maxPayable)}
              placeholderTextColor={color.textFaint}
            />
            <Text style={styles.fieldHint}>
              Everything he owes today is Rs {maxPayable.toLocaleString()}
            </Text>
            <View style={styles.rowWrap}>
              <Chip small label="+ half" onPress={() => addToPart(Math.floor(maxPayable / 2))} />
              {QUICK_ADDS.map(v => (
                <Chip key={v} small label={`+ ${v.toLocaleString()}`} onPress={() => addToPart(v)} />
              ))}
              {partText ? <Chip small label="Clear" danger onPress={() => setPartText('')} /> : null}
            </View>
          </View>
        )}

        <View style={[styles.payBlock, payAmount > 0 && styles.payDivider]}>
          <View style={styles.rowBetween}>
            <Text style={styles.big}>Taking now</Text>
            <Money amount={payAmount} size={font.stat} bold />
          </View>
          <Text style={stillOwed > 0 ? styles.oweText : styles.clearText}>
            {stillOwed > 0
              ? `Shop will still owe Rs ${stillOwed.toLocaleString()}`
              : 'Shop clears everything — nothing left on the khata'}
          </Text>
        </View>

        {payAmount > 0 && (
          <View style={styles.payBlock}>
            <View style={styles.payHead}>
              <IconTile name="bank-outline" size={34} />
              <Text style={styles.payLabel}>How did he pay?</Text>
            </View>
            <OptionBar options={modeOptions} value={mode} render={modeLabel} onChange={setModeChoice} />
          </View>
        )}
      </Card>

      <View style={styles.ctaWrap}>
        <PrimaryButton
          label={payAmount > 0 ? `Delivered — take Rs ${payAmount.toLocaleString()}` : 'Delivered — on credit'}
          icon="check-circle-outline"
          disabled={(payChoice === 'part' && partAmount === 0) || busy}
          disabledReason={busy ? 'Saving…' : 'Type how much he is paying'}
          onPress={() => {
            // One confirm between the thumb and an irreversible bill (audit).
            const pieces = items.reduce((s, i) => s + (i.deliveredQty ?? 0), 0);
            Alert.alert(
              'Close this stop?',
              `${order.shopSnapshot.name}\n${pieces} pcs delivered • bill Rs ${billed.grandTotal.toLocaleString()}` +
                (payAmount > 0 ? `\nTaking Rs ${payAmount.toLocaleString()} (${mode})` : '\nNothing taken — on credit'),
              [
                { text: 'Not yet', style: 'cancel' },
                {
                  text: 'Delivered',
                  onPress: async () => {
                    setBusy(true);
                    const r = await Promise.resolve(
                      store.closeOutStop({
                        orderId: order.id, deliveredQtys: qtys, paymentAmount: payAmount, mode,
                      }),
                    );
                    setBusy(false);
                    setResult(r);
                  },
                },
              ],
            );
          }}
        />
        {/* The two honest ways OUT of a stop that cannot be delivered (audit
            blocker: the only button used to be 'Delivered'). */}
        <View style={styles.failRow}>
          <Chip small label={`Shop closed — ${strings.delivery.tryTomorrow.toLowerCase()}`}
            onPress={() =>
              Alert.alert('Move to tomorrow?', `${order.orderNo} stays on the van and returns on tomorrow's route.`, [
                { text: 'Back', style: 'cancel' },
                { text: 'Move it', onPress: () => { store.deferOrder(order.id); onDone(); } },
              ])
            } />
          <Chip small danger label={strings.delivery.sendBack}
            onPress={() =>
              Alert.alert('Send the goods back?', `${order.orderNo} is closed WITHOUT a bill and the stock returns to the godown count.`, [
                { text: 'Back', style: 'cancel' },
                { text: 'Send back', style: 'destructive', onPress: () => { store.returnOrder(order.id, 'refused at door'); onDone(); } },
              ])
            } />
        </View>
      </View>
    </ScrollView>
  );
}

export function RiderHistoryScreen() {
  const store = useStore();
  const done = store.orders
    .filter(o => o.status === 'delivered')
    .sort((a, b) => (b.deliveredAt ?? b.bookedAt) - (a.deliveredAt ?? a.bookedAt));

  // "Send it again" — the shopkeeper lost the PDF or asked later (audit).
  const resendBill = async (o: Order) => {
    const shop = store.shops.find(s => s.id === o.shopId);
    if (!shop || !o.billedTotals || !o.invoiceNo) return;
    const html = billHtml({
      settings: store.settings,
      order: o,
      shop,
      amountInWordsLine: amountInWordsLine(o.billedTotals.grandTotal),
      received: o.amountPaid,
      previousBalance: 0, // history re-send: today's balance is not that day's
    });
    await sharePdf(
      html, o.invoiceNo,
      `Bill ${o.invoiceNo} — Rs ${o.billedTotals.grandTotal.toLocaleString()}.`,
    ).catch(e => Alert.alert('Could not share', e instanceof Error ? e.message : String(e)));
  };

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
          <View style={styles.rowWrap}>
            <Chip small label="Bill PDF" onPress={() => { void resendBill(o); }} />
          </View>
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
  const pending = store.payments.filter(p => !p.confirmed && !p.voided);
  // Physical cash and bank transfers are different piles: the owner counts
  // notes for one and checks the bank app for the other (audit).
  const cashPile = pending.filter(p => p.mode === 'cash' || p.mode === 'cheque');
  const transferPile = pending.filter(p => p.mode === 'transfer');
  const cashTotal = cashPile.reduce((s, p) => s + p.amount, 0);
  const transferTotal = transferPile.reduce((s, p) => s + p.amount, 0);
  const expected = cashTotal + transferTotal;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <ListRow
          icon="cash-multiple"
          title="Cash in hand"
          right={<Money amount={cashTotal} size={font.stat} bold />}
        />
        {cashPile.map(p => (
          <View key={p.id} style={styles.rowBetween}>
            <Text style={styles.meta}>{p.receiptNo}{p.mode === 'cheque' ? ' • cheque' : ''}</Text>
            <Money amount={p.amount} />
          </View>
        ))}
        {transferPile.length > 0 && (
          <>
            <ListRow
              icon="bank-outline"
              title="Bank transfers (already with the owner)"
              right={<Money amount={transferTotal} bold />}
            />
            {transferPile.map(p => (
              <View key={p.id} style={styles.rowBetween}>
                <Text style={styles.meta}>{p.receiptNo}</Text>
                <Money amount={p.amount} />
              </View>
            ))}
          </>
        )}
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
  ctaWrap: { marginHorizontal: space.l, marginVertical: space.m },

  tightCard: { paddingVertical: space.xs },
  payBlock: { paddingVertical: space.m },
  payDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  payHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.s + 2 },
  payLabel: { fontSize: font.body, fontWeight: '600', color: color.text, marginLeft: 10 },
  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginBottom: 6 },
  fieldHint: { fontSize: font.tiny + 1, color: color.textSub, marginTop: 6 },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 46,
    fontSize: font.body, color: color.text,
  },
  oweText: { fontSize: font.sub, fontWeight: '700', color: color.danger, marginTop: space.xs },
  clearText: { fontSize: font.sub, fontWeight: '700', color: color.success, marginTop: space.xs },

  undoRow: { flexDirection: 'row', paddingHorizontal: space.l, marginBottom: space.xs },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.s },
  qtyInput: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 44, width: 78,
    fontSize: font.h2, fontWeight: '700', color: color.text, textAlign: 'center',
  },
  qtyChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginLeft: space.s },
  failRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    justifyContent: 'center', marginTop: space.m, gap: space.s,
  },
});
