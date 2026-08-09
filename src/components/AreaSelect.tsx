/**
 * Pick a shop's area from the owner's list — one field, one searchable sheet.
 *
 * This started as a row of chips, which is fine for three rounds and useless
 * for thirty: the row wraps into a wall, every name has to be read to find
 * one, and on a phone the wall pushes the Save button off the screen. A field
 * that says what is chosen, plus a sheet you can type into, stays the same size
 * whether the business has two areas or two hundred.
 *
 * It cannot create an area — that is deliberate and is the whole point of the
 * split. Rounds are defined once by the owner in More → Areas; this only files
 * a shop under one that already exists.
 */
import React from 'react';
import {
  FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Icon, color, font, radius, space } from './ui';
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
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

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
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Choose an area</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={12} style={styles.close}>
              <Icon name="close" size={22} color={color.textSub} />
            </Pressable>
          </View>

          {options.length > 0 && (
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
              No areas yet. The owner adds them in More → Areas, then shops can be filed
              under one. You can save this shop without an area for now.
            </Text>
          ) : (
            <FlatList
              data={shown}
              keyExtractor={a => a}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={
                <Text style={styles.empty}>Nothing matches “{query.trim()}”.</Text>
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
    padding: space.l, paddingBottom: space.xl,
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
  clear: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: space.s },
  clearText: { fontSize: font.body, fontWeight: '700', color: color.danger },
});
