/**
 * The counter staff of ONE shop, shown where they belong — inside that shop.
 *
 * These are not our employees. They stand behind someone else's counter and
 * recommend our product for a per-piece reward, which makes them a property of
 * the shop, not of the company: the only question anyone ever asks is "who
 * sells for us in THIS shop", and until now there was nowhere to ask it. They
 * were registerable only from the booker's My Day tab and visible only there,
 * so an owner opening a shop had no idea whether it had a counter person at
 * all.
 *
 * They are stored ON the shop — `shop.counterStaff`, an optional array — for
 * the same reason. Register a shop today with nobody behind the counter, find
 * someone next month, open the shop and add them; an absent field and an empty
 * list mean the same thing. They used to live in their own `rewardStaff`
 * collection, which meant the answer to "who sells for us here" was a join
 * away from the shop it was about.
 */
import React from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card, Chip, ListRow, PrimaryButton, Tag, color, font, radius, space } from '../../components/ui';
import { useWriteGuard } from './AdminScreens';
import { useStore } from '../../data/store';
import type { RewardStaff, Shop } from '../../data/models';

export function CounterStaffSection({ shop }: { shop: Shop }) {
  const store = useStore();
  const { isBusy, run } = useWriteGuard();
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [showInactive, setShowInactive] = React.useState(false);

  const all = store.rewardStaff.filter(r => r.shopId === shop.id);
  const active = all.filter(r => r.active);
  const inactive = all.filter(r => !r.active);

  // Claims are what the reward money actually flows through, so the count is
  // the honest measure of whether a counter person is really selling.
  const claimsFor = (staffId: string) =>
    store.rewardClaims.filter(c => c.staffId === staffId && c.status !== 'rejected').length;

  // A name is the whole requirement. Plenty of counter staff are known by face
  // and first name only, and refusing to register one because nobody has his
  // number just means he goes unrecorded and unpaid.
  const canSave = name.trim().length > 0;

  const save = () => {
    run('add-staff', () => {
      store.addRewardStaff({ name: name.trim(), phone: phone.trim() || undefined, shopId: shop.id });
      setName(''); setPhone(''); setAdding(false);
    });
  };

  const retire = (r: RewardStaff) => {
    const claims = claimsFor(r.id);
    Alert.alert(
      `Remove ${r.name}?`,
      claims > 0
        ? `Their ${claims} ${claims === 1 ? 'claim stays' : 'claims stay'} on the record and any approved reward is still owed. They just stop being offered for new claims.`
        : 'They stop being offered when anyone files a new reward claim. You can bring them back any time.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => run(`retire-${r.id}`, () => store.setRewardStaffActive(r.id, false)),
        },
      ],
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.divider} />
      <Text style={styles.heading}>
        Counter staff{active.length > 0 ? ` (${active.length})` : ''}
      </Text>
      <Text style={styles.hint}>
        Whoever stands at this counter and recommends our product. They earn
        Rs {store.settings.rewardPerPiece} a piece on approved claims.
      </Text>

      {active.map(r => (
        <Card key={r.id}>
          <ListRow
            icon="account-star-outline"
            title={r.name}
            sub={`${r.phone}${claimsFor(r.id) > 0 ? ` • ${claimsFor(r.id)} claim${claimsFor(r.id) === 1 ? '' : 's'}` : ' • no claims yet'}`}
          />
          <View style={styles.rowWrap}>
            <Chip
              small
              label={isBusy(`retire-${r.id}`) ? 'Removing…' : 'Remove'}
              onPress={isBusy(`retire-${r.id}`) ? undefined : () => retire(r)}
            />
          </View>
        </Card>
      ))}

      {active.length === 0 && !adding && (
        <Text style={styles.empty}>
          Nobody registered at this counter yet.
        </Text>
      )}

      {adding ? (
        <Card style={styles.tight}>
          <Text style={styles.fieldLabel}>Their name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Salman"
            placeholderTextColor={color.textFaint}
            autoFocus
          />
          <Text style={styles.fieldLabel}>Their mobile number (optional)</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="03xx xxxxxxx — leave blank if you don't have it"
            placeholderTextColor={color.textFaint}
            keyboardType="phone-pad"
          />
          <PrimaryButton
            label="Save counter person"
            icon="check-circle-outline"
            disabled={!canSave}
            disabledReason="Type their name first"
            busy={isBusy('add-staff')}
            onPress={save}
          />
          <View style={styles.rowWrap}>
            <Chip small label="Cancel" onPress={() => { setName(''); setPhone(''); setAdding(false); }} />
          </View>
        </Card>
      ) : (
        <View style={styles.rowWrap}>
          <Chip small selected label="+ Add counter person" onPress={() => setAdding(true)} />
          {inactive.length > 0 && (
            <Chip
              small
              label={showInactive ? 'Hide removed' : `Removed (${inactive.length})`}
              onPress={() => setShowInactive(v => !v)}
            />
          )}
        </View>
      )}

      {showInactive && inactive.map(r => (
        <Card key={r.id}>
          <ListRow icon="account-off-outline" title={r.name} sub={r.phone} />
          <View style={styles.rowWrap}>
            <Tag label="REMOVED" tone="warn" />
            <Chip
              small
              selected
              label="Bring back"
              onPress={() => run(`revive-${r.id}`, () => store.setRewardStaffActive(r.id, true))}
            />
          </View>
        </Card>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.s },
  divider: { height: 1, backgroundColor: color.border, marginVertical: space.l },
  heading: { fontSize: font.h2, fontWeight: '700', color: color.text },
  hint: {
    fontSize: font.sub, color: color.textSub,
    lineHeight: font.sub + 6, marginTop: space.xs, marginBottom: space.m,
  },
  empty: { fontSize: font.sub, color: color.textFaint, marginBottom: space.s },
  tight: { paddingTop: space.m },
  fieldLabel: { fontSize: font.sub, color: color.textSub, marginBottom: space.xs },
  input: {
    backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1,
    borderColor: color.border, padding: space.m, minHeight: 44,
    fontSize: font.body + 1, marginBottom: space.m, color: color.text,
  },
  rowWrap: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    gap: space.s, marginTop: space.s,
  },
});
