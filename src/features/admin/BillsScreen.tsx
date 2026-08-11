/**
 * The owner's bill book — every bill he can reach, and a way to get them onto
 * paper without printing one sheet per shop.
 *
 * The rider already sends each shop its bill over WhatsApp at the door, and
 * that is untouched. This is the other copy: the owner wants the stack in his
 * own hand, filed, and one A5 page per bill turns a forty-bill day into forty
 * sheets. Four to a page makes it ten, cut apart on the dashed lines.
 *
 * Selection is explicit — no "print everything" button. A day's bills is the
 * common case and it is one tap (`Select all`), but the owner who wants three
 * shops' copies should not have to throw away thirty-seven pages to get them.
 */
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Card, Chip, EmptyState, ListRow, Money, OptionBar, PrimaryButton, SectionLabel, Tag,
  color, font, space,
} from '../../components/ui';
import { useNeed, useStore } from '../../data/store';
import type { Order } from '../../data/models';
import { computeTotals, netOfTax, paidAgainstOrder, pickList, totalQty } from '../../lib/order';
import { isProvisional } from '../../lib/serials';
import { billHtml, billSheetHtml, orderConfirmationHtml } from '../../documents/templates';
import type { BillsPerPage, BillSlip } from '../../documents/templates';
import { savePdf, sharePdf } from '../../documents/share';
import { documentLogo } from '../../lib/logoCache';
import { amountInWordsLine } from '../../lib/money';
import { KEEP_DAYS, loadDownloads, markDownloaded, unmarkDownloaded } from './billDownloads';
import { setPendingOrder } from '../../app/orderIntent';

/** "today" / "3 days ago" — enough to place a batch, no more. */
function daysAgo(at: number, now: number): string {
  const days = Math.floor((now - at) / 86400_000);
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * Anything that still has paper in it.
 *
 * This screen started as delivered-bills-only, which was wrong for the job it
 * is actually for: the owner prints these to hand to the DELIVERY MAN, so the
 * orders that have not gone out yet are the urgent ones and the delivered
 * bills are the archive. Cancelled and returned orders carry no paper anybody
 * wants.
 */
function isPrintable(o: Order): boolean {
  return o.status !== 'cancelled' && o.status !== 'returned';
}

/** Has the van been? Decides ORDER COPY vs BILL COPY, everywhere. */
function isDelivered(o: Order): boolean {
  return o.status === 'delivered';
}

/**
 * The only split that matters on this screen: has this bill been printed and
 * handed over, or is it still on the owner's desk?
 *
 * It replaced a Today / 7 days / All range control, which was answering a
 * question nobody asked. A bill he has not printed is wanted whatever its age
 * — a week-old one he missed is MORE urgent, not less — and one he has printed
 * is only ever wanted by accident. Age was never the axis; the doing was.
 */
type Tab = 'todo' | 'done';

const TABS: readonly Tab[] = ['todo', 'done'];
const TAB_LABEL: Record<Tab, string> = { todo: 'To print', done: 'Printed' };

const PER_PAGE: readonly BillsPerPage[] = [2, 3, 4];

export function BillsScreen({ navigation }: { navigation?: { navigate: (r: string) => void } }) {
  const store = useStore();
  // `staffNames` is fed by the employee list, which is a LAZY collection: read
  // it without declaring it and you get a confident empty object rather than
  // an error, and every bill silently prints with no names on it.
  useNeed('employeeList');
  const [tab, setTab] = React.useState<Tab>('todo');
  /**
   * The download log, held in state so the list moves the moment a batch is
   * stamped. `now` is frozen for the life of the screen so the keep window
   * cannot shift under a render and drop a row mid-scroll.
   */
  const [now] = React.useState(() => Date.now());
  const [log, setLog] = React.useState(() => loadDownloads(now));
  const [perPage, setPerPage] = React.useState<BillsPerPage>(3);
  /**
   * On by default. The owner asked for this screen so he could load the van
   * and hand the rider his paperwork in one go, and the picking list is the
   * half he cannot do in his head — nine slips of sunblock added up wrong is a
   * van four shops into a bazaar without enough stock.
   */
  const [loadSheet, setLoadSheet] = React.useState(true);
  const [picked, setPicked] = React.useState<readonly string[]>([]);
  const [busy, setBusy] = React.useState(false);

  const allBills = store.orders.filter(isPrintable);

  /**
   * To print: **undelivered first**, and that is the whole ordering.
   *
   * The rider cannot leave without these, so an order still sitting in the
   * depot outranks any delivered bill however old. Within each group, oldest
   * first — this is a queue of work, and the one that has been waiting longest
   * is the one somebody is still waiting on.
   *
   * Printed: newest first, because that list is only ever searched backwards
   * from "the batch I just did".
   */
  const billsIn = (t: Tab) => t === 'todo'
    ? allBills
      .filter(o => log[o.id] === undefined)
      .sort((a, b) =>
        Number(isDelivered(a)) - Number(isDelivered(b))
        || (a.deliveredAt ?? a.bookedAt) - (b.deliveredAt ?? b.bookedAt))
    : allBills
      .filter(o => log[o.id] !== undefined)
      .sort((a, b) => (log[b.id] ?? 0) - (log[a.id] ?? 0));

  const bills = billsIn(tab);
  /** The count rides on each tab — it is the whole answer to "why is this empty". */
  const countIn = (t: Tab) => billsIn(t).length;

  const shopFor = (id: string) => store.shops.find(s => s.id === id);
  // Ordered totals until the van has been; billed after. Same rule as the
  // slip, and it has to be the same rule or the row and the paper disagree.
  const totalsFor = (o: Order) => isDelivered(o)
    ? o.billedTotals ?? computeTotals(o.items, o.discountPercent, true)
    : o.orderedTotals;

  const toggle = (id: string) =>
    setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const allPicked = bills.length > 0 && picked.length === bills.length;
  const selectAll = () => setPicked(allPicked ? [] : bills.map(o => o.id));

  /** The slips, in the order they are listed, for whatever is ticked. */
  const slipsFor = (ids: readonly string[]): BillSlip[] => bills
    .filter(o => ids.includes(o.id))
    .map((o): BillSlip | null => {
      const shop = shopFor(o.shopId);
      return shop ? {
        order: o,
        shop,
        paid: paidAgainstOrder(store.payments, o.id),
        // Absent rather than "Removed employee": a shop's bill is not the
        // place to announce that somebody left.
        bookedByName: store.staffNames[o.bookedBy] || undefined,
        deliveredByName: o.assignedTo ? store.staffNames[o.assignedTo] || undefined : undefined,
      } : null;
    })
    .filter((s): s is BillSlip => s !== null);

  const download = async () => {
    if (busy) return;
    const slips = slipsFor(picked);
    if (slips.length === 0) return;
    setBusy(true);
    try {
      const html = billSheetHtml({
        settings: store.settings,
        logo: await documentLogo(store.settings.logoUrl),
        bills: slips,
        perPage,
        loadSheet,
      });
      const pages = Math.ceil(slips.length / perPage);
      await savePdf(
        html,
        `bill-copies-${slips.length}`,
        `${slips.length} bill ${slips.length === 1 ? 'copy' : 'copies'} on ${pages} A4 ${pages === 1 ? 'page' : 'pages'} — cut along the dotted lines.`,
      );
      // Stamped only once the sheet has closed and only for what actually
      // went into the PDF. Marking on intent would hide a bill from the
      // to-print list that the owner never got as far as saving.
      setLog(markDownloaded(slips.map(b => b.order.id), Date.now()));
      setPicked([]);
    } catch (e) {
      Alert.alert('Could not build the sheet', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /**
   * One shop's full-size document — the rider's own A5 bill for a delivered
   * order, the booker's order confirmation for one that has not gone out.
   *
   * Never `billHtml` for an undelivered order: it is built on delivered
   * quantities, so every line would read zero and the sheet would say BILL
   * over an empty table.
   */
  const shareOne = async (order: Order) => {
    if (busy) return;
    const shop = shopFor(order.shopId);
    if (!shop) return;
    setBusy(true);
    try {
      const logo = await documentLogo(store.settings.logoUrl);
      const totals = totalsFor(order);
      const paid = paidAgainstOrder(store.payments, order.id);
      const html = isDelivered(order)
        ? billHtml({
          settings: store.settings,
          order, shop, logo,
          amountInWordsLine: amountInWordsLine(totals.grandTotal),
          received: paid,
          // The khata BEFORE this bill cannot be reconstructed from a delivered
          // order months later, and a wrong "previous balance" on a reprint is
          // worse than none. The rider's copy at delivery time is the one that
          // carries it; this reprint states only what this bill is.
          previousBalance: 0,
        })
        : orderConfirmationHtml({ settings: store.settings, order, shop, logo });
      await sharePdf(html, order.invoiceNo ?? order.orderNo, `${isDelivered(order) ? 'Bill' : 'Order'} ${order.invoiceNo ?? order.orderNo}`);
    } catch (e) {
      Alert.alert('Could not open the bill', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickedSlips = slipsFor(picked);
  const pickedValue = pickedSlips.reduce((s, b) => s + netOfTax(totalsFor(b.order)), 0);
  // Ordered quantities: this is what has to LEAVE the shelf, and nothing has
  // been delivered yet for the orders that make up most of this list.
  const pick = pickList(pickedSlips.map(b => ({ shopId: b.shop.id, shopName: b.shop.name, items: b.order.items })));
  const pickPieces = pick.reduce((sum, l) => sum + l.qty, 0);
  const sheets = Math.ceil(picked.length / perPage);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.rangeRow}>
        {/* Switching tabs clears the ticks. A selection the owner cannot see
            is a selection he will print by accident. */}
        <OptionBar
          options={TABS}
          value={tab}
          onChange={v => { setTab(v); setPicked([]); }}
          render={v => `${TAB_LABEL[v]} ${countIn(v)}`}
        />
      </View>

      {/* Two facts the owner cannot deduce from an empty list, and both of
          them have already been asked about once. The 90 days is the store
          window (lib/window.ts); the keep window is this screen's own. */}
      <Text style={styles.note}>
        {tab === 'todo'
          ? 'Orders not yet delivered come first — those are the ones the rider needs.'
          : `Printed sheets are kept here for ${KEEP_DAYS} days so you can print them again.`}
      </Text>

      {bills.length === 0 ? (
        <EmptyState
          icon={tab === 'todo' ? 'check-circle-outline' : 'printer-outline'}
          title={tab === 'todo'
            ? (countIn('done') > 0 ? 'All printed' : 'Nothing to print')
            : 'Nothing printed yet'}
          // A bill is made at DELIVERY, not at booking — that is the fact an
          // owner staring at an empty screen is missing, and no amount of
          // "try again" phrasing substitutes for saying it.
          hint={tab === 'todo'
            ? (countIn('done') > 0
              ? `Nothing left to print. The ${countIn('done')} you have done are under Printed.`
              : 'Book an order and it appears here, ready to print for the rider.')
            : 'Print a batch and it moves here, out of the way of the ones you still have to do.'}
        />
      ) : (
        <>
          <View style={styles.actionRow}>
            <Chip label={allPicked ? 'Clear all' : `Select all ${bills.length}`} onPress={selectAll} />
            {picked.length > 0 && (
              <Text style={styles.pickedNote}>
                {picked.length} picked · Rs {pickedValue.toLocaleString()}
              </Text>
            )}
          </View>

          {bills.map(o => {
            const shop = shopFor(o.shopId);
            const totals = totalsFor(o);
            const paid = paidAgainstOrder(store.payments, o.id);
            const owed = totals.grandTotal - paid;
            const on = picked.includes(o.id);
            const no = o.invoiceNo ?? o.orderNo;
            return (
              <Card key={o.id}>
                <ListRow
                  icon={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  tint={on ? color.primary : color.textFaint}
                  title={shop?.name ?? 'Unknown shop'}
                  sub={`${no} · ${totalQty(o.items, isDelivered(o))} pcs${
                    isDelivered(o)
                      ? owed > 0 ? ` · Rs ${owed.toLocaleString()} owed` : ' · paid'
                      : ` · ${o.deliveryDay === 'today' ? 'deliver today' : 'deliver tomorrow'}`}`}
                  right={<Money amount={totals.grandTotal} bold />}
                  onPress={() => toggle(o.id)}
                />
                <View style={styles.rowFoot}>
                  {/* Which document this row will print. The owner is handing
                      one pile to the rider and filing the other; they must not
                      look alike on screen either. */}
                  <Tag
                    label={isDelivered(o) ? 'BILL' : 'FOR THE RIDER'}
                    tone={isDelivered(o) ? 'success' : 'primary'}
                  />
                  {isProvisional(no) && <Tag label="PROVISIONAL" tone="warn" />}
                  {tab === 'done' && (
                    <Text style={styles.doneAt}>Printed {daysAgo(log[o.id] ?? now, now)}</Text>
                  )}
                  <View style={styles.spacer} />
                  {/* The way back. An owner who printed a batch by mistake
                      would otherwise have no way to put it in front of
                      himself again except by remembering it forever. */}
                  {tab === 'done' && (
                    <Chip
                      label="Not printed"
                      onPress={() => setLog(unmarkDownloaded([o.id], Date.now()))}
                    />
                  )}
                  {/* "Edit", not "View" — the screen behind it changes prices,
                      and a label that undersells what a button does is how
                      somebody taps it expecting to look and ends up changing
                      what a shop is charged. It reads View only once the order
                      is delivered, where the fields are genuinely locked. */}
                  {navigation && (
                    <Chip
                      label={isDelivered(o) ? 'View' : 'Edit'}
                      onPress={() => { setPendingOrder(o.id); navigation.navigate('Order'); }}
                    />
                  )}
                  <Chip
                    label={isDelivered(o) ? 'Open full bill' : 'Open full order'}
                    onPress={() => { void shareOne(o); }}
                  />
                </View>
              </Card>
            );
          })}

          <SectionLabel>Bills per A4 page</SectionLabel>
          <View style={styles.rangeRow}>
            <OptionBar
              options={PER_PAGE}
              value={perPage}
              onChange={setPerPage}
              render={v => `${v} per page`}
            />
          </View>
          {/* Says what the choice COSTS, not just what it is. Six-up is the
              cheapest and the one that starts summarising long baskets, and
              the owner should learn that here rather than from a printed
              page that hides three items. */}
          <Text style={styles.note}>
            {perPage === 2
              ? 'Half a page each, cut once across. Up to 20 items — most paper used.'
              : perPage === 3
                ? 'Full width, cut twice across. Up to 12 items each — best for most bills.'
                : 'Two columns, cut across and down. Densest, but long product names wrap.'}
          </Text>

          <SectionLabel>What to pull off the shelf</SectionLabel>
          {picked.length === 0 ? (
            <Text style={styles.note}>Tick some orders and the totals appear here.</Text>
          ) : (
            <Card>
              {pick.map((l, i) => (
                <View key={l.productId} style={[styles.pickBlock, i < pick.length - 1 && styles.pickDivider]}>
                  <View style={styles.pickRow}>
                    <Text style={styles.pickName} numberOfLines={2}>{l.name}</Text>
                    <Text style={styles.pickShops}>{l.shops} shop{l.shops === 1 ? '' : 's'}</Text>
                    <Text style={styles.pickQty}>{l.qty}</Text>
                  </View>
                </View>
              ))}
              <View style={styles.pickTotal}>
                <Text style={styles.pickTotalLabel}>TOTAL PIECES</Text>
                <Text style={styles.pickQty}>{pickPieces}</Text>
              </View>
            </Card>
          )}
          <Chip
            label={loadSheet ? '✓ Load sheet on page 1' : 'Add load sheet to page 1'}
            selected={loadSheet}
            onPress={() => setLoadSheet(v => !v)}
          />

          <View style={styles.ctaWrap}>
            <PrimaryButton
              icon="download"
              label={picked.length === 0
                ? 'Pick some bills'
                : `Download ${picked.length} on ${sheets} ${sheets === 1 ? 'page' : 'pages'}`}
              busy={busy}
              busyLabel="Building the sheet…"
              disabled={picked.length === 0}
              disabledReason="Tick a bill first"
              onPress={() => { void download(); }}
            />
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { padding: space.gutter, paddingBottom: space.xl * 2 },
  rangeRow: { marginBottom: space.s },
  note: { fontSize: font.tiny, color: color.textSub, marginBottom: space.m, lineHeight: font.tiny + 5 },
  actionRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.s },
  pickedNote: { marginLeft: space.m, fontSize: font.sub, color: color.textSub, fontWeight: '700' },
  rowFoot: { flexDirection: 'row', alignItems: 'center', marginTop: space.s, gap: space.s },
  doneAt: { fontSize: font.tiny, color: color.textSub },
  spacer: { flex: 1 },
  ctaWrap: { marginTop: space.m },
  pickBlock: { paddingVertical: space.s },
  pickRow: { flexDirection: 'row', alignItems: 'center' },
  pickDivider: { borderBottomWidth: 1, borderBottomColor: color.cardEdge },
  pickName: { flex: 1, fontSize: font.body, fontWeight: '700', color: color.text },
  pickShops: { fontSize: font.tiny, color: color.textSub, marginHorizontal: space.m },
  pickQty: { fontSize: font.stat, fontWeight: '800', color: color.text, minWidth: 44, textAlign: 'right' },
  pickTotal: {
    flexDirection: 'row', alignItems: 'center', paddingTop: space.s,
    borderTopWidth: 2, borderTopColor: color.text, marginTop: space.xs,
  },
  pickTotalLabel: { flex: 1, fontSize: font.sub, fontWeight: '800', color: color.text, letterSpacing: 0.5 },
});
