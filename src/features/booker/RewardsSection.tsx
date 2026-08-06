/**
 * Rewards (FR-16) — the booker's side, lives inside My Day.
 *
 * Register a shop's counter person once; then a claim is: pick the person,
 * count the pieces, take the receipt photo, shelf count, done. The claim
 * waits for the owner (FR-16.5 — the booker can never approve himself) and
 * an approved claim is paid from the booker's cash float.
 */
import React from 'react';
import { Alert, Image, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Card, Chip, EmptyState, IconTile, ListRow, Money, PrimaryButton, SectionLabel, Tag,
  color, font, radius, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import { capturePhotoBase64 } from '../../lib/photos';
import { strings } from '../../i18n/strings';

function toInt(text: string): number {
  const n = Number.parseInt(text.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

const PIECE_CHIPS = [6, 12, 24];

export function RewardsSection() {
  const store = useStore();

  // ---- register form ----
  const [registering, setRegistering] = React.useState(false);
  const [name, setName] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [shopId, setShopId] = React.useState<string | null>(null);

  // ---- claim form ----
  const [claimStaffId, setClaimStaffId] = React.useState<string | null>(null);
  const [piecesText, setPiecesText] = React.useState('');
  const [shelfText, setShelfText] = React.useState('');
  const [photo, setPhoto] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // A booker's float listener only carries his own rows, so the sum IS his balance.
  const float = store.floatMovements
    .reduce((s, f) => s + (f.kind === 'issue' ? f.amount : -f.amount), 0);
  const perPiece = store.settings.rewardPerPiece;
  const pieces = toInt(piecesText);
  const amount = pieces * perPiece;
  const claimStaff = claimStaffId ? store.rewardStaff.find(r => r.id === claimStaffId) : null;
  const canRegister = name.trim().length > 0 && phone.trim().length >= 7 && !!shopId;
  const canClaim = pieces > 0 && shelfText !== '' && !!photo;

  const resetClaim = () => {
    setClaimStaffId(null); setPiecesText(''); setShelfText(''); setPhoto(null); setBusy(false);
  };

  const submit = async () => {
    if (!claimStaff || !photo) return;
    setBusy(true);
    try {
      const r = await store.submitRewardClaim({
        staffId: claimStaff.id, pieces, shelfCount: toInt(shelfText), photoBase64: photo,
      });
      Alert.alert('Claim sent', `${r.claimNo} — Rs ${amount.toLocaleString()} waits for the owner.`);
      resetClaim();
    } catch (e) {
      Alert.alert(
        'Claim not sent',
        `The receipt photo could not be uploaded — you need signal for a claim.\n\n${e instanceof Error ? e.message : String(e)}`,
      );
      setBusy(false);
    }
  };

  return (
    <>
      <SectionLabel>{strings.rewards.section}</SectionLabel>

      <Card>
        <ListRow
          icon="wallet-outline"
          title="My reward float"
          sub={`Rs ${perPiece} per piece • approved claims are paid from this`}
          right={<Money amount={float} bold color={float > 0 ? color.success : undefined} />}
        />
      </Card>

      {/* ---- new claim ---- */}
      {claimStaff ? (
        <Card style={styles.tightCard}>
          <View style={styles.formHead}>
            <IconTile name="gift-outline" size={34} />
            <Text style={styles.formTitle}>{claimStaff.name} — {store.shops.find(s => s.id === claimStaff.shopId)?.name ?? ''}</Text>
          </View>

          <Text style={styles.fieldLabel}>Pieces he sold (check the receipts)</Text>
          <TextInput
            style={styles.input}
            value={piecesText}
            onChangeText={t => setPiecesText(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={color.textFaint}
          />
          <View style={styles.rowWrap}>
            {PIECE_CHIPS.map(q => (
              <Chip key={q} small label={`${q}`} selected={pieces === q}
                onPress={() => setPiecesText(String(q))} />
            ))}
          </View>
          {pieces > 0 && (
            <View style={styles.amountRow}>
              <Text style={styles.meta}>{pieces} × Rs {perPiece}</Text>
              <Money amount={amount} bold color={amount > store.settings.rewardApprovalLimit ? color.warn : undefined} />
            </View>
          )}
          {amount > store.settings.rewardApprovalLimit && (
            <Text style={styles.overLimit}>Over the Rs {store.settings.rewardApprovalLimit.toLocaleString()} limit — the owner will look closely.</Text>
          )}

          <Text style={styles.fieldLabel}>Shelf count (pieces on the shelf right now)</Text>
          <TextInput
            style={styles.input}
            value={shelfText}
            onChangeText={t => setShelfText(t.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={color.textFaint}
          />

          <Text style={styles.fieldLabel}>Receipt photo — required</Text>
          {photo ? (
            <View style={styles.photoRow}>
              <Image source={{ uri: `data:image/jpeg;base64,${photo}` }} style={styles.photoThumb} />
              <Chip small label="Retake" onPress={() => setPhoto(null)} />
            </View>
          ) : (
            <View style={styles.rowWrap}>
              <Chip
                small
                selected
                label="Take the photo"
                onPress={async () => {
                  try {
                    const b64 = await capturePhotoBase64();
                    if (b64) setPhoto(b64);
                  } catch (e) {
                    Alert.alert('Camera', e instanceof Error ? e.message : String(e));
                  }
                }}
              />
            </View>
          )}

          <PrimaryButton
            variant="cta"
            icon="check-circle-outline"
            label={busy ? 'Sending…' : `Claim Rs ${amount.toLocaleString()}`}
            disabled={!canClaim || busy}
            disabledReason={busy ? 'Sending…' : 'Pieces, shelf count and the photo first'}
            onPress={() => { void submit(); }}
          />
          <View style={styles.rowWrap}>
            <Chip small label="Cancel" onPress={resetClaim} />
          </View>
        </Card>
      ) : (
        <>
          {store.rewardStaff.filter(r => r.active).map(r => (
            <Card key={r.id}>
              <ListRow
                icon="account-star-outline"
                title={r.name}
                sub={store.shops.find(s => s.id === r.shopId)?.name ?? ''}
                right={<Chip small selected label="New claim" onPress={() => setClaimStaffId(r.id)} />}
              />
            </Card>
          ))}
          {store.rewardStaff.filter(r => r.active).length === 0 && !registering && (
            <EmptyState
              icon="account-star-outline"
              title="No counter staff yet"
              hint="Register a shop's counter person to start the per-piece reward."
            />
          )}
        </>
      )}

      {/* ---- register counter staff ---- */}
      {!claimStaff && !registering && (
        <View style={styles.ctaWrap}>
          <PrimaryButton icon="account-plus-outline" variant="quiet" label="Register counter staff"
            onPress={() => setRegistering(true)} />
        </View>
      )}
      {!claimStaff && registering && (
        <Card style={styles.tightCard}>
          <View style={styles.formHead}>
            <IconTile name="account-plus-outline" size={34} />
            <Text style={styles.formTitle}>New counter person</Text>
          </View>
          <Text style={styles.fieldLabel}>Name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName}
            placeholder="Their name" placeholderTextColor={color.textFaint} />
          <Text style={styles.fieldLabel}>Phone</Text>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone}
            placeholder="03xx xxxxxxx" placeholderTextColor={color.textFaint} keyboardType="phone-pad" />
          <Text style={styles.fieldLabel}>Which shop does he work at?</Text>
          <View style={styles.rowWrap}>
            {store.shops.filter(s => s.active).map(s => (
              <Chip key={s.id} small label={s.name} selected={shopId === s.id}
                onPress={() => setShopId(s.id)} />
            ))}
          </View>
          <PrimaryButton
            icon="check"
            label="Register"
            disabled={!canRegister}
            disabledReason="Name, phone and shop first"
            onPress={() => {
              store.addRewardStaff({ name: name.trim(), phone: phone.trim(), shopId: shopId! });
              setName(''); setPhone(''); setShopId(null); setRegistering(false);
            }}
          />
          <View style={styles.rowWrap}>
            <Chip small label="Cancel" onPress={() => setRegistering(false)} />
          </View>
        </Card>
      )}

      {/* ---- my claims ---- */}
      {store.rewardClaims.length > 0 && (
        <>
          <SectionLabel>My claims</SectionLabel>
          {[...store.rewardClaims].sort((a, b) => b.createdAt - a.createdAt).map(c => (
            <Card key={c.id}>
              <View style={styles.rowBetween}>
                <Text style={styles.claimTitle}>{c.staffName} • {c.pieces} pcs</Text>
                <Money amount={c.amount} bold />
              </View>
              <View style={styles.metaRow}>
                <Tag
                  label={c.status.toUpperCase()}
                  tone={c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'warn'}
                />
                <Text style={styles.meta}>{c.claimNo} • {c.shopName}</Text>
              </View>
            </Card>
          ))}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  tightCard: { paddingVertical: space.xs },
  formHead: { flexDirection: 'row', alignItems: 'center', paddingTop: space.s, marginBottom: space.xs },
  formTitle: { fontSize: font.body, fontWeight: '600', color: color.text, marginLeft: 10, flexShrink: 1 },

  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginTop: space.m, marginBottom: 6 },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 46,
    fontSize: font.body, color: color.text,
  },

  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: space.s },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s },
  meta: { fontSize: font.sub, color: color.textSub },
  claimTitle: { fontSize: font.h2 - 1, fontWeight: '700', color: color.text },

  amountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.s },
  overLimit: { fontSize: font.sub, fontWeight: '600', color: color.warn, marginTop: space.xs },

  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.m, marginTop: space.xs },
  photoThumb: { width: 84, height: 84, borderRadius: radius.tile, backgroundColor: color.surfaceAlt },

  ctaWrap: { paddingHorizontal: space.l, marginTop: space.s },
});
