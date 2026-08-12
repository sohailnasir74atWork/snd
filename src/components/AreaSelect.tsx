/**
 * Pick a shop's area from the owner's list — one field, one searchable sheet.
 *
 * This started as a row of chips, which is fine for three rounds and useless
 * for thirty: the row wraps into a wall, every name has to be read to find
 * one, and on a phone the wall pushes the Save button off the screen. A field
 * that says what is chosen, plus a sheet you can type into, stays the same size
 * whether the business has two areas or two hundred.
 *
 * It CAN now create one, which it deliberately could not before. The old split
 * — owner defines rounds in More → Areas, everyone else only files under an
 * existing one — is right in an office and wrong at a counter: a booker
 * standing in a street his company has never worked cannot register the shop
 * he is looking at, and the fallback ("save it with no area") drops it out of
 * every route until somebody notices. Creating is offered only when what he
 * typed matches nothing, so the normal path is still picking, not typing.
 *
 * He can create; he cannot rename, retire, or put a rider or another booker on
 * a round. Those decide where orders are delivered and whose territory a shop
 * belongs to, and they stay the owner's — enforced in firestore.rules, not
 * just here.
 */
import React from 'react';
import {
  FlatList, Modal, Pressable, StyleSheet, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, PrimaryButton, Text, TextInput, color, font, radius, space } from './ui';
import { useStore } from '../data/store';

const NO_AREA = '__none__';

export function AreaSelect({
  value,
  onChange,
  /** Shown when nothing is chosen yet. */
  placeholder = 'Choose an area',
}: {
  value: string;
  onChange: (area: string) => void;
  placeholder?: string;
}) {
  const store = useStore();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  const options = React.useMemo(() => {
    const live = store.areas.filter(a => a.active).map(a => a.name);
    // The shop's current area is always offered even if it has been retired,
    // or opening an old shop and pressing Save would move it out of its own
    // round without anyone asking for that.
    const current = value.trim();
    return [...new Set(current ? [...live, current] : live)]
      .sort((a, b) => a.localeCompare(b));
  }, [store.areas, value]);

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(a => a.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const countIn = (areaName: string) =>
    store.shops.filter(s => s.active && s.area === areaName).length;

  const choose = (areaName: string) => {
    onChange(areaName === NO_AREA ? '' : areaName);
    setOpen(false);
    setQuery('');
  };

  const typed = query.trim();
  /**
   * Offer to create only when the typed name matches nothing at all — case
   * included, so "saddar" does not quietly become a second "Saddar". That
   * duplicate-by-typo problem is exactly why areas became a managed list in
   * the first place, and it must not come back through this door.
   */
  const canCreate =
    typed.length > 1 &&
    !options.some(a => a.toLowerCase() === typed.toLowerCase());

  const createAndChoose = () => {
    if (!canCreate || creating) return;
    setCreating(true);
    store.addArea(typed);
    // addArea is fire-and-forget and the round-trip is not awaited anywhere in
    // this app, so the name is applied to the shop directly rather than waiting
    // for it to come back through the areas listener. The shop stores the NAME,
    // which is why that is safe: the two agree without a round-trip.
    onChange(typed);
    setOpen(false);
    setQuery('');
    setCreating(false);
  };

  return (
    <>
      <Pressable
        style={styles.field}
        accessibilityRole="button"
        accessibilityLabel={value ? `Area: ${value}` : placeholder}
        onPress={() => { setQuery(''); setOpen(true); }}>
        <Icon name="map-marker-radius-outline" size={18} color={value ? color.primary : color.textFaint} />
        {/* flex + minWidth 0 so a long area name ellipsises instead of pushing
            the chevron off the field — the crop bug from the design pass. */}
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>
          {value || placeholder}
        </Text>
        <Icon name="chevron-down" size={18} color={color.textSub} />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        {/*
          Android 15+ forces edge-to-edge at targetSdk 35+, so the system
          gesture bar draws OVER this sheet — the same bug that cut the tab bar
          labels in half (navigation.tsx). A fixed paddingBottom looked fine in
          the emulator and buried the last row and the buttons on a real phone.
        */}
        <View style={[styles.sheet, { paddingBottom: space.xl + insets.bottom }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Choose an area</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={12} style={styles.close}>
              <Icon name="close" size={22} color={color.textSub} />
            </Pressable>
          </View>

          {(
            <TextInput
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Type to find an area"
              placeholderTextColor={color.textFaint}
              // Always present so the sheet behaves the same way whether the
              // business has two rounds or two hundred, but the keyboard only
              // takes the screen when the list is long enough to need it —
              // popping it over four rows just hides the answer.
              autoFocus={options.length > 8}
              autoCorrect={false}
            />
          )}

          {options.length === 0 ? (
            <Text style={styles.empty}>
              No areas yet. Type the name of the round this shop sits on and add it —
              or save the shop without one for now.
            </Text>
          ) : (
            <FlatList
              data={shown}
              keyExtractor={a => a}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={
                canCreate ? null : <Text style={styles.empty}>Nothing matches “{typed}”.</Text>
              }
              renderItem={({ item }) => {
                const selected = item === value.trim();
                return (
                  <Pressable
                    style={[styles.row, selected && styles.rowSelected]}
                    onPress={() => choose(item)}>
                    <Text style={[styles.rowText, selected && styles.rowTextSelected]} numberOfLines={1}>
                      {item}
                    </Text>
                    <Text style={styles.rowCount}>
                      {countIn(item)} {countIn(item) === 1 ? 'shop' : 'shops'}
                    </Text>
                    {selected && <Icon name="check" size={18} color={color.primary} />}
                  </Pressable>
                );
              }}
            />
          )}

          {canCreate && (
            <View style={styles.createWrap}>
              <PrimaryButton
                label={`Add “${typed}” as a new area`}
                icon="plus"
                variant="primary"
                busy={creating}
                onPress={createAndChoose}
              />
            </View>
          )}

          {value.trim() !== '' && (
            <Pressable style={styles.clear} onPress={() => choose(NO_AREA)}>
              <Text style={styles.clearText}>Remove the area from this shop</Text>
            </Pressable>
          )}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row', alignItems: 'center', gap: space.s,
    backgroundColor: color.surface, borderRadius: radius.card,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, minHeight: 44, marginBottom: space.m,
  },
  value: { flex: 1, minWidth: 0, fontSize: font.body + 1, color: color.text },
  placeholder: { color: color.textFaint },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  // Capped so the sheet never swallows the whole screen on a tall phone, and
  // the list scrolls inside it rather than the page growing.
  sheet: {
    maxHeight: '70%', backgroundColor: color.bg,
    borderTopLeftRadius: radius.card * 2, borderTopRightRadius: radius.card * 2,
    // Horizontal follows the gutter so the sheet's rows sit on the same line
    // as the cards behind it; vertical keeps the roomier step.
    paddingHorizontal: space.gutter, paddingTop: space.l,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.m },
  sheetTitle: { flex: 1, minWidth: 0, fontSize: font.h2, fontWeight: '700', color: color.text },
  close: { padding: space.xs },
  search: {
    backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1,
    borderColor: color.border, paddingHorizontal: space.m, minHeight: 44,
    fontSize: font.body + 1, color: color.text, marginBottom: space.m,
  },
  list: { flexGrow: 0 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: space.s,
    backgroundColor: color.surface, borderRadius: radius.card,
    paddingHorizontal: space.m, minHeight: 52, marginBottom: space.s,
  },
  rowSelected: { borderWidth: 1, borderColor: color.primary },
  rowText: { flex: 1, minWidth: 0, fontSize: font.body + 1, color: color.text, fontWeight: '600' },
  rowTextSelected: { color: color.primary },
  rowCount: { flexShrink: 0, fontSize: font.sub, color: color.textSub },
  empty: { fontSize: font.sub, color: color.textSub, lineHeight: font.sub + 6, paddingVertical: space.m },
  createWrap: { marginTop: space.s },
  clear: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: space.s },
  clearText: { fontSize: font.body, fontWeight: '700', color: color.danger },
});
