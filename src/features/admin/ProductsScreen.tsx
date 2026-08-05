/**
 * Admin — Products. List every product, activate/deactivate, and an inline
 * "Add product" form (§5.4: chips over typing, defaults everywhere,
 * disabled-with-reason instead of error popups).
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Card, Chip, EmptyState, IconTile, Money, OptionBar, PrimaryButton, Tag,
  color, font, radius, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import type { Product } from '../../data/models';

const UNITS: Product['unit'][] = ['pc', 'dozen', 'box'];

function toRupees(text: string): number {
  const n = parseInt(text.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function Field({ label, value, onChange, placeholder, keyboardType, autoCapitalize }: {
  label: string; value: string; onChange: (t: string) => void; placeholder: string;
  keyboardType?: 'number-pad'; autoCapitalize?: 'characters';
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
        autoCapitalize={autoCapitalize}
      />
    </View>
  );
}

export function ProductsScreen() {
  const store = useStore();

  // ---- add-product form state ----
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [packSize, setPackSize] = React.useState('');
  const [unit, setUnit] = React.useState<Product['unit']>('pc');
  const [tradeText, setTradeText] = React.useState('');
  const [mrpText, setMrpText] = React.useState('');
  const [stockText, setStockText] = React.useState('');

  const tradePrice = toRupees(tradeText);
  const canSave = name.trim().length > 0 && tradePrice > 0;

  const reset = () => {
    setName(''); setCode(''); setPackSize(''); setUnit('pc');
    setTradeText(''); setMrpText(''); setStockText('');
    setAdding(false);
  };

  const save = () => {
    store.addProduct({
      name: name.trim(),
      code: code.trim(),
      unit,
      packSize: packSize.trim(),
      tradePrice,
      // Retail price defaults to the shop price when left blank — every input has a default.
      mrp: toRupees(mrpText) || tradePrice,
      stockQty: toRupees(stockText),
    });
    reset();
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {store.products.length > 0 && (
        <Text style={styles.subLine}>
          {store.products.length} products — bookers see active ones only
        </Text>
      )}

      {!adding && (
        <View style={styles.ctaWrap}>
          <PrimaryButton label="Add product" icon="plus" variant="cta" onPress={() => setAdding(true)} />
        </View>
      )}

      {adding && (
        <Card style={styles.tightCard}>
          <View style={styles.formHead}>
            <IconTile name="package-variant-closed" size={34} />
            <Text style={styles.formTitle}>New product</Text>
          </View>

          <Field label="Name" value={name} onChange={setName}
            placeholder="e.g. Glow Face Wash" />
          <Field label="Product code" value={code} onChange={setCode}
            placeholder="e.g. GFW-120" autoCapitalize="characters" />
          <Field label="Pack size" value={packSize} onChange={setPackSize}
            placeholder="e.g. 120 ml" />

          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Sold by</Text>
            <OptionBar
              options={UNITS}
              value={unit}
              onChange={u => setUnit(u)}
            />
          </View>

          <Field label="Price to shop (Rs)" value={tradeText} onChange={setTradeText}
            placeholder="0" keyboardType="number-pad" />
          <Field label="Retail price (Rs) — what the customer pays" value={mrpText} onChange={setMrpText}
            placeholder={tradePrice > 0 ? `${tradePrice}` : '0'} keyboardType="number-pad" />
          <Field label="Opening stock (how many you have now)" value={stockText} onChange={setStockText}
            placeholder="0" keyboardType="number-pad" />

          <PrimaryButton
            label="Save product"
            variant="cta"
            icon="check-circle-outline"
            disabled={!canSave}
            disabledReason="Name and price first"
            onPress={save}
          />
          <View style={styles.rowWrap}>
            <Chip small label="Cancel" onPress={reset} />
          </View>
        </Card>
      )}

      {store.products.length === 0 && !adding && (
        <EmptyState
          icon="package-variant"
          title="Add your first product"
          hint="Bookers can only sell what you list here."
        />
      )}

      {store.products.map(p => (
        <Card key={p.id}>
          <View style={p.active ? undefined : styles.dim}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>
                {p.name}{' '}
                <Text style={styles.cardTitlePack}>{p.packSize}</Text>
              </Text>
              {!p.active && <Tag label="INACTIVE" tone="warn" />}
            </View>
            <Text style={styles.meta}>Product code {p.code || '—'} • sold by {p.unit}</Text>
            <View style={styles.priceRow}>
              <View style={styles.priceCol}>
                <Text style={styles.faintLabel}>Price to shop</Text>
                <Money amount={p.tradePrice} bold />
              </View>
              <View style={styles.priceCol}>
                <Text style={styles.faintLabel}>Retail price</Text>
                <Money amount={p.mrp} />
              </View>
              <View style={styles.priceCol}>
                <Text style={styles.faintLabel}>Stock</Text>
                <Text style={styles.stock}>{p.stockQty} in stock • {p.committedQty} committed</Text>
              </View>
            </View>
          </View>
          <View style={styles.rowWrap}>
            <Chip
              small
              label={p.active ? 'Deactivate — hide from bookers' : 'Activate — show to bookers'}
              danger={p.active}
              onPress={() => store.updateProduct(p.id, { active: !p.active })}
            />
          </View>
        </Card>
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

  cardTitle: { fontSize: font.h2 - 1, fontWeight: '700', color: color.text },
  cardTitlePack: { fontSize: font.sub, fontWeight: '700', color: color.textSub },
  meta: { fontSize: font.sub, color: color.textSub, marginTop: 2 },
  priceRow: { flexDirection: 'row', marginTop: space.m },
  priceCol: { flex: 1, paddingRight: space.s },
  faintLabel: { fontSize: font.sub, color: color.textFaint, marginBottom: 2 },
  stock: { fontSize: font.sub, fontWeight: '600', color: color.text },
  dim: { opacity: 0.45 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.s, alignItems: 'center' },
});
