/**
 * Rewards (FR-16) — the booker's side, lives inside My Day.
 *
 * Register a shop's counter person once; then a claim is: pick the person,
 * count the pieces, take the receipt photo, shelf count, done. The claim
 * waits for the owner (FR-16.5 — the booker can never approve himself) and
 * an approved claim is paid from the booker's cash float.
 */
import React from 'react';
import { Alert, Image, StyleSheet, View } from 'react-native';
import {
  Card, Chip, EmptyState, IconTile, ListRow, Money, PrimaryButton, SectionLabel, Tag, Text, TextInput, color, font, radius, space,
} from '../../components/ui';
import { useNeed, useStore } from '../../data/store';
import { capturePhotoBase64 } from '../../lib/photos';
import { strings } from '../../i18n/strings';

function toInt(text: string): number {
  const n = Number.parseInt(text.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

const PIECE_CHIPS = [6, 12, 24];

export function RewardsSection() {
  const store = useStore();
  useNeed('floatMovements');

  // ---- claim form ----
  const [claimStaffId, setClaimStaffId] = React.useState<string | null>(null);
  const [piecesText, setPiecesText] = React.useState('');
  const [shelfText, setShelfText] = React.useState('');
  const [photo, setPhoto] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  // A booker's float listener only carries his own rows, so the sum IS his balance.
  const float = store.floatMovements
    .reduce((s, f) => s + (f.kind === 'issue' ? f.amount : -f.amount), 0);
  const perPiece = store.settings.rewardPerPiece;
  const pieces = toInt(piecesText);
  const amount = pieces * perPiece;
  const claimStaff = claimStaffId ? store.rewardStaff.find(r => r.id === claimStaffId) : null;
  const canClaim = pieces > 0 && shelfText !== '' && !!photo;

  const resetClaim = () => {
    setClaimStaffId(null); setPiecesText(''); setShelfText(''); setPhoto(null); setBusy(false);
  };

  const submit = async () => {
    // The photo upload plus the claim write take seconds on market signal — a
    // second tap here sent the same reward money twice.
    if (!claimStaff || !photo || busy) return;
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
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    // The camera takes a moment to open; a second tap launched it twice.
    if (photoBusy) return;
    setPhotoBusy(true);
    try {
      const b64 = await capturePhotoBase64();
      if (b64) setPhoto(b64);
    } catch (e) {
      Alert.alert('Camera', e instanceof Error ? e.message : String(e));
    } finally {
      setPhotoBusy(false);
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
            {/* Two names joined by a dash — the longest string on the card. */}
            <Text style={styles.formTitle} numberOfLines={2}>{claimStaff.name} — {store.shops.find(s => s.id === claimStaff.shopId)?.name ?? ''}</Text>
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
              <Text style={[styles.meta, styles.flexLabel]} numberOfLines={2}>{pieces} × Rs {perPiece}</Text>
              <View style={styles.valueRight}>
                <Money amount={amount} bold color={amount > store.settings.rewardApprovalLimit ? color.warn : undefined} />
              </View>
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
                onPress={photoBusy ? undefined : () => { void takePhoto(); }}
              />
            </View>
          )}

          <PrimaryButton
            variant="cta"
            icon="check-circle-outline"
            label={`Claim Rs ${amount.toLocaleString()}`}
            busy={busy}
            busyLabel="Sending…"
            disabled={!canClaim}
            disabledReason="Pieces, shelf count and the photo first"
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
          {store.rewardStaff.filter(r => r.active).length === 0 && (
            <EmptyState
              icon="account-star-outline"
              title="No counter staff yet"
              hint="Add one on the shop itself — Route, then Edit details. They are part of the shop, not of your day."
            />
          )}
        </>
      )}

      {/*
        There is no "Register counter staff" button here any more.

        A counter person belongs to a SHOP — `shop.counterStaff` — and this tab
        is My Day, a list of what the booker has booked. Registering one from
        here meant a form whose third field was "which shop does he work at?",
        answered from a chip row of the whole territory, by someone who was
        standing in the shop at the time. It is done on the shop now: on the
        Add-shop form when he is registering the counter, and behind
        `Edit details` on Route any time after.
      */}
      {/* ---- my claims ---- */}
      {store.rewardClaims.length > 0 && (
        <>
          <SectionLabel>My claims</SectionLabel>
          {[...store.rewardClaims].sort((a, b) => b.createdAt - a.createdAt).map(c => (
            <Card key={c.id}>
              <View style={styles.rowBetween}>
                <Text style={[styles.claimTitle, styles.flexLabel]} numberOfLines={2}>{c.staffName} • {c.pieces} pcs</Text>
                <View style={styles.valueRight}>
                  <Money amount={c.amount} bold />
                </View>
              </View>
              <View style={styles.metaRow}>
                <Tag
                  label={c.status.toUpperCase()}
                  tone={c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'warn'}
                />
                {/* Claim no + shop name sat beside the status Tag and was
                    running off the card — it takes the slack now. */}
                <Text style={[styles.meta, styles.flexLabel]} numberOfLines={2}>{c.claimNo} • {c.shopName}</Text>
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
  formTitle: { fontSize: font.body, fontWeight: '600', color: color.text, marginLeft: space.m, flex: 1, minWidth: 0 },

  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginTop: space.s + 2, marginBottom: space.s },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 40,
    fontSize: font.body, color: color.text,
  },

  rowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: space.s },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.s },
  meta: { fontSize: font.sub, color: color.textSub },
  claimTitle: { fontSize: font.body, fontWeight: '700', color: color.text },

  // Flexible label beside a fixed value or Tag: the label wraps, the number
  // keeps its width so money never breaks mid-figure.
  flexLabel: { flex: 1, minWidth: 0 },
  valueRight: { flexShrink: 0, marginLeft: space.s, alignItems: 'flex-end' },

  amountRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: space.s },
  overLimit: { fontSize: font.sub, fontWeight: '600', color: color.warn, marginTop: space.xs },

  photoRow: { flexDirection: 'row', alignItems: 'center', gap: space.s, marginTop: space.xs },
  photoThumb: { width: 72, height: 72, borderRadius: radius.tile, backgroundColor: color.surfaceAlt },

  ctaWrap: { paddingHorizontal: space.gutter, marginTop: space.s },
});
