/**
 * First-run setup wizard — FR-12.9. Four short steps: Company, Products,
 * Shops, Team. Every step is skippable; nothing here is irreversible, all of
 * it can be edited later from the More menu. Ends with the second-admin
 * safety prompt (a lost account must have a way back in).
 */
import React from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Card, Chip, Icon, IconTile, ListRow, Money, OptionBar, PrimaryButton, SectionLabel, Tag,
  color, font, radius, space,
} from '../../components/ui';
import { KeyboardScreen, useWriteGuard } from './AdminScreens';
import { useNeed, useStore } from '../../data/store';
import type { Employee, Product } from '../../data/models';
import { digitsOnly } from '../../lib/phone';

const STEP_COUNT = 4;

const STEP_META: { title: string; explain: string }[] = [
  { title: 'Your company', explain: 'This name and phone number go on every bill you print.' },
  { title: 'Your products', explain: 'Add the items you sell. You can change prices any time.' },
  { title: 'Your shops', explain: 'Add a few shops you visit — just the name and mobile number.' },
  { title: 'Your team', explain: 'Invite the people who book orders and deliver.' },
];

/** "1,200" -> 1200; anything unreadable -> 0. Money stays integer rupees. */
function toInt(raw: string): number {
  const n = parseInt(digitsOnly(raw), 10);
  return Number.isFinite(n) ? n : 0;
}

/** RuleRow-style card header: pastel icon tile + quiet bold label. */
function CardHead({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={styles.cardHead}>
      <IconTile name={icon} size={34} />
      <Text style={styles.cardHeadLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

export function WizardScreen({ onDone }: { onDone: () => void }) {
  const [step, setStep] = React.useState(0);
  const insets = useSafeAreaInsets();

  const next = () => {
    if (step >= STEP_COUNT - 1) onDone();
    else setStep(step + 1);
  };

  return (
    // Every step of this wizard is a form, and it sits outside the navigator,
    // so it carries its own insets as well as the keyboard wrapper.
    <KeyboardScreen
      style={styles.screen}
      contentContainerStyle={{
        paddingTop: insets.top + space.s,
        paddingBottom: insets.bottom + space.xl + space.l,
      }}>
      <View style={styles.headerRow}>
        <View style={styles.dots}>
          {STEP_META.map((_, i) => (
            <View key={i} style={[styles.dot, i <= step && styles.dotDone]} />
          ))}
        </View>
        <Pressable onPress={next} hitSlop={12}>
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>
      <Text style={styles.stepLabel}>Step {step + 1} of {STEP_COUNT}</Text>
      <Text style={styles.h1}>{STEP_META[step].title}</Text>
      <Text style={styles.subLine}>{STEP_META[step].explain}</Text>

      {step === 0 && <CompanyStep onNext={next} />}
      {step === 1 && <ProductsStep onNext={next} />}
      {step === 2 && <ShopsStep onNext={next} />}
      {step === 3 && <TeamStep onFinish={onDone} />}
    </KeyboardScreen>
  );
}

/* ------------------------------------------------------------------ step 1 */

function CompanyStep({ onNext }: { onNext: () => void }) {
  const store = useStore();
  const { isBusy, run } = useWriteGuard();
  const [brandName, setBrandName] = React.useState(store.settings.brandName);
  const [address, setAddress] = React.useState(store.settings.address ?? '');
  const [phone, setPhone] = React.useState(store.settings.phone ?? '');

  return (
    <View>
      <Card>
        <CardHead icon="office-building-outline" label="Company details" />
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Business name</Text>
          <TextInput
            style={styles.input}
            value={brandName}
            onChangeText={setBrandName}
            placeholder="e.g. Madina Traders"
            placeholderTextColor={color.textFaint}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Address</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder="Shop / office address (optional)"
            placeholderTextColor={color.textFaint}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Phone</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="0300-1234567 (optional)"
            placeholderTextColor={color.textFaint}
            keyboardType="phone-pad"
          />
        </View>
      </Card>
      <View style={styles.footer}>
        <PrimaryButton
          label="Next"
          icon="arrow-right"
          disabled={brandName.trim() === ''}
          disabledReason="Type your business name first"
          busy={isBusy('company')}
          onPress={() => run('company', () => {
            store.updateSettings({
              brandName: brandName.trim(),
              address: address.trim() || undefined,
              phone: phone.trim() || undefined,
            });
            onNext();
          })}
        />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ step 2 */

const UNITS: Product['unit'][] = ['pc', 'dozen', 'box'];
const UNIT_LABELS: Record<Product['unit'], string> = { pc: 'Piece', dozen: 'Dozen', box: 'Box' };
const STOCK_CHIPS = [12, 50, 100];

function ProductsStep({ onNext }: { onNext: () => void }) {
  const store = useStore();
  const { isBusy, run } = useWriteGuard();
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [unit, setUnit] = React.useState<Product['unit']>('pc');
  const [packSize, setPackSize] = React.useState('1 pc');
  const [tradePrice, setTradePrice] = React.useState('');
  const [mrp, setMrp] = React.useState('');
  const [stockQty, setStockQty] = React.useState('0');

  const disabledReason =
    name.trim() === '' ? 'Type the product name first'
    : code.trim() === '' ? 'Type a short product code first'
    : toInt(tradePrice) <= 0 ? 'Enter the price to shop'
    : undefined;

  // The form only clears on the next render, so without the guard an eager
  // double tap added the product — and its opening stock — twice.
  const add = () => {
    run('product', () => {
      store.addProduct({
        name: name.trim(),
        code: code.trim(),
        unit,
        packSize: packSize.trim() === '' ? '1 pc' : packSize.trim(),
        tradePrice: toInt(tradePrice),
        mrp: toInt(mrp) > 0 ? toInt(mrp) : toInt(tradePrice),
        stockQty: toInt(stockQty),
      });
      setName(''); setCode(''); setUnit('pc'); setPackSize('1 pc');
      setTradePrice(''); setMrp(''); setStockQty('0');
    });
  };

  return (
    <View>
      <Card>
        <CardHead icon="bottle-tonic-plus-outline" label="Add a product" />
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Product name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Rose Soap 100g"
            placeholderTextColor={color.textFaint}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Product code</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder="e.g. RS-100"
            placeholderTextColor={color.textFaint}
            autoCapitalize="characters"
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Sold by</Text>
          <OptionBar
            options={UNITS}
            value={unit}
            render={u => UNIT_LABELS[u]}
            onChange={setUnit}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Pack size</Text>
          <TextInput
            style={styles.input}
            value={packSize}
            onChangeText={setPackSize}
            placeholder="e.g. 12 pcs per box"
            placeholderTextColor={color.textFaint}
          />
        </View>
        <View style={styles.twoCol}>
          <View style={[styles.col, styles.field]}>
            <Text style={styles.fieldLabel}>Price to shop (Rs)</Text>
            <TextInput
              style={styles.input}
              value={tradePrice}
              onChangeText={t => setTradePrice(digitsOnly(t))}
              placeholder="0"
              placeholderTextColor={color.textFaint}
              keyboardType="number-pad"
            />
          </View>
          <View style={[styles.col, styles.field]}>
            <Text style={styles.fieldLabel}>Retail price (Rs)</Text>
            <TextInput
              style={styles.input}
              value={mrp}
              onChangeText={t => setMrp(digitsOnly(t))}
              placeholder="same as shop price"
              placeholderTextColor={color.textFaint}
              keyboardType="number-pad"
            />
          </View>
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Stock you have now</Text>
          <View style={styles.rowWrap}>
            {STOCK_CHIPS.map(q => (
              <Chip key={q} small label={`+${q}`} onPress={() => setStockQty(String(toInt(stockQty) + q))} />
            ))}
            {toInt(stockQty) > 0 && <Chip small label="clear" onPress={() => setStockQty('0')} />}
            <TextInput
              style={[styles.input, styles.qtyInput]}
              value={stockQty}
              onChangeText={t => setStockQty(digitsOnly(t))}
              keyboardType="number-pad"
            />
          </View>
        </View>
        <PrimaryButton
          label="Add product"
          icon="plus"
          variant="primary"
          disabled={disabledReason !== undefined}
          disabledReason={disabledReason}
          busy={isBusy('product')}
          busyLabel="Adding…"
          onPress={add}
        />
      </Card>

      {store.products.length === 0 ? (
        <Text style={styles.emptyHint}>Add your first product above — or skip and do it later.</Text>
      ) : (
        <View>
          <SectionLabel>{`Added so far (${store.products.length})`}</SectionLabel>
          <Card>
            {store.products.map(p => (
              <ListRow
                key={p.id}
                icon="bottle-tonic-plus-outline"
                title={p.name}
                sub={`code ${p.code} • ${p.packSize} • ${p.stockQty} in stock`}
                right={<Money amount={p.tradePrice} bold />}
              />
            ))}
          </Card>
        </View>
      )}

      <View style={styles.footer}>
        <PrimaryButton label="Next" icon="arrow-right" onPress={onNext} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ step 3 */

function ShopsStep({ onNext }: { onNext: () => void }) {
  const store = useStore();
  const { isBusy, run } = useWriteGuard();
  const existingAreas = [...new Set([
    ...store.areas.filter(a => a.active).map(a => a.name),
    ...store.shops.map(s => s.area),
  ].filter(a => a.trim().length > 0))];
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [area, setArea] = React.useState(() => existingAreas[0] ?? 'Main area');
  const [showMore, setShowMore] = React.useState(false);

  const disabledReason =
    name.trim() === '' ? 'Type the shop name first'
    : digitsOnly(phone).length < 10 ? "Enter the shop's mobile number"
    : undefined;

  // Same as the product step: the guard is what stops a duplicate shop.
  //
  // This is the one place an area may still be typed, because it is the one
  // place there is nothing to pick from: first run, no shops, no areas. The
  // typed name is registered as a real area on the way past, so the owner
  // arrives at More → Areas with the rounds already listed rather than a blank
  // screen and every shop unfileable.
  const add = () => {
    run('shop', () => {
      const areaName = area.trim() === '' ? 'Main area' : area.trim();
      store.addArea(areaName); // no-ops when it already exists
      store.addShop({ name: name.trim(), phone: phone.trim(), area: areaName });
      setName(''); setPhone('');
    });
  };

  return (
    <View>
      <Card>
        <CardHead icon="storefront-outline" label="Add a shop" />
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Shop name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Bismillah General Store"
            placeholderTextColor={color.textFaint}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Mobile number</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="0300-1234567"
            placeholderTextColor={color.textFaint}
            keyboardType="phone-pad"
          />
        </View>
        {!showMore ? (
          <Pressable onPress={() => setShowMore(true)} hitSlop={8}>
            <View style={styles.moreLink}>
              {/* A typed area name can be long — it wraps, the chevron stays put. */}
              <Text style={styles.moreLinkText} numberOfLines={2}>More — area: {area}</Text>
              <Icon name="chevron-down" size={18} color={color.primary} />
            </View>
          </Pressable>
        ) : (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Area</Text>
            <View style={styles.rowWrap}>
              {existingAreas.map(a => (
                <Chip key={a} small label={a} selected={area === a} onPress={() => setArea(a)} />
              ))}
            </View>
            <TextInput
              style={styles.input}
              value={area}
              onChangeText={setArea}
              placeholder="or type a new area"
              placeholderTextColor={color.textFaint}
            />
          </View>
        )}
        <PrimaryButton
          label="Add shop"
          icon="plus"
          variant="primary"
          disabled={disabledReason !== undefined}
          disabledReason={disabledReason}
          busy={isBusy('shop')}
          busyLabel="Adding…"
          onPress={add}
        />
      </Card>

      {store.shops.length === 0 ? (
        <Text style={styles.emptyHint}>Add your first shop above — or skip and do it later.</Text>
      ) : (
        <View>
          <SectionLabel>{`Added so far (${store.shops.length})`}</SectionLabel>
          <Card>
            {store.shops.map(s => (
              <ListRow
                key={s.id}
                icon="storefront-outline"
                title={s.name}
                sub={`${s.area} • ${s.phone}`}
              />
            ))}
          </Card>
        </View>
      )}

      <View style={styles.footer}>
        <PrimaryButton label="Next" icon="arrow-right" onPress={onNext} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ step 4 */

const ROLES: Employee['role'][] = ['admin', 'booker', 'rider'];
const ROLE_LABELS: Record<Employee['role'], string> = {
  admin: 'Admin', booker: 'Order booker', rider: 'Delivery rider',
};
const ROLE_SHORT: Record<Employee['role'], string> = {
  admin: 'Admin', booker: 'Booker', rider: 'Rider',
};

function TeamStep({ onFinish }: { onFinish: () => void }) {
  const store = useStore();
  // The last-admin guard below counts this list, so it has to be synced before
  // the guard can mean anything.
  useNeed('employeeList');
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState<Employee['role']>('admin');
  const [busy, setBusy] = React.useState(false);

  const adminCount = store.employees.filter(e => e.role === 'admin').length;
  const emailOk = email.includes('@') && email.includes('.');

  // disabledReason is back to explaining what is still missing — "Adding…" is
  // now the busy label, so the button spins instead of pretending to be
  // unfinished.
  const disabledReason =
    !emailOk ? 'Enter their Gmail address first'
    : name.trim() === '' ? 'Type their name first'
    : undefined;

  const add = async () => {
    if (busy) return; // addEmployee calls a cloud function — never call it twice
    setBusy(true);
    try {
      await store.addEmployee(email.trim().toLowerCase(), name.trim(), role);
      setEmail(''); setName(''); setRole('admin');
    } catch (e) {
      Alert.alert('Could not add', e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View>
      {adminCount < 2 ? (
        <Card style={styles.promptWarn}>
          <View style={styles.promptRow}>
            <Icon name="shield-account-outline" size={24} color={color.warn} />
            <View style={styles.promptText}>
              <Text style={styles.promptTitle} numberOfLines={2}>Add a second Admin</Text>
              <Text style={styles.promptBody}>
                A partner or family member. If you ever lose your account, they are the way back in.
              </Text>
            </View>
          </View>
        </Card>
      ) : (
        <Card style={styles.promptOk}>
          <View style={styles.promptRow}>
            <Icon name="check-circle-outline" size={24} color={color.success} />
            <View style={styles.promptText}>
              <Text style={[styles.promptTitle, { color: color.success }]} numberOfLines={2}>You have a second Admin</Text>
              <Text style={styles.promptBody}>If you ever lose your account, they are the way back in.</Text>
            </View>
          </View>
        </Card>
      )}

      <Card>
        <CardHead icon="account-plus-outline" label="Add a person" />
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Gmail address</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="name@gmail.com"
            placeholderTextColor={color.textFaint}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Ahmed"
            placeholderTextColor={color.textFaint}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Role</Text>
          <OptionBar
            options={ROLES}
            value={role}
            render={r => ROLE_SHORT[r]}
            onChange={setRole}
          />
        </View>
        <PrimaryButton
          label="Add to team"
          icon="account-plus-outline"
          variant="primary"
          disabled={disabledReason !== undefined}
          disabledReason={disabledReason}
          busy={busy}
          busyLabel="Adding…"
          onPress={() => { void add(); }}
        />
      </Card>

      {store.employees.length === 0 ? (
        <Text style={styles.emptyHint}>No one on the team yet — you can also add people later.</Text>
      ) : (
        <View>
          <SectionLabel>{`Team (${store.employees.length})`}</SectionLabel>
          <Card>
            {store.employees.map(e => (
              <ListRow
                key={e.email}
                icon="account-multiple-outline"
                title={e.name}
                sub={`${ROLE_LABELS[e.role]} • ${e.email}`}
                right={<Tag label={e.joined ? 'JOINED' : 'INVITED'} tone={e.joined ? 'success' : 'warn'} />}
              />
            ))}
          </Card>
        </View>
      )}

      <View style={styles.footer}>
        <PrimaryButton label="Finish setup" icon="check" onPress={onFinish} />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ styles */

const styles = StyleSheet.create({
  // Top/bottom padding comes from the safe-area insets at render time — this
  // screen sits OUTSIDE the navigator, so nothing else keeps "Skip" and the
  // step dots clear of the status bar (Android 15+ forces edge-to-edge).
  screen: { flex: 1, backgroundColor: color.bg },
  headerRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginHorizontal: space.gutter, marginTop: space.s,
  },
  dots: { flexDirection: 'row', alignItems: 'center' },
  dot: {
    width: space.s, height: space.s, borderRadius: space.s / 2,
    backgroundColor: color.border, marginRight: space.s - 2,
  },
  dotDone: { backgroundColor: color.primary, width: space.l + 4 },
  stepLabel: {
    fontSize: font.sub, fontWeight: '700', color: color.textSub,
    marginHorizontal: space.gutter, marginTop: space.s,
  },
  skip: { fontSize: font.body, fontWeight: '700', color: color.textSub, padding: space.xs },
  h1: { fontSize: font.h1, fontWeight: '800', color: color.text, marginHorizontal: space.gutter, marginTop: space.xs },
  subLine: { fontSize: font.sub, color: color.textSub, marginHorizontal: space.gutter, marginBottom: space.s, marginTop: 2 },

  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.s },
  cardHeadLabel: {
    flex: 1, minWidth: 0, fontSize: font.body, fontWeight: '600',
    color: color.text, marginLeft: space.m,
  },

  field: { marginBottom: space.s },
  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginBottom: space.xs },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 40,
    fontSize: font.body, color: color.text,
  },
  qtyInput: { minWidth: 80, marginLeft: space.xs, textAlign: 'center' },
  twoCol: { flexDirection: 'row' },
  col: { flex: 1, minWidth: 0, marginRight: space.s },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginBottom: space.xs },
  emptyHint: { fontSize: font.sub, color: color.textSub, marginHorizontal: space.gutter, marginTop: space.s },
  moreLink: { flexDirection: 'row', alignItems: 'center', marginBottom: space.s, paddingVertical: space.xs },
  // flex 1 so the wrapped label keeps the chevron on the row rather than
  // pushing it out of the card.
  moreLinkText: { flex: 1, minWidth: 0, fontSize: font.body, fontWeight: '700', color: color.primary, marginRight: 2 },
  promptWarn: { backgroundColor: color.warnSoft },
  promptOk: { backgroundColor: color.successSoft },
  promptRow: { flexDirection: 'row', alignItems: 'flex-start' },
  promptText: { flex: 1, minWidth: 0, marginLeft: space.m },
  promptTitle: { fontSize: font.h2 - 1, fontWeight: '800', color: color.warn },
  promptBody: { fontSize: font.sub, color: color.textSub, marginTop: 2, lineHeight: 17 },
  footer: { marginHorizontal: space.gutter, marginTop: space.s, marginBottom: space.l },
});
