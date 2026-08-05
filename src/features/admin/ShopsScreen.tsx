/**
 * Admin — Shops. Grouped by area (same grouping as the booker's route), plus
 * the SRS two-field "Add shop" form: name + mobile up front, everything else
 * behind "More". Existing-area chips stop "Saddar"/"Sadar" fragmentation.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Card, Chip, EmptyState, IconTile, ListRow, Money, OptionBar, PrimaryButton, SectionLabel,
  color, font, radius, space,
} from '../../components/ui';
import { useStore } from '../../data/store';

const DISCOUNT_CHIPS = [0, 2, 5];

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

  const canSave = name.trim().length > 0 && phone.trim().length > 0;

  const reset = () => {
    setName(''); setPhone(''); setArea(''); setOwnerName(''); setAddress('');
    setDiscount(0); setShowMore(false); setAdding(false);
  };

  const save = () => {
    store.addShop({
      name: name.trim(),
      phone: phone.trim(),
      area: area.trim(),
      ownerName: ownerName.trim() ? ownerName.trim() : undefined,
      address: address.trim() ? address.trim() : undefined,
      standingDiscountPercent: discount,
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
          {shops.filter(s => s.area === a).map(shop => (
            <Card key={shop.id}>
              <ListRow
                icon="storefront-outline"
                title={shop.name}
                sub={`${shop.ownerName ? `${shop.ownerName} • ` : ''}${shop.phone}`}
                right={shop.outstanding > 0
                  ? <Money amount={shop.outstanding} bold color={color.danger} />
                  : undefined}
              />
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
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.s, alignItems: 'center' },
});
