/**
 * Admin — Areas. The rounds a booker sweeps, defined once here.
 *
 * Areas used to be a free-text box on the shop form, which meant every typo
 * made a new one: "Saddar", "saddar" and "Sadar " were three different places
 * that split one round into three and left the route map unable to say what
 * "the area" even was. Creating a round is an owner's decision made once;
 * filing a shop under one is a field decision made daily. They belong in
 * different screens, and this is the first one.
 */
import React from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Card, Chip, EmptyState, IconTile, ListRow, PrimaryButton, Tag,
  color, font, radius, space,
} from '../../components/ui';
import { KeyboardScreen, useWriteGuard } from './AdminScreens';
import { useStore } from '../../data/store';
import type { Area } from '../../data/models';

export function AreasScreen() {
  const store = useStore();
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState('');
  const { isBusy, run } = useWriteGuard();

  const areas = store.areas;
  const countIn = (areaName: string) => store.shops.filter(s => s.area === areaName).length;

  /**
   * Who delivers this round, in the row subtitle.
   *
   * Says "company default" rather than nothing when a round has no rider of
   * its own, because that is the difference between "these orders go
   * somewhere sensible" and "these orders go nowhere" — and the owner cannot
   * tell those apart from a blank.
   */
  const riderLabel = (area: Area): string => {
    if (area.riderId) return store.riders.find(r => r.id === area.riderId)?.name ?? 'Removed rider';
    const fallback = store.settings.defaultRiderId ?? store.settings.autoAssignRiderId;
    if (!fallback) return 'no rider';
    return `${store.riders.find(r => r.id === fallback)?.name ?? 'default rider'} (default)`;
  };

  /** Whose territory, appended only once the company has more than one booker. */
  const bookerLabel = (area: Area): string => {
    if (store.bookers.length < 2) return '';
    if (!area.bookerId) return ' • unclaimed';
    return ` • ${store.bookers.find(b => b.id === area.bookerId)?.name ?? 'removed booker'}`;
  };

  /**
   * Names sitting on shops that no area doc claims.
   *
   * Every shop that existed before this screen carries a typed name, and none
   * of them are on the list — so without this the owner opens Areas, sees
   * nothing, and every one of those shops becomes unfileable. Offered as a
   * one-tap import rather than written behind their back: the typos are real
   * and some of them should be merged, not adopted.
   */
  const unlisted = React.useMemo(() => {
    const known = new Set(areas.map(a => a.name.toLowerCase()));
    const found = new Set<string>();
    store.shops.forEach(s => {
      const n = (s.area || '').trim();
      if (n && !known.has(n.toLowerCase())) found.add(n);
    });
    return [...found].sort((a, b) => a.localeCompare(b));
  }, [areas, store.shops]);

  const clean = name.trim();
  const duplicate = areas.some(a => a.name.toLowerCase() === clean.toLowerCase());

  const save = () => {
    run('add', () => {
      store.addArea(clean);
      setName('');
      setAdding(false);
    });
  };

  const saveRename = (area: Area) => {
    const next = editName.trim();
    if (!next || next === area.name) { setEditingId(null); return; }
    const moving = countIn(area.name);
    run(`rename-${area.id}`, () => {
      store.renameArea(area.id, next);
      setEditingId(null);
      if (moving > 0) {
        Alert.alert(
          'Area renamed',
          `${moving} ${moving === 1 ? 'shop was' : 'shops were'} moved to “${next}” as well, so nothing is left filed under the old name.`,
        );
      }
    });
  };

  const retire = (area: Area) => {
    const held = countIn(area.name);
    Alert.alert(
      `Retire “${area.name}”?`,
      held > 0
        ? `${held} ${held === 1 ? 'shop stays' : 'shops stay'} in this area and keep working — it just stops being offered when anyone files a new shop.`
        : 'It stops being offered when anyone files a new shop. You can bring it back any time.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Retire',
          style: 'destructive',
          onPress: () => run(`retire-${area.id}`, () => store.setAreaActive(area.id, false)),
        },
      ],
    );
  };

  return (
    <KeyboardScreen style={styles.screen} contentContainerStyle={styles.content}>
      {areas.length > 0 && (
        <Text style={styles.subLine}>
          {areas.filter(a => a.active).length} active
          {areas.some(a => !a.active) ? ` • ${areas.filter(a => !a.active).length} retired` : ''}
        </Text>
      )}

      {!adding && (
        <View style={styles.ctaWrap}>
          <PrimaryButton label="Add area" icon="plus" variant="cta" onPress={() => setAdding(true)} />
        </View>
      )}

      {adding && (
        <Card style={styles.tightCard}>
          <View style={styles.formHead}>
            <IconTile name="map-marker-radius-outline" size={34} />
            <Text style={styles.formTitle}>New area</Text>
          </View>
          <Text style={styles.fieldLabel}>Area name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Saddar"
            placeholderTextColor={color.textFaint}
            autoFocus
          />
          <PrimaryButton
            label={duplicate ? 'Already on the list' : 'Save area'}
            variant="cta"
            icon="check-circle-outline"
            disabled={clean.length === 0 || duplicate}
            disabledReason={duplicate ? 'That area already exists' : 'Type a name first'}
            busy={isBusy('add')}
            onPress={save}
          />
          <View style={styles.rowWrap}>
            <Chip small label="Cancel" onPress={() => { setName(''); setAdding(false); }} />
          </View>
        </Card>
      )}

      {areas.length === 0 && !adding && (
        <EmptyState
          icon="map-marker-radius-outline"
          title="No areas yet"
          hint="An area is one round — the patch a booker covers in a day. Add them here, then every shop gets filed under one."
        />
      )}

      {areas.map(area => (
        <Card key={area.id}>
          {editingId === area.id ? (
            <>
              <Text style={styles.fieldLabel}>Rename area</Text>
              <TextInput
                style={styles.input}
                value={editName}
                onChangeText={setEditName}
                placeholder={area.name}
                placeholderTextColor={color.textFaint}
                autoFocus
              />
              <Text style={styles.hint}>
                {countIn(area.name) > 0
                  ? `${countIn(area.name)} ${countIn(area.name) === 1 ? 'shop moves' : 'shops move'} with it.`
                  : 'No shops are filed here yet.'}
              </Text>
              <View style={styles.rowWrap}>
                <Chip small selected label="Save name" onPress={() => saveRename(area)} />
                <Chip small label="Cancel" onPress={() => setEditingId(null)} />
              </View>
            </>
          ) : (
            <>
              <ListRow
                icon="map-marker-radius-outline"
                title={area.name}
                sub={`${countIn(area.name)} ${countIn(area.name) === 1 ? 'shop' : 'shops'} • ${riderLabel(area)}${bookerLabel(area)}`}
              />
              {/*
                Who drives this round. Only shown once there is a real choice
                to make — a one-van business never sees it and its orders keep
                going where they always did, through the company default.
              */}
              {area.active && store.riders.length > 1 && (
                <>
                  <Text style={styles.fieldLabel}>Delivered by</Text>
                  <View style={styles.rowWrap}>
                    {store.riders.map(r => (
                      <Chip
                        key={r.id}
                        small
                        label={r.name}
                        selected={area.riderId === r.id}
                        onPress={isBusy(`rider-${area.id}`) ? undefined : () => run(
                          `rider-${area.id}`,
                          () => store.setAreaRider(area.id, area.riderId === r.id ? null : r.id),
                        )}
                      />
                    ))}
                  </View>
                  <Text style={styles.hint}>
                    {area.riderId
                      ? 'New orders for shops on this round go to him. Orders already booked keep the van they were booked to.'
                      : 'Nobody on this round yet — new orders here wait in Unassigned on your Action screen.'}
                  </Text>
                </>
              )}
              {/*
                Whose territory this is. Same rule as the rider row: hidden
                until there is more than one booker, so a small business never
                has to think about it and keeps seeing every shop.
              */}
              {area.active && store.bookers.length > 1 && (
                <>
                  <Text style={styles.fieldLabel}>Booked by</Text>
                  <View style={styles.rowWrap}>
                    {store.bookers.map(b => (
                      <Chip
                        key={b.id}
                        small
                        label={b.name}
                        selected={area.bookerId === b.id}
                        onPress={isBusy(`booker-${area.id}`) ? undefined : () => run(
                          `booker-${area.id}`,
                          () => store.setAreaBooker(area.id, area.bookerId === b.id ? null : b.id),
                        )}
                      />
                    ))}
                  </View>
                  <Text style={styles.hint}>
                    {area.bookerId
                      ? 'This round is on his route screen, and his visit cycle is measured over it.'
                      : 'Unclaimed — it shows up for any booker who has no round of his own.'}
                  </Text>
                </>
              )}
              <View style={styles.rowWrap}>
                {!area.active && <Tag label="RETIRED" tone="warn" />}
                <Chip
                  small
                  label="Rename"
                  onPress={() => { setEditingId(area.id); setEditName(area.name); }}
                />
                {area.active ? (
                  <Chip small label="Retire" onPress={() => retire(area)} />
                ) : (
                  <Chip
                    small
                    selected
                    label="Bring back"
                    onPress={() => run(`revive-${area.id}`, () => store.setAreaActive(area.id, true))}
                  />
                )}
              </View>
            </>
          )}
        </Card>
      ))}

      {unlisted.length > 0 && (
        <Card style={styles.tightCard}>
          <Text style={styles.formTitle}>Found on shops, not on this list</Text>
          <Text style={styles.hint}>
            These names were typed onto shops before areas were a list. Add the ones that
            are real — and leave the typos, then rename the shops onto the right area.
          </Text>
          <View style={styles.rowWrap}>
            {unlisted.map(n => (
              <Chip
                key={n}
                small
                label={`+ ${n} (${countIn(n)})`}
                onPress={() => run(`import-${n}`, () => store.addArea(n))}
              />
            ))}
          </View>
          {unlisted.length > 1 && (
            <PrimaryButton
              variant="quiet"
              label={`Add all ${unlisted.length}`}
              icon="playlist-plus"
              busy={isBusy('import-all')}
              onPress={() => run('import-all', () => unlisted.forEach(n => store.addArea(n)))}
            />
          )}
        </Card>
      )}
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: space.gutter, paddingTop: space.l, paddingBottom: 40 },
  subLine: { fontSize: font.sub, color: color.textSub, marginBottom: space.m },
  ctaWrap: { marginBottom: space.m },
  tightCard: { paddingTop: space.m },
  formHead: { flexDirection: 'row', alignItems: 'center', gap: space.m, marginBottom: space.m },
  formTitle: { flex: 1, minWidth: 0, fontSize: font.h2, fontWeight: '700', color: color.text },
  fieldLabel: { fontSize: font.sub, color: color.textSub, marginBottom: space.xs },
  input: {
    backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1,
    borderColor: color.border, padding: space.m, minHeight: 44,
    fontSize: font.body + 1, marginBottom: space.m, color: color.text,
  },
  hint: { fontSize: font.sub, color: color.textSub, lineHeight: font.sub + 6, marginBottom: space.m },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s, marginTop: space.s },
});
