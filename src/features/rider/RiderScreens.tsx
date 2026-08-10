/**
 * Rider screens — load list with [Start route] freeze (FR-14.1/6.2),
 * one-screen close-out with prefilled quantities and a real payment amount —
 * full, full + old khata, part or nothing (FR-14.4, FR-5.2, FR-7.x) —
 * evening handover (FR-7.9/7.11).
 */
import React from 'react';
import {
  Alert, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import {
  Card, Chip, EmptyState, IconTile, ListRow, Money, OptionBar, PrimaryButton, ProvisionalNote,
  SectionLabel, Tag, color, font, radius, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import type { Order } from '../../data/models';
import { todayKey } from '../../data/models';
import { computeTotals } from '../../lib/order';
import { amountInWordsLine } from '../../lib/money';
import { isProvisional } from '../../lib/serials';
import { strings } from '../../i18n/strings';
import { billHtml } from '../../documents/templates';
import { sharePdf } from '../../documents/share';
import { documentLogo } from '../../lib/logoCache';
import { PinShopScreen } from '../shops/PinShopScreen';
import { ShopPlaceChips } from '../shops/ShopPlace';

export function RiderRouteScreen() {
  const store = useStore();
  const today = todayKey();
  // Everything still owed to shops rides today: today's stops AND anything
  // left over from earlier days (audit blocker: overdue orders vanished at
  // midnight with their stock still committed).
  const isDueNow = (o: Order) => (o.deliveryDate ?? today) <= today;
  const isOverdue = (o: Order) => (o.deliveryDate ?? today) < today;
  const stops = store.orders.filter(o => isDueNow(o) && (o.status === 'assigned' || o.status === 'out_for_delivery'));
  // Counted by WHEN IT WAS DELIVERED, not by the day it was due. An overdue
  // stop left `stops` the moment it was delivered but never joined a
  // `=== today` list, so the header counted DOWN as the rider worked:
  // "0 of 6" became "0 of 4". Orders written before deliveredAt existed fall
  // back to the old due-date test.
  //
  // Anchored to the WORKING day, so a rider still out past midnight does not
  // watch his own totals reset to zero underneath him.
  const dayStartMs = new Date(`${store.day.date}T00:00:00`).getTime();
  const done = store.orders.filter(o => o.status === 'delivered' && (
    o.deliveredAt !== undefined ? o.deliveredAt >= dayStartMs : (o.deliveryDate ?? today) === today
  ));
  const [openStop, setOpenStop] = React.useState<Order | null>(null);
  // The rider is at more shop doors in a day than anyone else, which makes the
  // rider the fastest way to get the map filled in.
  const [pinningShopId, setPinningShopId] = React.useState<string | null>(null);
  // startRoute/undoStartRoute return void: nothing to await, and the day doc
  // only flips once the write lands. Hold the control down from the first tap
  // and release it when the day doc actually says what we asked it to say.
  const [routeSwitching, setRouteSwitching] = React.useState(false);
  const routeStarted = store.day.routeStarted;
  React.useEffect(() => { setRouteSwitching(false); }, [routeStarted]);

  if (openStop) return <CloseOutScreen order={openStop} onDone={() => setOpenStop(null)} />;

  const pinningShop = pinningShopId ? store.shops.find(s => s.id === pinningShopId) : null;
  if (pinningShop) {
    return (
      <PinShopScreen
        shopName={pinningShop.name}
        existing={pinningShop.location ?? null}
        onSave={fix => { store.setShopLocation(pinningShop.id, fix); setPinningShopId(null); }}
        onCancel={() => setPinningShopId(null)}
      />
    );
  }

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
            disabled={stops.length === 0 || routeSwitching}
            disabledReason={stops.length === 0 ? 'Nothing to deliver yet' : undefined}
            onPress={() => { setRouteSwitching(true); store.startRoute(); }}
          />
          <Text style={styles.hint}>Starting the route freezes today's load — later orders go to tomorrow.</Text>
        </View>
      </ScrollView>
    );
  }

  // TODAY's take, not the all-time total (audit) — voided rows don't count.
  const collected = store.payments
    .filter(p => !p.voided && p.createdAt >= dayStartMs)
    .reduce((s, p) => s + p.amount, 0);
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.subLine}>
        {done.length} of {done.length + stops.length} done • Rs {collected.toLocaleString()} collected today
      </Text>
      {done.length === 0 && !routeSwitching && (
        <View style={styles.undoRow}>
          <Chip small label="Undo start — back to the load list"
            onPress={() => { setRouteSwitching(true); store.undoStartRoute(); }} />
        </View>
      )}
      {stops.map(o => {
        const shop = store.shops.find(s => s.id === o.shopId);
        return (
          <Card key={o.id} onPress={() => setOpenStop(o)}>
            <View style={styles.rowBetween}>
              <Text style={[styles.big, styles.flexLabel]} numberOfLines={2}>{o.shopSnapshot.name}</Text>
              <View style={styles.valueRight}>
                <Money amount={o.orderedTotals.grandTotal} bold />
              </View>
            </View>
            <View style={styles.rowBetween}>
              {/* The two Tags below are wide; without the flexible label the
                  area line used to run straight under "COLLECT KHATA". */}
              <Text style={[styles.meta, styles.flexLabel]} numberOfLines={2}>
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
              {/* Only for a shop this rider can actually resolve — an order
                  whose shop document is not in view has nothing to write to. */}
              {shop ? (
                <ShopPlaceChips
                  shop={shop}
                  onPin={() => setPinningShopId(shop.id)}
                  onPhotoUrl={url => store.setShopPhoto(shop.id, url)}
                />
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
  // One flag for every way OUT of this stop — delivered, deferred, sent back.
  // Whichever fires first must lock the other two: they all write the order.
  const [busy, setBusy] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  // previousBalance is carried IN here, not re-read on the success screen:
  // see the capture at close-out below.
  const [result, setResult] = React.useState<
    { invoiceNo: string; receiptNo?: string; previousBalance: number } | null
  >(null);

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

  const closeOut = async () => {
    // The invoice and receipt numbers need a server round-trip. A second tap
    // billed the shop twice AND banked the same cash twice.
    if (busy) return;
    setBusy(true);
    try {
      // Snapshot the khata BEFORE the write. Firestore's local
      // latency compensation applies the new bill to
      // shop.outstanding immediately, so reading it again on
      // the success screen printed a "Previous balance" that
      // already contained the invoice being printed.
      const previousBalance = oldBalance;
      const r = await Promise.resolve(
        store.closeOutStop({
          orderId: order.id, deliveredQtys: qtys, paymentAmount: payAmount, mode,
        }),
      );
      setResult({ ...r, previousBalance });
    } catch (e) {
      // The booker can cancel this order while the rider is at
      // the counter — say so and send him back to the route.
      Alert.alert('Cannot close this stop', e instanceof Error ? e.message : String(e), [
        { text: 'Back to route', onPress: onDone },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const leaveStop = (write: () => void) => {
    // Deferring or sending back writes the order too — never on top of a
    // close-out that is already in flight, and never twice.
    if (busy) return;
    setBusy(true);
    write();
    onDone();
  };

  const shareBill = async (invoiceNo: string, previousBalance: number) => {
    // PDF generation plus the share sheet take a beat — a second tap stacked
    // two share sheets on the rider's screen.
    if (sharing) return;
    setSharing(true);
    try {
      const logo = await documentLogo(store.settings.logoUrl);
      const billedOrder: Order = {
        ...order, items, billedTotals: billed, invoiceNo,
        deliveredAt: Date.now(), status: 'delivered',
      };
      const html = billHtml({
        settings: store.settings,
        order: billedOrder,
        shop,
        logo,
        amountInWordsLine: amountInWordsLine(billed.grandTotal),
        received: Math.min(payAmount, billed.grandTotal),
        previousBalance,
        // Anything over today's bill went to the old khata — the printed
        // total must credit it, or the shopkeeper is handed a bill
        // claiming he still owes cash he just paid.
        paidToPrevious: Math.max(0, payAmount - billed.grandTotal),
      });
      await sharePdf(
        html,
        invoiceNo,
        `Bill ${invoiceNo} — Rs ${billed.grandTotal.toLocaleString()}.`,
        { phone: shop?.phone ?? order.shopSnapshot.phone, countryCode: store.settings.countryCode },
      );
    } catch (e) {
      Alert.alert('Could not share', e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  };

  if (result) {
    return (
      <View style={[styles.screen, styles.centerPad]}>
        <IconTile name="check-circle-outline" tint={color.success} bg={color.successSoft} size={64} />
        <Text style={styles.doneTitle}>Delivered</Text>
        <Text style={styles.big}>Bill {result.invoiceNo}</Text>
        {result.receiptNo && <Text style={styles.big}>Receipt {result.receiptNo}</Text>}
        {(isProvisional(result.invoiceNo) || isProvisional(result.receiptNo)) && <ProvisionalNote />}
        <Money amount={billed.grandTotal} size={font.h1} bold />
        <Text style={styles.hint}>The bill covers exactly what was delivered — the ledger says the same number.</Text>
        <PrimaryButton
          label={`Send bill to ${order.shopSnapshot.name}'s WhatsApp`}
          icon="whatsapp"
          busy={sharing}
          busyLabel="Preparing…"
          onPress={() => { void shareBill(result.invoiceNo, result.previousBalance); }}
        />
        <PrimaryButton label="Next stop" variant="quiet" onPress={onDone} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.shopTitle}>{order.shopSnapshot.name}</Text>
        <Text style={styles.subLine}>{order.orderNo} • adjust only what changed</Text>

        {order.items.map(i => (
          <Card key={i.productId}>
            <View style={styles.rowBetween}>
              <Text style={[styles.big, styles.flexLabel]} numberOfLines={2}>{i.name}</Text>
              <Text style={[styles.meta, styles.valueRight]}>ordered {i.qty}</Text>
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
            <Text style={[styles.big, styles.flexLabel]} numberOfLines={2}>Bill (delivered)</Text>
            <View style={styles.valueRight}>
              <Money amount={billed.grandTotal} size={font.stat} bold />
            </View>
          </View>
          {oldBalance > 0 && (
            <View style={styles.rowBetween}>
              <Text style={[styles.meta, styles.flexLabel]} numberOfLines={2}>Old khata</Text>
              <View style={styles.valueRight}>
                <Money amount={oldBalance} color={color.danger} />
              </View>
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
              {/* The "+ half / + 500 / + 1,000 …" row is gone. The rider is
                  holding the notes he was just handed and knows the number; a
                  ladder of buttons that ADDS to whatever is already in the box
                  is slower than typing it and, tapped one too many times, banks
                  a figure nobody counted. The field takes the amount directly. */}
            </View>
          )}

          <View style={[styles.payBlock, payAmount > 0 && styles.payDivider]}>
            <View style={styles.rowBetween}>
              <Text style={[styles.big, styles.flexLabel]} numberOfLines={2}>Taking now</Text>
              <View style={styles.valueRight}>
                <Money amount={payAmount} size={font.stat} bold />
              </View>
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
            busy={busy}
            disabled={payChoice === 'part' && partAmount === 0}
            disabledReason="Type how much he is paying"
            onPress={() => {
              // One confirm between the thumb and an irreversible bill (audit).
              const pieces = items.reduce((s, i) => s + (i.deliveredQty ?? 0), 0);
              Alert.alert(
                'Close this stop?',
                `${order.shopSnapshot.name}\n${pieces} pcs delivered • bill Rs ${billed.grandTotal.toLocaleString()}` +
                  (payAmount > 0 ? `\nTaking Rs ${payAmount.toLocaleString()} (${mode})` : '\nNothing taken — on credit'),
                [
                  { text: 'Not yet', style: 'cancel' },
                  { text: 'Delivered', onPress: () => { void closeOut(); } },
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
                  { text: 'Move it', onPress: () => leaveStop(() => store.deferOrder(order.id)) },
                ])
              } />
            <Chip small danger label={strings.delivery.sendBack}
              onPress={() =>
                Alert.alert('Send the goods back?', `${order.orderNo} is closed WITHOUT a bill and the stock returns to the godown count.`, [
                  { text: 'Back', style: 'cancel' },
                  { text: 'Send back', style: 'destructive', onPress: () => leaveStop(() => store.returnOrder(order.id, 'refused at door')) },
                ])
              } />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function RiderHistoryScreen() {
  const store = useStore();
  const done = store.orders
    .filter(o => o.status === 'delivered')
    .sort((a, b) => (b.deliveredAt ?? b.bookedAt) - (a.deliveredAt ?? a.bookedAt));

  // The chip stays on screen while the PDF builds, so it needs its own guard.
  const [sharingId, setSharingId] = React.useState<string | null>(null);

  // "Send it again" — the shopkeeper lost the PDF or asked later (audit).
  const resendBill = async (o: Order) => {
    const shop = store.shops.find(s => s.id === o.shopId);
    if (!shop || !o.billedTotals || !o.invoiceNo || sharingId) return;
    setSharingId(o.id);
    try {
      const html = billHtml({
        settings: store.settings,
        order: o,
        shop,
        logo: await documentLogo(store.settings.logoUrl),
        amountInWordsLine: amountInWordsLine(o.billedTotals.grandTotal),
        received: o.amountPaid,
        previousBalance: 0, // history re-send: today's balance is not that day's
      });
      await sharePdf(
        html, o.invoiceNo,
        `Bill ${o.invoiceNo} — Rs ${o.billedTotals.grandTotal.toLocaleString()}.`,
        { phone: shop.phone, countryCode: store.settings.countryCode },
      );
    } catch (e) {
      Alert.alert('Could not share', e instanceof Error ? e.message : String(e));
    } finally {
      setSharingId(null);
    }
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
            <Chip small label="Bill PDF"
              onPress={sharingId ? undefined : () => { void resendBill(o); }} />
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
  // handOver returns void — the day doc flips only once the write lands, so
  // the button holds itself down from the first tap.
  const [handedOver, setHandedOver] = React.useState(false);
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
            <Text style={[styles.meta, styles.flexLabel]} numberOfLines={2}>{p.receiptNo}{p.mode === 'cheque' ? ' • cheque' : ''}</Text>
            <View style={styles.valueRight}>
              <Money amount={p.amount} />
            </View>
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
                <Text style={[styles.meta, styles.flexLabel]} numberOfLines={2}>{p.receiptNo}</Text>
                <View style={styles.valueRight}>
                  <Money amount={p.amount} />
                </View>
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
            disabled={expected === 0 || handedOver}
            disabledReason={expected === 0 ? 'No cash collected yet' : undefined}
            onPress={() => { setHandedOver(true); store.handOver(); }}
          />
        </View>
      ) : (
        <Card>
          {/* The one tag in the app inside a COLUMN — without this wrapper it
              would centre itself across the card instead of sitting above the
              line it labels. */}
          <View style={styles.tagWrap}>
            <Tag
              label={store.day.handoverConfirmed ? 'CONFIRMED' : 'WAITING'}
              tone={store.day.handoverConfirmed ? 'success' : 'warn'}
            />
          </View>
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
  // Owns the height the ScrollView shrinks into when the keyboard is up.
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: color.bg },
  // Deep enough that the CTA under the last field still clears the keyboard.
  content: { paddingTop: space.s, paddingBottom: space.xl * 3 },
  centerPad: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  subLine: {
    fontSize: font.sub, color: color.textSub,
    marginHorizontal: space.gutter, marginTop: space.xs, marginBottom: space.s,
  },
  shopTitle: { fontSize: font.h1, fontWeight: '800', color: color.text, marginHorizontal: space.gutter },
  doneTitle: { fontSize: font.h1, fontWeight: '800', color: color.text, marginTop: space.s, marginBottom: space.xs },
  big: { fontSize: font.h2, fontWeight: '700', color: color.text },
  qty: { fontSize: font.body, fontWeight: '700', color: color.text },
  meta: { fontSize: font.sub, color: color.textSub },
  hint: { fontSize: font.sub, color: color.textSub, marginTop: space.s, textAlign: 'center' },
  tagWrap: { alignSelf: 'flex-start' },
  statusText: { fontSize: font.sub, color: color.textSub, marginTop: space.s },
  rowBetween: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.xs,
  },
  // A flexible label beside a fixed value: the label takes all the slack and
  // wraps to two lines, the number keeps its natural width so money never
  // breaks mid-figure.
  flexLabel: { flex: 1, minWidth: 0 },
  valueRight: { flexShrink: 0, marginLeft: space.s, alignItems: 'flex-end' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.xs },
  ctaWrap: { marginHorizontal: space.gutter, marginVertical: space.s },

  tightCard: { paddingVertical: space.xs },
  payBlock: { paddingVertical: space.s + 2 },
  payDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  payHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.s },
  payLabel: { fontSize: font.body, fontWeight: '600', color: color.text, marginLeft: space.m },
  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginBottom: space.s },
  fieldHint: { fontSize: font.tiny, color: color.textSub, marginTop: space.s },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 40,
    fontSize: font.body, color: color.text,
  },
  oweText: { fontSize: font.sub, fontWeight: '700', color: color.danger, marginTop: space.xs },
  clearText: { fontSize: font.sub, fontWeight: '700', color: color.success, marginTop: space.xs },

  undoRow: { flexDirection: 'row', paddingHorizontal: space.gutter, marginBottom: space.xs },
  // Capped and wrapping: two Tags side by side ("FROM EARLIER" + "COLLECT
  // KHATA") used to eat the whole row and crop the shop's area line.
  tagRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    justifyContent: 'flex-end', gap: space.xs, flexShrink: 0, maxWidth: '55%',
  },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.s },
  qtyInput: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 42, width: 74,
    fontSize: font.h2, fontWeight: '700', color: color.text, textAlign: 'center',
  },
  qtyChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginLeft: space.s },
  failRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    justifyContent: 'center', marginTop: space.s, gap: space.s,
  },
});
