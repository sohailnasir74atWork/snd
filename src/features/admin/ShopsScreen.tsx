/**
 * Admin — Shops. Grouped by area (same grouping as the booker's route), plus
 * the SRS two-field "Add shop" form: name + mobile up front, everything else
 * behind "More".
 *
 * Areas are PICKED here, never typed — they are defined once in More → Areas.
 * Chips beside a free-text box were meant to stop "Saddar"/"Sadar"
 * fragmentation and did not: the box was always right there.
 */
import React from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import {
  Card, Chip, EmptyState, Icon, IconTile, Money, OptionBar, PrimaryButton, Text, TextInput, color, font, radius, space,
} from '../../components/ui';
import { KeyboardScreen, useWriteGuard } from './AdminScreens';
import { useStore } from '../../data/store';
import type { Shop } from '../../data/models';
import { AreaSelect } from '../../components/AreaSelect';
import { CounterStaffSection } from './CounterStaffSection';
import { digitsOnly, formatLocal, normalizeWhatsApp } from '../../lib/phone';
import { formatAmount } from '../../lib/money';

function toRupees(text: string): number {
  const n = parseInt(text.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Everything the owner needs to do to an EXISTING shop (audit: shops could
 * never be edited): details, manual khata correction, a payment made directly
 * to her, deactivation, deletion.
 *
 * There is no standing-discount control any more, and no standing discount:
 * a per-shop rate applied itself to every order silently, which is the same
 * thing the percent chips on New Order were removed for. A price is agreed per
 * basket now, typed in rupees on the order itself.
 */
function ShopEditor({ shop, onClose }: { shop: Shop; onClose: () => void }) {
  const store = useStore();
  const [name, setName] = React.useState(shop.name);
  const [phone, setPhone] = React.useState(shop.phone);
  const [area, setArea] = React.useState(shop.area);
  const [ownerName, setOwnerName] = React.useState(shop.ownerName ?? '');
  const [khataText, setKhataText] = React.useState('');
  const [khataDir, setKhataDir] = React.useState<'down' | 'up'>('down');
  const [payText, setPayText] = React.useState('');
  const [payMode, setPayMode] = React.useState<'cash' | 'transfer'>('transfer');
  // `collect` really is awaitable (it allocates a receipt serial), so it keeps
  // its own busy state; everything else here is a fire-and-forget write.
  const [recording, setRecording] = React.useState(false);
  const { isBusy, run } = useWriteGuard();

  const khataDelta = toRupees(khataText);
  const payAmount = Math.min(toRupees(payText), shop.outstanding);

  const remove = () => run('delete', () => { store.deleteShop(shop.id); onClose(); });

  /**
   * Deleting is permanent, so the alert has to say what is actually lost —
   * and a shop that owes money gets asked twice.
   *
   * The second prompt is not ceremony. Orders keep a frozen `shopSnapshot`, so
   * the history survives; the live khata lives on THIS document and does not.
   * Deleting a debtor is therefore the one press here that quietly destroys
   * money the business is owed, and it should not share a single "OK" with
   * clearing up a test row.
   */
  const confirmDelete = () => {
    const owes = shop.outstanding > 0;
    Alert.alert(
      `Delete ${shop.name}?`,
      owes
        ? `This cannot be undone. ${shop.name} still owes Rs ${shop.outstanding.toLocaleString()} — deleting the shop deletes that balance with it. Past bills keep their record; the khata does not.\n\nTo keep the balance, close this and use Deactivate instead.`
        : 'This cannot be undone. The shop disappears from every round and every map. Bills already issued keep their own record of it.',
      [
        { text: 'Cancel', style: 'cancel' },
        owes
          ? {
            text: 'Delete anyway',
            style: 'destructive',
            onPress: () => Alert.alert(
              'Delete the balance too?',
              `Rs ${shop.outstanding.toLocaleString()} owed by ${shop.name} will no longer be counted anywhere.`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete the shop', style: 'destructive', onPress: remove },
              ],
            ),
          }
          : { text: 'Delete', style: 'destructive', onPress: remove },
      ],
    );
  };

  return (
    <Card style={styles.tightCard}>
      <View style={styles.formHead}>
        <IconTile name="storefront-outline" size={34} />
        {/* A long shop name used to run past the card edge here — it now takes
            the remaining width and wraps. */}
        <Text style={styles.formTitle} numberOfLines={2}>{shop.name}</Text>
      </View>

      <Field label="Shop name" value={name} onChange={setName} placeholder={shop.name} />
      <Field label="Mobile number" value={phone} onChange={setPhone}
        placeholder="03xx xxxxxxx" keyboardType="phone-pad" />
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Area</Text>
        <AreaSelect value={area} onChange={setArea} />
      </View>
      <Field label="Owner's name" value={ownerName} onChange={setOwnerName} placeholder="Who runs the shop" />
      <PrimaryButton
        label="Save details" icon="check-circle-outline"
        // Editing cannot strip an area off a shop either — that would take a
        // shop already on a round and quietly retire it from every screen.
        disabled={name.trim().length === 0 || phone.trim().length === 0 || area.trim().length === 0}
        disabledReason={
          name.trim().length === 0 || phone.trim().length === 0
            ? 'Name and mobile first'
            : 'Pick the area first'
        }
        busy={isBusy('details')}
        onPress={() => run('details', () => {
          store.updateShop(shop.id, {
            name: name.trim(), phone: phone.trim(), area: area.trim(),
            // Empty string, not undefined: undefined is stripped before the
            // write, so clearing the owner's name silently kept the old one.
            ownerName: ownerName.trim(),
          });
          onClose();
        })}
      />

      <View style={styles.divider} />
      <Text style={styles.fieldLabel} numberOfLines={2}>
        Khata correction — owes Rs {shop.outstanding.toLocaleString()} now
      </Text>
      <OptionBar
        options={['down', 'up'] as const}
        value={khataDir}
        render={v => (v === 'down' ? 'Reduce (return/waiver)' : 'Increase (old debt)')}
        onChange={setKhataDir}
      />
      <TextInput style={[styles.input, styles.gapTop]} value={khataText}
        onChangeText={t => setKhataText(t.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad" placeholder="0" placeholderTextColor={color.textFaint} />
      {khataDelta > 0 && (
        <View style={styles.rowWrap}>
          {/* The khata moves by an atomic increment, so confirming twice took
              the correction off the balance twice. */}
          <Chip small selected label={`Apply ${khataDir === 'down' ? '−' : '+'}Rs ${khataDelta.toLocaleString()}`}
            onPress={isBusy('khata') ? undefined : () =>
              Alert.alert('Adjust the khata?',
                `${shop.name}: Rs ${shop.outstanding.toLocaleString()} → Rs ${(shop.outstanding + (khataDir === 'down' ? -khataDelta : khataDelta)).toLocaleString()}`,
                [
                  { text: 'Back', style: 'cancel' },
                  { text: 'Apply', onPress: () => run('khata', () => {
                      store.adjustShopBalance(shop.id, khataDir === 'down' ? -khataDelta : khataDelta,
                        khataDir === 'down' ? 'manual reduction' : 'manual increase');
                      setKhataText('');
                    }) },
                ])
            } />
        </View>
      )}

      {shop.outstanding > 0 && (
        <>
          <View style={styles.divider} />
          <Text style={styles.fieldLabel}>Payment made directly to you</Text>
          <OptionBar
            options={['transfer', 'cash'] as const}
            value={payMode}
            render={v => (v === 'transfer' ? 'Bank transfer' : 'Cash')}
            onChange={setPayMode}
          />
          <TextInput style={[styles.input, styles.gapTop]} value={payText}
            onChangeText={t => setPayText(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad" placeholder="0" placeholderTextColor={color.textFaint} />
          {payAmount > 0 && (
            <View style={styles.rowWrap}>
              {/* Clear the field FIRST: a second tap while the receipt serial
                  is still in flight would otherwise take the money twice. */}
              <Chip small selected
                label={recording ? 'Recording…' : `Record Rs ${payAmount.toLocaleString()} received`}
                onPress={recording ? undefined : async () => {
                  setRecording(true);
                  const amt = payAmount;
                  setPayText('');
                  try {
                    await Promise.resolve(store.collect({ shopId: shop.id, amount: amt, mode: payMode }));
                  } catch (e) {
                    Alert.alert('Not recorded', e instanceof Error ? e.message : String(e));
                    setPayText(String(amt));
                  } finally {
                    setRecording(false);
                  }
                }} />
            </View>
          )}
        </>
      )}

      {/* The people who sell for us at this counter, in the one place anyone
          would look for them. */}
      <CounterStaffSection shop={shop} />

      <View style={styles.divider} />
      <View style={styles.rowWrap}>
        <Chip small danger={shop.active}
          label={shop.active ? 'Deactivate shop' : 'Reactivate shop'}
          onPress={isBusy('active') ? undefined : () => run('active', () => {
            store.updateShop(shop.id, { active: !shop.active }); onClose();
          })} />
        <Chip small danger label="Delete shop"
          onPress={isBusy('delete') ? undefined : confirmDelete} />
        <Chip small label="Close" onPress={onClose} />
      </View>
    </Card>
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

/** A 34pt round action beside a row — big enough to hit, small enough to repeat. */
function RoundButton({ icon, tint, bg, onPress, disabled, label }: {
  icon: string; tint: string; bg: string; onPress: () => void;
  disabled?: boolean; label: string;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      // The button is 34 so the row can stay two lines tall; the hit area is
      // 46, which is what the thumb actually needs.
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.roundBtn,
        { backgroundColor: disabled ? color.surfaceAlt : bg, opacity: pressed ? 0.55 : 1 },
      ]}>
      <Icon name={icon} size={17} color={disabled ? color.textFaint : tint} />
    </Pressable>
  );
}

/**
 * One shop, one row.
 *
 * This list used to be a full card per shop — icon tile, two lines, and an
 * "Edit / khata / payment" chip parked underneath — about a fifth of the screen
 * each, so five shops filled the phone and the owner's twenty-two took five
 * scrolls to walk past.
 *
 * The bigger miss was that none of that height bought an ACTION. The one thing
 * an owner wants from a list of shops at his desk is to ring the shopkeeper,
 * and the number was printed as dead text. Now the number itself dials, there
 * is a call and a WhatsApp button on every row, and the row still opens the
 * full editor — which is where khata corrections and payments live.
 */
function ShopRow({ shop, staffCount, countryCode, onOpen, last }: {
  shop: Shop; staffCount: number; countryCode: string; onOpen: () => void; last?: boolean;
}) {
  const digits = digitsOnly(shop.phone);
  // Normalising for WhatsApp also gives the tidy local form to print:
  // "03001234567" reads as "0300-1234567".
  const intl = digits ? normalizeWhatsApp(shop.phone, countryCode) : '';

  const call = () => {
    if (!digits) return;
    void Linking.openURL(`tel:${digits}`).catch(() =>
      Alert.alert('Could not dial', `This phone would not open the dialler for ${shop.phone}.`));
  };

  /**
   * The app scheme first so an installed WhatsApp opens the chat straight
   * away — even for a number that was never saved as a contact — with the
   * wa.me link behind it for a phone that uses the browser hand-off.
   */
  const whatsapp = () => {
    if (!intl) return;
    void Linking.openURL(`whatsapp://send?phone=${intl}`).catch(() => {
      void Linking.openURL(`https://wa.me/${intl}`).catch(() =>
        Alert.alert('No WhatsApp', `This phone has no WhatsApp to message ${shop.phone} with.`));
    });
  };

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${shop.name} — edit, khata, payment`}
      style={({ pressed }) => [
        styles.row, !last && styles.rowDivider, pressed && styles.rowPressed,
      ]}>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowName} numberOfLines={1}>{shop.name}</Text>
          {shop.outstanding > 0 && (
            <Money amount={shop.outstanding} bold size={font.body} color={color.danger} />
          )}
        </View>
        {/* One line for everything that is not the name: the number (which
            dials), who runs the shop, and the two facts that need chasing —
            no map pin, or switched off. They were full-width tags before. */}
        <Text style={styles.rowMeta} numberOfLines={1}>
          {digits
            ? <Text style={styles.phoneLink} onPress={call}>{formatLocal(intl, countryCode)}</Text>
            : <Text style={styles.metaWarn}>no number</Text>}
          {shop.ownerName ? `  ·  ${shop.ownerName}` : ''}
          {staffCount > 0 ? `  ·  ${staffCount} counter staff` : ''}
          {!shop.location ? <Text style={styles.metaWarn}>{'  ·  no pin'}</Text> : ''}
          {!shop.active ? <Text style={styles.metaDanger}>{'  ·  inactive'}</Text> : ''}
        </Text>
      </View>
      <RoundButton
        icon="phone" tint={color.primary} bg={color.primarySoft}
        disabled={!digits} label={`Call ${shop.name}`} onPress={call} />
      <RoundButton
        icon="whatsapp" tint={color.success} bg={color.successSoft}
        disabled={!intl} label={`WhatsApp ${shop.name}`} onPress={whatsapp} />
    </Pressable>
  );
}

/** Area heading — pressable, because a hundred shops is a lot to scroll past. */
function AreaHeader({ title, count, owed, open, onToggle }: {
  title: string; count: number; owed: number; open: boolean; onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      style={styles.areaHead}>
      <Icon name={open ? 'chevron-down' : 'chevron-right'} size={16} color={color.textSub} />
      <Text style={styles.areaTitle} numberOfLines={1}>{title}</Text>
      <Text style={styles.areaCount} numberOfLines={1}>
        {count}{owed > 0 ? ` · Rs ${formatAmount(owed)}` : ''}
      </Text>
    </Pressable>
  );
}

/**
 * Rows for one area in a single card, with the editor opening IN PLACE.
 *
 * The card is split around the shop being edited rather than the editor being
 * pushed to the end of the group: the owner opened a specific line and the form
 * has to appear where that line was, or the list moves under him.
 */
function ShopGroup({ shops, editingId, staffCount, countryCode, onOpen, onClose }: {
  shops: Shop[]; editingId: string | null; staffCount: (id: string) => number;
  countryCode: string; onOpen: (id: string) => void; onClose: () => void;
}) {
  const row = (list: Shop[]) => (
    <Card style={styles.listCard}>
      {list.map((s, i) => (
        <ShopRow
          key={s.id} shop={s} staffCount={staffCount(s.id)} countryCode={countryCode}
          last={i === list.length - 1} onOpen={() => onOpen(s.id)} />
      ))}
    </Card>
  );

  const idx = shops.findIndex(s => s.id === editingId);
  if (idx < 0) return shops.length > 0 ? row(shops) : null;

  const before = shops.slice(0, idx);
  const after = shops.slice(idx + 1);
  return (
    <>
      {before.length > 0 && row(before)}
      <ShopEditor shop={shops[idx]} onClose={onClose} />
      {after.length > 0 && row(after)}
    </>
  );
}

/** A search box earns its place once the list is past a screenful. */
const SEARCH_FROM = 8;

export function ShopsScreen() {
  const store = useStore();
  const { isBusy, run } = useWriteGuard();
  const shops = store.shops;
  const countryCode = store.settings.countryCode;
  // Counter staff hang off the shop by shopId, so the row can say whether a
  // shop has anyone selling for us without opening it.
  const counterStaffCount = (shopId: string) =>
    store.rewardStaff.filter(r => r.active && r.shopId === shopId).length;

  const [query, setQuery] = React.useState('');
  const [closedAreas, setClosedAreas] = React.useState<Record<string, boolean>>({});

  const q = query.trim().toLowerCase();
  const qDigits = digitsOnly(query);
  // Four digits, because the tail of the number is what anyone remembers — and
  // fewer than that matches half the list and looks broken.
  const matches = (s: Shop) => !q
    || s.name.toLowerCase().includes(q)
    || s.area.toLowerCase().includes(q)
    || (s.ownerName ?? '').toLowerCase().includes(q)
    || (qDigits.length >= 4 && digitsOnly(s.phone).includes(qDigits));

  const found = React.useMemo(
    () => shops.filter(matches).sort((a, b) => a.name.localeCompare(b.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shops, q, qDigits],
  );
  // Firestore hands the shops over in document order, which is no order at
  // all — the areas are sorted here so the same area is in the same place
  // every time the screen opens. A shop with no area sinks to the bottom.
  const byArea = [...new Set(found.map(s => s.area))]
    .sort((a, b) => (a.trim() ? 0 : 1) - (b.trim() ? 0 : 1) || a.localeCompare(b));
  const owedTotal = shops.reduce((n, s) => n + s.outstanding, 0);

  // ---- add-shop form state ----
  const [adding, setAdding] = React.useState(false);
  const [showMore, setShowMore] = React.useState(false);
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [area, setArea] = React.useState('');
  const [ownerName, setOwnerName] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [openingText, setOpeningText] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);

  // Area is required. A shop without one is on no round and no map — see the
  // note on the booker's form; this is the same rule from the owner's side.
  const canSave = name.trim().length > 0 && phone.trim().length > 0 && area.trim().length > 0;
  const saveBlockedBy = name.trim().length === 0 || phone.trim().length === 0
    ? 'Name and mobile first'
    : 'Pick the area first';

  const reset = () => {
    setName(''); setPhone(''); setArea(''); setOwnerName(''); setAddress('');
    setOpeningText(''); setShowMore(false); setAdding(false);
  };

  // Without the guard a second tap made a duplicate shop — carrying a second
  // copy of the opening khata balance with it.
  const save = () => {
    run('add', () => {
      store.addShop({
        name: name.trim(),
        phone: phone.trim(),
        area: area.trim(),
        ownerName: ownerName.trim() ? ownerName.trim() : undefined,
        address: address.trim() ? address.trim() : undefined,
        // The paper khata comes along on day one (audit blocker).
        openingBalance: toRupees(openingText),
      });
      reset();
    });
  };

  return (
    <KeyboardScreen style={styles.screen} contentContainerStyle={styles.content}>
      {shops.length > 0 && (
        <Text style={styles.subLine}>
          {shops.length} shops
          {/* How far the map has got. The route can only ever visit pinned
              shops, so this number is the feature's real progress bar. */}
          {shops.some(s => !s.location)
            ? ` • ${shops.filter(s => s.location).length} of ${shops.length} pinned`
            : ' • all pinned'}
          {owedTotal > 0 ? ` • Rs ${formatAmount(owedTotal)} on the books` : ''}
        </Text>
      )}

      {!adding && (
        <View style={styles.ctaWrap}>
          <PrimaryButton label="Add shop" icon="plus" variant="cta" onPress={() => setAdding(true)} />
        </View>
      )}

      {adding && (
        <Card style={styles.tightCard}>
          <View style={styles.formHead}>
            <IconTile name="storefront-outline" size={34} />
            <Text style={styles.formTitle} numberOfLines={2}>New shop</Text>
          </View>

          <Field label="Shop name" value={name} onChange={setName}
            placeholder="e.g. Bismillah General Store" />
          <Field label="Mobile number" value={phone} onChange={setPhone}
            placeholder="03xx xxxxxxx" keyboardType="phone-pad" />

          {/* Area sits with name and mobile, not under "More". It became a
              required field, and a required field hidden behind a disclosure
              link is a form that refuses to save for a reason the person
              cannot see. */}
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Area</Text>
            <AreaSelect value={area} onChange={setArea} />
          </View>

          {!showMore && (
            <Pressable onPress={() => setShowMore(true)} style={styles.moreLink}>
              <Text style={styles.moreLinkText}>More — owner, address, old khata</Text>
            </Pressable>
          )}

          {showMore && (
            <View>
              <Field label="Owner's name" value={ownerName} onChange={setOwnerName}
                placeholder="Who runs the shop" />
              <Field label="Address" value={address} onChange={setAddress}
                placeholder="Street, landmark" />

              <Field label="Old khata balance (Rs) — what they already owe from the paper book"
                value={openingText} onChange={t => setOpeningText(t.replace(/[^0-9]/g, ''))}
                placeholder="0" keyboardType="phone-pad" />
            </View>
          )}

          <PrimaryButton
            label="Save shop"
            variant="cta"
            icon="check-circle-outline"
            disabled={!canSave}
            disabledReason={saveBlockedBy}
            busy={isBusy('add')}
            onPress={save}
          />
          <View style={styles.rowWrap}>
            <Chip small label="Cancel" onPress={reset} />
          </View>
        </Card>
      )}

      {shops.length === 0 && !adding && (
        <EmptyState
          icon="storefront-outline"
          title="Add your first shop"
          hint="Just the name and mobile number to start — details can come later."
        />
      )}

      {shops.length >= SEARCH_FROM && (
        <View style={styles.searchWrap}>
          <Icon name="magnify" size={17} color={color.textFaint} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Search name, owner, area or number"
            placeholderTextColor={color.textFaint}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
              <Icon name="close-circle" size={17} color={color.textFaint} />
            </Pressable>
          )}
        </View>
      )}

      {q.length > 0 && (
        <Text style={styles.subLine}>
          {found.length === 0
            ? 'No shop matches'
            : `${found.length} of ${shops.length} shops match`}
        </Text>
      )}

      {byArea.map(a => {
        const list = found.filter(s => s.area === a);
        const owed = list.reduce((n, s) => n + s.outstanding, 0);
        // A search is its own answer: collapsing is for walking a long list,
        // not for hiding the result someone just typed their way to.
        const open = q.length > 0 || !closedAreas[a];
        return (
          <View key={a || 'no-area'}>
            <AreaHeader
              title={a.trim() ? a : 'No area yet'}
              count={list.length}
              owed={owed}
              open={open}
              onToggle={() => setClosedAreas(prev => ({ ...prev, [a]: !prev[a] }))}
            />
            {open && (
              <ShopGroup
                shops={list}
                editingId={editingId}
                staffCount={counterStaffCount}
                countryCode={countryCode}
                onOpen={setEditingId}
                onClose={() => setEditingId(null)}
              />
            )}
          </View>
        );
      })}
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  // Extra bottom padding so the save button never ends up flush against the
  // top of the keyboard.
  content: { paddingTop: space.s, paddingBottom: space.xl + space.l },
  subLine: {
    fontSize: font.sub, color: color.textSub,
    marginHorizontal: space.gutter, marginBottom: space.xs,
  },
  ctaWrap: { paddingHorizontal: space.gutter },

  tightCard: { paddingVertical: space.xs },
  formHead: { flexDirection: 'row', alignItems: 'center', paddingTop: space.s, marginBottom: space.xs },
  formTitle: {
    flex: 1, minWidth: 0, fontSize: font.body, fontWeight: '600',
    color: color.text, marginLeft: space.m,
  },

  field: { paddingVertical: space.s },
  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginBottom: space.xs },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 40,
    fontSize: font.body, color: color.text,
  },

  // Tighter padding, but minHeight keeps the tap target at 40.
  moreLink: { paddingVertical: space.s, minHeight: 40, justifyContent: 'center', marginTop: space.xs },
  moreLinkText: { fontSize: font.body, fontWeight: '700', color: color.primary },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.xs, alignItems: 'center' },
  areaEmpty: { fontSize: font.sub, color: color.textSub, lineHeight: font.sub + 6, marginBottom: space.xs },

  // ---- search ----
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: space.s,
    marginHorizontal: space.gutter, marginTop: space.s,
    paddingHorizontal: space.m, height: 38,
    backgroundColor: color.surface, borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth, borderColor: color.cardEdge,
  },
  searchInput: { flex: 1, minWidth: 0, height: 38, fontSize: font.body, color: color.text, padding: 0 },

  // ---- area heading ----
  areaHead: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    marginHorizontal: space.gutter, marginTop: space.m, marginBottom: 3,
    minHeight: 26,
  },
  areaTitle: {
    flex: 1, minWidth: 0,
    fontSize: font.tiny + 1, fontWeight: '800', color: color.textSub,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  areaCount: { fontSize: font.tiny, fontWeight: '700', color: color.textFaint },

  // ---- the list itself ----
  // The card holds the group; each row carries its own padding, so the rows
  // sit on one hairline instead of every shop having its own card edge.
  listCard: { paddingVertical: 2, paddingHorizontal: space.m },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.s, minHeight: 46 },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  rowPressed: { opacity: 0.6 },
  rowBody: { flex: 1, minWidth: 0, marginRight: space.s },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  rowName: { flex: 1, minWidth: 0, fontSize: font.body + 1, fontWeight: '700', color: color.text },
  rowMeta: { fontSize: font.sub, color: color.textSub, marginTop: 1 },
  // Blue and underlined because it is the one word on the row that does
  // something when you touch it.
  phoneLink: { color: color.primary, fontWeight: '700', textDecorationLine: 'underline' },
  metaWarn: { color: color.warn, fontWeight: '700' },
  metaDanger: { color: color.danger, fontWeight: '700' },
  roundBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center', marginLeft: space.s,
  },
  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.s, alignItems: 'center', gap: space.xs },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border,
    marginTop: space.s, marginBottom: space.s,
  },
  gapTop: { marginTop: space.s },
});
