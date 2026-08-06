/**
 * Settings — company details and daily rules (SRS FR-12.1). Every control
 * writes through updateSettings immediately; there is no save button.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import {
  Card, IconTile, OptionBar, SectionLabel,
  color, font, radius, space,
} from '../../components/ui';
import { useStore } from '../../data/store';

function RuleRow({ icon, label, children, last }: {
  icon: string; label: string; children: React.ReactNode; last?: boolean;
}) {
  return (
    <View style={[styles.ruleRow, !last && styles.ruleDivider]}>
      <View style={styles.ruleHead}>
        <IconTile name={icon} size={34} />
        <Text style={styles.ruleLabel}>{label}</Text>
      </View>
      {children}
    </View>
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

function SwitchRow({ icon, tint, bg, title, sub, value, onToggle, last }: {
  icon: string; tint?: string; bg?: string; title: string; sub: string;
  value: boolean; onToggle: () => void; last?: boolean;
}) {
  return (
    <Pressable onPress={onToggle} style={[styles.switchRow, !last && styles.ruleDivider]}>
      <IconTile name={icon} tint={tint} bg={bg} size={38} />
      <View style={styles.switchText}>
        <Text style={styles.switchTitle}>{title}</Text>
        <Text style={styles.switchSub}>{sub}</Text>
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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.subLine}>Changes save on their own — nothing else to press</Text>

      <SectionLabel>Company</SectionLabel>
      <Card style={styles.tightCard}>
        <Field label="Brand name" value={brandName} placeholder="Your brand name"
          onChange={t => { setBrandName(t); store.updateSettings({ brandName: t }); }} />
        <Field label="Address" value={address} placeholder="Shop or office address"
          onChange={t => { setAddress(t); store.updateSettings({ address: t }); }} />
        <Field label="Phone" value={phone} placeholder="03xx-xxxxxxx" keyboardType="phone-pad"
          onChange={t => { setPhone(t); store.updateSettings({ phone: t }); }} />
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingTop: space.s, paddingBottom: space.xl + space.l },
  subLine: {
    fontSize: font.sub, color: color.textSub,
    marginHorizontal: space.l, marginBottom: space.xs,
  },
  tightCard: { paddingVertical: space.xs },

  field: { paddingVertical: space.s },
  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginBottom: 6 },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 46,
    fontSize: font.body, color: color.text,
  },

  ruleRow: { paddingVertical: space.m },
  ruleDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  ruleHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.s + 2 },
  ruleLabel: { fontSize: font.body, fontWeight: '600', color: color.text, marginLeft: 10 },


  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.m },
  switchText: { flex: 1, marginHorizontal: 12 },
  switchTitle: { fontSize: font.body, fontWeight: '700', color: color.text },
  switchSub: { fontSize: font.tiny + 1, color: color.textSub, marginTop: 2 },
});
