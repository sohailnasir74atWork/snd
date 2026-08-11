/**
 * Settings — company details and daily rules (SRS FR-12.1). Every control
 * writes through updateSettings immediately; there is no save button.
 */
import React from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  Card, Chip, Icon, IconTile, MoreFields, OptionBar, SectionLabel,
  color, font, radius, space,
} from '../../components/ui';
import { KeyboardScreen } from './AdminScreens';
import { useStore } from '../../data/store';
import { DEFAULT_WARRANTY } from '../../data/models';
import type { MonthlyTarget } from '../../data/models';
import { targetsOf } from '../../lib/target';
import { LogoPicker } from './LogoPicker';

/**
 * A number the owner TYPES, in place of a row of chips.
 *
 * Every rate on this screen used to be three or four fixed options, and the
 * fixed options were always somebody else's numbers: a business paying Rs 25 a
 * piece had to pick 20 or 40. A list of choices is only kind when the choices
 * are exhaustive, and none of these ever were.
 *
 * It still saves on its own — every keystroke that parses to a number is
 * written, and blur puts a valid value back in the box. The empty field is
 * allowed WHILE typing (you cannot retype 20 as 25 without passing through
 * nothing) but never committed, so no rate is ever stored as zero by accident.
 */
function NumberRow({ icon, label, value, prefix, suffix, min, max, onCommit, last }: {
  icon: string; label: string; value: number;
  prefix?: string; suffix?: string; min: number; max: number;
  onCommit: (n: number) => void; last?: boolean;
}) {
  const [text, setText] = React.useState(String(value));
  const clamp = (n: number) => Math.min(Math.max(n, min), max);

  return (
    <View style={[styles.ruleRow, !last && styles.ruleDivider]}>
      <View style={styles.ruleHead}>
        <IconTile name={icon} size={34} />
        <Text style={styles.ruleLabel} numberOfLines={2}>{label}</Text>
      </View>
      <View style={styles.numberRow}>
        {prefix ? <Text style={styles.numberAffix}>{prefix}</Text> : null}
        <TextInput
          style={styles.numberInput}
          value={text}
          onChangeText={t => {
            const digits = t.replace(/[^0-9]/g, '');
            setText(digits);
            if (digits === '') return;
            const n = clamp(Number.parseInt(digits, 10));
            if (n !== value) onCommit(n);
          }}
          onBlur={() => {
            const n = Number.parseInt(text, 10);
            setText(String(Number.isFinite(n) ? clamp(n) : value));
          }}
          keyboardType="number-pad"
          maxLength={6}
          selectTextOnFocus
        />
        {suffix ? <Text style={styles.numberAffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

function Field({ label, value, onChange, placeholder, keyboardType, multiline, hint }: {
  label: string; value: string; onChange: (t: string) => void;
  placeholder: string; keyboardType?: 'phone-pad'; multiline?: boolean; hint?: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputTall]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={color.textFaint}
        keyboardType={keyboardType}
        multiline={multiline}
        // A paragraph field must not centre its text vertically on Android.
        textAlignVertical={multiline ? 'top' : undefined}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/**
 * One person's commission: how it is read, then how much.
 *
 * The mode sits ABOVE the number because it changes what the number means —
 * "20" is twenty rupees a piece or twenty percent of the sale, and those are
 * not close to each other. Reading order is the only thing stopping that
 * mistake, so the prefix and suffix on the amount change with it too.
 */
function CommissionRows({ label, icon, mode, value, onMode, onValue, last }: {
  label: string; icon: string; mode: 'fixed' | 'percent'; value: number;
  onMode: (m: 'fixed' | 'percent') => void; onValue: (v: number) => void; last?: boolean;
}) {
  return (
    <View style={!last ? styles.ruleDivider : undefined}>
      <View style={styles.ruleRow}>
        <View style={styles.ruleHead}>
          <IconTile name={icon} size={34} />
          <Text style={styles.ruleLabel} numberOfLines={2}>{label}</Text>
        </View>
        <OptionBar
          options={['fixed', 'percent'] as const}
          value={mode}
          onChange={onMode}
          render={m => (m === 'fixed' ? 'Rs per piece' : '% of sale')}
        />
      </View>
      <NumberRow
        icon={mode === 'fixed' ? 'cash' : 'percent'}
        label={mode === 'fixed' ? `${label} — rupees per piece` : `${label} — percent of the sale`}
        value={value}
        prefix={mode === 'fixed' ? 'Rs' : undefined}
        suffix={mode === 'percent' ? '%' : undefined}
        min={0}
        max={mode === 'fixed' ? 100000 : 100}
        onCommit={onValue}
        last
      />
    </View>
  );
}

function SwitchRow({ icon, tint, bg, title, sub, value, onToggle, last }: {
  icon: string; tint?: string; bg?: string; title: string; sub: string;
  value: boolean; onToggle: () => void; last?: boolean;
}) {
  return (
    <Pressable onPress={onToggle} style={[styles.switchRow, !last && styles.ruleDivider]}>
      <IconTile name={icon} tint={tint} bg={bg} size={38} />
      {/* The Switch is a fixed width, so the label column takes the slack and
          wraps — long titles used to be squeezed against it. */}
      <View style={styles.switchText}>
        <Text style={styles.switchTitle} numberOfLines={2}>{title}</Text>
        <Text style={styles.switchSub} numberOfLines={2}>{sub}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: color.border, true: color.successSoft }}
        thumbColor={value ? color.success : color.surface}
      />
    </Pressable>
  );
}

export function SettingsScreen() {
  const store = useStore();
  const s = store.settings;

  // Local copies so typing stays smooth; every keystroke still writes through.
  const [brandName, setBrandName] = React.useState(s.brandName);
  const [address, setAddress] = React.useState(s.address ?? '');
  const [phone, setPhone] = React.useState(s.phone ?? '');
  const [taxNumber, setTaxNumber] = React.useState(s.taxNumber ?? '');
  /**
   * `?? DEFAULT_WARRANTY` only when the key is ABSENT — a company that has
   * never been asked gets the template, and one that deliberately cleared the
   * box keeps it cleared. `?? ''` would have been the bug: an owner who
   * emptied it would find the default back on his next visit to Settings, and
   * on his next bill.
   */
  const [warranty, setWarranty] = React.useState(s.warrantyText ?? DEFAULT_WARRANTY);
  /**
   * Held locally and written as a whole array on every change — the list is
   * three rows at most, and a partial write of a targets array is how one
   * target silently disappears while another is being edited.
   */
  const [targets, setTargetsState] = React.useState<MonthlyTarget[]>(targetsOf(s.monthlyTargets));
  const setTargets = (next: MonthlyTarget[]) => {
    setTargetsState(next);
    store.updateSettings({ monthlyTargets: next });
  };

  // Nothing on this screen needs a busy guard: there is no save button, and
  // every control writes the whole value it shows, so a repeated tap writes
  // the same settings doc again rather than a second one.
  return (
    <KeyboardScreen style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.subLine}>Changes save on their own — nothing else to press</Text>

      <SectionLabel>Company</SectionLabel>
      <Card style={styles.tightCard}>
        <Field label="Brand name" value={brandName} placeholder="Your brand name"
          onChange={t => { setBrandName(t); store.updateSettings({ brandName: t }); }} />
        <Field label="Address" value={address} placeholder="Shop or office address"
          onChange={t => { setAddress(t); store.updateSettings({ address: t }); }} />
        <Field label="Phone" value={phone} placeholder="03xx-xxxxxxx" keyboardType="phone-pad"
          onChange={t => { setPhone(t); store.updateSettings({ phone: t }); }} />
        <LogoPicker />
        {/*
          Only ever shown when it is set or when the owner goes looking: a
          business that is not registered should not be asked for a tax number
          on the screen it opens to set its brand name. The header block in
          templates.ts has always printed this line when present — until now
          there was no way to make it present.
        */}
        <MoreFields label="Sales tax registration" count={1}>
          <Field label="Tax number (NTN / STRN)" value={taxNumber}
            placeholder="Printed on every bill"
            onChange={t => { setTaxNumber(t); store.updateSettings({ taxNumber: t }); }} />
        </MoreFields>
        {/*
          Behind a disclosure because it is a paragraph, and a paragraph at the
          top of Settings would push every switch below the fold. Not optional
          in importance — it is what the shopkeeper's copy says about returns —
          but it is set once and then left alone for years.
        */}
        <MoreFields label="Bill small print" count={1}>
          <Field
            label="Warranty and returns terms"
            value={warranty}
            multiline
            placeholder="Leave empty to print no small print at all"
            hint="Printed at the foot of every bill and on each cut-out copy. The default is written for cosmetics — have it checked before you rely on it."
            onChange={t => { setWarranty(t); store.updateSettings({ warrantyText: t }); }}
          />
        </MoreFields>
      </Card>
      <SectionLabel>Sales tax</SectionLabel>
      <Card style={styles.tightCard}>
        <NumberRow
          // `receipt-text-outline` is not in the bundled MaterialCommunityIcons
          // font — a name the font does not carry renders as "?", silently, on
          // the device only. Check `glyphmaps/MaterialCommunityIcons.json`
          // before using an icon name rather than trusting the MDI website,
          // which lists icons newer than this package ships.
          icon="percent-outline" label="Sales tax on bills"
          value={s.taxPercent} suffix="%" min={0} max={100}
          onCommit={v => store.updateSettings({ taxPercent: v })}
        />
        <Text style={styles.taxHint}>
          {s.taxPercent > 0
            ? 'Shown as its own line on every bill. Sales in your reports stay net of it — tax you collect is not money you earned.'
            : 'Off. Leave it off unless you are registered and must charge it — bills stay exactly as they are today.'}
        </Text>
        {/*
          Only worth asking once a rate is set: at 0% the two answers are the
          same number, and a switch with one possible outcome is a question the
          owner has to think about for nothing.
        */}
        {s.taxPercent > 0 && (
          <>
            <SwitchRow
              icon="cash-multiple"
              title="Booker types the final price"
              sub={s.priceIncludesTax
                ? `Tax is taken out of what he types — 700 means the shop pays 700`
                : `Tax goes on top of what he types — 700 means the shop pays ${
                  Math.round(700 * (1 + s.taxPercent / 100))}`}
              value={!!s.priceIncludesTax}
              onToggle={() => store.updateSettings({ priceIncludesTax: !s.priceIncludesTax })}
              last
            />
            <Text style={styles.taxHint}>
              {s.priceIncludesTax
                ? `When your booker agrees a price across the counter, that is the whole figure — the bill splits Rs ${s.taxPercent}% of it back out as sales tax and shows both lines. Use this if you quote shops one number.`
                : 'When your booker agrees a price, sales tax is added to it afterwards, so the shop pays more than the figure they discussed. This is how a trade invoice is normally written.'}
            </Text>
          </>
        )}
      </Card>

      <SectionLabel>Daily rules</SectionLabel>
      <Card style={styles.tightCard}>
        {/* "Default delivery day" used to sit here. Booking now always starts
            on Tomorrow — an order taken at a counter rides a van that has
            usually left, and the store rewrites "today" to tomorrow anyway
            once the rider starts his route, so Today as a default was a
            promise the round could not keep. The booker can still tap Today
            per order. `settings.defaultDeliveryDay` is left on the model
            rather than migrated off every existing company; nothing reads it. */}
        <NumberRow
          icon="storefront-outline" label="Shops per day"
          value={s.shopsPerDay} suffix="shops" min={1} max={500}
          onCommit={v => store.updateSettings({ shopsPerDay: v })}
        />
        {/* "Max discount" and "Reward approval limit" used to sit between
            these two. Both are gone from the screen, not from the app: the
            discount cap still floors the price a booker can agree, and a
            reward claim over the limit still reaches the owner marked for a
            closer look. They run on the value already stored (10% and
            Rs 1,000) and are no longer his to fiddle with. */}
        <NumberRow
          icon="hand-coin-outline" label="Reward per piece — counter staff" last
          value={s.rewardPerPiece} prefix="Rs" min={0} max={100000}
          onCommit={v => store.updateSettings({ rewardPerPiece: v })}
        />
      </Card>
      <Text style={styles.taxHint}>
        What the shop's own salesman earns for every piece he moves. The booker
        claims it for him; you approve it.
      </Text>

      {/* YOUR men, not the shop's — a separate card on purpose. The row above
          is claimed and approved one at a time; these are worked out from
          orders the app already records and nobody claims them. */}
      {/* Targets. An array on the model, so the owner can run a lump-sum goal
          and a product-wise one at the same time — which is how a distributor
          actually pushes a slow line without dropping the overall number. */}
      <SectionLabel>Monthly target</SectionLabel>
      <Card style={styles.tightCard}>
        {targets.map((t, i) => (
          <View key={i} style={i < targets.length - 1 ? styles.ruleDivider : undefined}>
            <View style={styles.ruleRow}>
              <View style={styles.ruleHead}>
                <IconTile name="target" size={34} />
                <Text style={styles.ruleLabel} numberOfLines={2}>
                  {t.productId
                    ? store.products.find(p2 => p2.id === t.productId)?.name ?? 'Product'
                    : t.metric === 'collection' ? 'Cash collected' : 'All products'}
                </Text>
              </View>
              <Pressable onPress={() => setTargets(targets.filter((_, j) => j !== i))} hitSlop={12}>
                <Icon name="close-circle-outline" size={22} color={color.textFaint} />
              </Pressable>
            </View>
            <OptionBar
              options={['pieces', 'value', 'collection'] as const}
              value={t.metric}
              onChange={m => setTargets(targets.map((x, j) => (j === i ? { ...x, metric: m } : x)))}
              render={m => (m === 'pieces' ? 'Pieces' : m === 'value' ? 'Sales Rs' : 'Collected Rs')}
            />
            <NumberRow
              icon={t.metric === 'pieces' ? 'package-variant' : 'cash'}
              label={t.metric === 'pieces' ? 'Pieces this month' : 'Rupees this month'}
              value={t.value}
              prefix={t.metric === 'pieces' ? undefined : 'Rs'}
              suffix={t.metric === 'pieces' ? 'pcs' : undefined}
              min={0}
              max={99999999}
              onCommit={v => setTargets(targets.map((x, j) => (j === i ? { ...x, value: v } : x)))}
              last
            />
            {/* Product-wise is meaningless on collection — money does not
                arrive labelled by product — so the picker hides itself. */}
            {t.metric !== 'collection' && (
              <MoreFields label={t.productId ? 'Change product' : 'Narrow to one product'} count={1}>
                <View style={styles.chipWrap}>
                  <Chip
                    label="All products"
                    selected={!t.productId}
                    onPress={() => setTargets(targets.map((x, j) => (j === i ? { ...x, productId: undefined } : x)))}
                  />
                  {store.products.filter(p2 => p2.active).map(p2 => (
                    <Chip
                      key={p2.id}
                      label={p2.name}
                      selected={t.productId === p2.id}
                      onPress={() => setTargets(targets.map((x, j) => (j === i ? { ...x, productId: p2.id } : x)))}
                    />
                  ))}
                </View>
              </MoreFields>
            )}
          </View>
        ))}
        {targets.length === 0 && (
          <Text style={styles.taxHint}>No target set — the booker's screen shows none.</Text>
        )}
      </Card>
      <View style={styles.chipWrap}>
        <Chip
          label="+ Add a target"
          onPress={() => setTargets([...targets, { metric: 'pieces', value: 500 }])}
        />
      </View>
      <Text style={styles.taxHint}>
        What each booker is aiming at this month. Pieces is what he can push
        hardest; Collected is the only one that says the money came home.
        Sales and Pieces can be narrowed to a single product.
      </Text>

      <SectionLabel>Your team's commission</SectionLabel>
      <Card style={styles.tightCard}>
        <CommissionRows
          label="Order booker"
          icon="cart-outline"
          mode={s.bookerCommissionMode ?? 'fixed'}
          value={s.bookerCommissionValue ?? 0}
          onMode={m => store.updateSettings({ bookerCommissionMode: m })}
          onValue={v => store.updateSettings({ bookerCommissionValue: v })}
        />
        <CommissionRows
          label="Delivery rider"
          icon="truck-outline"
          last
          mode={s.riderCommissionMode ?? 'fixed'}
          value={s.riderCommissionValue ?? 0}
          onMode={m => store.updateSettings({ riderCommissionMode: m })}
          onValue={v => store.updateSettings({ riderCommissionValue: v })}
        />
      </Card>
      <Text style={styles.taxHint}>
        Leave at 0 to show no commission at all. A percentage is taken on the
        sale net of sales tax — nobody earns a share of the government's money.
        It counts as earned only once the goods are delivered AND the bill is
        paid.
      </Text>

      <SectionLabel>Switches</SectionLabel>
      <Card style={styles.tightCard}>
        <SwitchRow
          icon="whatsapp" tint={color.success} bg={color.successSoft}
          title="Send order confirmations to shops"
          sub="The shop gets the order PDF at booking"
          value={s.sendConfirmations}
          onToggle={() => store.updateSettings({ sendConfirmations: !s.sendConfirmations })}
        />
        {/*
          Default ON, and absent means ON: the booker is the only person who
          ever stands in the shop, so he is the only one who finds out the
          number is wrong. An owner who wants those edits to himself turns it
          off. The shop's NAME is never his either way.
        */}
        <SwitchRow
          icon="storefront-outline"
          title="Booker can edit shop details"
          sub={s.bookerEditsShops === false
            ? 'Off — only you change a shop. He can still register a new one.'
            : 'Phone, owner\'s name, area and counter staff. Never the name or the balance.'}
          value={s.bookerEditsShops !== false}
          onToggle={() => store.updateSettings({ bookerEditsShops: s.bookerEditsShops === false })}
        />
        <SwitchRow
          icon="bank-outline"
          title="Accept cheques"
          sub="Shows the cheque option when taking payment"
          value={s.acceptCheques}
          onToggle={() => store.updateSettings({ acceptCheques: !s.acceptCheques })}
          last
        />
      </Card>

      <SectionLabel>What staff can see</SectionLabel>
      <Card style={styles.tightCard}>
        <SwitchRow
          icon="cash-multiple"
          title="Booker sees shop balances"
          sub="Owed amounts on his route — also the cash-exception button"
          value={s.visibility.bookerSeesBalances}
          onToggle={() => store.updateSettings({
            visibility: { ...s.visibility, bookerSeesBalances: !s.visibility.bookerSeesBalances },
          })}
        />
        <SwitchRow
          icon="truck-outline"
          title="Booker sees delivery status"
          sub="Done / to-deliver tags on his booked orders"
          value={s.visibility.bookerSeesDelivery}
          onToggle={() => store.updateSettings({
            visibility: { ...s.visibility, bookerSeesDelivery: !s.visibility.bookerSeesDelivery },
          })}
        />
        <SwitchRow
          icon="sigma"
          title="Booker sees his order amounts"
          sub="Rupee totals on My Day"
          value={s.visibility.bookerSeesOwnTotals}
          onToggle={() => store.updateSettings({
            visibility: { ...s.visibility, bookerSeesOwnTotals: !s.visibility.bookerSeesOwnTotals },
          })}
        />
        <SwitchRow
          icon="history"
          title="Rider sees old balances"
          sub="Old khata at close-out and the whole Collect tab"
          value={s.visibility.riderSeesOldBalance}
          onToggle={() => store.updateSettings({
            visibility: { ...s.visibility, riderSeesOldBalance: !s.visibility.riderSeesOldBalance },
          })}
          last
        />
      </Card>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingTop: space.s, paddingBottom: space.xl + space.l },
  // Chips wrap rather than scroll: a product list of thirty must not hide the
  // thirtieth behind a gesture nobody knows is there.
  chipWrap: {
    flexDirection: 'row', flexWrap: 'wrap', gap: space.s,
    paddingHorizontal: space.gutter, paddingBottom: space.s,
  },
  taxHint: {
    fontSize: font.sub, color: color.textSub,
    paddingHorizontal: space.l, paddingBottom: space.m,
  },
  subLine: {
    fontSize: font.sub, color: color.textSub,
    marginHorizontal: space.gutter, marginBottom: space.xs,
  },
  tightCard: { paddingVertical: space.xs },

  field: { paddingVertical: space.s },
  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginBottom: space.xs },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 40,
    fontSize: font.body, color: color.text,
  },
  // A paragraph, not a line: fixed height so the card does not grow under the
  // owner's thumb as he types, and it scrolls inside itself past that.
  inputTall: { height: 132, paddingVertical: space.s, lineHeight: font.body + 5 },
  fieldHint: {
    fontSize: font.tiny, color: color.textSub, marginTop: space.xs,
    lineHeight: font.tiny + 5,
  },

  ruleRow: { paddingVertical: space.s },
  ruleDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  ruleHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.s },
  ruleLabel: {
    flex: 1, minWidth: 0, fontSize: font.body, fontWeight: '600',
    color: color.text, marginLeft: space.m,
  },

  // The typed rate: a short box, not a full-width field. A number that is
  // never more than a few digits should not look like an address line.
  numberRow: { flexDirection: 'row', alignItems: 'center' },
  numberAffix: { fontSize: font.body, fontWeight: '700', color: color.textSub, marginHorizontal: space.s },
  numberInput: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, paddingVertical: 0, height: 42, minWidth: 96,
    fontSize: font.h2, fontWeight: '700', color: color.text, textAlign: 'center',
  },

  // 38pt icon tile + 6pt top and bottom keeps the row a 50pt tap target.
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.s },
  switchText: { flex: 1, minWidth: 0, marginHorizontal: space.m },
  switchTitle: { fontSize: font.body, fontWeight: '700', color: color.text },
  switchSub: { fontSize: font.tiny + 1, color: color.textSub, marginTop: 1 },
});
