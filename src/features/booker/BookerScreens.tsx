/**
 * Booker screens — Route (FR-13.1), New Order (FR-4.1/13.3/13.4/6.1),
 * My Day. Zero typing: everything is chips and tiles.
 */
import React from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  Card, Chip, EmptyState, Icon, IconTile, Money, OptionBar, PrimaryButton, ProvisionalNote,
  SectionLabel, Tag, color, font, radius, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import type { CollectionInput } from '../../data/store';
import type { Order, OrderItem, Shop } from '../../data/models';
import { todayKey } from '../../data/models';
import {
  computeTotals, discountAmountForPrice, discountPercentForPrice, discountPercentForTotal,
  lowestPrice, netOfTax, priceForDiscountAmount, totalWithTax,
} from '../../lib/order';
import { formatAmount } from '../../lib/money';
import { visitCycleDays } from '../../lib/assignment';
import { commissionSplit } from '../../lib/commission';
import { allProgress, monthPace, targetsOf } from '../../lib/target';
import { isProvisional } from '../../lib/serials';
import { strings } from '../../i18n/strings';
import { orderConfirmationHtml } from '../../documents/templates';
import { sharePdf } from '../../documents/share';
import { documentLogo } from '../../lib/logoCache';
import { RewardsSection } from './RewardsSection';
import { consumePendingOrderShop, setPendingOrderShop } from '../../app/orderIntent';
import { PinShopScreen } from '../shops/PinShopScreen';
import { NewShopPlaceChips, ShopPlaceChips } from '../shops/ShopPlace';
import type { GeoFix } from '../../lib/geo';
import { AreaSelect } from '../../components/AreaSelect';
import { CounterStaffSection } from '../admin/CounterStaffSection';

/** Stands in for a shop id while the shop it belongs to does not exist yet. */
const NEW_SHOP = '__new__';

/** Digits only — money and counts are always whole numbers. */
function toInt(text: string): number {
  const n = Number.parseInt(text.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * FR-7.13 — the booker's ONE way to accept cash, deliberately loud. The
 * payment lands flagged, the owner is pushed immediately, and the khata
 * only moves when the owner confirms at the handover.
 */
function ExceptionCashScreen({ shop, onDone }: { shop: Shop; onDone: () => void }) {
  const store = useStore();
  const [amountText, setAmountText] = React.useState('');
  const [mode, setMode] = React.useState<CollectionInput['mode']>('cash');
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<{ receiptNo: string; amount: number } | null>(null);

  const amount = Math.min(toInt(amountText), shop.outstanding);
  const modes: readonly CollectionInput['mode'][] = store.settings.acceptCheques
    ? ['cash', 'transfer', 'cheque']
    : ['cash', 'transfer'];

  const submit = async () => {
    // The receipt number needs a server round-trip, so the button sat live
    // while the write was flying — a second tap recorded the same cash twice.
    if (busy) return;
    setBusy(true);
    try {
      const r = await Promise.resolve(
        store.collect({ shopId: shop.id, amount, mode, exception: true }),
      );
      setDone({ receiptNo: r.receiptNo, amount });
    } catch (e) {
      Alert.alert('Not recorded', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Icon name="alert-decagram" size={64} color={color.warn} />
        <Text style={styles.orderNo}>Receipt {done.receiptNo}</Text>
        {isProvisional(done.receiptNo) && <ProvisionalNote />}
        <Money amount={done.amount} size={font.h1} bold />
        <Text style={styles.centerSub}>
          Recorded as an EXCEPTION — the owner has been told. Hand this cash
          over tonight; the shop's khata moves when the owner confirms it.
        </Text>
        <View style={styles.ctaWrapWide}>
          <PrimaryButton variant="quiet" label="Back to route" onPress={onDone} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
        <Card style={styles.warnCard}>
          <View style={styles.rowCenter}>
            <IconTile name="alert-decagram" tint={color.warn} bg={color.warnSoft} size={40} />
            <View style={styles.rowText}>
              <Text style={styles.shopName}>Exception — you are taking cash</Text>
              <Text style={styles.shopMeta}>
                Normally only the rider takes money. Use this ONLY when the shop
                insists on paying you right now.
              </Text>
            </View>
          </View>
        </Card>

        <Card>
          <View style={styles.rowBetween}>
            <Text style={[styles.shopName, styles.flexLabel]} numberOfLines={2}>{shop.name}</Text>
            <View style={styles.owedCol}>
              <Money amount={shop.outstanding} bold color={color.danger} />
              <Text style={styles.owedLabel}>owed</Text>
            </View>
          </View>
          <Text style={styles.fieldLabel}>How much is he handing you?</Text>
          <TextInput
            style={styles.input}
            value={amountText}
            onChangeText={t => setAmountText(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={color.textFaint}
          />
          <View style={styles.rowWrap}>
            <Chip small label={`All Rs ${shop.outstanding.toLocaleString()}`}
              onPress={() => setAmountText(String(shop.outstanding))} />
          </View>
          <Text style={styles.fieldLabel}>How did the money come in?</Text>
          <OptionBar
            options={modes}
            value={modes.includes(mode) ? mode : 'cash'}
            render={m => (m === 'cash' ? 'Cash' : m === 'transfer' ? 'Bank transfer' : 'Cheque')}
            onChange={setMode}
          />
        </Card>

        <View style={styles.ctaWrap}>
          <PrimaryButton
            variant="cta"
            icon="alert-decagram"
            label={strings.money.cashExceptionButton}
            busy={busy}
            disabled={amount <= 0}
            disabledReason="Enter an amount"
            onPress={() => { void submit(); }}
          />
          <PrimaryButton variant="quiet" icon="arrow-left" label="Back — the rider collects" onPress={onDone} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function BookerRouteScreen() {
  const store = useStore();
  const navigation = useNavigation<{ navigate: (r: string) => void }>();
  // HIS round, not the company's. Ten bookers used to read every shop in the
  // business and compute the identical "due today" list from it — they
  // collided on the same counters and no shop had an owner.
  const active = store.routeShops;
  // Visit cycle: with ~shopsPerDay visits a day, a shop is DUE once its last
  // visit is a full cycle old (or it was never visited). The rest wait below.
  //
  // Measured over the territory for the same reason. Divided by the whole
  // company, 2,000 shops at 20 a day gave a 100-DAY cycle, so almost nothing
  // was ever due and the screen the booker starts his day on was empty.
  const cycleDays = visitCycleDays(active.length, store.settings.shopsPerDay);
  const isDue = (s: Shop) => !s.lastVisitAt || Date.now() - s.lastVisitAt >= cycleDays * 86400_000;
  const due = active.filter(isDue);
  const notDue = active.filter(s => !isDue(s));
  const [showNotDue, setShowNotDue] = React.useState(false);

  /**
   * Which round the booker is working.
   *
   * A territory of seven areas at a hundred shops each is not a list, it is a
   * directory — and he stands in ONE street at a time. Pick the area, then
   * show a day's worth of it. That is the whole filtering story on this
   * screen: one control, no search box, nothing to learn.
   */
  const [areaFilter, setAreaFilter] = React.useState<string | null>(null);
  /** One card open at a time — the rest stay one line tall. */
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  /** Pages of `shopsPerDay`, grown by the button at the foot of the list. */
  const [pages, setPages] = React.useState(1);

  const areas = [...new Set(active.map(s => s.area))].sort((a, b) => a.localeCompare(b));
  const dueInArea = (a: string) => due.filter(s => s.area === a).length;

  /**
   * Exactly one area, always — there is no "all" and no unfiltered state.
   *
   * Showing every area at once is the crowded screen this replaced, so the
   * escape hatch back to it was never worth keeping. Falling back through the
   * list rather than trusting the stored name also self-heals: an area the
   * owner renames or retires under the booker's feet leaves him on a real
   * round instead of an empty screen.
   */
  const activeArea = areaFilter !== null && areas.includes(areaFilter)
    ? areaFilter
    : areas.find(a => dueInArea(a) > 0) ?? areas[0] ?? null;

  const matches = (s: Shop) => s.area === activeArea;
  const dueShown = due.filter(matches);
  const notDueShown = notDue.filter(matches);
  const pageSize = Math.max(5, store.settings.shopsPerDay);
  const limit = pages * pageSize;
  // The cap is not decoration. This list renders into a ScrollView, so every
  // card it emits is MOUNTED — a hundred of them, each with its own chips, on
  // the 3GB phones this app is for.
  const visibleDue = dueShown.slice(0, limit);
  const moreDue = dueShown.length - visibleDue.length;
  // FR-2.x: balances (and everything that acts on them) can be hidden.
  const seesBalances = store.settings.visibility.bookerSeesBalances;
  const [exceptionShopId, setExceptionShopId] = React.useState<string | null>(null);
  const [shelfShopId, setShelfShopId] = React.useState<string | null>(null);
  const [shelfText, setShelfText] = React.useState('');
  /**
   * Editing a shop the booker is standing in front of.
   *
   * He is the one who finds out the name is spelt wrong, the number is dead or
   * the counter has moved street — and until now the only way to fix any of it
   * was to tell the owner, who was not there. The rules have always let a
   * booker write a shop (everything except `outstanding`, which is what
   * payments are for); it was the screen that had no way in.
   */
  const [editShopId, setEditShopId] = React.useState<string | null>(null);
  const [editPhone, setEditPhone] = React.useState('');
  const [editOwner, setEditOwner] = React.useState('');
  const [editArea, setEditArea] = React.useState('');
  const savingEditRef = React.useRef(false);
  // New shop registered on the spot (a new counter wants to start today).
  const [addingShop, setAddingShop] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newPhone, setNewPhone] = React.useState('');
  const [newArea, setNewArea] = React.useState('');
  // Held locally until the shop document exists to carry them.
  const [newLocation, setNewLocation] = React.useState<GeoFix | null>(null);
  const [newPhotoUrl, setNewPhotoUrl] = React.useState<string | null>(null);
  // Counter staff typed before the shop document exists to hold them, exactly
  // like the pin and the photo above. Optional: most counters have nobody on
  // the reward scheme on day one, and `CounterStaffSection` on Edit details is
  // the other door for when somebody agrees to it later.
  const [newStaff, setNewStaff] = React.useState<{ name: string; phone?: string }[]>([]);
  const [newStaffName, setNewStaffName] = React.useState('');
  const [newStaffPhone, setNewStaffPhone] = React.useState('');
  // Which shop is being pinned right now: an id for one that exists, or the
  // sentinel for the shop being registered on this screen.
  const [pinning, setPinning] = React.useState<string | null>(null);
  // addShop and recordShelfCount return void — nothing to await and nothing to
  // spin on, so the second tap is blocked here and the form closes itself.
  // addShop writes a NEW document every call: two taps = two shops.
  const savingShopRef = React.useRef(false);
  const savingShelfRef = React.useRef(false);
  // The flag only comes back from the server, so the chip stayed on screen
  // long enough to be tapped twice — remember it locally the moment it is sent.
  const [flagged, setFlagged] = React.useState<Record<string, boolean>>({});

  const exceptionShop = exceptionShopId ? store.shops.find(s => s.id === exceptionShopId) : null;
  if (exceptionShop) {
    return <ExceptionCashScreen shop={exceptionShop} onDone={() => setExceptionShopId(null)} />;
  }

  // The map takes the whole screen while it is open — a pin is a "stand still
  // and look at this" job, and half a map next to a form is neither.
  if (pinning === NEW_SHOP) {
    return (
      <PinShopScreen
        shopName={newName.trim() || 'New shop'}
        existing={newLocation}
        onSave={fix => { setNewLocation(fix); setPinning(null); }}
        onCancel={() => setPinning(null)}
      />
    );
  }
  const pinningShop = pinning ? store.shops.find(s => s.id === pinning) : null;
  if (pinningShop) {
    return (
      <PinShopScreen
        shopName={pinningShop.name}
        existing={pinningShop.location ?? null}
        onSave={fix => { store.setShopLocation(pinningShop.id, fix); setPinning(null); }}
        onCancel={() => setPinning(null)}
      />
    );
  }

  const saveShelf = (shopId: string) => {
    if (savingShelfRef.current) return;
    savingShelfRef.current = true;
    store.recordShelfCount(shopId, toInt(shelfText));
    setShelfShopId(null);
    setShelfText('');
  };

  const flagShop = (shopId: string) => {
    if (flagged[shopId]) return;
    setFlagged(prev => ({ ...prev, [shopId]: true }));
    store.flagCollection(shopId);
  };

  const openShelf = (shopId: string) => {
    savingShelfRef.current = false;
    setShelfShopId(shelfShopId === shopId ? null : shopId);
    setShelfText('');
  };

  const openEdit = (shop: Shop) => {
    savingEditRef.current = false;
    if (editShopId === shop.id) { setEditShopId(null); return; }
    setEditShopId(shop.id);
    setEditPhone(shop.phone);
    setEditOwner(shop.ownerName ?? '');
    setEditArea(shop.area);
  };

  const saveEdit = (shopId: string) => {
    if (savingEditRef.current) return;
    savingEditRef.current = true;
    store.updateShop(shopId, {
      // No `name`: owner-only, and the rules reject it from a booker.
      phone: editPhone.trim(),
      // Empty string rather than undefined: undefined is stripped before the
      // write, so clearing a wrong owner name would silently keep the old one.
      ownerName: editOwner.trim(),
      area: editArea.trim(),
    });
    setEditShopId(null);
  };

  const saveShop = () => {
    if (savingShopRef.current) return;
    savingShopRef.current = true;
    store.addShop({
      name: newName.trim(), phone: newPhone.trim(), area: newArea.trim(),
      // Both optional by design: a counter registered with no signal and no
      // GPS still becomes a shop, and gets its pin on the next visit.
      location: newLocation ?? undefined,
      photoUrl: newPhotoUrl ?? undefined,
      counterStaff: newStaff.length ? newStaff : undefined,
    });
    setNewName(''); setNewPhone(''); setNewArea('');
    setNewLocation(null); setNewPhotoUrl(null); setAddingShop(false);
    setNewStaff([]); setNewStaffName(''); setNewStaffPhone('');
  };

  const startOrder = (shopId: string) => {
    setPendingOrderShop(shopId);
    navigation.navigate('NewOrder');
  };

  /**
   * One shop, one line — and everything else one tap away.
   *
   * The card used to carry every action it could ever need, permanently: book,
   * shelf count, pin, photo, tell the rider, exception cash. Six controls is
   * fine on the four shops of a pilot and it is three and a half thousand live
   * tap targets across a real territory, on a card tall enough that a screen
   * holds five of them. Booking stays out in the open because booking is the
   * job; the other five live under the chevron.
   */
  const shopCard = (shop: Shop) => {
    const open = expandedId === shop.id;
    const meta = [
      shop.ownerName,
      shop.lastVisitAt
        ? `last visit ${Math.round((Date.now() - shop.lastVisitAt) / 86400_000)} days ago`
        : 'never visited',
      shop.lastShelfCount !== undefined ? `shelf ${shop.lastShelfCount}` : '',
    ].filter(Boolean).join(' • ');
    return (
            <Card key={shop.id} onPress={() => setExpandedId(open ? null : shop.id)}>
              <View style={styles.rowCenter}>
                <View style={styles.rowTextFlush}>
                  <Text style={styles.shopName} numberOfLines={1}>{shop.name}</Text>
                  <Text style={styles.shopMeta} numberOfLines={1}>{meta}</Text>
                </View>
                {seesBalances && shop.outstanding > 0 && (
                  <View style={styles.owedCol}>
                    <Money amount={shop.outstanding} bold color={color.danger} />
                    <Text style={styles.owedLabel}>owed</Text>
                  </View>
                )}
                <View style={styles.rowActions}>
                  <Chip small selected label="Book" onPress={() => startOrder(shop.id)} />
                  <Icon name={open ? 'chevron-up' : 'chevron-down'} size={22} color={color.textFaint} />
                </View>
              </View>
              {open && (
              <View style={styles.rowWrap}>
                {seesBalances && shop.outstanding > 0 && !shop.collectionFlagged && !flagged[shop.id] && (
                  <Chip small danger label={strings.order.tellTheRider} onPress={() => flagShop(shop.id)} />
                )}
                {/* The owner may keep shop edits to himself (Settings). This
                    is a CLIENT scope — the rules still permit the write, in the
                    same way territory is a client scope — so it tidies the
                    booker's screen rather than locking a door. */}
                {store.settings.bookerEditsShops !== false && (
                  <Chip small label="Edit details" onPress={() => openEdit(shop)} />
                )}
                <Chip small label="Shelf count" onPress={() => openShelf(shop.id)} />
                <ShopPlaceChips
                  shop={shop}
                  onPin={() => setPinning(shop.id)}
                  onPhotoUrl={url => store.setShopPhoto(shop.id, url)}
                />
                {seesBalances && shop.outstanding > 0 && (
                  <Chip small label="Shop insists on paying me" onPress={() => setExceptionShopId(shop.id)} />
                )}
              </View>
              )}
              {editShopId === shop.id && (
                <View style={styles.shelfEditor}>
                  {/* The name is shown, not edited. A shop that changes name is
                      a different shop to everyone reading a report, and the
                      booker standing in front of it is the person most likely
                      to "correct" it to whatever the board outside says this
                      month. Owner-only, and enforced in firestore.rules — not
                      merely hidden here. */}
                  <Text style={styles.fieldLabel}>Shop name</Text>
                  <Text style={styles.readOnlyValue}>{shop.name}</Text>
                  <Text style={styles.priceHint}>Only the owner can change a shop's name.</Text>
                  <Text style={styles.fieldLabel}>Mobile number</Text>
                  <TextInput style={styles.input} value={editPhone} onChangeText={setEditPhone}
                    placeholder="03xx xxxxxxx" placeholderTextColor={color.textFaint}
                    keyboardType="phone-pad" />
                  <Text style={styles.fieldLabel}>Owner's name</Text>
                  <TextInput style={styles.input} value={editOwner} onChangeText={setEditOwner}
                    placeholder="Who runs the shop" placeholderTextColor={color.textFaint} />
                  <Text style={styles.fieldLabel}>Area</Text>
                  {/* Picked, never typed — same sheet as everywhere else, so a
                      booker cannot fork a round into three spellings from here. */}
                  <AreaSelect value={editArea} onChange={setEditArea} />
                  <View style={styles.rowWrap}>
                    <Chip
                      small
                      selected={editPhone.trim().length >= 7 && editArea.trim() !== ''}
                      label={
                        editPhone.trim().length < 7 ? 'Mobile number first'
                        : editArea.trim() === '' ? 'Pick the area first'
                        : 'Save details'
                      }
                      onPress={
                        editPhone.trim().length < 7 || editArea.trim() === ''
                          ? undefined
                          : () => saveEdit(shop.id)
                      }
                    />
                    <Chip small label="Cancel" onPress={() => setEditShopId(null)} />
                  </View>
                  {/* The balance is deliberately absent: a booker moves money
                      through payments, never by editing a number on a shop —
                      and the rules refuse the write if he tries. */}
                  {/* Counter staff, on the shop they stand in. This used to be
                      a form on My Day whose third question was "which shop
                      does he work at?", asked of a man who was inside it. */}
                  <CounterStaffSection shop={shop} />
                </View>
              )}
              {shelfShopId === shop.id && (
                <View style={styles.shelfEditor}>
                  <Text style={styles.fieldLabel}>Pieces on the shelf right now</Text>
                  <TextInput
                    style={styles.input}
                    value={shelfText}
                    onChangeText={t => setShelfText(t.replace(/[^0-9]/g, ''))}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={color.textFaint}
                  />
                  <View style={styles.rowWrap}>
                    {/* Save disappears the moment it writes — a second tap
                        used to file the same shelf count again. */}
                    {shelfText !== '' && (
                      <Chip small selected label="Save count" onPress={() => saveShelf(shop.id)} />
                    )}
                    <Chip small label="Cancel" onPress={() => { setShelfShopId(null); setShelfText(''); }} />
                  </View>
                </View>
              )}
              {shop.collectionFlagged && (
                <View style={styles.flaggedRow}>
                  <Icon name="check-circle-outline" size={16} color={color.success} />
                  <Text style={styles.flagged}>Rider will collect on next visit</Text>
                </View>
              )}
            </Card>
    );
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.sub}>
          {due.length} due today • {notDue.length} visited recently • ~{cycleDays}-day cycle
        </Text>

        {/* The ONLY filter on this screen. One row he can thumb through
            instead of seven headings he has to scroll past: a booker works one
            area a day, and the other six are noise until tomorrow. A
            single-area business gets no row at all.

            There is no search box beside it on purpose — two ways to narrow
            the same list is one way too many, and the area a man is standing
            in is a thing he knows without typing. Shop-name search lives on
            New Order, where picking the right shop is the whole job. */}
        {areas.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // Without flexGrow 0 a ScrollView nested in a ScrollView claims
            // the height of the screen and pushes the whole list off it.
            style={styles.filterScroll}
            contentContainerStyle={styles.filterRow}
            keyboardShouldPersistTaps="handled">
            {/* No "All" chip. One area is always selected, and tapping the
                selected one does nothing rather than dropping him back into
                the whole territory — that view is the crowding this screen
                exists to get rid of. */}
            {areas.map(a => (
              <Chip
                key={a || 'no-area'}
                small
                selected={activeArea === a}
                label={`${a.trim() ? a : 'No area yet'} ${dueInArea(a)}`}
                onPress={() => { setAreaFilter(a); setPages(1); setExpandedId(null); }}
              />
            ))}
          </ScrollView>
        )}

        {!addingShop ? (
          <View style={styles.rowWrapPadded}>
            <Chip small label="+ New shop — register on the spot"
              onPress={() => { savingShopRef.current = false; setAddingShop(true); }} />
          </View>
        ) : (
          <Card style={styles.tightCard}>
            <View style={styles.formHead}>
              <IconTile name="storefront-outline" size={34} />
              <Text style={styles.formTitle}>New shop</Text>
            </View>
            <Text style={styles.fieldLabel}>Shop name</Text>
            <TextInput style={styles.input} value={newName} onChangeText={setNewName}
              placeholder="e.g. Bismillah General Store" placeholderTextColor={color.textFaint} />
            <Text style={styles.fieldLabel}>Mobile number</Text>
            <TextInput style={styles.input} value={newPhone} onChangeText={setNewPhone}
              placeholder="03xx xxxxxxx" placeholderTextColor={color.textFaint} keyboardType="phone-pad" />
            <Text style={styles.fieldLabel}>Area</Text>
            {/* Pick, or create when nothing matches — this is the ONLY screen
                a booker can open a round from, because it is the only one he
                has: his tabs are Route, Area map, New order and My day, and
                the shop editor lives in the owner's More stack.

                Free typing was how one round became "Saddar", "saddar" and
                "Sadar ", which split it three ways and left the map unable to
                say what "the area" was. The sheet only offers to create when
                the typed name matches nothing case-insensitively, so that
                cannot come back while a booker in an unworked street can still
                register the shop in front of him.

                Never a blocker either: with no area at all the shop still
                saves and shows under "No area yet" for the owner to place. */}
            <AreaSelect value={newArea} onChange={setNewArea} />
            {/* Whoever is already behind this counter, if anyone. A name is
                the whole requirement — plenty of counter staff are known by
                face and first name only, and refusing to register one because
                nobody has his number just means he goes unpaid. */}
            <Text style={styles.fieldLabel}>Counter staff (optional)</Text>
            {newStaff.map((c, i) => (
              <View key={`${c.name}-${i}`} style={styles.rowBetween}>
                <Text style={[styles.shopMeta, styles.flexLabel]} numberOfLines={1}>
                  {c.name}{c.phone ? ` • ${c.phone}` : ''}
                </Text>
                <Chip small danger label="Remove"
                  onPress={() => setNewStaff(list => list.filter((_, j) => j !== i))} />
              </View>
            ))}
            <TextInput style={styles.input} value={newStaffName} onChangeText={setNewStaffName}
              placeholder="Their name" placeholderTextColor={color.textFaint} />
            <TextInput style={styles.input} value={newStaffPhone} onChangeText={setNewStaffPhone}
              placeholder="Their phone (optional)" placeholderTextColor={color.textFaint}
              keyboardType="phone-pad" />
            <View style={styles.rowWrap}>
              <Chip
                small
                label="Add this person"
                onPress={newStaffName.trim() === '' ? undefined : () => {
                  setNewStaff(list => [...list, {
                    name: newStaffName.trim(),
                    phone: newStaffPhone.trim() || undefined,
                  }]);
                  setNewStaffName(''); setNewStaffPhone('');
                }}
              />
            </View>
            <Text style={styles.fieldLabel}>The place itself (both optional)</Text>
            <NewShopPlaceChips
              hasLocation={!!newLocation}
              hasPhoto={!!newPhotoUrl}
              onPin={() => setPinning(NEW_SHOP)}
              onPhotoUrl={setNewPhotoUrl}
            />
            <PrimaryButton
              label="Save shop" icon="check-circle-outline"
              // Area is required now. A shop saved without one belongs to no
              // round, so it is due on nobody's morning and appears on no
              // map — invisible from the moment it is created, and only ever
              // found by an owner who goes looking. Better to ask for the
              // street while the man is standing in it.
              disabled={
                newName.trim().length === 0
                || newPhone.trim().length < 7
                || newArea.trim().length === 0
              }
              disabledReason={
                newName.trim().length === 0 || newPhone.trim().length < 7
                  ? 'Name and mobile first'
                  : 'Pick the area first'
              }
              onPress={saveShop}
            />
            <View style={styles.rowWrap}>
              <Chip small label="Cancel" onPress={() => setAddingShop(false)} />
            </View>
          </Card>
        )}

        {/* No area headings: the list is one area by construction, and the
            selected chip above already says which. */}
        {visibleDue.map(shopCard)}

        {moreDue > 0 && (
          <View style={styles.rowWrapPadded}>
            {/* A day's work, then the rest on request. An unbounded list of
                due shops is a list nobody can finish, which is a worse start
                to a morning than a short one. */}
            <Chip small label={`Show ${Math.min(moreDue, pageSize)} more — ${moreDue} left`}
              onPress={() => setPages(p => p + 1)} />
          </View>
        )}

        {dueShown.length === 0 && (
          due.length === 0 ? (
            <EmptyState
              icon="check-circle-outline"
              title="Route covered"
              hint="Every shop was visited within the cycle — check back tomorrow."
            />
          ) : (
            <EmptyState
              icon="check-circle-outline"
              title="This area is covered"
              hint="Nothing due here today — pick another area above."
            />
          )
        )}

        {notDueShown.length > 0 && (
          <>
            <View style={styles.rowWrapPadded}>
              <Chip
                small
                label={showNotDue ? 'Hide recently visited' : `Visited recently (${notDueShown.length})`}
                onPress={() => setShowNotDue(v => !v)}
              />
            </View>
            {/* Capped as hard as the due list: this toggle used to mount every
                shop in the territory that was NOT due, which is most of them. */}
            {showNotDue && notDueShown.slice(0, limit).map(shopCard)}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/**
 * Find a shop — every counter in the business, behind one magnifier.
 *
 * The Route screen is the round: due shops, one area, no search box in the
 * way. This is the other half of that decision. A booker who walks past a shop
 * that is not due today, or covers a colleague's patch for an afternoon, needs
 * a way to reach it, and hiding it behind an icon costs him one tap on the
 * rare day he wants it instead of a permanent row on every other day.
 *
 * Company-wide on purpose, like the picker it replaces: covering someone
 * else's shop is normal, and the rules keep `shops` readable across the
 * company rather than carving territory up in the database.
 */
const SEARCH_LIMIT = 40;

export function ShopSearchScreen() {
  const store = useStore();
  const navigation = useNavigation<{ navigate: (r: string) => void }>();
  const [search, setSearch] = React.useState('');
  const seesBalances = store.settings.visibility.bookerSeesBalances;

  const q = search.trim().toLowerCase();
  // Nothing typed shows HIS round, so the screen is useful the instant it
  // opens; typing widens to the whole business.
  const pool = q ? store.shops : store.routeShops;
  const matches = pool.filter(s =>
    s.active && (!q || s.name.toLowerCase().includes(q) || s.area.toLowerCase().includes(q)
      || (s.ownerName ?? '').toLowerCase().includes(q)));
  // Capped, because this list is drawn into a ScrollView and a thousand shops
  // is a thousand mounted cards. Nobody reads past the fortieth result — they
  // type another letter, which is the faster path anyway.
  const shown = matches.slice(0, SEARCH_LIMIT);
  const hidden = matches.length - shown.length;

  const choose = (s: Shop) => {
    setPendingOrderShop(s.id);
    navigation.navigate('NewOrder');
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.input}
            value={search}
            onChangeText={setSearch}
            placeholder="Search shop, area or owner…"
            placeholderTextColor={color.textFaint}
            autoCorrect={false}
            autoFocus
          />
        </View>
        <Text style={styles.sub}>
          {q
            ? `${matches.length} ${matches.length === 1 ? 'shop' : 'shops'} across the business`
            : 'Your round. Type to search every shop in the business.'}
        </Text>

        {shown.map(s => (
          <Card key={s.id} onPress={() => choose(s)}>
            <View style={styles.rowCenter}>
              <IconTile name="storefront-outline" size={40} />
              <View style={styles.rowText}>
                <Text style={styles.shopName} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.shopMeta} numberOfLines={1}>
                  {s.ownerName ? `${s.area} • ${s.ownerName}` : s.area}
                </Text>
              </View>
              {seesBalances && s.outstanding > 0 && (
                <View style={styles.owedCol}>
                  <Money amount={s.outstanding} bold color={color.danger} />
                  <Text style={styles.owedLabel}>owed</Text>
                </View>
              )}
            </View>
          </Card>
        ))}

        {hidden > 0 && (
          <Text style={styles.discountHint}>
            {hidden} more match — type a little more to narrow it down.
          </Text>
        )}

        {matches.length === 0 && (
          <EmptyState
            icon="storefront-outline"
            title={store.shops.length === 0 ? 'No shops yet' : 'Nothing matches'}
            hint={store.shops.length === 0
              ? 'Shops added by your admin will appear here.'
              : 'Try the area name, or the owner’s name.'}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function NewOrderScreen() {
  const store = useStore();
  const navigation = useNavigation<{ navigate: (r: string) => void; goBack: () => void }>();
  const [shop, setShop] = React.useState<Shop | null>(null);
  const [qtys, setQtys] = React.useState<Record<string, number>>({});
  // Typed quantities ride alongside the chips — "3 face wash" is the
  // commonest order and chips alone could not book it (audit).
  const [qtyTexts, setQtyTexts] = React.useState<Record<string, string>>({});
  /**
   * Tomorrow, always, until the booker says otherwise.
   *
   * An order booked at a counter is loaded on a van that has usually already
   * left, so "today" is a promise the round cannot keep — and the store
   * silently rewrites it to tomorrow anyway once the rider starts his route.
   * Starting on the honest answer means the shop is told the truth while the
   * booker is still standing there, instead of finding out when nothing
   * arrives. Today is one tap away for the shops close enough to make it.
   */
  const [deliveryDay, setDeliveryDay] = React.useState<'today' | 'tomorrow'>('tomorrow');
  /**
   * The negotiated price in rupees, empty until the booker types one.
   *
   * Empty is not "no discount" — it means "whatever this shop's standing rate
   * gives", so a shop on a permanent 5% still gets it without anyone opening
   * the panel. Typing a price overrides that for this order only.
   */
  const [priceText, setPriceText] = React.useState('');
  /**
   * The same concession said the other way round — rupees OFF rather than the
   * price after. The booker gets a box for each because the shopkeeper decides
   * which sentence the haggle ends on, and doing the subtraction in his head
   * across the counter is how a bill ends up a rupee away from what was
   * promised. `priceText` stays the single source of truth for what gets
   * stored; this one is an input, never an input to the arithmetic.
   */
  const [offText, setOffText] = React.useState('');
  const [priceOpen, setPriceOpen] = React.useState(false);
  /**
   * Both boxes empty together, always. They are two views of one number, and
   * a cleared price beside a surviving "40 off" is a screen making a promise
   * the order does not contain. Five call sites clear this — that is five
   * chances to remember only one of them, so none of them gets the choice.
   */
  const clearPrice = React.useCallback(() => { setPriceText(''); setOffText(''); }, []);
  const [busy, setBusy] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState<{ order: Order; shop: Shop } | null>(null);

  const pickShop = React.useCallback((s: Shop) => {
    setShop(s);
    // A new shop is a new negotiation: the price panel closes and empties, so
    // the last shop's haggle cannot ride along to this one.
    clearPrice();
    setPriceOpen(false);
    setDeliveryDay('tomorrow');
  }, [clearPrice]);

  /**
   * Is the van THIS shop's order would ride on already loaded?
   *
   * Asked per shop, not per company: a business with several rounds has
   * several vans, and one rider leaving the depot must not push every other
   * round's bookings to tomorrow. No shop picked yet means no van to ask about.
   */
  const vanLoaded = shop ? store.riderRouteStarted(store.riderForShop(shop.id)) : false;

  // "Book order" tapped on a Route card — arrive with the shop preselected.
  useFocusEffect(React.useCallback(() => {
    const id = consumePendingOrderShop();
    if (id) {
      const s = store.shops.find(sh => sh.id === id);
      if (s) { setConfirmed(null); setQtys({}); setQtyTexts({}); pickShop(s); }
    }
  }, [store.shops, pickShop]));

  /**
   * Every quantity change goes through here, and every one of them throws the
   * negotiated price away.
   *
   * A price is agreed for a basket. Keep it while the basket changes and "700"
   * typed against one face wash silently becomes 700 for eleven of them — the
   * percent needed to hold that total is enormous, and above the cap it is
   * quietly clamped instead of refused. Clearing costs one retype in the rare
   * case where the haggle came before the last item; the alternative loses the
   * company real money without showing anything on screen.
   */
  const setQty = (productId: string, q: number) => {
    const v = Math.max(0, Math.min(q, 9999));
    setQtys(prev => ({ ...prev, [productId]: v }));
    setQtyTexts(prev => ({ ...prev, [productId]: v > 0 ? String(v) : '' }));
    clearPrice();
  };

  const typeQty = (productId: string, text: string) => {
    const digits = text.replace(/[^0-9]/g, '');
    setQtyTexts(prev => ({ ...prev, [productId]: digits }));
    setQtys(prev => ({ ...prev, [productId]: digits ? Math.min(parseInt(digits, 10), 9999) : 0 }));
    clearPrice();
  };

  const items: OrderItem[] = store.products
    .filter(p => p.active && (qtys[p.id] ?? 0) > 0)
    .map(p => ({ productId: p.id, name: p.name, qty: qtys[p.id], unitPrice: p.tradePrice }));

  const maxDiscount = store.settings.maxDiscountPercent;
  const subTotal = items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
  // No standing rate any more: an order starts at full price and stays there
  // until somebody types a lower one. `Shop.standingDiscountPercent` used to be
  // read here and quietly took money off every bill for that shop — invisible
  // on the order screen, on the confirmation and on the bill. It is the same
  // objection that removed the percent chips: a discount nobody decided to give
  // is not a negotiation, and the booker could not see it to argue with it.
  const typedPrice = priceText.trim() === '' ? null : toInt(priceText);
  const taxPercent = store.settings.taxPercent;
  // What the number in the box MEANS — the owner's choice (§Settings → Sales
  // tax). Inclusive: he typed the figure the shop hands over, tax already in
  // it. Exclusive: he typed the goods and tax goes on top. Only relevant once
  // a rate is set; at 0 the two are the same number.
  const priceIsFinal = taxPercent > 0 && !!store.settings.priceIncludesTax;
  const discount = typedPrice === null
    ? 0
    : priceIsFinal
      ? discountPercentForTotal(subTotal, typedPrice, maxDiscount, taxPercent)
      : discountPercentForPrice(subTotal, typedPrice, maxDiscount);
  // Tax rides along here as well as in the store: the booker's TOTAL and the
  // number that gets written must be the same number.
  const totals = computeTotals(items, discount, false, store.settings.taxPercent);
  /**
   * The two numbers the booker is negotiating BETWEEN, quoted on the same
   * basis as the box he is typing into. Inclusive mode compares tax-in
   * figures, exclusive mode compares goods — mixing the two is how a hint
   * ends up telling him 700 is above full price when it is not.
   */
  const priceCeiling = priceIsFinal ? totalWithTax(subTotal, taxPercent) : subTotal;
  const priceFloor = priceIsFinal
    ? totalWithTax(lowestPrice(subTotal, maxDiscount), taxPercent)
    : lowestPrice(subTotal, maxDiscount);
  /** What an empty box means: leave it alone and the shop pays this. */
  const pricePlaceholder = priceIsFinal ? totals.grandTotal : netOfTax(totals);
  /** The most the owner's cap allows off, in the rupees the booker is typing. */
  const maxOff = priceCeiling - priceFloor;

  /**
   * The two boxes follow each other on every KEYSTROKE, not on blur.
   *
   * A booker types 40 while the shopkeeper is watching the screen, and the
   * price box has to already say 660 — updating on blur means the two boxes
   * disagree for exactly as long as anyone is looking at them, which is the
   * whole time. `priceText` remains what the order is computed from, so the
   * off box can never introduce a number the stored rate does not reproduce.
   *
   * Both derive against `priceCeiling`, which is full price on whichever basis
   * this company types in — goods, or goods with the tax already inside. Mix
   * the bases and "40 off" quietly becomes 47 off at 17%.
   */
  const typePrice = (t: string) => {
    const digits = t.replace(/[^0-9]/g, '');
    setPriceText(digits);
    setOffText(digits === '' ? '' : String(discountAmountForPrice(priceCeiling, toInt(digits))));
  };

  const typeOff = (t: string) => {
    const digits = t.replace(/[^0-9]/g, '');
    setOffText(digits);
    setPriceText(digits === '' ? '' : String(priceForDiscountAmount(priceCeiling, toInt(digits))));
  };

  /**
   * One line under the field, and it always says what the limits are rather
   * than only complaining once they are crossed. A booker mid-haggle needs to
   * know how far he can go before he offers it, not after.
   */
  const priceHint = subTotal === 0
    ? 'Add a quantity first.'
    : typedPrice !== null && typedPrice > priceCeiling
      ? `Full price is Rs ${formatAmount(priceCeiling)} — you cannot charge above it.`
      : typedPrice !== null && typedPrice < priceFloor
        // Quoted both ways round, because either box may be the one he is
        // looking at when he hits the cap.
        ? `Owner's cap is ${maxDiscount}% — at most Rs ${formatAmount(maxOff)} off, so Rs ${formatAmount(priceFloor)} is as low as you go.`
        : `Full price Rs ${formatAmount(priceCeiling)} · up to Rs ${formatAmount(maxOff)} off, lowest Rs ${formatAmount(priceFloor)}${
          totals.taxTotal
            ? priceIsFinal ? ' · sales tax is inside this' : ' · sales tax is added on top'
            : ''}`;

  const reset = () => {
    setShop(null); setQtys({}); setQtyTexts({}); setConfirmed(null);
    setDeliveryDay('tomorrow'); clearPrice(); setPriceOpen(false);
  };

  const bookOrder = async () => {
    // The serial number needs a server round-trip, so this button sits
    // enabled for a second or two — long enough for an impatient second
    // tap to book the whole order twice.
    if (busy || !shop) return;
    setBusy(true);
    try {
      const order = await Promise.resolve(
        store.bookOrder({ shopId: shop.id, items, discountPercent: discount, deliveryDay }),
      );
      setConfirmed({ order, shop });
    } catch (e) {
      Alert.alert('Order not saved', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const shareConfirmation = async () => {
    // Generating the PDF and opening the share sheet both take a beat: a
    // second tap stacked two share sheets on top of each other.
    if (sharing || !confirmed) return;
    setSharing(true);
    try {
      const html = orderConfirmationHtml({
        settings: store.settings, order: confirmed.order, shop: confirmed.shop,
        logo: await documentLogo(store.settings.logoUrl),
      });
      await sharePdf(
        html,
        confirmed.order.orderNo,
        `Order ${confirmed.order.orderNo} — Rs ${confirmed.order.orderedTotals.grandTotal.toLocaleString()}. Your bill comes with the delivery.`,
        // Straight into THIS shopkeeper's chat. He is standing at the counter
        // while the booker does it; hunting for him in a contact list is the
        // slowest part of the whole booking.
        { phone: confirmed.shop.phone, countryCode: store.settings.countryCode },
      );
    } catch (e) {
      Alert.alert('Could not share', e instanceof Error ? e.message : String(e));
    } finally {
      setSharing(false);
    }
  };

  if (confirmed) {
    const total = confirmed.order.orderedTotals.grandTotal;
    return (
      <View style={[styles.screen, styles.center]}>
        <View style={styles.successBadge}>
          <Icon name="check-circle" size={44} color={color.success} />
        </View>
        <Text style={styles.orderNo}>{confirmed.order.orderNo}</Text>
        {isProvisional(confirmed.order.orderNo) && <ProvisionalNote />}
        <Text style={styles.centerSub}>Order confirmation ready — this is not a bill.</Text>
        <Money amount={total} size={font.h1} bold />
        <View style={styles.ctaWrapWide}>
          <PrimaryButton
            icon="whatsapp"
            label={`Send to ${confirmed.shop.name}'s WhatsApp`}
            busy={sharing}
            busyLabel="Preparing…"
            onPress={() => { void shareConfirmation(); }}
          />
          <PrimaryButton variant="quiet" icon="plus" label="Book another order" onPress={reset} />
        </View>
      </View>
    );
  }

  const seesBalances = store.settings.visibility.bookerSeesBalances;

  /**
   * Arriving with no shop is now the exceptional path, not the normal one.
   *
   * This screen used to open on a picker that listed the booker's whole round
   * grouped by area — a second copy of the Route screen, drawn from the same
   * shops, with none of Route's capping. At a thousand shops it mounted a
   * thousand cards. Every way in now carries a shop with it (Route → Book, or
   * Find a shop), so what is left here is a signpost rather than a list.
   */
  if (!shop) {
    return (
      <View style={[styles.screen, styles.center]}>
        <EmptyState
          icon="storefront-outline"
          title="Which shop are you at?"
          hint="Tap Book on a shop in your round, or search for any shop in the business."
        />
        <View style={styles.ctaWrapWide}>
          <PrimaryButton icon="magnify" label="Find a shop"
            onPress={() => navigation.navigate('ShopSearch')} />
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
        <Card>
          <View style={styles.rowCenter}>
            <IconTile name="storefront-outline" size={40} />
            <View style={styles.rowText}>
              <Text style={styles.shopName} numberOfLines={2}>{shop.name}</Text>
              <Text style={styles.shopMeta} numberOfLines={2}>{shop.area}</Text>
            </View>
            {seesBalances && shop.outstanding > 0 && (
              <View style={styles.owedCol}>
                <Money amount={shop.outstanding} bold color={color.danger} />
                <Text style={styles.owedLabel}>owed</Text>
              </View>
            )}
          </View>
        </Card>

        {shop.lastOrderSummary && Object.keys(qtys).length === 0 && (
          <View style={styles.ctaWrap}>
            <PrimaryButton
              variant="quiet"
              icon="history"
              label={`${strings.order.sameAsLastTime} (${shop.lastOrderSummary.map(l => `${l.qty}×`).join(' ')})`}
              onPress={() => {
                shop.lastOrderSummary!.forEach(l => setQty(l.productId, l.qty));
              }}
            />
          </View>
        )}

        {store.products.filter(p => p.active).map(p => (
          <Card key={p.id}>
            <View style={styles.rowBetween}>
              <Text style={styles.productName} numberOfLines={2}>
                {p.name} <Text style={styles.shopMeta}>{p.packSize}</Text>
              </Text>
              <View style={styles.valueRight}>
                <Money amount={p.tradePrice} bold />
              </View>
            </View>
            {/* Quantity is TYPED, full stop. The chip row that used to sit here
                only covered 1/6/12 and quietly nudged the booker toward those
                numbers; any other count meant fighting the widget. */}
            <View style={styles.qtyRow}>
              <TextInput
                style={styles.qtyInput}
                value={qtyTexts[p.id] ?? ''}
                onChangeText={t => typeQty(p.id, t)}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={color.textFaint}
                maxLength={4}
                selectTextOnFocus
              />
              <Text style={styles.qtyUnit}>pcs</Text>
              <View style={styles.springRow} />
              {qtys[p.id] ? (
                <Money amount={qtys[p.id] * p.tradePrice} size={font.body} bold color={color.primary} />
              ) : null}
            </View>
          </Card>
        ))}

        {/* There is no discount section any more, and its absence is the point.
            A row reading "0% 2% 5% 10%" sits at eye level on a phone the
            shopkeeper is looking at across his own counter, and it announced
            that money was on the table before the booker had decided to put it
            there — every negotiation started from the largest number on
            screen. The concession now lives behind the chevron on the TOTAL
            row, closed until the booker opens it, and it is entered in rupees
            because rupees is what the two of them are actually arguing about. */}
        <Card>
          <View style={styles.totalRow}>
            <Text style={[styles.totalKey, styles.flexLabel]} numberOfLines={2}>Subtotal</Text>
            <View style={styles.valueRight}>
              <Money amount={totals.subTotal} />
            </View>
          </View>
          {totals.discountTotal > 0 && (
            <View style={styles.totalRow}>
              {/* No percent on screen. The rate is bookkeeping; the shop is
                  owed a straight answer about how many rupees came off. */}
              <Text style={[styles.totalKey, styles.flexLabel]} numberOfLines={2}>Discount</Text>
              <View style={styles.valueRight}>
                <Money amount={-totals.discountTotal} />
              </View>
            </View>
          )}
          {totals.taxTotal ? (
            <View style={styles.totalRow}>
              <Text style={[styles.totalKey, styles.flexLabel]} numberOfLines={2}>
                Sales tax {store.settings.taxPercent}%
              </Text>
              <View style={styles.valueRight}>
                <Money amount={totals.taxTotal} />
              </View>
            </View>
          ) : null}
          <View style={[styles.totalRow, styles.totalDivider]}>
            <Text style={[styles.totalLabel, styles.flexLabel]} numberOfLines={2}>TOTAL</Text>
            <View style={styles.valueRight}>
              <Money amount={totals.grandTotal} size={font.stat} bold />
            </View>
            {/* The whole of the discount UI when it is closed: a plain
                expander that gives nothing away to someone reading the screen
                upside down. The booker knows what is under it. */}
            <Pressable
              onPress={() => setPriceOpen(o => !o)}
              hitSlop={14}
              accessibilityRole="button"
              accessibilityLabel={priceOpen ? 'Hide price entry' : 'Give a discount or change the price'}
              style={styles.priceToggle}>
              <Icon name={priceOpen ? 'chevron-up' : 'chevron-down'} size={22} color={color.textFaint} />
            </Pressable>
          </View>

          {priceOpen && (
            <View style={styles.priceEditor}>
              {/* Two boxes, one concession. A haggle ends on whichever sentence
                  the shopkeeper happened to say — "take forty off" or "give it
                  for six sixty" — and making the booker convert one into the
                  other in his head, at a counter, is how a bill lands a rupee
                  away from what he promised out loud. Type either; the other
                  fills itself in. */}
              <Text style={styles.fieldLabel}>Discount — rupees off</Text>
              <TextInput
                style={styles.input}
                value={offText}
                onChangeText={typeOff}
                keyboardType="number-pad"
                // Zero, not the live discount: this box is what he is TAKING
                // off, and a basket with nothing off it has nothing to show.
                placeholder="0"
                placeholderTextColor={color.textFaint}
                maxLength={9}
                selectTextOnFocus
              />
              {/* The label has to say WHICH number he is typing. In inclusive
                  mode the figure he agrees across the counter is the one the
                  shop hands over, and the card above splits the tax back out
                  of it line by line. */}
              <Text style={[styles.fieldLabel, styles.priceFieldGap]}>
                {priceIsFinal ? 'Final price — sales tax included' : 'Discounted price'}
              </Text>
              <TextInput
                style={styles.input}
                value={priceText}
                onChangeText={typePrice}
                keyboardType="number-pad"
                // The placeholder is the live total, so an empty field is
                // visibly "no change" rather than "nothing decided".
                placeholder={String(pricePlaceholder)}
                placeholderTextColor={color.textFaint}
                maxLength={9}
                selectTextOnFocus
              />
              <Text style={styles.priceHint}>{priceHint}</Text>
            </View>
          )}
        </Card>

        <SectionLabel>Deliver</SectionLabel>
        <View style={styles.chipRow}>
          <Chip label={strings.common.today} selected={deliveryDay === 'today' && !vanLoaded}
            onPress={vanLoaded ? undefined : () => setDeliveryDay('today')} />
          <Chip label={vanLoaded ? strings.delivery.vanLoadedDeliverTomorrow : strings.common.tomorrow}
            selected={deliveryDay === 'tomorrow' || vanLoaded}
            onPress={() => setDeliveryDay('tomorrow')} />
        </View>

        <View style={styles.ctaWrap}>
          <PrimaryButton
            icon="check-circle-outline"
            label={`Confirm — Rs ${totals.grandTotal.toLocaleString()}`}
            busy={busy}
            disabled={items.length === 0}
            disabledReason="Add a quantity first"
            onPress={() => { void bookOrder(); }}
          />
          {/* Back to the round rather than to a picker: the shop he wants is
              almost always the next one on Route, and the search is one tap
              from there when it is not. */}
          <PrimaryButton variant="quiet" icon="arrow-left" label="Different shop"
            onPress={() => {
              setShop(null); setQtys({}); setQtyTexts({});
              clearPrice(); setPriceOpen(false);
              navigation.goBack();
            }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function MyDayScreen() {
  const store = useStore();
  const vis = store.settings.visibility;
  const today = todayKey();
  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
  // TODAY's bookings, newest first — not six weeks of history (audit).
  const mine = store.orders
    .filter(o => o.bookedAt >= startOfDay.getTime())
    .sort((a, b) => b.bookedAt - a.bookedAt);
  const todayTotal = mine
    .filter(o => o.status !== 'cancelled' && o.status !== 'returned')
    .reduce((s, o) => s + (o.billedTotals ?? o.orderedTotals).grandTotal, 0);

  // The booker's own evening: exception cash he is carrying (audit blocker —
  // he ended the day blind), then hand over and watch for the confirm.
  /**
   * His own week, and what he has earned.
   *
   * The screen used to open on a list of today's orders and nothing else — a
   * man could not tell from it whether he had had a good morning or a bad one,
   * because there was no yesterday on it to compare against. These are the
   * four numbers he actually asks about.
   *
   * All of it is HIS orders already: the read rule on `orders` is
   * `isBooker && resource.data.bookedBy == request.auth.uid`, so a booker's
   * client never receives anybody else's. Re-filtering by `bookedBy` here
   * would need his uid on the store, which is not there, and would protect
   * against nothing the rules do not already refuse.
   */
  const mineAll = store.orders;
  const yStart = startOfDay.getTime() - 86400_000;
  const yesterday = mineAll.filter(o => o.bookedAt >= yStart && o.bookedAt < startOfDay.getTime()
    && o.status !== 'cancelled' && o.status !== 'returned');
  const yesterdayTotal = yesterday.reduce((s2, o) => s2 + netOfTax(o.billedTotals ?? o.orderedTotals), 0);
  const todayNet = mine
    .filter(o => o.status !== 'cancelled' && o.status !== 'returned')
    .reduce((s2, o) => s2 + netOfTax(o.billedTotals ?? o.orderedTotals), 0);
  /** Booked today FOR tomorrow — the work already lined up. */
  const forTomorrow = mineAll.filter(o =>
    (o.deliveryDate ?? today) > today && o.status !== 'cancelled' && o.status !== 'returned');

  /**
   * Commission, split into money that is his and money that is not yet.
   *
   * A rate of 0 hides the whole block rather than showing four zeroes — a
   * company that does not pay commission should not have a commission panel.
   */
  const rate = {
    mode: store.settings.bookerCommissionMode ?? 'fixed',
    value: store.settings.bookerCommissionValue ?? 0,
  } as const;
  // The month, because that is the period a man is paid over.
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const monthOrders = mineAll.filter(o => o.bookedAt >= monthStart.getTime());
  const earned = commissionSplit(monthOrders, rate);
  /**
   * The month's targets, and where he has got to.
   *
   * Pace matters as much as progress: 60% of a target on the 12th is ahead,
   * and 60% on the 28th is behind. Showing the bar without the day of the
   * month tells a man he is doing well when he is not.
   */
  const monthPayments = store.payments.filter(pm => pm.createdAt >= monthStart.getTime());
  const targets = allProgress(targetsOf(store.settings.monthlyTargets), monthOrders, monthPayments);
  const pace = monthPace(new Date());
  const productName = (id?: string) =>
    id ? store.products.find(pr => pr.id === id)?.name ?? 'product' : null;

  const monthNet = monthOrders
    .filter(o => o.status !== 'cancelled' && o.status !== 'returned')
    .reduce((s2, o) => s2 + netOfTax(o.billedTotals ?? o.orderedTotals), 0);

  const myCash = store.payments.filter(p => !p.confirmed && !p.voided);
  const myCashTotal = myCash.reduce((s, p) => s + p.amount, 0);
  // cancelOrder and handOver are fire-and-forget writes: the status only comes
  // back from the server, so the control has to stop itself the moment it fires.
  const [cancelling, setCancelling] = React.useState<Record<string, boolean>>({});
  const [handedOver, setHandedOver] = React.useState(false);

  const cancelOrder = (order: Order) => {
    // Cancelling twice releases the same committed stock twice.
    if (cancelling[order.id]) return;
    setCancelling(prev => ({ ...prev, [order.id]: true }));
    store.cancelOrder(order.id);
  };

  const statusTag = (o: Order) => {
    if (o.status === 'cancelled') return <Tag label="CANCELLED" tone="danger" />;
    if (o.status === 'returned') return <Tag label="SENT BACK" tone="danger" />;
    if (!vis.bookerSeesDelivery) return null;
    return (
      <Tag
        label={(o.status === 'delivered' ? strings.statuses.done : strings.statuses.toDeliver).toUpperCase()}
        tone={o.status === 'delivered' ? 'success' : 'primary'}
      />
    );
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.sub}>
          {mine.length} orders today{vis.bookerSeesOwnTotals ? ` • Rs ${todayTotal.toLocaleString()}` : ''}
        </Text>

        {/* Today against yesterday, because a number on its own says nothing.
            Hidden entirely when the owner has turned own-totals off — this is
            the same information that switch exists to withhold. */}
        {vis.bookerSeesOwnTotals && (
          <Card>
            <View style={styles.dayRow}>
              <View style={styles.dayCell}>
                <Text style={styles.dayValue}>Rs {todayNet.toLocaleString()}</Text>
                <Text style={styles.dayLabel}>today · {mine.length} orders</Text>
              </View>
              <View style={styles.dayDivider} />
              <View style={styles.dayCell}>
                <Text style={styles.dayValueQuiet}>Rs {yesterdayTotal.toLocaleString()}</Text>
                <Text style={styles.dayLabel}>yesterday · {yesterday.length} orders</Text>
              </View>
            </View>
            {yesterdayTotal > 0 && (
              <Text style={[styles.dayDelta, todayNet >= yesterdayTotal ? styles.deltaUp : styles.deltaDown]}>
                {todayNet >= yesterdayTotal
                  ? `↑ Rs ${(todayNet - yesterdayTotal).toLocaleString()} ahead of yesterday`
                  : `↓ Rs ${(yesterdayTotal - todayNet).toLocaleString()} behind yesterday`}
              </Text>
            )}
            {forTomorrow.length > 0 && (
              <Text style={styles.dayNext}>
                {forTomorrow.length} {forTomorrow.length === 1 ? 'order' : 'orders'} already lined up for delivery
              </Text>
            )}
          </Card>
        )}

        {/* The goal, and the pace. A bar on its own says "60% done"; the day
            of the month is what turns that into ahead or behind. */}
        {targets.length > 0 && vis.bookerSeesOwnTotals && (
          <>
            <SectionLabel>This month's target</SectionLabel>
            <Card>
              {targets.map((t, i) => {
                const ahead = t.fraction >= pace.fraction;
                const name = productName(t.target.productId);
                return (
                  <View key={i} style={i > 0 ? styles.targetGap : undefined}>
                    <View style={styles.rowBetween}>
                      <Text style={[styles.targetName, styles.flexLabel]} numberOfLines={1}>
                        {name ?? (t.target.metric === 'collection' ? 'Cash collected' : 'All products')}
                      </Text>
                      <Text style={styles.targetNum}>
                        {t.label} / {t.target.metric === 'pieces'
                          ? `${t.target.value.toLocaleString()} pcs`
                          : `Rs ${t.target.value.toLocaleString()}`}
                      </Text>
                    </View>
                    <View style={styles.barTrack}>
                      <View style={[
                        styles.barFill,
                        { width: `${Math.round(t.fraction * 100)}%` },
                        ahead ? styles.barAhead : styles.barBehind,
                      ]} />
                      {/* Where the month is. The bar has to reach this line to
                          be on pace, and it is drawn ON the bar rather than
                          written underneath so the comparison is one glance. */}
                      <View style={[styles.barPace, { left: `${Math.round(pace.fraction * 100)}%` }]} />
                    </View>
                    <Text style={[styles.targetHint, ahead ? styles.deltaUp : styles.deltaDown]}>
                      {Math.round(t.fraction * 100)}% done · day {pace.day} of {pace.days}
                      {' · '}{ahead ? 'on track' : 'behind pace'}
                    </Text>
                  </View>
                );
              })}
            </Card>
          </>
        )}

        {/* Commission. Confirmed is money the shop has actually paid for;
            unconfirmed is work done that has not turned into cash yet, and
            keeping the two apart is the whole point — a man told he has
            earned money nobody has handed over stops chasing it. */}
        {rate.value > 0 && vis.bookerSeesOwnTotals && (
          <>
            <SectionLabel>My commission this month</SectionLabel>
            <Card>
              <View style={styles.dayRow}>
                <View style={styles.dayCell}>
                  <Text style={styles.earnConfirmed}>Rs {earned.confirmed.toLocaleString()}</Text>
                  <Text style={styles.dayLabel}>confirmed · {earned.confirmedOrders} paid</Text>
                </View>
                <View style={styles.dayDivider} />
                <View style={styles.dayCell}>
                  <Text style={styles.earnPending}>Rs {earned.unconfirmed.toLocaleString()}</Text>
                  <Text style={styles.dayLabel}>waiting · {earned.unconfirmedOrders} orders</Text>
                </View>
              </View>
              <Text style={styles.dayNext}>
                {rate.mode === 'fixed'
                  ? `Rs ${rate.value} per piece delivered`
                  : `${rate.value}% of the sale`}
                {' · '}confirmed once the shop has paid
              </Text>
              <Text style={styles.dayNext}>Rs {monthNet.toLocaleString()} booked this month</Text>
            </Card>
          </>
        )}
        {mine.map(o => (
          <Card key={o.id}>
            <View style={styles.rowBetween}>
              <Text style={[styles.shopName, styles.flexLabel]} numberOfLines={2}>{o.shopSnapshot.name}</Text>
              {vis.bookerSeesOwnTotals && (
                <View style={styles.valueRight}>
                  <Money amount={(o.billedTotals ?? o.orderedTotals).grandTotal} bold />
                </View>
              )}
            </View>
            <View style={styles.metaRow}>
              {statusTag(o)}
              {/* The Tag beside it is fixed-width, so this line takes the slack. */}
              <Text style={[styles.shopMeta, styles.flexLabel]} numberOfLines={2}>{o.orderNo} • {o.deliveryDay}</Text>
            </View>
            {(o.status === 'booked' || o.status === 'assigned') && !cancelling[o.id] && (
              <View style={styles.rowWrap}>
                <Chip
                  small
                  danger
                  label="Cancel order"
                  onPress={() =>
                    Alert.alert('Cancel this order?', `${o.orderNo} — ${o.shopSnapshot.name}. The shop's confirmation becomes void.`, [
                      { text: 'Keep it', style: 'cancel' },
                      { text: 'Cancel order', style: 'destructive', onPress: () => cancelOrder(o) },
                    ])
                  }
                />
              </View>
            )}
          </Card>
        ))}
        {mine.length === 0 && (
          <EmptyState
            icon="cart-outline"
            title="No orders yet today"
            hint="Tap Book on a shop in your round to start one."
          />
        )}

        <SectionLabel>My cash</SectionLabel>
        <Card>
          <View style={styles.rowBetween}>
            <Text style={[styles.shopName, styles.flexLabel]} numberOfLines={2}>Exception cash with me</Text>
            <View style={styles.valueRight}>
              <Money amount={myCashTotal} bold color={myCashTotal > 0 ? color.warn : undefined} />
            </View>
          </View>
          {myCash.map(p => (
            <View key={p.id} style={styles.metaRow}>
              {/* Receipt + shop name is the long side; the amount holds its width. */}
              <Text style={[styles.shopMeta, styles.flexLabel]} numberOfLines={2}>
                {p.receiptNo} • {store.shops.find(s => s.id === p.shopId)?.name ?? ''}
              </Text>
              <View style={styles.valueRight}>
                <Money amount={p.amount} />
              </View>
            </View>
          ))}
          {myCashTotal === 0 && (
            <Text style={styles.shopMeta}>Nothing — the rider handles collections.</Text>
          )}
        </Card>
        {myCashTotal > 0 && !store.day.handedOver && (
          <View style={styles.ctaWrap}>
            <PrimaryButton
              icon="cash-multiple"
              label={`${strings.money.handOver} Rs ${myCashTotal.toLocaleString()}`}
              // handOver returns void — it goes dead on the first tap and stays
              // dead until the day doc comes back saying it landed.
              disabled={handedOver}
              onPress={() => { setHandedOver(true); store.handOver(); }}
            />
            <Text style={styles.discountHint}>Give the cash to the owner tonight — they confirm it.</Text>
          </View>
        )}
        {store.day.handedOver && store.day.date === today && (
          <Card>
            <Tag
              label={store.day.handoverConfirmed ? 'CONFIRMED' : 'WAITING'}
              tone={store.day.handoverConfirmed ? 'success' : 'warn'}
            />
            <Text style={styles.shopMeta}>
              {store.day.handoverConfirmed
                ? 'Confirmed by the owner — all clear.'
                : 'Waiting for the owner to count and confirm…'}
            </Text>
          </Card>
        )}

        <RewardsSection />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // The KeyboardAvoidingView wrapper: it has to own the height the ScrollView
  // then shrinks into when the keyboard is up.
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: color.bg, paddingTop: space.s },
  // Deep enough that the CTA under the last field still clears the keyboard.
  screenContent: { paddingBottom: space.xl * 3 },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },

  sub: { fontSize: font.sub, color: color.textSub, marginHorizontal: space.gutter, marginTop: space.xs, marginBottom: space.xs },
  shopName: { fontSize: font.h2, fontWeight: '700', color: color.text },
  // Product rows put a name beside a price: let the name take the slack and
  // wrap instead of shoving the amount off the card. minWidth 0 is the half
  // that actually lets it shrink.
  productName: { flex: 1, minWidth: 0, marginRight: space.s, fontSize: font.body, fontWeight: '700', color: color.text },
  shopMeta: { fontSize: font.sub, color: color.textSub, marginTop: 2 },

  // Any flexible label sitting beside a fixed number or Tag: it takes the
  // slack and wraps, the value column never shrinks so money stays on one line.
  flexLabel: { flex: 1, minWidth: 0 },
  valueRight: { flexShrink: 0, marginLeft: space.s, alignItems: 'flex-end' },

  owedCol: { flexShrink: 0, marginLeft: space.s, alignItems: 'flex-end' },
  owedLabel: { fontSize: font.tiny, fontWeight: '700', color: color.danger, textTransform: 'uppercase', letterSpacing: 0.4 },

  flaggedRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.s },
  flagged: { fontSize: font.sub, fontWeight: '600', color: color.success, marginLeft: space.xs },

  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  rowText: { flex: 1, minWidth: 0, marginLeft: space.m },
  // Same as rowText, without the icon-tile gap — the collapsed shop row leads
  // with the name, not a tile.
  rowTextFlush: { flex: 1, minWidth: 0 },
  rowActions: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', marginLeft: space.s },
  // Aligned with `rowWrapPadded` below it rather than with the card edge:
  // the two chip rows sit one above the other and must agree with each other.
  filterScroll: { flexGrow: 0 },
  filterRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: space.gutter, paddingBottom: space.xs,
  },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: space.s, marginLeft: -space.xs },
  areaEmpty: {
    fontSize: font.sub, color: color.textSub, lineHeight: font.sub + 6,
    marginTop: space.xs, marginBottom: space.s,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingHorizontal: space.m },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.xs },
  totalKey: { fontSize: font.body, color: color.textSub },
  totalDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border, marginTop: space.s, paddingTop: space.s + 2 },
  totalLabel: { fontSize: font.body, fontWeight: '800', color: color.text, letterSpacing: 0.4 },

  // Quiet on purpose — see the comment at the call site. It sits inside the
  // TOTAL row rather than under it so nothing on the closed card looks like a
  // section that has been collapsed away.
  priceToggle: { paddingLeft: space.s, paddingVertical: space.xs },
  priceEditor: {
    marginTop: space.s, paddingTop: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border,
  },
  readOnlyValue: { fontSize: font.body, fontWeight: '700', color: color.text, marginTop: 2 },
  priceHint: { fontSize: font.tiny, color: color.textSub, marginTop: space.xs, lineHeight: font.tiny + 5 },
  targetGap: { marginTop: space.l, paddingTop: space.l, borderTopWidth: 1, borderTopColor: color.cardEdge },
  targetName: { fontSize: font.body, fontWeight: '700', color: color.text },
  targetNum: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginLeft: space.s },
  barTrack: {
    height: 10, borderRadius: 5, backgroundColor: color.surfaceAlt,
    marginTop: space.s, overflow: 'hidden', position: 'relative',
  },
  barFill: { height: '100%', borderRadius: 5 },
  barAhead: { backgroundColor: color.success },
  barBehind: { backgroundColor: color.warn },
  // A hairline showing how much of the MONTH has gone. Absolute, on top of the
  // fill, so "am I past it" is answered without reading a number.
  barPace: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: color.text },
  targetHint: { fontSize: font.tiny, marginTop: space.xs, fontWeight: '700' },
  dayRow: { flexDirection: 'row', alignItems: 'center' },
  dayCell: { flex: 1, minWidth: 0 },
  dayDivider: { width: 1, alignSelf: 'stretch', backgroundColor: color.cardEdge, marginHorizontal: space.m },
  dayValue: { fontSize: font.stat, fontWeight: '800', color: color.text },
  dayValueQuiet: { fontSize: font.stat, fontWeight: '800', color: color.textSub },
  dayLabel: { fontSize: font.tiny, color: color.textSub, marginTop: 1 },
  dayDelta: { fontSize: font.sub, fontWeight: '700', marginTop: space.s },
  deltaUp: { color: color.success },
  deltaDown: { color: color.danger },
  dayNext: { fontSize: font.tiny, color: color.textSub, marginTop: space.s, lineHeight: font.tiny + 4 },
  earnConfirmed: { fontSize: font.stat, fontWeight: '800', color: color.success },
  earnPending: { fontSize: font.stat, fontWeight: '800', color: color.warn },
  // Air between the two boxes, so they read as a pair of choices rather than
  // a form with two things to fill in. `fieldLabel` already carries a top
  // margin; this is the extra that separates the second from the first.
  priceFieldGap: { marginTop: space.m },

  ctaWrap: { paddingHorizontal: space.gutter, marginTop: space.s },
  ctaWrapWide: { alignSelf: 'stretch', marginTop: space.m },
  successBadge: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: color.successSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.m,
  },
  orderNo: { fontSize: font.h1, fontWeight: '800', color: color.text },
  centerSub: { fontSize: font.sub, color: color.textSub, textAlign: 'center', marginTop: space.s, marginBottom: space.s },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s },

  warnCard: { borderWidth: 1, borderColor: color.warn },
  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginTop: space.s + 2, marginBottom: space.s },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 40,
    fontSize: font.body, color: color.text,
  },
  shelfEditor: {
    marginTop: space.s, paddingTop: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border,
  },

  rowWrapPadded: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    paddingHorizontal: space.gutter, marginBottom: space.xs,
  },
  tightCard: { paddingVertical: space.xs },
  formHead: { flexDirection: 'row', alignItems: 'center', paddingTop: space.s, marginBottom: space.xs },
  formTitle: { fontSize: font.body, fontWeight: '600', color: color.text, marginLeft: space.m, flexShrink: 1 },
  searchWrap: { paddingHorizontal: space.gutter, marginBottom: space.s },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.s },
  qtyInput: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.s, paddingVertical: 0, height: 40, width: 72,
    fontSize: font.h2, fontWeight: '700', color: color.text, textAlign: 'center',
  },
  qtyUnit: { fontSize: font.sub, color: color.textSub, marginLeft: space.s, fontWeight: '600' },
  discountHint: {
    fontSize: font.tiny, color: color.textSub,
    marginHorizontal: space.gutter, marginTop: space.xs,
  },
  springRow: { flex: 1 },
});
