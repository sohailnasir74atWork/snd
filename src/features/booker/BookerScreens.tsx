/**
 * Booker screens — Route (FR-13.1), New Order (FR-4.1/13.3/13.4/6.1),
 * My Day. Zero typing: everything is chips and tiles.
 */
import React from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  Card, Chip, EmptyState, Icon, IconTile, Money, OptionBar, PrimaryButton, SectionLabel, Tag,
  color, font, radius, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import type { CollectionInput } from '../../data/store';
import type { Order, OrderItem, Shop } from '../../data/models';
import { todayKey } from '../../data/models';
import { computeTotals } from '../../lib/order';
import { visitCycleDays } from '../../lib/assignment';
import { strings } from '../../i18n/strings';
import { orderConfirmationHtml } from '../../documents/templates';
import { sharePdf } from '../../documents/share';
import { RewardsSection } from './RewardsSection';
import { consumePendingOrderShop, setPendingOrderShop } from '../../app/orderIntent';
import { PinShopScreen } from '../shops/PinShopScreen';
import { NewShopPlaceChips, ShopPlaceChips } from '../shops/ShopPlace';
import type { GeoFix } from '../../lib/geo';
import { AreaSelect } from '../../components/AreaSelect';

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
  const byArea = [...new Set(due.map(s => s.area))];
  // FR-2.x: balances (and everything that acts on them) can be hidden.
  const seesBalances = store.settings.visibility.bookerSeesBalances;
  const [exceptionShopId, setExceptionShopId] = React.useState<string | null>(null);
  const [shelfShopId, setShelfShopId] = React.useState<string | null>(null);
  const [shelfText, setShelfText] = React.useState('');
  // New shop registered on the spot (a new counter wants to start today).
  const [addingShop, setAddingShop] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [newPhone, setNewPhone] = React.useState('');
  const [newArea, setNewArea] = React.useState('');
  // Held locally until the shop document exists to carry them.
  const [newLocation, setNewLocation] = React.useState<GeoFix | null>(null);
  const [newPhotoUrl, setNewPhotoUrl] = React.useState<string | null>(null);
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

  const saveShop = () => {
    if (savingShopRef.current) return;
    savingShopRef.current = true;
    store.addShop({
      name: newName.trim(), phone: newPhone.trim(), area: newArea.trim(),
      // Both optional by design: a counter registered with no signal and no
      // GPS still becomes a shop, and gets its pin on the next visit.
      location: newLocation ?? undefined,
      photoUrl: newPhotoUrl ?? undefined,
    });
    setNewName(''); setNewPhone(''); setNewArea('');
    setNewLocation(null); setNewPhotoUrl(null); setAddingShop(false);
  };

  const startOrder = (shopId: string) => {
    setPendingOrderShop(shopId);
    navigation.navigate('NewOrder');
  };

  const shopCard = (shop: Shop) => (
            <Card key={shop.id}>
              <View style={styles.rowBetween}>
                <Text style={[styles.shopName, styles.flexLabel]} numberOfLines={2}>{shop.name}</Text>
                {seesBalances && shop.outstanding > 0 && (
                  <View style={styles.owedCol}>
                    <Money amount={shop.outstanding} bold color={color.danger} />
                    <Text style={styles.owedLabel}>owed</Text>
                  </View>
                )}
              </View>
              <Text style={styles.shopMeta}>
                {shop.ownerName}
                {shop.lastVisitAt
                  ? ` • last visit ${Math.round((Date.now() - shop.lastVisitAt) / 86400_000)} days ago`
                  : ' • never visited'}
                {shop.lastShelfCount !== undefined ? ` • shelf ${shop.lastShelfCount}` : ''}
              </Text>
              <View style={styles.rowWrap}>
                <Chip small selected label="Book order" onPress={() => startOrder(shop.id)} />
                {seesBalances && shop.outstanding > 0 && !shop.collectionFlagged && !flagged[shop.id] && (
                  <Chip small danger label={strings.order.tellTheRider} onPress={() => flagShop(shop.id)} />
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

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
        <Text style={styles.sub}>
          {due.length} due today • {notDue.length} visited recently • ~{cycleDays}-day cycle
        </Text>

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
            {/* Pick only — a booker cannot invent an area any more. Typing was
                how one round became "Saddar", "saddar" and "Sadar ", which
                split the round three ways and left the map unable to say what
                "the area" was. The owner defines them in More → Areas.
                Never a blocker either: with no areas yet the shop still saves
                and shows under "No area yet" for the owner to place. */}
            <AreaSelect value={newArea} onChange={setNewArea} />
            <Text style={styles.fieldLabel}>The place itself (both optional)</Text>
            <NewShopPlaceChips
              hasLocation={!!newLocation}
              hasPhoto={!!newPhotoUrl}
              onPin={() => setPinning(NEW_SHOP)}
              onPhotoUrl={setNewPhotoUrl}
            />
            <PrimaryButton
              label="Save shop" icon="check-circle-outline"
              disabled={newName.trim().length === 0 || newPhone.trim().length < 7}
              disabledReason="Name and mobile first"
              onPress={saveShop}
            />
            <View style={styles.rowWrap}>
              <Chip small label="Cancel" onPress={() => setAddingShop(false)} />
            </View>
          </Card>
        )}

        {byArea.map(area => (
          <View key={area || 'no-area'}>
            <SectionLabel>{area.trim() ? area : 'No area yet'}</SectionLabel>
            {due.filter(s => s.area === area).map(shopCard)}
          </View>
        ))}
        {due.length === 0 && (
          <EmptyState
            icon="check-circle-outline"
            title="Route covered"
            hint="Every shop was visited within the cycle — check back tomorrow."
          />
        )}

        {notDue.length > 0 && (
          <>
            <View style={styles.rowWrapPadded}>
              <Chip
                small
                label={showNotDue ? 'Hide recently visited' : `Visited recently (${notDue.length})`}
                onPress={() => setShowNotDue(v => !v)}
              />
            </View>
            {showNotDue && notDue.map(shopCard)}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function NewOrderScreen() {
  const store = useStore();
  const [shop, setShop] = React.useState<Shop | null>(null);
  const [qtys, setQtys] = React.useState<Record<string, number>>({});
  // Typed quantities ride alongside the chips — "3 face wash" is the
  // commonest order and chips alone could not book it (audit).
  const [qtyTexts, setQtyTexts] = React.useState<Record<string, string>>({});
  const [deliveryDay, setDeliveryDay] = React.useState<'today' | 'tomorrow'>('today');
  const [discount, setDiscount] = React.useState(0);
  const [search, setSearch] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState<{ order: Order; shop: Shop } | null>(null);

  const pickShop = React.useCallback((s: Shop) => {
    setShop(s);
    // The daily negotiation: prefill the standing rate, allow up to the
    // owner's max (FR: discount is adjustable per order within the cap).
    setDiscount(s.standingDiscountPercent ?? 0);
  }, []);

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

  const setQty = (productId: string, q: number) => {
    const v = Math.max(0, Math.min(q, 9999));
    setQtys(prev => ({ ...prev, [productId]: v }));
    setQtyTexts(prev => ({ ...prev, [productId]: v > 0 ? String(v) : '' }));
  };

  const items: OrderItem[] = store.products
    .filter(p => p.active && (qtys[p.id] ?? 0) > 0)
    .map(p => ({ productId: p.id, name: p.name, qty: qtys[p.id], unitPrice: p.tradePrice }));
  const maxDiscount = store.settings.maxDiscountPercent;
  const discountOptions = [...new Set([0, 2, 5, 10, shop?.standingDiscountPercent ?? 0])]
    .filter(d => d <= maxDiscount)
    .sort((a, b) => a - b);
  const totals = computeTotals(items, discount);

  const reset = () => {
    setShop(null); setQtys({}); setQtyTexts({}); setConfirmed(null);
    setDeliveryDay('today'); setDiscount(0); setSearch('');
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
      });
      await sharePdf(
        html,
        confirmed.order.orderNo,
        `Order ${confirmed.order.orderNo} — Rs ${confirmed.order.orderedTotals.grandTotal.toLocaleString()}. Your bill comes with the delivery.`,
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

  if (!shop) {
    const q = search.trim().toLowerCase();
    // Browsing shows HIS round; typing searches the whole company. Covering a
    // colleague's shop for a day is normal, and a picker that made it
    // impossible would be a worse bug than the collisions territories fix —
    // which is also why the shops collection stays readable company-wide in
    // the rules rather than being carved up there.
    const matches = (q ? store.shops : store.routeShops).filter(s =>
      s.active && (!q || s.name.toLowerCase().includes(q) || s.area.toLowerCase().includes(q)
        || (s.ownerName ?? '').toLowerCase().includes(q)));
    const pickerAreas = [...new Set(matches.map(s => s.area))];
    return (
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.sub}>Which shop are you at?</Text>
          <View style={styles.searchWrap}>
            <TextInput
              style={styles.input}
              value={search}
              onChangeText={setSearch}
              placeholder="Search shop, area or owner…"
              placeholderTextColor={color.textFaint}
              autoCorrect={false}
            />
          </View>
          {pickerAreas.map(a => (
            <View key={a || 'no-area'}>
              <SectionLabel>{a.trim() ? a : 'No area yet'}</SectionLabel>
              {matches.filter(s => s.area === a).map(s => (
                <Card key={s.id} onPress={() => pickShop(s)}>
                  <View style={styles.rowCenter}>
                    <IconTile name="storefront-outline" size={40} />
                    <View style={styles.rowText}>
                      <Text style={styles.shopName} numberOfLines={2}>{s.name}</Text>
                      <Text style={styles.shopMeta} numberOfLines={2}>{s.ownerName ? `${s.area} • ${s.ownerName}` : s.area}</Text>
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
            </View>
          ))}
          {store.shops.length === 0 && (
            <EmptyState
              icon="storefront-outline"
              title="No shops yet"
              hint="Shops added by your admin will appear here."
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
                onChangeText={t => {
                  const digits = t.replace(/[^0-9]/g, '');
                  setQtyTexts(prev => ({ ...prev, [p.id]: digits }));
                  setQtys(prev => ({ ...prev, [p.id]: digits ? Math.min(parseInt(digits, 10), 9999) : 0 }));
                }}
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

        <SectionLabel>Discount</SectionLabel>
        <View style={styles.chipRow}>
          <OptionBar
            options={discountOptions}
            value={discount}
            render={d => (d === (shop.standingDiscountPercent ?? 0) ? `${d}% •` : `${d}%`)}
            onChange={setDiscount}
          />
        </View>
        <Text style={styles.discountHint}>
          • = {shop.name}'s standing rate. Owner's cap: {maxDiscount}%.
        </Text>

        <Card>
          <View style={styles.totalRow}>
            <Text style={[styles.totalKey, styles.flexLabel]} numberOfLines={2}>Subtotal</Text>
            <View style={styles.valueRight}>
              <Money amount={totals.subTotal} />
            </View>
          </View>
          {discount > 0 && (
            <View style={styles.totalRow}>
              <Text style={[styles.totalKey, styles.flexLabel]} numberOfLines={2}>Discount {discount}%</Text>
              <View style={styles.valueRight}>
                <Money amount={-totals.discountTotal} />
              </View>
            </View>
          )}
          <View style={[styles.totalRow, styles.totalDivider]}>
            <Text style={[styles.totalLabel, styles.flexLabel]} numberOfLines={2}>TOTAL</Text>
            <View style={styles.valueRight}>
              <Money amount={totals.grandTotal} size={font.stat} bold />
            </View>
          </View>
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
          <PrimaryButton variant="quiet" icon="arrow-left" label="Different shop"
            onPress={() => { setShop(null); setQtys({}); setQtyTexts({}); }} />
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
            hint="Book your first order from the New Order tab."
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
