/**
 * Booker screens — Route (FR-13.1), New Order (FR-4.1/13.3/13.4/6.1),
 * My Day. Zero typing: everything is chips and tiles.
 */
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Card, Chip, EmptyState, Icon, IconTile, Money, OptionBar, PrimaryButton, SectionLabel, Tag,
  color, font, radius, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import type { CollectionInput } from '../../data/store';
import type { Order, OrderItem, Shop } from '../../data/models';
import { computeTotals } from '../../lib/order';
import { strings } from '../../i18n/strings';
import { orderConfirmationHtml } from '../../documents/templates';
import { sharePdf } from '../../documents/share';
import { RewardsSection } from './RewardsSection';

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
  const due = store.shops.filter(s => s.active);
  const byArea = [...new Set(due.map(s => s.area))];
  const [exceptionShopId, setExceptionShopId] = React.useState<string | null>(null);
  const [shelfShopId, setShelfShopId] = React.useState<string | null>(null);
  const [shelfText, setShelfText] = React.useState('');

  const exceptionShop = exceptionShopId ? store.shops.find(s => s.id === exceptionShopId) : null;
  if (exceptionShop) {
    return <ExceptionCashScreen shop={exceptionShop} onDone={() => setExceptionShopId(null)} />;
  }

  const saveShelf = (shopId: string) => {
    store.recordShelfCount(shopId, toInt(shelfText));
    setShelfShopId(null);
    setShelfText('');
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.sub}>{due.length} shops due — grouped by area</Text>
      {byArea.map(area => (
        <View key={area}>
          <SectionLabel>{area}</SectionLabel>
          {due.filter(s => s.area === area).map(shop => (
            <Card key={shop.id}>
              <View style={styles.rowBetween}>
                <Text style={styles.shopName}>{shop.name}</Text>
                {shop.outstanding > 0 && (
                  <View style={styles.owedCol}>
                    <Money amount={shop.outstanding} bold color={color.danger} />
                    <Text style={styles.owedLabel}>owed</Text>
                  </View>
                )}
              </View>
              <Text style={styles.shopMeta}>
                {shop.ownerName} • last visit {Math.round((Date.now() - (shop.lastVisitAt ?? 0)) / 86400_000)} days ago
                {shop.lastShelfCount !== undefined ? ` • shelf ${shop.lastShelfCount}` : ''}
              </Text>
              <View style={styles.rowWrap}>
                {shop.outstanding > 0 && !shop.collectionFlagged && (
                  <Chip small danger label={strings.order.tellTheRider} onPress={() => store.flagCollection(shop.id)} />
                )}
                <Chip small label="Shelf count"
                  onPress={() => { setShelfShopId(shelfShopId === shop.id ? null : shop.id); setShelfText(''); }} />
                {shop.outstanding > 0 && (
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
          ))}
        </View>
      ))}
      {due.length === 0 && (
        <EmptyState
          icon="storefront-outline"
          title="No shops due today"
          hint="Shops show up here when they are due for a visit."
        />
      )}
    </ScrollView>
  );
}

export function NewOrderScreen() {
  const store = useStore();
  const [shop, setShop] = React.useState<Shop | null>(null);
  const [qtys, setQtys] = React.useState<Record<string, number>>({});
  const [deliveryDay, setDeliveryDay] = React.useState<'today' | 'tomorrow'>('today');
  const [confirmed, setConfirmed] = React.useState<{ order: Order; shop: Shop } | null>(null);

  const items: OrderItem[] = store.products
    .filter(p => (qtys[p.id] ?? 0) > 0)
    .map(p => ({ productId: p.id, name: p.name, qty: qtys[p.id], unitPrice: p.tradePrice }));
  const discount = shop?.standingDiscountPercent ?? 0;
  const totals = computeTotals(items, discount);

  const reset = () => { setShop(null); setQtys({}); setConfirmed(null); setDeliveryDay('today'); };

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

  if (!shop) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent}>
        <Text style={styles.sub}>Which shop are you at?</Text>
        {store.shops.map(s => (
          <Card key={s.id} onPress={() => setShop(s)}>
            <View style={styles.rowCenter}>
              <IconTile name="storefront-outline" size={40} />
              <View style={styles.rowText}>
                <Text style={styles.shopName}>{s.name}</Text>
                <Text style={styles.shopMeta}>{s.area}</Text>
              </View>
              {s.outstanding > 0 && (
                <View style={styles.owedCol}>
                  <Money amount={s.outstanding} bold color={color.danger} />
                  <Text style={styles.owedLabel}>owed</Text>
                </View>
              )}
            </View>
          </Card>
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
          {shop.outstanding > 0 && (
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
              const next: Record<string, number> = {};
              shop.lastOrderSummary!.forEach(l => { next[l.productId] = l.qty; });
              setQtys(next);
            }}
          />
        </View>
      )}

      {store.products.map(p => (
        <Card key={p.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.shopName}>{p.name} <Text style={styles.shopMeta}>{p.packSize}</Text></Text>
            <Money amount={p.tradePrice} bold />
          </View>
          <View style={styles.rowWrap}>
            {QTY_CHIPS.map(q => (
              <Chip small key={q} label={`${q}`} selected={qtys[p.id] === q}
                onPress={() => setQtys({ ...qtys, [p.id]: q })} />
            ))}
            <Chip small label="+6" onPress={() => setQtys({ ...qtys, [p.id]: (qtys[p.id] ?? 0) + 6 })} />
            {qtys[p.id] ? <Chip small label="clear" onPress={() => setQtys({ ...qtys, [p.id]: 0 })} /> : null}
          </View>
          {qtys[p.id] ? (
            <View style={styles.lineTotalRow}>
              <Text style={styles.lineTotalText}>{qtys[p.id]} pcs</Text>
              <Money amount={qtys[p.id] * p.tradePrice} size={font.sub} bold color={color.primary} />
            </View>
          ) : null}
        </Card>
      ))}

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
        <Chip label={strings.common.today} selected={deliveryDay === 'today' && !store.day.routeStarted}
          onPress={store.day.routeStarted ? undefined : () => setDeliveryDay('today')} />
        <Chip label={store.day.routeStarted ? strings.delivery.vanLoadedDeliverTomorrow : strings.common.tomorrow}
          selected={deliveryDay === 'tomorrow' || store.day.routeStarted}
          onPress={() => setDeliveryDay('tomorrow')} />
      </View>

      <View style={styles.ctaWrap}>
        <PrimaryButton
          icon="check-circle-outline"
          label={`Confirm — Rs ${totals.grandTotal.toLocaleString()}`}
          disabled={items.length === 0}
          disabledReason="Add a quantity first"
          onPress={async () => {
            const order = await Promise.resolve(
              store.bookOrder({ shopId: shop.id, items, discountPercent: discount, deliveryDay }),
            );
            setConfirmed({ order, shop });
          }}
        />
        <PrimaryButton variant="quiet" icon="arrow-left" label="Different shop" onPress={() => { setShop(null); setQtys({}); }} />
      </View>
    </ScrollView>
  );
}

export function MyDayScreen() {
  const store = useStore();
  const mine = store.orders;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.screenContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.sub}>{mine.length} orders booked</Text>
      {mine.map(o => (
        <Card key={o.id}>
          <View style={styles.rowBetween}>
            <Text style={styles.shopName}>{o.shopSnapshot.name}</Text>
            <Money amount={(o.billedTotals ?? o.orderedTotals).grandTotal} bold />
          </View>
          <View style={styles.metaRow}>
            <Tag
              label={(o.status === 'delivered' ? strings.statuses.done : strings.statuses.toDeliver).toUpperCase()}
              tone={o.status === 'delivered' ? 'success' : 'primary'}
            />
            <Text style={styles.shopMeta}>{o.orderNo} • {o.deliveryDay}</Text>
          </View>
        </Card>
      ))}
      {mine.length === 0 && (
        <EmptyState
          icon="cart-outline"
          title="No orders yet"
          hint="Book your first order from the New Order tab."
        />
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
});
