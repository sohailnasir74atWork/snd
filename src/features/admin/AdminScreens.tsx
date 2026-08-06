/**
 * Admin screens — the "Needs your action" stack led by cash awaiting
 * confirmation (FR-15.4, FR-7.11), live dashboard tiles (FR-9.1), More menu.
 */
import React from 'react';
import LinearGradient from 'react-native-linear-gradient';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Card, EmptyState, IconTile, ListRow, Money, PrimaryButton, SectionLabel, Tile,
  color, font, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import { strings } from '../../i18n/strings';

export function AdminActionScreen() {
  const store = useStore();
  const withStaff = store.payments.filter(p => !p.confirmed).reduce((s, p) => s + p.amount, 0);
  const oldCredit = store.shops.filter(s => s.outstanding > 0);
  const problems = store.orders.filter(o => o.status === 'returned' || o.status === 'cancelled');

  // One card PER PERSON who has handed over: the owner counts one pile of
  // cash and confirms exactly that pile (FR-7.11).
  const pending = store.staffDays
    .filter(d => d.staffId && d.handedOver && !d.handoverConfirmed)
    .map(d => ({
      staffId: d.staffId!,
      name: store.staffNames[d.staffId!] || 'Staff member',
      amount: store.payments
        .filter(p => !p.confirmed && p.collectedBy === d.staffId)
        .reduce((s, p) => s + p.amount, 0),
    }));
  const pendingTotal = pending.reduce((s, h) => s + h.amount, 0);
  const stillOut = withStaff - pendingTotal; // collected but not yet handed over
  const calm = withStaff === 0 && oldCredit.length === 0 && problems.length === 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {pending.map(h => (
        <Card key={h.staffId}>
          <View style={styles.row}>
            <IconTile name="cash-multiple" />
            <View style={styles.rowBody}>
              <Text style={styles.cardTitle}>{h.name} handed over</Text>
              <Money amount={h.amount} size={font.stat + 4} bold />
            </View>
          </View>
          <Text style={styles.meta}>Count {h.name}'s cash, then confirm — only you can.</Text>
          <PrimaryButton
            variant="cta"
            icon="check-circle-outline"
            label={`${strings.money.confirm} Rs ${h.amount.toLocaleString()}`}
            onPress={() => store.confirmHandover(h.staffId)}
          />
        </Card>
      ))}
      {stillOut > 0 && (
        <Card>
          <View style={styles.row}>
            <IconTile name="clock-outline" tint={color.warn} bg={color.warnSoft} />
            <View style={styles.rowBody}>
              <Text style={styles.cardTitle}>Rs {stillOut.toLocaleString()} with staff</Text>
              <Text style={styles.meta}>Collected at shops today — confirmation happens at the evening handover.</Text>
            </View>
          </View>
        </Card>
      )}

      {oldCredit.map(s => (
        <Card key={s.id}>
          <View style={styles.row}>
            <IconTile name="alert-circle-outline" tint={color.danger} bg={color.dangerSoft} />
            <View style={styles.rowBody}>
              <Text style={styles.cardTitle}>{s.name} — credit</Text>
              <Text style={styles.meta}>{s.area} • {s.ownerName} • {s.collectionFlagged ? 'rider will collect' : 'not yet flagged'}</Text>
            </View>
            <Money amount={s.outstanding} bold color={color.danger} />
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
  const delivered = store.orders.filter(o => o.status === 'delivered');
  const sales = delivered.reduce((s, o) => s + (o.billedTotals?.grandTotal ?? 0), 0);
  const confirmed = store.payments.filter(p => p.confirmed).reduce((s, p) => s + p.amount, 0);
  const withStaff = store.payments.filter(p => !p.confirmed).reduce((s, p) => s + p.amount, 0);
  const outstanding = store.shops.reduce((s, sh) => s + sh.outstanding, 0);

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
            <Text style={styles.heroStatValue}>{delivered.length}/{store.orders.length}</Text>
            <Text style={styles.heroStatLabel}>delivered</Text>
          </View>
        </View>
      </LinearGradient>
      <View style={styles.tiles}>
        <Tile label="Orders booked" value={`${store.orders.length}`} icon="cart-outline" />
        <Tile label="Delivered" value={`${delivered.length}`} icon="check-circle-outline" />
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

export function AdminMoreMenu({ navigation }: { navigation: { navigate: (r: string) => void } }) {
  const items: [string, string, string, string][] = [
    ['storefront-outline', 'Shops', 'add, edit, areas, balances', 'Shops'],
    ['bottle-tonic-plus-outline', 'Products', 'prices, stock, activate/deactivate', 'Products'],
    ['account-multiple-outline', 'Employees', 'add by Gmail, roles, remove', 'Employees'],
    ['chart-line', 'Reports', 'sales, collections, who owes me', 'Reports'],
    ['receipt', 'Expenses', 'fixed charges + one-off expenses', 'Expenses'],
    ['cog-outline', 'Settings', 'brand, delivery day, discounts, toggles', 'Settings'],
  ];
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card>
        {items.map(([icon, title, sub, route]) => (
          <ListRow
            key={route}
            icon={icon}
            title={title}
            sub={sub}
            chevron
            onPress={() => navigation.navigate(route)}
          />
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginHorizontal: 16, marginTop: 12, borderRadius: 18, padding: 20,
    shadowColor: '#1D4FD7', shadowOpacity: 0.35, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  heroLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 12, fontWeight: '800', letterSpacing: 1.2 },
  heroValue: { color: '#FFFFFF', fontSize: 34, fontWeight: '800', marginTop: 4, letterSpacing: -0.5 },
  heroRow: { flexDirection: 'row', marginTop: 18, alignItems: 'center' },
  heroStat: { flex: 1 },
  heroStatValue: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  heroStatLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11, marginTop: 2 },
  heroDivider: { width: 1, height: 30, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 12 },
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingTop: space.s, paddingBottom: space.xl },
  subLine: { fontSize: font.sub, color: color.textSub, marginHorizontal: space.l, marginBottom: space.xs },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space.s + 2 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowBody: { flex: 1, marginLeft: space.m },
  cardTitle: { fontSize: font.h2 - 1, fontWeight: '700', color: color.text },
  meta: { fontSize: font.sub, color: color.textSub, marginTop: space.xs },
});
