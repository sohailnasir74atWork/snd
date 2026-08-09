/**
 * Admin — Products. List every product, activate/deactivate, and an inline
 * "Add product" form (§5.4: chips over typing, defaults everywhere,
 * disabled-with-reason instead of error popups).
 */
import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Card, Chip, EmptyState, Icon, IconTile, Money, MoreFields, OptionBar, PrimaryButton,
  Reveal, Tag,
  color, font, radius, space,
} from '../../components/ui';
import { KeyboardScreen, useWriteGuard } from './AdminScreens';
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
  const { isBusy, run } = useWriteGuard();

  // ---- add-product form state ----
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [packSize, setPackSize] = React.useState('');
  const [unit, setUnit] = React.useState<Product['unit']>('pc');
  const [tradeText, setTradeText] = React.useState('');
  const [mrpText, setMrpText] = React.useState('');
  const [costText, setCostText] = React.useState('');
  const [stockText, setStockText] = React.useState('');

  // ---- inline "set cost" editor on an existing product ----
  const [costEditId, setCostEditId] = React.useState<string | null>(null);
  const [costEditText, setCostEditText] = React.useState('');

  // ---- inline price editor (audit: prices could never change) ----
  const [priceEditId, setPriceEditId] = React.useState<string | null>(null);
  const [tradeEditText, setTradeEditText] = React.useState('');
  const [mrpEditText, setMrpEditText] = React.useState('');

  // ---- inline stock adjustment (audit: no restock path) ----
  const [stockEditId, setStockEditId] = React.useState<string | null>(null);
  const [stockDeltaText, setStockDeltaText] = React.useState('');
  const [stockDir, setStockDir] = React.useState<'in' | 'out'>('in');

  const tradePrice = toRupees(tradeText);
  const canSave = name.trim().length > 0 && tradePrice > 0;
  const missingCost = store.products.filter(p => p.costPrice === undefined).length;

  const reset = () => {
    setName(''); setCode(''); setPackSize(''); setUnit('pc');
    setTradeText(''); setMrpText(''); setCostText(''); setStockText('');
    setAdding(false);
  };

  // The guard is what stops a second tap creating a duplicate product with a
  // duplicate opening stock — the form only disappears on the next render.
  const save = () => {
    run('add', () => {
      const costPrice = toRupees(costText);
      store.addProduct({
        name: name.trim(),
        code: code.trim(),
        unit,
        packSize: packSize.trim(),
        tradePrice,
        // Retail price defaults to the shop price when left blank — every input has a default.
        mrp: toRupees(mrpText) || tradePrice,
        stockQty: toRupees(stockText),
        // Left out entirely when blank — a product with no cost stays out of profit.
        ...(costPrice > 0 ? { costPrice } : null),
      });
      reset();
    });
  };

  const openCostEditor = (p: Product) => {
    setCostEditId(p.id);
    setCostEditText(p.costPrice !== undefined ? String(p.costPrice) : '');
  };

  const saveCost = (id: string) => {
    run(`cost:${id}`, () => {
      store.updateProduct(id, { costPrice: toRupees(costEditText) });
      setCostEditId(null);
      setCostEditText('');
    });
  };

  return (
    <KeyboardScreen style={styles.screen} contentContainerStyle={styles.content}>
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

          {/*
            `canSave` is name + price, and every other field here already
            defaults in `save()` — blank code, blank pack, unit 'pc', MRP falls
            back to the trade price, stock 0, and a blank cost is left off the
            document entirely. So the form asks for the two it needs, in order,
            and keeps the other six one tap away.
          */}
          <Field label="Name" value={name} onChange={setName}
            placeholder="e.g. Glow Face Wash" />
          <Reveal when={name.trim() !== ''}>
            <Field label="Price to shop (Rs)" value={tradeText} onChange={setTradeText}
              placeholder="0" keyboardType="number-pad" />
          </Reveal>

          <Reveal when={canSave}>
            <MoreFields label="Code, pack, retail, cost, stock" count={6}>
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
              <Field label="Retail price (Rs) — what the customer pays" value={mrpText} onChange={setMrpText}
                placeholder={tradePrice > 0 ? `${tradePrice}` : '0'} keyboardType="number-pad" />
              <Field label="Cost price (what you pay)" value={costText} onChange={setCostText}
                placeholder="0" keyboardType="number-pad" />
              <Field label="Opening stock (how many you have now)" value={stockText} onChange={setStockText}
                placeholder="0" keyboardType="number-pad" />
            </MoreFields>
          </Reveal>

          <PrimaryButton
            label="Save product"
            variant="cta"
            icon="check-circle-outline"
            disabled={!canSave}
            disabledReason="Name and price first"
            busy={isBusy('add')}
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
              {/* Long product names used to run under the tags and get clipped:
                  the name now wraps to two lines, the tags never shrink. */}
              <Text style={styles.cardTitle} numberOfLines={2}>
                {p.name}{' '}
                <Text style={styles.cardTitlePack}>{p.packSize}</Text>
              </Text>
              <View style={styles.tagRow}>
                {p.costPrice === undefined && <Tag label="NO COST" tone="warn" />}
                {!p.active && <Tag label="INACTIVE" tone="warn" />}
              </View>
            </View>
            <Text style={styles.meta} numberOfLines={2}>Product code {p.code || '—'} • sold by {p.unit}</Text>
            <View style={styles.priceRow}>
              <View style={styles.priceCol}>
                <Text style={styles.faintLabel}>Price to shop</Text>
                <Money amount={p.tradePrice} bold />
              </View>
              <View style={styles.priceCol}>
                <Text style={styles.faintLabel}>Retail price</Text>
                <Money amount={p.mrp} />
              </View>
              {p.costPrice !== undefined && (
                <View style={styles.priceCol}>
                  <Text style={styles.faintLabel}>Your cost</Text>
                  <Money amount={p.costPrice} />
                </View>
              )}
            </View>
            <View style={styles.stockRow}>
              <Text style={styles.stockLabel}>Stock</Text>
              <Text style={styles.stock} numberOfLines={2}>{p.stockQty} in stock • {p.committedQty} committed</Text>
            </View>
          </View>

          {costEditId === p.id && (
            <View style={styles.costEditor}>
              <Text style={styles.fieldLabel}>Cost price (what you pay)</Text>
              <TextInput
                style={styles.input}
                value={costEditText}
                onChangeText={setCostEditText}
                placeholder="0"
                placeholderTextColor={color.textFaint}
                keyboardType="number-pad"
              />
              <View style={styles.rowWrap}>
                {toRupees(costEditText) > 0 ? (
                  <Chip small selected label="Save cost"
                    onPress={isBusy(`cost:${p.id}`) ? undefined : () => saveCost(p.id)} />
                ) : (
                  <Text style={styles.costHint}>Type what one {p.unit} costs you</Text>
                )}
                <Chip small label="Cancel" onPress={() => { setCostEditId(null); setCostEditText(''); }} />
              </View>
            </View>
          )}

          {priceEditId === p.id && (
            <View style={styles.costEditor}>
              <Text style={styles.fieldLabel}>Price to shop (Rs)</Text>
              <TextInput style={styles.input} value={tradeEditText}
                onChangeText={t => setTradeEditText(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad" placeholder={String(p.tradePrice)}
                placeholderTextColor={color.textFaint} />
              <Text style={styles.fieldLabel}>Retail price (Rs)</Text>
              <TextInput style={styles.input} value={mrpEditText}
                onChangeText={t => setMrpEditText(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad" placeholder={String(p.mrp)}
                placeholderTextColor={color.textFaint} />
              <View style={styles.rowWrap}>
                {toRupees(tradeEditText) > 0 && (
                  <Chip small selected label="Save prices"
                    onPress={isBusy(`price:${p.id}`) ? undefined : () => run(`price:${p.id}`, () => {
                      const trade = toRupees(tradeEditText);
                      store.updateProduct(p.id, { tradePrice: trade, mrp: toRupees(mrpEditText) || trade });
                      setPriceEditId(null);
                    })} />
                )}
                <Chip small label="Cancel" onPress={() => setPriceEditId(null)} />
              </View>
            </View>
          )}

          {stockEditId === p.id && (
            <View style={styles.costEditor}>
              <Text style={styles.fieldLabel}>
                {stockDir === 'in' ? 'Pieces arrived from the supplier' : 'Pieces removed (damage / correction)'}
              </Text>
              <OptionBar
                options={['in', 'out'] as const}
                value={stockDir}
                render={v => (v === 'in' ? 'Stock IN' : 'Stock OUT')}
                onChange={setStockDir}
              />
              <TextInput style={[styles.input, styles.stockInput]} value={stockDeltaText}
                onChangeText={t => setStockDeltaText(t.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad" placeholder="0"
                placeholderTextColor={color.textFaint} />
              <View style={styles.rowWrap}>
                {toRupees(stockDeltaText) > 0 && (
                  // adjustStock is an atomic increment: a double tap did not
                  // just log twice, it added the delivery to stock twice.
                  <Chip small selected label={`Save — ${stockDir === 'in' ? '+' : '−'}${toRupees(stockDeltaText)} pcs`}
                    onPress={isBusy(`stock:${p.id}`) ? undefined : () => run(`stock:${p.id}`, () => {
                      const n = toRupees(stockDeltaText);
                      store.adjustStock(p.id, stockDir === 'in' ? n : -n,
                        stockDir === 'in' ? 'restock' : 'correction');
                      setStockEditId(null); setStockDeltaText('');
                    })} />
                )}
                <Chip small label="Cancel" onPress={() => { setStockEditId(null); setStockDeltaText(''); }} />
              </View>
            </View>
          )}

          <View style={styles.rowWrap}>
            {costEditId !== p.id && (
              <Chip
                small
                label={p.costPrice === undefined ? 'Set cost' : 'Change cost'}
                onPress={() => openCostEditor(p)}
              />
            )}
            {priceEditId !== p.id && (
              <Chip small label="Change prices" onPress={() => {
                setPriceEditId(p.id); setTradeEditText(String(p.tradePrice)); setMrpEditText(String(p.mrp));
              }} />
            )}
            {stockEditId !== p.id && (
              <Chip small label="Add / correct stock" onPress={() => {
                setStockEditId(p.id); setStockDeltaText(''); setStockDir('in');
              }} />
            )}
            {/* The chip stays put until the listener brings the new flag back,
                so a second tap flipped the product straight back again. */}
            <Chip
              small
              label={p.active ? 'Deactivate — hide from bookers' : 'Activate — show to bookers'}
              danger={p.active}
              onPress={isBusy(`active:${p.id}`) ? undefined
                : () => run(`active:${p.id}`, () => store.updateProduct(p.id, { active: !p.active }))}
            />
          </View>
        </Card>
      ))}

      {missingCost > 0 && (
        <View style={styles.noteRow}>
          <Icon name="alert-outline" size={15} color={color.warn} />
          <Text style={styles.noteText}>Products without a cost price are left out of profit.</Text>
        </View>
      )}
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  // Extra bottom padding so "Save product" never ends up flush against the
  // top of the keyboard.
  content: { paddingTop: space.s, paddingBottom: space.xl + space.l },
  subLine: {
    fontSize: font.sub, color: color.textSub,
    marginHorizontal: space.gutter, marginBottom: space.xs,
  },
  ctaWrap: { paddingHorizontal: space.gutter },

  tightCard: { paddingVertical: space.xs },
  formHead: { flexDirection: 'row', alignItems: 'center', paddingTop: space.s, marginBottom: space.xs },
  formTitle: { fontSize: font.body, fontWeight: '600', color: color.text, marginLeft: space.m },

  field: { paddingVertical: space.s },
  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginBottom: space.xs },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 40,
    fontSize: font.body, color: color.text,
  },

  // flex + minWidth 0 let the name take the slack and wrap; the tag column
  // beside it keeps its natural width.
  cardTitle: { flex: 1, minWidth: 0, fontSize: font.h2 - 1, fontWeight: '700', color: color.text },
  cardTitlePack: { fontSize: font.sub, fontWeight: '700', color: color.textSub },
  meta: { fontSize: font.sub, color: color.textSub, marginTop: 2 },
  priceRow: { flexDirection: 'row', marginTop: space.s },
  priceCol: { flex: 1, minWidth: 0, paddingRight: space.s },
  faintLabel: { fontSize: font.sub, color: color.textFaint, marginBottom: 2 },
  stockRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.s },
  stockLabel: { fontSize: font.sub, color: color.textFaint, marginRight: space.s },
  stock: { flex: 1, minWidth: 0, fontSize: font.sub, fontWeight: '600', color: color.text },
  dim: { opacity: 0.45 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.s, alignItems: 'center' },
  tagRow: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', marginLeft: space.s, gap: space.xs },

  costEditor: {
    marginTop: space.s, paddingTop: space.s,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border,
  },
  stockInput: { marginTop: space.s },
  costHint: { fontSize: font.sub, color: color.textSub, marginRight: space.s },
  noteRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: space.gutter, marginTop: space.s,
  },
  noteText: { fontSize: font.sub, color: color.warn, marginLeft: space.s, flexShrink: 1 },
});
