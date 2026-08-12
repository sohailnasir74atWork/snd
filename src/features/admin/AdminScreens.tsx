/**
 * Admin screens — the "Needs your action" stack led by cash awaiting
 * confirmation (FR-15.4, FR-7.11), live dashboard tiles (FR-9.1), More menu.
 */
import React from 'react';
import LinearGradient from 'react-native-linear-gradient';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import {
  Card, Chip, EmptyState, IconTile, ListRow, Money, PrimaryButton, SectionLabel, Tag, Text, Tile, color, font, radius, space,
} from '../../components/ui';
import { netOfTax, totalQty } from '../../lib/order';
import { useStore } from '../../data/store';
import { strings } from '../../i18n/strings';

/**
 * Double-tap guard for the store's fire-and-forget writes.
 *
 * Those methods return void: there is no promise to await and nothing tells
 * the screen the write landed, so the only thing that can stop a fumbled
 * second tap booking the same cash or stock twice is a latch that outlives the
 * tap. The latch is a ref, so it blocks the second press before React has
 * re-rendered; it is released on a short timer, so a failed write can never
 * leave a control dead and a deliberate second action a moment later still
 * goes through. Keyed, so one row's write never freezes another row's.
 *
 * Work that really is awaitable (addEmployee, collect, the CSV export) does
 * NOT use this — it gets a proper busy state with try/finally instead, because
 * only there is there something to show a spinner for.
 */
export function useWriteGuard(holdMs = 1200) {
  const [busyKeys, setBusyKeys] = React.useState<readonly string[]>([]);
  const inFlight = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  React.useEffect(() => {
    const timers = inFlight.current;
    return () => { timers.forEach(clearTimeout); timers.clear(); };
  }, []);

  const run = React.useCallback((key: string, write: () => void) => {
    if (inFlight.current.has(key)) return; // the second tap writes nothing
    const release = setTimeout(() => {
      inFlight.current.delete(key);
      setBusyKeys(keys => keys.filter(k => k !== key));
    }, holdMs);
    inFlight.current.set(key, release);
    setBusyKeys(keys => [...keys, key]);
    // Last, so a throw still leaves the release timer armed.
    write();
  }, [holdMs]);

  const isBusy = React.useCallback((key: string) => busyKeys.includes(key), [busyKeys]);
  return { isBusy, run };
}

/**
 * Scroll container for every admin screen that has a TextInput. The Android
 * manifest asks for `adjustResize`, but this app is edge-to-edge (targetSdk
 * 36) where that alone no longer lifts the field — let alone the save button
 * under it — clear of the keyboard. `keyboardShouldPersistTaps` is the other
 * half: without it the first tap on a button only dismisses the keyboard and
 * the button reads as dead.
 */
export function KeyboardScreen({ children, style, contentContainerStyle }: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={style}
        contentContainerStyle={contentContainerStyle}
        keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function AdminActionScreen() {
  const store = useStore();
  // Every card on this screen moves money, and every one of them stays on
  // screen until the server round-trip lands — the window a second tap fits in.
  const { isBusy, run } = useWriteGuard();
  const withStaff = store.payments.filter(p => !p.confirmed && !p.voided).reduce((s, p) => s + p.amount, 0);
  const oldCredit = store.shops.filter(s => s.active && s.outstanding > 0);
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const problems = store.orders.filter(o =>
    (o.status === 'returned' || o.status === 'cancelled') && o.bookedAt >= dayStart.getTime() - 6 * 86400_000);

  // One card PER PERSON who has handed over: the owner counts one pile of
  // cash and confirms exactly that pile (FR-7.11).
  const handedOver = store.staffDays
    .filter(d => d.staffId && d.handedOver && !d.handoverConfirmed)
    .map(d => d.staffId!);

  // Cash whose holder can no longer hand it over. A removed employee cannot
  // write his own day doc, so without this card the money he collected before
  // being removed could never be confirmed by anyone — it just sat outside
  // every total for good.
  const stranded = Array.from(
    new Set(store.payments.filter(p => !p.confirmed && !p.voided).map(p => p.collectedBy)),
  ).filter(id => !handedOver.includes(id) && !store.staffNames[id]);

  const pending = [...handedOver, ...stranded].map(staffId => ({
    staffId,
    name: store.staffNames[staffId] || 'Removed employee',
    gone: !store.staffNames[staffId],
    amount: store.payments
      .filter(p => !p.confirmed && !p.voided && p.collectedBy === staffId)
      .reduce((s, p) => s + p.amount, 0),
  }));
  const pendingTotal = pending.reduce((s, h) => s + h.amount, 0);
  const stillOut = withStaff - pendingTotal; // collected but not yet handed over
  const exceptions = store.payments.filter(p => p.exception && !p.confirmed && !p.voided);
  const claims = store.rewardClaims.filter(c => c.status === 'pending');
  // Orders no van is carrying. Loud, because a rider's read rule keys on
  // assignedTo — nobody but the owner can even see these, and until he puts
  // one on a van it will not be delivered by anyone.
  const unassigned = store.unassignedOrders;
  const calm = withStaff === 0 && oldCredit.length === 0 && problems.length === 0
    && exceptions.length === 0 && claims.length === 0 && unassigned.length === 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {unassigned.length > 0 && (
        <Card style={styles.exceptionCard}>
          <View style={styles.row}>
            {/* Not `truck-alert-outline` — the bundled font has no such glyph
                and it drew a "?" on the owner's Action screen. */}
            <IconTile name="truck-outline" tint={color.danger} bg={color.dangerSoft} />
            <View style={styles.rowBody}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {unassigned.length} {unassigned.length === 1 ? 'order has' : 'orders have'} no rider
              </Text>
              <Text style={styles.meta} numberOfLines={2}>
                Nobody can see these but you. Put each one on a van, or set a rider
                on the round in More → Areas so the next ones address themselves.
              </Text>
            </View>
          </View>
          {unassigned.slice(0, 8).map(o => (
            <View key={o.id} style={styles.unassignedRow}>
              <Text style={styles.meta} numberOfLines={1}>
                {o.orderNo} • {o.shopSnapshot.name} • {o.shopSnapshot.area || 'no area'}
              </Text>
              <View style={styles.rowWrap}>
                {store.riders.map(r => (
                  <Chip
                    key={r.id}
                    small
                    label={r.name}
                    onPress={isBusy(`assign-${o.id}`) ? undefined : () => run(
                      `assign-${o.id}`, () => store.assignOrder(o.id, r.id),
                    )}
                  />
                ))}
                {store.riders.length === 0 && (
                  <Text style={styles.meta}>Add a rider in More → Employees first.</Text>
                )}
              </View>
            </View>
          ))}
          {unassigned.length > 8 && (
            <Text style={styles.meta}>…and {unassigned.length - 8} more.</Text>
          )}
        </Card>
      )}

      {/* FR-7.13: the booker took cash — deliberately the loudest card here. */}
      {exceptions.map(p => (
        <Card key={p.id} style={styles.exceptionCard}>
          <View style={styles.row}>
            <IconTile name="alert-decagram" tint={color.danger} bg={color.dangerSoft} />
            <View style={styles.rowBody}>
              <Text style={styles.cardTitle} numberOfLines={2}>Booker took cash — exception</Text>
              <Text style={styles.meta} numberOfLines={2}>
                {store.staffNames[p.collectedBy] || 'Booker'} • {store.shops.find(s => s.id === p.shopId)?.name ?? 'shop'} • {p.receiptNo}
              </Text>
            </View>
            {/* The amount never shrinks — a long shop name in the meta line used
                to push it past the right edge of the card. */}
            <View style={styles.rowRight}>
              <Money amount={p.amount} bold color={color.danger} />
            </View>
          </View>
          <Text style={styles.meta}>
            The shop's khata moves only when you confirm this at the handover.
          </Text>
        </Card>
      ))}

      {/* FR-16.5: reward claims — only you can approve. */}
      {claims.map(c => (
        <Card key={c.id}>
          <View style={styles.row}>
            <IconTile name="gift-outline" tint={color.warn} bg={color.warnSoft} />
            <View style={styles.rowBody}>
              <Text style={styles.cardTitle} numberOfLines={2}>Reward claim — {c.staffName}</Text>
              <Text style={styles.meta} numberOfLines={2}>
                {c.shopName} • {c.pieces} pcs • shelf {c.shelfCount} • {c.claimNo}
              </Text>
            </View>
            <View style={styles.rowRight}>
              <Money amount={c.amount} bold />
            </View>
          </View>
          {c.overLimit && (
            <View style={styles.tagRow}>
              <Tag label="OVER LIMIT" tone="danger" />
            </View>
          )}
          {c.photoUrl ? (
            <Image source={{ uri: c.photoUrl }} style={styles.proofPhoto} resizeMode="cover" />
          ) : null}
          {/* Approving writes the float payout row that pays the reward. The
              card only leaves once the listener catches up, so a second tap
              here used to pay the same claim twice — one key covers both
              chips, so approve-then-reject cannot race either. */}
          <View style={styles.chipRow}>
            <Chip small selected label={strings.rewards.approve}
              onPress={isBusy(`claim:${c.id}`) ? undefined
                : () => run(`claim:${c.id}`, () => store.decideRewardClaim(c.id, 'approved'))} />
            <Chip small danger label={strings.rewards.reject}
              onPress={isBusy(`claim:${c.id}`) ? undefined
                : () => run(`claim:${c.id}`, () => store.decideRewardClaim(c.id, 'rejected'))} />
          </View>
        </Card>
      ))}

      {pending.map(h => (
        <Card key={h.staffId}>
          <View style={styles.row}>
            <IconTile name="cash-multiple" />
            <View style={styles.rowBody}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {h.gone ? `${h.name} — cash still to settle` : `${h.name} handed over`}
              </Text>
              <Money amount={h.amount} size={font.stat + 2} bold />
            </View>
          </View>
          <Text style={styles.meta}>
            {h.gone
              ? 'Collected before this person was removed. Settle the cash, then confirm.'
              : `Count ${h.name}'s cash, then confirm — only you can.`}
          </Text>
          {/* The card lives until the confirmation comes back down the
              listener, so the owner sees an unchanged screen and taps again —
              which re-ran the exception-cash khata adjustment. */}
          <PrimaryButton
            variant="cta"
            icon="check-circle-outline"
            label={`${strings.money.confirm} Rs ${h.amount.toLocaleString()}`}
            busy={isBusy(`handover:${h.staffId}`)}
            busyLabel="Confirming…"
            onPress={() => run(`handover:${h.staffId}`, () => store.confirmHandover(h.staffId))}
          />
        </Card>
      ))}
      {stillOut > 0 && (
        <Card>
          <View style={styles.row}>
            <IconTile name="clock-outline" tint={color.warn} bg={color.warnSoft} />
            <View style={styles.rowBody}>
              <Text style={styles.cardTitle} numberOfLines={2}>Rs {stillOut.toLocaleString()} with staff</Text>
              <Text style={styles.meta}>Collected at shops today — confirmation happens at the evening handover.</Text>
            </View>
          </View>
        </Card>
      )}

      {problems.map(o => (
        <Card key={o.id}>
          <View style={styles.row}>
            <IconTile name="close-circle-outline" tint={color.danger} bg={color.dangerSoft} />
            <View style={styles.rowBody}>
              <Text style={styles.cardTitle} numberOfLines={2}>
                {o.shopSnapshot.name} — {o.status === 'cancelled' ? 'cancelled' : 'sent back'}
              </Text>
              <Text style={styles.meta} numberOfLines={2}>
                {o.orderNo}{o.undeliveredReason ? ` • ${o.undeliveredReason}` : ''} • stock released
              </Text>
            </View>
            <View style={styles.rowRight}>
              <Money amount={o.orderedTotals.grandTotal} color={color.textSub} />
            </View>
          </View>
        </Card>
      ))}

      {oldCredit.map(s => (
        <Card key={s.id}>
          <View style={styles.row}>
            <IconTile name="alert-circle-outline" tint={color.danger} bg={color.dangerSoft} />
            <View style={styles.rowBody}>
              <Text style={styles.cardTitle} numberOfLines={2}>{s.name} — credit</Text>
              <Text style={styles.meta} numberOfLines={2}>{s.area} • {s.ownerName} • {s.collectionFlagged ? 'rider will collect' : 'not yet flagged'}</Text>
            </View>
            <View style={styles.rowRight}>
              <Money amount={s.outstanding} bold color={color.danger} />
            </View>
          </View>
        </Card>
      ))}

      {calm && (
        <EmptyState icon="check-circle-outline" title="Nothing needs you" hint="A calm day." />
      )}
    </ScrollView>
  );
}

export function AdminDashboardScreen() {
  const store = useStore();
  // TODAY means today (audit: the hero card was quietly all-time).
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const todayOrders = store.orders.filter(o =>
    o.status !== 'cancelled' && o.status !== 'returned'
    && (o.deliveredAt ?? o.bookedAt) >= dayStart.getTime());
  const delivered = todayOrders.filter(o => o.status === 'delivered');
  // Net of tax: money held for the government was never this business's sale.
  const sales = delivered.reduce((s, o) => s + netOfTax(o.billedTotals), 0);
  // Both figures sit under a "TODAY'S SALES" heading, so both are today's.
  // "cash confirmed" was summing every payment ever taken.
  const confirmed = store.payments
    .filter(p => p.confirmed && !p.voided && p.createdAt >= dayStart.getTime())
    .reduce((s, p) => s + p.amount, 0);
  const withStaff = store.payments.filter(p => !p.confirmed && !p.voided).reduce((s, p) => s + p.amount, 0);
  const outstanding = store.shops.filter(sh => sh.active).reduce((s, sh) => s + sh.outstanding, 0);

  /**
   * What the bookers WROTE today — a different set of orders from
   * `todayOrders`, and deliberately so.
   *
   * `todayOrders` counts anything that moved today, which includes yesterday's
   * bookings going out on today's van; that is the right denominator for a
   * delivered ratio and the wrong one for "how much business did we take". An
   * order booked this morning for Thursday belongs in this number and lands in
   * neither of the two above.
   *
   * The dashboard had the count of these and nothing else, which answers "how
   * busy were they" and not "at what". Twelve orders is a good morning or a
   * poor one depending entirely on whether it is 40 pieces or 400, and the
   * owner had to open Reports to find out which.
   */
  const bookedToday = store.orders.filter(o =>
    o.status !== 'cancelled' && o.status !== 'returned' && o.bookedAt >= dayStart.getTime());
  const bookedPieces = bookedToday.reduce((s, o) => s + totalQty(o.items), 0);
  // Net of tax, for the same reason TODAY'S SALES is: the tax inside a booked
  // order is money this business will collect and hand straight on, and a
  // booked-value tile that quietly includes it disagrees with every sales
  // figure on the screen above it by exactly the tax rate.
  const bookedValue = bookedToday.reduce((s, o) => s + netOfTax(o.orderedTotals), 0);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <LinearGradient
        colors={[color.primary, color.primaryDark]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={styles.hero}>
        <Text style={styles.heroLabel}>TODAY'S SALES</Text>
        <Text style={styles.heroValue}>Rs {sales.toLocaleString()}</Text>
        <View style={styles.heroRow}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatValue}>Rs {confirmed.toLocaleString()}</Text>
            <Text style={styles.heroStatLabel}>cash confirmed</Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroStat}>
            <Text style={styles.heroStatValue}>Rs {withStaff.toLocaleString()}</Text>
            <Text style={styles.heroStatLabel}>with staff</Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroStat}>
            <Text style={styles.heroStatValue}>{delivered.length}/{todayOrders.length}</Text>
            <Text style={styles.heroStatLabel}>delivered</Text>
          </View>
        </View>
      </LinearGradient>
      <View style={styles.tiles}>
        <Tile label="Orders today" value={`${todayOrders.length}`} icon="cart-outline" />
        <Tile label="Delivered" value={`${delivered.length}`} icon="check-circle-outline" />
        {/* The two that answer "at WHAT" rather than "how many". They sit
            together and in this order because pieces is the figure that moves
            a van and rupees is the one that pays for it — an owner reading
            them apart learns half of his own morning. Both say "booked" out
            loud: they count what was written today, which is not the set of
            orders the two tiles above them count. */}
        <Tile label="Pieces booked today" value={bookedPieces.toLocaleString()} icon="package-variant-closed" />
        <Tile label="Value booked today" value={`Rs ${bookedValue.toLocaleString()}`} icon="tag-outline" />
        <Tile label="Credit outstanding" value={`Rs ${outstanding.toLocaleString()}`} icon="alert-circle-outline" accent={outstanding > 0 ? color.danger : undefined} />
        <Tile label="With staff" value={`Rs ${withStaff.toLocaleString()}`} icon="clock-outline" accent={withStaff > 0 ? color.warn : undefined} />
      </View>
      <SectionLabel>Stock</SectionLabel>
      {store.products.map(p => (
        <Card key={p.id}>
          <ListRow
            icon="package-variant"
            title={p.name}
            sub={`${p.stockQty} in stock • ${p.committedQty} committed`}
          />
        </Card>
      ))}
    </ScrollView>
  );
}

type MoreRow = {
  icon: string;
  tint: string;
  bg: string;
  title: string;
  sub: string;
  route: string;
  right?: React.ReactNode;
};

/**
 * One group of destinations. Module scope, not defined during render — a
 * nested component would be a new type on every render and throw away the
 * subtree each time.
 */
function MoreSection({
  label, rows, onGo,
}: { label: string; rows: MoreRow[]; onGo: (route: string) => void }) {
  return (
    <>
      <SectionLabel>{label}</SectionLabel>
      <Card style={styles.menuCard}>
        {rows.map((r, i) => (
          // Hairlines between rows: eight identical rows in one unbroken card
          // read as a wall of text, and the eye has nothing to count by.
          <View key={r.route} style={i < rows.length - 1 ? styles.menuDivider : undefined}>
            <ListRow
              icon={r.icon}
              tint={r.tint}
              bg={r.bg}
              title={r.title}
              sub={r.sub}
              right={r.right}
              chevron
              onPress={() => onGo(r.route)}
            />
          </View>
        ))}
      </Card>
    </>
  );
}

export function AdminMoreMenu({ navigation }: { navigation: { navigate: (r: string) => void } }) {
  const store = useStore();
  const go = React.useCallback(
    (route: string) => navigation.navigate(route),
    [navigation],
  );

  // Everything counted here is ALREADY on the phone: shops, products, areas
  // and today's day docs all attach at sign-in. This screen opens no listener
  // of its own — which is exactly why Employees carries no count. That one is
  // lazy (LazyKey), and a number on a menu row does not justify a sync a rider
  // would also be paying for.
  const shops = store.shops.filter(s => s.active).length;
  const products = store.products.filter(p => p.active).length;
  const areas = store.areas.filter(a => a.active).length;

  // The only thing on this screen that is about money rather than navigation:
  // cash a man has handed over that nobody has counted yet (FR-7.11). It
  // outranks "still out" because it is the owner's to act on, not to wait on.
  const toConfirm = store.staffDays.filter(d => d.handedOver && !d.handoverConfirmed).length;
  const stillOut = store.staffDays.filter(d => d.routeStarted && !d.handedOver).length;
  const teamRight =
    toConfirm > 0 ? (
      <Tag label={`${toConfirm} TO CONFIRM`} tone="warn" />
    ) : stillOut > 0 ? (
      <Tag label={`${stillOut} OUT`} tone="primary" />
    ) : null;

  const count = (n: number) => <Text style={styles.menuCount}>{n}</Text>;

  // Daily checks first. This screen is reached from a tab several times a day
  // and the setup lists are opened once a month, so leading with Shops put the
  // rarest thing under the thumb and the owner's actual errand four rows down.
  const today: MoreRow[] = [
    {
      icon: 'account-clock-outline', tint: color.primary, bg: color.primarySoft,
      title: 'Team today', sub: 'who started, who is still out',
      route: 'TeamDay', right: teamRight,
    },
    {
      icon: 'chart-line', tint: color.success, bg: color.successSoft,
      title: 'Reports', sub: 'sales, collections, who owes me', route: 'Reports',
    },
    {
      icon: 'printer-outline', tint: color.primary, bg: color.primarySoft,
      title: 'Bills', sub: 'open one, or print many to a page', route: 'Bills',
    },
    {
      icon: 'receipt', tint: color.warn, bg: color.warnSoft,
      title: 'Expenses', sub: 'fixed charges + one-off expenses', route: 'Expenses',
    },
  ];

  const business: MoreRow[] = [
    {
      icon: 'storefront-outline', tint: color.primary, bg: color.primarySoft,
      title: 'Shops', sub: 'add, edit, pins, balances', route: 'Shops', right: count(shops),
    },
    {
      icon: 'bottle-tonic-plus-outline', tint: color.success, bg: color.successSoft,
      title: 'Products', sub: 'prices, stock, activate/deactivate',
      route: 'Products', right: count(products),
    },
    {
      icon: 'map-marker-radius-outline', tint: color.warn, bg: color.warnSoft,
      title: 'Areas', sub: 'the rounds a booker covers', route: 'Areas', right: count(areas),
    },
    {
      icon: 'account-multiple-outline', tint: color.primary, bg: color.primarySoft,
      // Was "add by Gmail, roles, remove" — Gmail is now the second way in,
      // not the only one.
      title: 'Employees', sub: 'login IDs, PINs, roles', route: 'Employees',
    },
  ];

  const app: MoreRow[] = [
    {
      icon: 'cog-outline', tint: color.textSub, bg: color.surfaceAlt,
      title: 'Settings', sub: 'brand, delivery day, discounts, toggles', route: 'Settings',
    },
  ];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <MoreSection label="Today" rows={today} onGo={go} />
      <MoreSection label="Your business" rows={business} onGo={go} />
      <MoreSection label="App" rows={app} onGo={go} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // The gradient keeps its literal whites (they sit on colour, not on the
  // canvas), but the sizes come down to the tightened type scale.
  hero: {
    marginHorizontal: space.gutter, marginTop: space.s, borderRadius: radius.card + 2, padding: space.l + 2,
    shadowColor: '#1D4FD7', shadowOpacity: 0.35, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  heroLabel: { color: 'rgba(255,255,255,0.75)', fontSize: font.sub, fontWeight: '800', letterSpacing: 1.2 },
  heroValue: { color: '#FFFFFF', fontSize: font.h1 + 6, fontWeight: '800', marginTop: 2, letterSpacing: -0.5 },
  heroRow: { flexDirection: 'row', marginTop: space.l, alignItems: 'center' },
  heroStat: { flex: 1, minWidth: 0 },
  heroStatValue: { color: '#FFFFFF', fontSize: font.body, fontWeight: '700' },
  heroStatLabel: { color: 'rgba(255,255,255,0.7)', fontSize: font.tiny, marginTop: 1 },
  heroDivider: { width: 1, height: 26, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: space.m },
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingTop: space.s, paddingBottom: space.xl },
  subLine: { fontSize: font.sub, color: color.textSub, marginHorizontal: space.gutter, marginBottom: space.xs },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space.s + 2 },
  row: { flexDirection: 'row', alignItems: 'center' },
  // One unassigned order and the vans it could go on. Divided so a list of
  // eight does not read as one paragraph of shop names.
  unassignedRow: {
    marginTop: space.m, paddingTop: space.s,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border,
  },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  // minWidth 0 is what lets a long name wrap instead of shoving the amount
  // beside it off the card.
  rowBody: { flex: 1, minWidth: 0, marginLeft: space.m },
  rowRight: { flexShrink: 0, marginLeft: space.s, alignItems: 'flex-end' },
  cardTitle: { fontSize: font.h2 - 1, fontWeight: '700', color: color.text },
  meta: { fontSize: font.sub, color: color.textSub, marginTop: 2 },

  exceptionCard: { borderWidth: 1, borderColor: color.danger },
  tagRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.s },
  proofPhoto: {
    height: 140, borderRadius: radius.tile, marginTop: space.s,
    backgroundColor: color.surfaceAlt,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: space.s },

  // ---- More menu ----------------------------------------------------------
  menuCard: { paddingVertical: space.xs },
  menuDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  // Faint on purpose: a count is context for the row it sits on, not a figure
  // the owner is meant to read down the column.
  menuCount: { fontSize: font.body, fontWeight: '700', color: color.textFaint },
});
