/**
 * Booker screens — Route (FR-13.1), New Order (FR-4.1/13.3/13.4/6.1),
 * My Day. Zero typing: everything is chips and tiles.
 */
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { strings } from '../../i18n/strings';
import { orderConfirmationHtml } from '../../documents/templates';
import { sharePdf } from '../../documents/share';
import { RewardsSection } from './RewardsSection';
import { consumePendingOrderShop, setPendingOrderShop } from '../../app/orderIntent';

const QTY_CHIPS = [1, 6, 12];

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

  if (done) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Icon name="alert-decagram" size={64} color={color.warn} />
        <Text style={styles.orderNo}>Receipt {done.receiptNo}</Text>
        <Money amount={done.amount} size={font.stat + 8} bold />
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
          <Text style={styles.shopName}>{shop.name}</Text>
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
          disabled={amount <= 0 || busy}
          disabledReason={busy ? 'Saving…' : 'Enter an amount'}
          onPress={async () => {
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
          }}
        />
        <PrimaryButton variant="quiet" icon="arrow-left" label="Back — the rider collects" onPress={onDone} />
      </View>
    </ScrollView>
  );
}

export function BookerRouteScreen() {
  const store = useStore();
  const navigation = useNavigation<{ navigate: (r: string) => void }>();
  const active = store.shops.filter(s => s.active);
  // Visit cycle: with ~shopsPerDay visits a day, a shop is DUE once its last
  // visit is a full cycle old (or it was never visited). The rest wait below.
  const cycleDays = Math.max(1, Math.round(active.length / Math.max(1, store.settings.shopsPerDay)));
  const isDue = (s: Shop) => !s.lastVisitAt || Date.now() - s.lastVisitAt >= cycleDays * 86400_000;
  const due = active.filter(isDue);
  const notDue = active.filter(s => !isDue(s));
  const [showNotDue, setShowNotDue] = React.useState(false);
  const byArea = [...new Set(due.map(s => s.area))];
  const knownAreas = [...new Set(active.map(s => s.area).filter(a => a.trim().length > 0))];
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

  const exceptionShop = exceptionShopId ? store.shops.find(s => s.id === exceptionShopId) : null;
  if (exceptionShop) {
    return <ExceptionCashScreen shop={exceptionShop} onDone={() => setExceptionShopId(null)} />;
  }

  const saveShelf = (shopId: string) => {
    store.recordShelfCount(shopId, toInt(shelfText));
    setShelfShopId(null);
    setShelfText('');
  };

  const startOrder = (shopId: string) => {
    setPendingOrderShop(shopId);
    navigation.navigate('NewOrder');
  };

  const shopCard = (shop: Shop) => (
            <Card key={shop.id}>
              <View style={styles.rowBetween}>
                <Text style={styles.shopName}>{shop.name}</Text>
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
                {seesBalances && shop.outstanding > 0 && !shop.collectionFlagged && (
                  <Chip small danger label={strings.order.tellTheRider} onPress={() => store.flagCollection(shop.id)} />
                )}
                <Chip small label="Shelf count"
                  onPress={() => { setShelfShopId(shelfShopId === shop.id ? null : shop.id); setShelfText(''); }} />
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.sub}>
        {due.length} due today • {notDue.length} visited recently • ~{cycleDays}-day cycle
      </Text>

      {!addingShop ? (
        <View style={styles.rowWrapPadded}>
          <Chip small label="+ New shop — register on the spot" onPress={() => setAddingShop(true)} />
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
          <View style={styles.rowWrap}>
            {knownAreas.map(a => (
              <Chip small key={a} label={a} selected={newArea === a} onPress={() => setNewArea(a)} />
            ))}
          </View>
          <TextInput style={styles.input} value={newArea} onChangeText={setNewArea}
            placeholder="Tap an area above, or type a new one" placeholderTextColor={color.textFaint} />
          <PrimaryButton
            label="Save shop" icon="check-circle-outline"
            disabled={newName.trim().length === 0 || newPhone.trim().length < 7}
            disabledReason="Name and mobile first"
            onPress={() => {
              store.addShop({ name: newName.trim(), phone: newPhone.trim(), area: newArea.trim() });
              setNewName(''); setNewPhone(''); setNewArea(''); setAddingShop(false);
            }}
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
  const [confirmed, setConfirmed] = React.useState<{ order: Order; shop: Shop } | null>(null);

  const pickShop = React.useCallback((s: Shop) => {
    setShop(s);
    // The daily negotiation: prefill the standing rate, allow up to the
    // owner's max (FR: discount is adjustable per order within the cap).
    setDiscount(s.standingDiscountPercent ?? 0);
  }, []);

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

  if (confirmed) {
    const total = confirmed.order.orderedTotals.grandTotal;
    return (
      <View style={[styles.screen, styles.center]}>
        <View style={styles.successBadge}>
          <Icon name="check-circle" size={44} color={color.success} />
        </View>
        <Text style={styles.orderNo}>{confirmed.order.orderNo}</Text>
        <Text style={styles.centerSub}>Order confirmation ready — this is not a bill.</Text>
        <Money amount={total} size={font.stat + 8} bold />
        <View style={styles.ctaWrapWide}>
          <PrimaryButton
            icon="whatsapp"
            label={`Send to ${confirmed.shop.name}'s WhatsApp`}
            onPress={async () => {
              const html = orderConfirmationHtml({
                settings: store.settings, order: confirmed.order, shop: confirmed.shop,
              });
              await sharePdf(
                html,
                confirmed.order.orderNo,
                `Order ${confirmed.order.orderNo} — Rs ${total.toLocaleString()}. Your bill comes with the delivery.`,
              ).catch(() => {});
            }}
          />
          <PrimaryButton variant="quiet" icon="plus" label="Book another order" onPress={reset} />
        </View>
      </View>
    );
  }

  const seesBalances = store.settings.visibility.bookerSeesBalances;

  if (!shop) {
    const q = search.trim().toLowerCase();
    const matches = store.shops.filter(s =>
      s.active && (!q || s.name.toLowerCase().includes(q) || s.area.toLowerCase().includes(q)
        || (s.ownerName ?? '').toLowerCase().includes(q)));
    const pickerAreas = [...new Set(matches.map(s => s.area))];
    return (
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
                    <Text style={styles.shopName}>{s.name}</Text>
                    <Text style={styles.shopMeta}>{s.ownerName ? `${s.area} • ${s.ownerName}` : s.area}</Text>
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
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
      <Card>
        <View style={styles.rowCenter}>
          <IconTile name="storefront-outline" size={40} />
          <View style={styles.rowText}>
            <Text style={styles.shopName}>{shop.name}</Text>
            <Text style={styles.shopMeta}>{shop.area}</Text>
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
            <Text style={styles.shopName}>{p.name} <Text style={styles.shopMeta}>{p.packSize}</Text></Text>
            <Money amount={p.tradePrice} bold />
          </View>
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
            />
            <View style={styles.qtyChips}>
              {QTY_CHIPS.map(q => (
                <Chip small key={q} label={`${q}`} selected={qtys[p.id] === q}
                  onPress={() => setQty(p.id, q)} />
              ))}
              <Chip small label="+1" onPress={() => setQty(p.id, (qtys[p.id] ?? 0) + 1)} />
              <Chip small label="+6" onPress={() => setQty(p.id, (qtys[p.id] ?? 0) + 6)} />
              {qtys[p.id] ? <Chip small label="clear" onPress={() => setQty(p.id, 0)} /> : null}
            </View>
          </View>
          {qtys[p.id] ? (
            <View style={styles.lineTotalRow}>
              <Text style={styles.lineTotalText}>{qtys[p.id]} pcs</Text>
              <Money amount={qtys[p.id] * p.tradePrice} size={font.sub} bold color={color.primary} />
            </View>
          ) : null}
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
          <Text style={styles.totalKey}>Subtotal</Text>
          <Money amount={totals.subTotal} />
        </View>
        {discount > 0 && (
          <View style={styles.totalRow}>
            <Text style={styles.totalKey}>Discount {discount}%</Text>
            <Money amount={-totals.discountTotal} />
          </View>
        )}
        <View style={[styles.totalRow, styles.totalDivider]}>
          <Text style={styles.totalLabel}>TOTAL</Text>
          <Money amount={totals.grandTotal} size={font.stat} bold />
        </View>
      </Card>

      <SectionLabel>Deliver</SectionLabel>
      <View style={styles.chipRow}>
        <Chip label={strings.common.today} selected={deliveryDay === 'today' && !store.riderRouteStarted()}
          onPress={store.riderRouteStarted() ? undefined : () => setDeliveryDay('today')} />
        <Chip label={store.riderRouteStarted() ? strings.delivery.vanLoadedDeliverTomorrow : strings.common.tomorrow}
          selected={deliveryDay === 'tomorrow' || store.riderRouteStarted()}
          onPress={() => setDeliveryDay('tomorrow')} />
      </View>

      <View style={styles.ctaWrap}>
        <PrimaryButton
          icon="check-circle-outline"
          label={busy ? 'Saving…' : `Confirm — Rs ${totals.grandTotal.toLocaleString()}`}
          // The serial number needs a server round-trip, so this button sits
          // enabled for a second or two — long enough for an impatient second
          // tap to book the whole order twice.
          disabled={items.length === 0 || busy}
          disabledReason={busy ? 'Saving…' : 'Add a quantity first'}
          onPress={async () => {
            if (busy) return;
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
          }}
        />
        <PrimaryButton variant="quiet" icon="arrow-left" label="Different shop"
          onPress={() => { setShop(null); setQtys({}); setQtyTexts({}); }} />
      </View>
    </ScrollView>
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.sub}>
        {mine.length} orders today{vis.bookerSeesOwnTotals ? ` • Rs ${todayTotal.toLocaleString()}` : ''}
      </Text>
      {mine.map(o => (
        <Card key={o.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.shopName}>{o.shopSnapshot.name}</Text>
            {vis.bookerSeesOwnTotals && (
              <Money amount={(o.billedTotals ?? o.orderedTotals).grandTotal} bold />
            )}
          </View>
          <View style={styles.metaRow}>
            {statusTag(o)}
            <Text style={styles.shopMeta}>{o.orderNo} • {o.deliveryDay}</Text>
          </View>
          {(o.status === 'booked' || o.status === 'assigned') && (
            <View style={styles.rowWrap}>
              <Chip
                small
                danger
                label="Cancel order"
                onPress={() =>
                  Alert.alert('Cancel this order?', `${o.orderNo} — ${o.shopSnapshot.name}. The shop's confirmation becomes void.`, [
                    { text: 'Keep it', style: 'cancel' },
                    { text: 'Cancel order', style: 'destructive', onPress: () => store.cancelOrder(o.id) },
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
          <Text style={styles.shopName}>Exception cash with me</Text>
          <Money amount={myCashTotal} bold color={myCashTotal > 0 ? color.warn : undefined} />
        </View>
        {myCash.map(p => (
          <View key={p.id} style={styles.metaRow}>
            <Text style={styles.shopMeta}>
              {p.receiptNo} • {store.shops.find(s => s.id === p.shopId)?.name ?? ''}
            </Text>
            <View style={styles.springRow} />
            <Money amount={p.amount} />
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
            onPress={() => store.handOver()}
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
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg, paddingTop: space.s },
  screenContent: { paddingBottom: space.xl },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },

  sub: { fontSize: font.sub, color: color.textSub, marginHorizontal: space.l, marginTop: space.xs, marginBottom: space.xs },
  shopName: { fontSize: font.h2, fontWeight: '700', color: color.text },
  shopMeta: { fontSize: font.sub, color: color.textSub, marginTop: 2 },

  owedCol: { alignItems: 'flex-end' },
  owedLabel: { fontSize: font.tiny, fontWeight: '700', color: color.danger, textTransform: 'uppercase', letterSpacing: 0.4 },

  flaggedRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.s },
  flagged: { fontSize: font.sub, fontWeight: '600', color: color.success, marginLeft: space.xs },

  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  rowText: { flex: 1, marginLeft: space.m },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: space.s, marginLeft: -space.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', paddingHorizontal: space.m },

  lineTotalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: space.xs, gap: space.xs },
  lineTotalText: { fontSize: font.sub, color: color.textSub },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space.xs },
  totalKey: { fontSize: font.body, color: color.textSub },
  totalDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border, marginTop: space.s, paddingTop: space.m },
  totalLabel: { fontSize: font.body, fontWeight: '800', color: color.text, letterSpacing: 0.4 },

  ctaWrap: { paddingHorizontal: space.l, marginTop: space.s },
  ctaWrapWide: { alignSelf: 'stretch', marginTop: space.l },
  successBadge: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: color.successSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: space.l,
  },
  orderNo: { fontSize: font.h1, fontWeight: '800', color: color.text },
  centerSub: { fontSize: font.sub, color: color.textSub, textAlign: 'center', marginTop: space.s, marginBottom: space.m },

  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s },

  warnCard: { borderWidth: 1, borderColor: color.warn },
  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginTop: space.m, marginBottom: 6 },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 46,
    fontSize: font.body, color: color.text,
  },
  shelfEditor: {
    marginTop: space.m, paddingTop: space.xs,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border,
  },

  rowWrapPadded: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    paddingHorizontal: space.l, marginBottom: space.xs,
  },
  tightCard: { paddingVertical: space.xs },
  formHead: { flexDirection: 'row', alignItems: 'center', paddingTop: space.s, marginBottom: space.xs },
  formTitle: { fontSize: font.body, fontWeight: '600', color: color.text, marginLeft: 10 },
  searchWrap: { paddingHorizontal: space.l, marginBottom: space.s },
  qtyRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.s },
  qtyInput: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 44, width: 78,
    fontSize: font.h2, fontWeight: '700', color: color.text, textAlign: 'center',
  },
  qtyChips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginLeft: space.s },
  discountHint: {
    fontSize: font.tiny + 1, color: color.textSub,
    marginHorizontal: space.l, marginTop: space.xs,
  },
  springRow: { flex: 1 },
});
