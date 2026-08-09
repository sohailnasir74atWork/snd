/**
 * Settings — company details and daily rules (SRS FR-12.1). Every control
 * writes through updateSettings immediately; there is no save button.
 */
import React from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  Card, IconTile, MoreFields, OptionBar, SectionLabel,
  color, font, radius, space,
} from '../../components/ui';
import { KeyboardScreen } from './AdminScreens';
import { useStore } from '../../data/store';

function RuleRow({ icon, label, children, last }: {
  icon: string; label: string; children: React.ReactNode; last?: boolean;
}) {
  return (
    <View style={[styles.ruleRow, !last && styles.ruleDivider]}>
      <View style={styles.ruleHead}>
        <IconTile name={icon} size={34} />
        <Text style={styles.ruleLabel} numberOfLines={2}>{label}</Text>
      </View>
      {children}
    </View>
  );
}

/**
 * The rates worth one tap. 0 is the default and the only value the app could
 * hold until now; 17% is the standard Pakistani sales-tax rate and 18% covers
 * the provincial services rates. A business on some other number can still be
 * served — the maths takes any percent — but this list keeps the common case
 * to a single tap instead of a keyboard.
 */
const TAX_RATES: number[] = [0, 17, 18];

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
      </Card>
      <SectionLabel>Sales tax</SectionLabel>
      <Card style={styles.tightCard}>
        <RuleRow icon="receipt-text-outline" label="Sales tax on bills" last>
          <OptionBar
            options={TAX_RATES}
            value={TAX_RATES.includes(s.taxPercent) ? s.taxPercent : 0}
            render={v => (v === 0 ? 'None' : `${v}%`)}
            onChange={v => store.updateSettings({ taxPercent: v })}
          />
        </RuleRow>
        <Text style={styles.taxHint}>
          {s.taxPercent > 0
            ? `Added on top of the discounted amount and shown as its own line on every bill. Sales in your reports stay net of it — tax you collect is not money you earned.`
            : 'Off. Leave it off unless you are registered and must charge it — bills stay exactly as they are today.'}
        </Text>
      </Card>

      <SectionLabel>Daily rules</SectionLabel>
      <Card style={styles.tightCard}>
        <RuleRow icon="calendar-today" label="Default delivery day">
          <OptionBar
            options={['today', 'tomorrow'] as const}
            value={s.defaultDeliveryDay}
            render={v => (v === 'today' ? 'Today' : 'Tomorrow')}
            onChange={v => store.updateSettings({ defaultDeliveryDay: v })}
          />
        </RuleRow>
        <RuleRow icon="storefront-outline" label="Shops per day">
          <OptionBar
            options={[10, 15, 20, 30]}
            value={s.shopsPerDay}
            onChange={v => store.updateSettings({ shopsPerDay: v })}
          />
        </RuleRow>
        <RuleRow icon="percent-outline" label="Max discount">
          <OptionBar
            options={[5, 10, 15]}
            value={s.maxDiscountPercent}
            render={v => `${v}%`}
            onChange={v => store.updateSettings({ maxDiscountPercent: v })}
          />
        </RuleRow>
        <RuleRow icon="gift-outline" label="Reward approval limit">
          <OptionBar
            options={[500, 1000, 2000]}
            value={s.rewardApprovalLimit}
            render={v => `Rs ${v.toLocaleString()}`}
            onChange={v => store.updateSettings({ rewardApprovalLimit: v })}
          />
        </RuleRow>
        <RuleRow icon="hand-coin-outline" label="Reward per piece" last>
          <OptionBar
            options={[20, 40, 60]}
            value={s.rewardPerPiece}
            render={v => `Rs ${v}`}
            onChange={v => store.updateSettings({ rewardPerPiece: v })}
          />
        </RuleRow>
      </Card>

      <SectionLabel>Switches</SectionLabel>
      <Card style={styles.tightCard}>
        <SwitchRow
          icon="whatsapp" tint={color.success} bg={color.successSoft}
          title="Send order confirmations to shops"
          sub="The shop gets the order PDF at booking"
          value={s.sendConfirmations}
          onToggle={() => store.updateSettings({ sendConfirmations: !s.sendConfirmations })}
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

  ruleRow: { paddingVertical: space.s },
  ruleDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  ruleHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.s },
  ruleLabel: {
    flex: 1, minWidth: 0, fontSize: font.body, fontWeight: '600',
    color: color.text, marginLeft: space.m,
  },

  // 38pt icon tile + 6pt top and bottom keeps the row a 50pt tap target.
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.s },
  switchText: { flex: 1, minWidth: 0, marginHorizontal: space.m },
  switchTitle: { fontSize: font.body, fontWeight: '700', color: color.text },
  switchSub: { fontSize: font.tiny + 1, color: color.textSub, marginTop: 1 },
});
