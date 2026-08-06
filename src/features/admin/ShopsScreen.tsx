/**
 * Admin — Shops. Grouped by area (same grouping as the booker's route), plus
 * the SRS two-field "Add shop" form: name + mobile up front, everything else
 * behind "More". Existing-area chips stop "Saddar"/"Sadar" fragmentation.
 */
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Card, Chip, EmptyState, IconTile, ListRow, Money, OptionBar, PrimaryButton, SectionLabel, Tag,
  color, font, radius, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import type { Shop } from '../../data/models';

const DISCOUNT_CHIPS = [0, 2, 5];

function toRupees(text: string): number {
  const n = parseInt(text.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Everything the owner needs to do to an EXISTING shop (audit: shops could
 * never be edited): details, standing discount, manual khata correction,
 * a payment made directly to her, deactivation.
 */
function ShopEditor({ shop, onClose }: { shop: Shop; onClose: () => void }) {
  const store = useStore();
  const [name, setName] = React.useState(shop.name);
  const [phone, setPhone] = React.useState(shop.phone);
  const [area, setArea] = React.useState(shop.area);
  const [ownerName, setOwnerName] = React.useState(shop.ownerName ?? '');
  const [discount, setDiscount] = React.useState(shop.standingDiscountPercent);
  const [khataText, setKhataText] = React.useState('');
  const [khataDir, setKhataDir] = React.useState<'down' | 'up'>('down');
  const [payText, setPayText] = React.useState('');
  const [payMode, setPayMode] = React.useState<'cash' | 'transfer'>('transfer');
  const [busy, setBusy] = React.useState(false);

  const khataDelta = toRupees(khataText);
  const payAmount = Math.min(toRupees(payText), shop.outstanding);

  return (
    <Card style={styles.tightCard}>
      <View style={styles.formHead}>
        <IconTile name="storefront-outline" size={34} />
        <Text style={styles.formTitle}>{shop.name}</Text>
      </View>

      <Field label="Shop name" value={name} onChange={setName} placeholder={shop.name} />
      <Field label="Mobile number" value={phone} onChange={setPhone}
        placeholder="03xx xxxxxxx" keyboardType="phone-pad" />
      <Field label="Area" value={area} onChange={setArea} placeholder="Area" />
      <Field label="Owner's name" value={ownerName} onChange={setOwnerName} placeholder="Who runs the shop" />
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Standing discount</Text>
        <OptionBar options={DISCOUNT_CHIPS} value={discount} render={d => `${d}%`} onChange={setDiscount} />
      </View>
      <PrimaryButton
        label="Save details" icon="check-circle-outline"
        disabled={name.trim().length === 0 || phone.trim().length === 0}
        disabledReason="Name and mobile first"
        onPress={() => {
          store.updateShop(shop.id, {
            name: name.trim(), phone: phone.trim(), area: area.trim(),
            // Empty string, not undefined: undefined is stripped before the
            // write, so clearing the owner's name silently kept the old one.
            ownerName: ownerName.trim(), standingDiscountPercent: discount,
          });
          onClose();
        }}
      />

      <View style={styles.divider} />
      <Text style={styles.fieldLabel}>
        Khata correction — owes Rs {shop.outstanding.toLocaleString()} now
      </Text>
      <OptionBar
        options={['down', 'up'] as const}
        value={khataDir}
        render={v => (v === 'down' ? 'Reduce (return/waiver)' : 'Increase (old debt)')}
        onChange={setKhataDir}
      />
      <TextInput style={[styles.input, styles.gapTop]} value={khataText}
        onChangeText={t => setKhataText(t.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad" placeholder="0" placeholderTextColor={color.textFaint} />
      {khataDelta > 0 && (
        <View style={styles.rowWrap}>
          <Chip small selected label={`Apply ${khataDir === 'down' ? '−' : '+'}Rs ${khataDelta.toLocaleString()}`}
            onPress={() =>
              Alert.alert('Adjust the khata?',
                `${shop.name}: Rs ${shop.outstanding.toLocaleString()} → Rs ${(shop.outstanding + (khataDir === 'down' ? -khataDelta : khataDelta)).toLocaleString()}`,
                [
                  { text: 'Back', style: 'cancel' },
                  { text: 'Apply', onPress: () => {
                      store.adjustShopBalance(shop.id, khataDir === 'down' ? -khataDelta : khataDelta,
                        khataDir === 'down' ? 'manual reduction' : 'manual increase');
                      setKhataText('');
                    } },
                ])
            } />
        </View>
      )}

      {shop.outstanding > 0 && (
        <>
          <View style={styles.divider} />
          <Text style={styles.fieldLabel}>Payment made directly to you</Text>
          <OptionBar
            options={['transfer', 'cash'] as const}
            value={payMode}
            render={v => (v === 'transfer' ? 'Bank transfer' : 'Cash')}
            onChange={setPayMode}
          />
          <TextInput style={[styles.input, styles.gapTop]} value={payText}
            onChangeText={t => setPayText(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad" placeholder="0" placeholderTextColor={color.textFaint} />
          {payAmount > 0 && (
            <View style={styles.rowWrap}>
              {/* Clear the field FIRST: a second tap while the receipt serial
                  is still in flight would otherwise take the money twice. */}
              <Chip small selected
                label={busy ? 'Recording…' : `Record Rs ${payAmount.toLocaleString()} received`}
                onPress={busy ? undefined : async () => {
                  setBusy(true);
                  const amt = payAmount;
                  setPayText('');
                  try {
                    await Promise.resolve(store.collect({ shopId: shop.id, amount: amt, mode: payMode }));
                  } catch (e) {
                    Alert.alert('Not recorded', e instanceof Error ? e.message : String(e));
                    setPayText(String(amt));
                  } finally {
                    setBusy(false);
                  }
                }} />
            </View>
          )}
        </>
      )}

      <View style={styles.divider} />
      <View style={styles.rowWrap}>
        <Chip small danger={shop.active}
          label={shop.active ? 'Deactivate shop' : 'Reactivate shop'}
          onPress={() => { store.updateShop(shop.id, { active: !shop.active }); onClose(); }} />
        <Chip small label="Close" onPress={onClose} />
      </View>
    </Card>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType }: {
  label: string; value: string; onChange: (t: string) => void;
  placeholder: string; keyboardType?: 'phone-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={color.textFaint}
        keyboardType={keyboardType}
      />
    </View>
  );
}

export function ShopsScreen() {
  const store = useStore();
  const shops = store.shops;
  const byArea = [...new Set(shops.map(s => s.area))];
  const knownAreas = [...new Set(shops.map(s => s.area).filter(a => a.trim().length > 0))];

  // ---- add-shop form state ----
  const [adding, setAdding] = React.useState(false);
  const [showMore, setShowMore] = React.useState(false);
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [area, setArea] = React.useState('');
  const [ownerName, setOwnerName] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [discount, setDiscount] = React.useState(0);
  const [openingText, setOpeningText] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);

  const canSave = name.trim().length > 0 && phone.trim().length > 0;

  const reset = () => {
    setName(''); setPhone(''); setArea(''); setOwnerName(''); setAddress('');
    setDiscount(0); setOpeningText(''); setShowMore(false); setAdding(false);
  };

  const save = () => {
    store.addShop({
      name: name.trim(),
      phone: phone.trim(),
      area: area.trim(),
      ownerName: ownerName.trim() ? ownerName.trim() : undefined,
      address: address.trim() ? address.trim() : undefined,
      standingDiscountPercent: discount,
      // The paper khata comes along on day one (audit blocker).
      openingBalance: toRupees(openingText),
    });
    reset();
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {shops.length > 0 && (
        <Text style={styles.subLine}>{shops.length} shops — grouped by area</Text>
      )}

      {!adding && (
        <View style={styles.ctaWrap}>
          <PrimaryButton label="Add shop" icon="plus" variant="cta" onPress={() => setAdding(true)} />
        </View>
      )}

      {adding && (
        <Card style={styles.tightCard}>
          <View style={styles.formHead}>
            <IconTile name="storefront-outline" size={34} />
            <Text style={styles.formTitle}>New shop</Text>
          </View>

          <Field label="Shop name" value={name} onChange={setName}
            placeholder="e.g. Bismillah General Store" />
          <Field label="Mobile number" value={phone} onChange={setPhone}
            placeholder="03xx xxxxxxx" keyboardType="phone-pad" />

          {!showMore && (
            <Pressable onPress={() => setShowMore(true)} style={styles.moreLink}>
              <Text style={styles.moreLinkText}>More — area, owner, address, discount</Text>
            </Pressable>
          )}

          {showMore && (
            <View>
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Area</Text>
                {knownAreas.length > 0 && (
                  <View style={styles.chipWrap}>
                    {knownAreas.map(a => (
                      <Chip small key={a} label={a} selected={area.trim() === a} onPress={() => setArea(a)} />
                    ))}
                  </View>
                )}
                <TextInput
                  style={styles.input} value={area} onChangeText={setArea}
                  placeholder="Tap an area above, or type a new one"
                  placeholderTextColor={color.textFaint} />
              </View>

              <Field label="Owner's name" value={ownerName} onChange={setOwnerName}
                placeholder="Who runs the shop" />
              <Field label="Address" value={address} onChange={setAddress}
                placeholder="Street, landmark" />

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Standing discount</Text>
                <OptionBar
                  options={DISCOUNT_CHIPS}
                  value={discount}
                  render={d => `${d}%`}
                  onChange={d => setDiscount(d)}
                />
              </View>

              <Field label="Old khata balance (Rs) — what they already owe from the paper book"
                value={openingText} onChange={t => setOpeningText(t.replace(/[^0-9]/g, ''))}
                placeholder="0" keyboardType="phone-pad" />
            </View>
          )}

          <PrimaryButton
            label="Save shop"
            variant="cta"
            icon="check-circle-outline"
            disabled={!canSave}
            disabledReason="Name and mobile first"
            onPress={save}
          />
          <View style={styles.rowWrap}>
            <Chip small label="Cancel" onPress={reset} />
          </View>
        </Card>
      )}

      {shops.length === 0 && !adding && (
        <EmptyState
          icon="storefront-outline"
          title="Add your first shop"
          hint="Just the name and mobile number to start — details can come later."
        />
      )}

      {byArea.map(a => (
        <View key={a || 'no-area'}>
          <SectionLabel>{a.trim() ? a : 'No area yet'}</SectionLabel>
          {shops.filter(s => s.area === a).map(shop =>
            editingId === shop.id ? (
              <ShopEditor key={shop.id} shop={shop} onClose={() => setEditingId(null)} />
            ) : (
              <Card key={shop.id}>
                <ListRow
                  icon="storefront-outline"
                  title={shop.name}
                  sub={`${shop.ownerName ? `${shop.ownerName} • ` : ''}${shop.phone}`}
                  right={shop.outstanding > 0
                    ? <Money amount={shop.outstanding} bold color={color.danger} />
                    : undefined}
                />
                <View style={styles.rowWrap}>
                  {!shop.active && <Tag label="INACTIVE" tone="warn" />}
                  <Chip small label="Edit / khata / payment" onPress={() => setEditingId(shop.id)} />
                </View>
                {shop.outstanding > 0 && (
                  <Text style={styles.owes}>owes this much on the books</Text>
                )}
              </Card>
            ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingTop: space.s, paddingBottom: space.xl },
  subLine: {
    fontSize: font.sub, color: color.textSub,
    marginHorizontal: space.l, marginBottom: space.xs,
  },
  ctaWrap: { paddingHorizontal: space.l },

  tightCard: { paddingVertical: space.xs },
  formHead: { flexDirection: 'row', alignItems: 'center', paddingTop: space.s, marginBottom: space.xs },
  formTitle: { fontSize: font.body, fontWeight: '600', color: color.text, marginLeft: 10 },

  field: { paddingVertical: space.s },
  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginBottom: 6 },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 46,
    fontSize: font.body, color: color.text,
  },

  moreLink: { paddingVertical: space.m, marginTop: space.xs },
  moreLinkText: { fontSize: font.body, fontWeight: '700', color: color.primary },
  owes: { fontSize: font.sub, color: color.danger, textAlign: 'right' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.xs, alignItems: 'center' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.s, alignItems: 'center', gap: space.xs },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border,
    marginTop: space.m, marginBottom: space.s,
  },
  gapTop: { marginTop: space.s },
});
