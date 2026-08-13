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
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import {
  Card, Chip, EmptyState, Icon, ListRow, Money, OptionBar, PrimaryButton, SectionLabel, Tag, Text, color, font, space,
} from '../../components/ui';
import { useNeed, useStore } from '../../data/store';
import type { Order } from '../../data/models';
import { computeTotals, netOfTax, paidAgainstOrder, pickList, totalQty } from '../../lib/order';
import { isProvisional } from '../../lib/serials';
import { billHtml, billSheetHtml, orderConfirmationHtml } from '../../documents/templates';
import { itemsPerSlip } from '../../documents/templates';
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
  /**
   * One card open at a time, the way Route does it.
   *
   * Every row used to carry Edit and Open-full permanently, which is a third
   * line of card on every bill for two controls the owner touches rarely — and
   * the job he came here for is ticking boxes. Nine bills filled two screens;
   * a forty-bill day was eight. Collapsed, the same nine fit on one.
   */
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
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

          {bills.map((o, i) => {
            const shop = shopFor(o.shopId);
            const totals = totalsFor(o);
            const paid = paidAgainstOrder(store.payments, o.id);
            const owed = totals.grandTotal - paid;
            const on = picked.includes(o.id);
            const no = o.invoiceNo ?? o.orderNo;
            const open = expandedId === o.id;
            /**
             * The document type, said ONCE per group instead of on every row.
             *
             * It used to be a tag on every card — and in the To-print tab,
             * which sorts undelivered first, that is nine identical pills in a
             * column telling the owner nothing. The distinction still matters,
             * because one pile goes to the rider and the other gets filed, so
             * it is a heading now: same fact, one line, and it holds the count.
             *
             * Only in this tab. Printed sorts by when it was printed, so the
             * two kinds interleave and there are no blocks to head — that tab
             * keeps the per-row tag below.
             */
            const heading = tab === 'todo'
              && (i === 0 || isDelivered(bills[i - 1]) !== isDelivered(o));
            return (
              <React.Fragment key={o.id}>
                {heading && (
                  <SectionLabel>
                    {isDelivered(o)
                      ? `Bills to file (${bills.filter(isDelivered).length})`
                      : `For the rider (${bills.filter(b => !isDelivered(b)).length})`}
                  </SectionLabel>
                )}
                <Card>
                  <ListRow
                    icon={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    tint={on ? color.primary : color.textFaint}
                    title={shop?.name ?? 'Unknown shop'}
                    // "provisional number" rides next to the number it is
                    // about, rather than as a pill at the far end of the card.
                    // The owner who asked what the orange tag meant had it in
                    // front of him and it explained nothing where it sat.
                    // Kept to ONE line at this width. It wrapped at "deliver
                    // tomorrow", and a second line puts back most of the height
                    // the collapse just saved. The heading above already says
                    // these are the rider's, so the verb was carrying nothing.
                    sub={`${no}${isProvisional(no) ? ' · provisional' : ''} · ${
                      totalQty(o.items, isDelivered(o))} pcs · ${
                      isDelivered(o)
                        ? owed > 0 ? `Rs ${owed.toLocaleString()} owed` : 'paid'
                        : o.deliveryDay === 'today' ? 'today' : 'tomorrow'}`}
                    right={(
                      <View style={styles.rowRight}>
                        <Money amount={totals.grandTotal} bold />
                        {/* Its own Pressable, not the card's: the card's job is
                            ticking, which is what the owner came here to do
                            forty times in a row. Opening the actions is the
                            rare one and pays for its own target. */}
                        <Pressable
                          onPress={() => setExpandedId(open ? null : o.id)}
                          hitSlop={12}
                          style={styles.moreBtn}>
                          <Icon
                            name={open ? 'chevron-up' : 'chevron-down'}
                            size={22}
                            color={color.textFaint}
                          />
                        </Pressable>
                      </View>
                    )}
                    onPress={() => toggle(o.id)}
                  />
                  {open && (
                    <View style={styles.rowFoot}>
                      {tab === 'done' && (
                        <Tag
                          label={isDelivered(o) ? 'BILL' : 'FOR THE RIDER'}
                          tone={isDelivered(o) ? 'success' : 'primary'}
                        />
                      )}
                      {tab === 'done' && (
                        <Text style={styles.doneAt}>Printed {daysAgo(log[o.id] ?? now, now)}</Text>
                      )}

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
                      {/* The one thing the old orange pill never said. A tag
                          nobody can decode is decoration, and this one is
                          about the number printed on a shopkeeper's paper. */}
                      {isProvisional(no) && (
                        <Text style={styles.provisionalNote}>
                          Booked with no internet, so this number came from the phone rather
                          than the company counter. It is unique and safe to print — it just
                          sits outside the {no.replace(/^LOCAL-/, '').replace(/-\d+$/, '')}-2026
                          run.
                        </Text>
                      )}
                    </View>
                  )}
                </Card>
              </React.Fragment>
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
          {/* Says what the choice COSTS, not just what it is — the owner should
              learn that a layout summarises long baskets here, rather than from
              a printed page that hides three items.

              The item counts come from the layout table itself
              (`itemsPerSlip`). They were typed in here as 20 and 12, neither
              matched what the sheet did, and the 2-up figure was nearly double
              what that cell physically holds. A number about what fits on paper
              does not belong in a screen's copy. */}
          <Text style={styles.note}>
            {perPage === 2
              ? `Half a page each, cut once across. Biggest print, up to ${itemsPerSlip(2)} items.`
              : perPage === 3
                ? `Three tall strips, cut twice down the sheet. Holds the most — up to ${itemsPerSlip(3)} items — and stays readable.`
                : `Four to a page, cut across and down. Densest: up to ${itemsPerSlip(4)} items, and long names wrap.`}
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
  /**
   * WRAPS. A row can carry a FOR THE RIDER tag, a PROVISIONAL tag, "Printed
   * today", and three chips — on a 720px phone the last of them ran off the
   * right edge with no scroll and no way to reach it. `flexWrap` is the whole
   * fix: the row becomes two lines when it has to rather than hiding a button.
   */
  rowFoot: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    marginTop: space.s, gap: space.s,
  },
  doneAt: { fontSize: font.tiny, color: color.textSub },
  // Money and the disclosure sit together on the right of the collapsed row.
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  moreBtn: { paddingVertical: space.xs, paddingLeft: space.xs },
  // Full width inside the wrapping foot, so it reads as a sentence rather than
  // as another chip in the row.
  provisionalNote: {
    width: '100%', fontSize: font.tiny, color: color.textSub, lineHeight: font.tiny + 5,
  },
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
