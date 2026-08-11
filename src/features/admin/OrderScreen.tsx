/**
 * One order, in full, for the owner — and the one place a price can be
 * corrected before the goods go out.
 *
 * The booker negotiates a DISCOUNT off a fixed trade price. That covers the
 * ordinary haggle and not the case this screen exists for: the owner has a
 * standing rate with a shop, or agreed one on the phone, and the order was
 * written at the list price by a man who did not know. Expressing that as a
 * discount percent works out to a number nobody chose and puts a concession on
 * the bill that was never a concession.
 *
 * Prices only, and only before the van goes. Quantities are not editable here
 * on purpose — `committedQty` moves at booking and would have to move with
 * them, and a stock correction hidden inside a price screen is how stock
 * quietly stops matching the shelf. A changed basket is a cancel and a rebook.
 */
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  Card, EmptyState, Money, PrimaryButton, SectionLabel, Tag,
  color, font, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import type { Order } from '../../data/models';
import { computeTotals, formatDiscountPercent, netOfTax } from '../../lib/order';
import { formatAmount } from '../../lib/money';
import { isProvisional } from '../../lib/serials';
import { consumePendingOrder } from '../../app/orderIntent';

/** Editable only while the goods are still ours to reprice. */
function isRepriceable(o: Order): boolean {
  return o.status === 'booked' || o.status === 'assigned';
}

const STATUS_LABEL: Record<Order['status'], string> = {
  booked: 'Booked',
  assigned: 'With the rider',
  out_for_delivery: 'Out for delivery',
  delivered: 'Delivered',
  closed: 'Closed',
  cancelled: 'Cancelled',
  returned: 'Returned',
};

function toInt(text: string): number {
  const n = Number.parseInt(text.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

export function OrderScreen() {
  const store = useStore();
  const [orderId, setOrderId] = React.useState<string | null>(null);
  /** Keyed by productId. Absent means "unchanged" — never "zero". */
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);

  useFocusEffect(React.useCallback(() => {
    const id = consumePendingOrder();
    if (id) { setOrderId(id); setEdits({}); }
  }, []));

  const order = orderId ? store.orders.find(o => o.id === orderId) ?? null : null;
  const shop = order ? store.shops.find(s => s.id === order.shopId) ?? null : null;

  if (!order) {
    return (
      <View style={styles.screen}>
        <EmptyState
          // NOT `receipt-text-outline` — it is not in the bundled
          // MaterialCommunityIcons font and draws a silent "?" on device
          // (HANDOFF §1c). Check the glyphmap, never the MDI website.
          icon="file-document-outline"
          title="No order open"
          hint="Open an order from Bills to see it in full."
        />
      </View>
    );
  }

  const editable = isRepriceable(order);
  const taxPercent = store.settings.taxPercent;

  /**
   * What the order WOULD total if the boxes were saved. Live, so the owner
   * watches the figure move as he types rather than saving to find out —
   * this is the only screen in the app where he changes what a shop pays
   * without the shopkeeper in front of him.
   */
  const draftItems = order.items.map(it => {
    const typed = edits[it.productId];
    return typed !== undefined && typed !== ''
      ? { ...it, unitPrice: toInt(typed) }
      : it;
  });
  const draftTotals = computeTotals(draftItems, order.discountPercent, false, taxPercent);
  const changed = draftItems.some((it, i) => it.unitPrice !== order.items[i].unitPrice);
  const delta = draftTotals.grandTotal - order.orderedTotals.grandTotal;

  const save = () => {
    if (busy || !changed) return;
    const prices = draftItems.map(it => ({ productId: it.productId, unitPrice: it.unitPrice }));
    // Confirmed, because it moves money on an order a shopkeeper may already
    // have been quoted. The figure in the question is the one that changes.
    Alert.alert(
      'Change the price?',
      `${shop?.name ?? 'This shop'} will be billed Rs ${formatAmount(draftTotals.grandTotal)} instead of Rs ${formatAmount(order.orderedTotals.grandTotal)}.`
      + (order.deliveryDay ? '\n\nThe rider bills against this when he delivers.' : ''),
      [
        { text: 'Keep it as it was', style: 'cancel' },
        {
          text: 'Change it',
          onPress: () => {
            setBusy(true);
            try {
              store.repriceOrder(order.id, prices);
              setEdits({});
            } catch (e) {
              Alert.alert('Not saved', e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  /**
   * Cancel, because delete does not exist and never will.
   *
   * `allow delete: if false` on orders — money history is crossed out, not
   * removed. A cancelled order keeps its serial, its stock movement and its
   * place in the record; a deleted one takes all three with it, and the
   * shopkeeper turning up in three months holding a slip gets no answer.
   *
   * The booker could already cancel his own order and the owner could not,
   * which was backwards. The store method and the rule both already existed;
   * only the button was missing.
   */
  const cancel = () => {
    if (busy || cancelling || !order) return;
    Alert.alert(
      'Cancel this order?',
      `${shop?.name ?? 'This shop'} · ${order.orderNo} · Rs ${formatAmount(order.orderedTotals.grandTotal)}`
      + '\n\nThe stock goes back to the shelf and the order stops appearing in every list. '
      + 'It stays in the record marked cancelled — orders are never deleted.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel the order',
          style: 'destructive',
          onPress: () => {
            setCancelling(true);
            try {
              store.cancelOrder(order.id);
            } catch (e) {
              Alert.alert('Not cancelled', e instanceof Error ? e.message : String(e));
            } finally {
              setCancelling(false);
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.shopName} numberOfLines={2}>{shop?.name ?? 'Unknown shop'}</Text>
        <Text style={styles.meta}>{shop?.area ?? ''}</Text>
        <View style={styles.tagRow}>
          <Tag
            label={STATUS_LABEL[order.status]}
            tone={order.status === 'delivered' ? 'success' : order.status === 'cancelled' || order.status === 'returned' ? 'danger' : 'primary'}
          />
          {isProvisional(order.orderNo) && <Tag label="PROVISIONAL" tone="warn" />}
        </View>
        <Text style={styles.meta}>{order.orderNo}</Text>
        {order.invoiceNo ? <Text style={styles.meta}>Bill {order.invoiceNo}</Text> : null}
      </Card>

      <SectionLabel>{editable ? 'Items — tap a price to change it' : 'Items'}</SectionLabel>
      {order.items.map(it => {
        const typed = edits[it.productId];
        const price = typed !== undefined && typed !== '' ? toInt(typed) : it.unitPrice;
        const moved = price !== it.unitPrice;
        return (
          <Card key={it.productId}>
            <View style={styles.lineHead}>
              <Text style={[styles.lineName, styles.flex]} numberOfLines={2}>{it.name}</Text>
              <Money amount={price * it.qty} bold />
            </View>
            <View style={styles.lineFoot}>
              <Text style={styles.qty}>{it.qty} pcs ×</Text>
              {editable ? (
                <TextInput
                  style={[styles.priceInput, moved && styles.priceInputMoved]}
                  value={typed ?? String(it.unitPrice)}
                  onChangeText={t => setEdits(p => ({ ...p, [it.productId]: t.replace(/[^0-9]/g, '') }))}
                  keyboardType="number-pad"
                  maxLength={7}
                  selectTextOnFocus
                />
              ) : (
                <Text style={styles.priceStatic}>Rs {formatAmount(it.unitPrice)}</Text>
              )}
              {/* What it WAS, kept on screen next to what it is becoming. An
                  owner mid-edit should never have to leave to check. */}
              {moved && <Text style={styles.was}>was {formatAmount(it.unitPrice)}</Text>}
            </View>
          </Card>
        );
      })}

      <Card>
        <View style={styles.totalRow}>
          <Text style={styles.totalKey}>Subtotal</Text>
          <Money amount={draftTotals.subTotal} />
        </View>
        {draftTotals.discountTotal > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalKey}>
              Discount ({formatDiscountPercent(order.discountPercent)}%)
            </Text>
            <Money amount={-draftTotals.discountTotal} />
          </View>
        )}
        {draftTotals.taxTotal ? (
          <View style={styles.totalRow}>
            <Text style={styles.totalKey}>Sales tax {taxPercent}%</Text>
            <Money amount={draftTotals.taxTotal} />
          </View>
        ) : null}
        <View style={[styles.totalRow, styles.totalDivider]}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Money amount={draftTotals.grandTotal} size={font.stat} bold />
        </View>
        {changed && (
          <Text style={[styles.delta, delta < 0 ? styles.deltaDown : styles.deltaUp]}>
            {delta < 0 ? '↓ ' : '↑ '}Rs {formatAmount(Math.abs(delta))} against the price this order was written at
          </Text>
        )}
      </Card>

      {editable ? (
        <View style={styles.ctaWrap}>
          <PrimaryButton
            icon="content-save-outline"
            label={changed ? `Save — Rs ${draftTotals.grandTotal.toLocaleString()}` : 'No change to save'}
            busy={busy}
            disabled={!changed}
            disabledReason="Change a price first"
            onPress={save}
          />
          {/* Quiet, and below the save. It is the rarer action and it should
              not sit at thumb height next to the one used every time. */}
          <PrimaryButton
            variant="quiet"
            icon="close-circle-outline"
            label="Cancel this order"
            busy={cancelling}
            busyLabel="Cancelling…"
            onPress={cancel}
          />
        </View>
      ) : (
        // Says WHY rather than just greying the fields out. "Delivered" is the
        // reason, and the shop is holding paper with the old number on it.
        <Text style={styles.locked}>
          {order.status === 'delivered' || order.status === 'closed'
            ? 'Delivered — the price is fixed now. The shop has a bill with this total on it.'
            : `${STATUS_LABEL[order.status]} — prices can only be changed while an order is booked or with the rider.`}
        </Text>
      )}
      {order.status === 'delivered' && (
        <Text style={styles.locked}>
          Sales on this order, net of tax: Rs {formatAmount(netOfTax(order.billedTotals ?? order.orderedTotals))}
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.gutter, paddingBottom: space.xl * 2 },
  flex: { flex: 1, minWidth: 0 },
  shopName: { fontSize: font.h2, fontWeight: '800', color: color.text },
  meta: { fontSize: font.sub, color: color.textSub, marginTop: 2 },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s },
  lineHead: { flexDirection: 'row', alignItems: 'center' },
  lineName: { fontSize: font.body, fontWeight: '700', color: color.text },
  lineFoot: { flexDirection: 'row', alignItems: 'center', marginTop: space.s, gap: space.s },
  qty: { fontSize: font.sub, color: color.textSub },
  priceInput: {
    backgroundColor: color.surfaceAlt, borderRadius: 8, borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 38, minWidth: 96,
    fontSize: font.body, fontWeight: '700', color: color.text,
  },
  priceInputMoved: { borderColor: color.primary, borderWidth: 2 },
  priceStatic: { fontSize: font.body, fontWeight: '700', color: color.text },
  was: { fontSize: font.tiny, color: color.textSub, textDecorationLine: 'line-through' },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
  totalKey: { fontSize: font.body, color: color.textSub },
  totalLabel: { fontSize: font.body, fontWeight: '800', color: color.text },
  totalDivider: { borderTopWidth: 1, borderTopColor: color.cardEdge, marginTop: space.s, paddingTop: space.s },
  delta: { fontSize: font.tiny, marginTop: space.s, fontWeight: '700' },
  deltaUp: { color: color.success },
  deltaDown: { color: color.danger },
  ctaWrap: { marginTop: space.m },
  locked: { fontSize: font.tiny, color: color.textSub, marginTop: space.m, lineHeight: font.tiny + 5 },
});
