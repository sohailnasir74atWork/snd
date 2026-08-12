/**
 * Khata visit (FR-7.4) — money collected from a shop with no delivery today.
 * Pick the shop that owes, type what you took, say how it came in. The only
 * other way money enters the app is a delivery close-out.
 */
import React from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import {
  Card, Chip, EmptyState, Icon, IconTile, Money, OptionBar, PrimaryButton, ProvisionalNote, SectionLabel, Tag, Text, TextInput, color, font, radius, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import type { CollectionInput } from '../../data/store';
import type { Payment, Shop } from '../../data/models';
import { formatAmount } from '../../lib/money';
import { isProvisional } from '../../lib/serials';
import { receiptHtml } from '../../documents/templates';
import { sharePdf } from '../../documents/share';
import { documentLogo } from '../../lib/logoCache';

type Mode = CollectionInput['mode'];

const MODE_LABEL: Record<Mode, string> = {
  cash: 'Cash',
  transfer: 'Bank transfer',
  cheque: 'Cheque',
};

const TOP_UPS = [500, 1000, 2000, 5000] as const;

/** Icon-led block inside a Card — the Settings RuleRow idiom. */
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

/** Digits only — money is always an integer number of rupees. */
function toRupees(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return 0;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : 0;
}

export function CollectScreen() {
  const store = useStore();
  const [shopId, setShopId] = React.useState<string | null>(null);
  const [amountText, setAmountText] = React.useState('');
  const [mode, setMode] = React.useState<Mode>('cash');
  const [busy, setBusy] = React.useState(false);
  const [sharing, setSharing] = React.useState(false);
  const [done, setDone] = React.useState<{
    receiptNo: string; amount: number; shopId: string; shopName: string;
    mode: Mode; newOutstanding: number;
  } | null>(null);

  const shop = shopId ? store.shops.find(s => s.id === shopId) ?? null : null;

  // FR-2.x: this whole tab runs on shop balances — hidden means hidden.
  if (!store.settings.visibility.riderSeesOldBalance) {
    return (
      <View style={styles.screen}>
        <EmptyState
          icon="eye-off-outline"
          title="Collections are handled by the owner"
          hint="Balances are switched off for riders. You still take payment at each delivery."
        />
      </View>
    );
  }

  const reset = () => {
    setShopId(null);
    setAmountText('');
    setMode('cash');
    setDone(null);
    setBusy(false);
  };

  // ---------- after a successful collection ----------
  if (done) {
    const sendReceipt = async () => {
      // Building the PDF and opening the share sheet both take a beat — a
      // second tap stacked two share sheets on top of each other.
      if (sharing) return;
      setSharing(true);
      try {
        const payment: Payment = {
          id: done.receiptNo, receiptNo: done.receiptNo, shopId: done.shopId,
          orderIds: [], amount: done.amount, mode: done.mode,
          collectedBy: 'rider', confirmed: false, createdAt: Date.now(),
        };
        const html = receiptHtml({
          settings: store.settings, payment, shopName: done.shopName,
          allocations: [], newOutstanding: done.newOutstanding,
          logo: await documentLogo(store.settings.logoUrl),
        });
        await sharePdf(
          html, done.receiptNo,
          `Receipt ${done.receiptNo} — Rs ${done.amount.toLocaleString()} received. Balance Rs ${done.newOutstanding.toLocaleString()}.`,
          // Read off the store rather than frozen into `done`: the number is
          // whatever the shop's record says at the moment of sending.
          {
            phone: store.shops.find(s => s.id === done.shopId)?.phone,
            countryCode: store.settings.countryCode,
          },
        );
      } catch (e) {
        Alert.alert('Could not share', e instanceof Error ? e.message : String(e));
      } finally {
        setSharing(false);
      }
    };
    return (
      <View style={[styles.screen, styles.centerPad]}>
        <Icon name="check-circle" size={72} color={color.success} />
        <Text style={styles.doneTitle}>Money taken</Text>
        <Text style={styles.receiptNo}>Receipt {done.receiptNo}</Text>
        {isProvisional(done.receiptNo) && <ProvisionalNote />}
        <Money amount={done.amount} size={font.h1} bold color={color.success} />
        <Text style={styles.hint}>It is counted as cash with you until the owner confirms the handover.</Text>
        <View style={styles.doneButtons}>
          <PrimaryButton icon="whatsapp" label={`Send receipt to ${done.shopName}`}
            busy={sharing} busyLabel="Preparing…"
            onPress={() => { void sendReceipt(); }} />
          <PrimaryButton label="Collect from another shop" variant="quiet" onPress={reset} />
          <PrimaryButton label="Done" variant="quiet" onPress={reset} />
        </View>
      </View>
    );
  }

  // ---------- pick a shop ----------
  if (!shop) {
    const owing = store.shops
      .filter(s => s.outstanding > 0)
      .sort((a: Shop, b: Shop) => {
        const flagged = Number(!!b.collectionFlagged) - Number(!!a.collectionFlagged);
        return flagged !== 0 ? flagged : b.outstanding - a.outstanding;
      });

    return (
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.subLine}>Collect money from a shop — no delivery needed</Text>

        {owing.length === 0 ? (
          <EmptyState
            icon="check-circle-outline"
            title="Nobody owes you money"
            hint="Shops with credit will appear here."
          />
        ) : (
          <>
            <SectionLabel>Shops that owe</SectionLabel>
            {owing.map(s => (
              <Card key={s.id} onPress={() => setShopId(s.id)}>
                <View style={styles.shopRow}>
                  <IconTile name="storefront-outline" tint={color.danger} bg={color.dangerSoft} size={40} />
                  <View style={styles.shopText}>
                    <Text style={styles.shopName} numberOfLines={2}>{s.name}</Text>
                    <Text style={styles.meta} numberOfLines={2}>{s.ownerName ? `${s.area} • ${s.ownerName}` : s.area}</Text>
                    {s.collectionFlagged ? (
                      <View style={styles.tagWrap}><Tag label="FLAGGED" tone="warn" /></View>
                    ) : null}
                  </View>
                  <View style={styles.valueRight}>
                    <Money amount={s.outstanding} bold color={color.danger} />
                  </View>
                </View>
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    );
  }

  // ---------- take the money ----------
  const outstanding = shop.outstanding;
  const amount = Math.min(toRupees(amountText), outstanding);
  const remaining = outstanding - amount;
  const modes: readonly Mode[] = store.settings.acceptCheques
    ? ['cash', 'transfer', 'cheque']
    : ['cash', 'transfer'];
  const activeMode: Mode = modes.includes(mode) ? mode : 'cash';

  const setAmount = (n: number) => setAmountText(String(Math.max(0, Math.min(n, outstanding))));

  const takeMoney = async () => {
    // The receipt number needs a server round-trip, so the button sat live
    // while the write was flying — a second tap banked the same cash twice
    // and handed the shop two receipts for one payment.
    if (busy) return;
    setBusy(true);
    try {
      const r = await Promise.resolve(
        store.collect({ shopId: shop.id, amount, mode: activeMode }),
      );
      setDone({
        receiptNo: r.receiptNo, amount, shopId: shop.id, shopName: shop.name,
        mode: activeMode, newOutstanding: Math.max(0, outstanding - amount),
      });
    } catch (e) {
      Alert.alert('Not recorded', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.subLine}>Collect money from a shop — no delivery needed</Text>

        <Card>
          <View style={styles.shopRow}>
            <IconTile name="storefront-outline" tint={color.danger} bg={color.dangerSoft} size={40} />
            <View style={styles.shopText}>
              <Text style={styles.shopName} numberOfLines={2}>{shop.name}</Text>
              <Text style={styles.meta} numberOfLines={2}>{shop.ownerName ? `${shop.area} • ${shop.ownerName}` : shop.area}</Text>
            </View>
            <View style={styles.owesBox}>
              <Text style={styles.owesLabel}>Owes</Text>
              <Money amount={outstanding} bold color={color.danger} />
            </View>
          </View>
        </Card>

        <SectionLabel>The collection</SectionLabel>
        <Card style={styles.tightCard}>
          <RuleRow icon="cash" label="How much are you taking?">
            <TextInput
              style={styles.input}
              value={amountText}
              onChangeText={t => setAmountText(t.replace(/[^0-9]/g, ''))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={color.textFaint}
            />
            <View style={styles.chipRow}>
              <Chip label={`All Rs ${formatAmount(outstanding)}`} onPress={() => setAmount(outstanding)} />
              {TOP_UPS.filter(v => v <= outstanding).map(v => (
                <Chip key={v} small label={`+${formatAmount(v)}`} onPress={() => setAmount(amount + v)} />
              ))}
            </View>
          </RuleRow>

          <RuleRow icon="account-cash-outline" label="How did the money come in?" last>
            <OptionBar
              options={modes}
              value={activeMode}
              render={m => MODE_LABEL[m]}
              onChange={setMode}
            />
          </RuleRow>
        </Card>

        <Card>
          <View style={styles.rowBetween}>
            <Text style={[styles.afterLabel, styles.flexLabel]} numberOfLines={2}>After this, shop owes</Text>
            <View style={styles.valueRight}>
              <Money amount={remaining} bold color={remaining > 0 ? color.danger : color.success} />
            </View>
          </View>
        </Card>

        <View style={styles.ctaWrap}>
          <PrimaryButton
            label={`Take Rs ${formatAmount(amount)}`}
            icon="cash-multiple"
            busy={busy}
            disabled={amount <= 0}
            disabledReason="Enter an amount"
            onPress={() => { void takeMoney(); }}
          />
          <PrimaryButton label="Choose a different shop" variant="quiet" onPress={reset} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  // Owns the height the ScrollView shrinks into when the keyboard is up.
  fill: { flex: 1 },
  screen: { flex: 1, backgroundColor: color.bg },
  // Deep enough that the CTA under the amount field still clears the keyboard.
  content: { paddingTop: space.s, paddingBottom: space.xl * 3 },
  centerPad: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  subLine: {
    fontSize: font.sub, color: color.textSub,
    marginHorizontal: space.gutter, marginTop: space.xs, marginBottom: space.xs,
  },
  tightCard: { paddingVertical: space.xs },

  shopRow: { flexDirection: 'row', alignItems: 'center' },
  // minWidth 0 is what lets a long shop name wrap instead of shoving the
  // amount (and the FLAGGED tag's row) off the right edge.
  shopText: { flex: 1, minWidth: 0, marginLeft: space.m },
  shopName: { fontSize: font.h2, fontWeight: '700', color: color.text },
  meta: { fontSize: font.sub, color: color.textSub, marginTop: 1 },
  tagWrap: { marginTop: space.xs, alignSelf: 'flex-start' },
  owesBox: { flexShrink: 0, marginLeft: space.s, alignItems: 'flex-end' },
  owesLabel: { fontSize: font.tiny, fontWeight: '700', color: color.textSub, marginBottom: 2 },

  ruleRow: { paddingVertical: space.s + 2 },
  ruleDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  ruleHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.s },
  ruleLabel: { fontSize: font.body, fontWeight: '600', color: color.text, marginLeft: space.m },

  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 40,
    fontSize: font.body, color: color.text,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: space.s },

  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  afterLabel: { fontSize: font.body, fontWeight: '600', color: color.textSub },
  // Label takes the slack, the money column keeps its natural width.
  flexLabel: { flex: 1, minWidth: 0 },
  valueRight: { flexShrink: 0, marginLeft: space.s, alignItems: 'flex-end' },

  ctaWrap: { marginHorizontal: space.gutter, marginVertical: space.s },

  doneTitle: { fontSize: font.h1, fontWeight: '800', color: color.text, marginTop: space.s },
  receiptNo: { fontSize: font.h2, fontWeight: '700', color: color.textSub, marginVertical: space.xs },
  hint: { fontSize: font.sub, color: color.textSub, marginTop: space.s, textAlign: 'center', lineHeight: 18 },
  doneButtons: { alignSelf: 'stretch', marginTop: space.m },
});
