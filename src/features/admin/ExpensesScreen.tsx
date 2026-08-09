/**
 * Expenses — owner-only money screen (SRS FR-17.1 / FR-17.2).
 * One-off expenses with a petrol double-count guard, plus fixed monthly charges.
 */
import React from 'react';
import { Alert, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import {
  Card, Chip, EmptyState, Icon, IconTile, ListRow, Money, OptionBar, PrimaryButton,
  SectionLabel, Tag, Tile,
  color, font, radius, space,
} from '../../components/ui';
import { KeyboardScreen, useWriteGuard } from './AdminScreens';
import { useStore } from '../../data/store';
import type { Expense } from '../../data/models';

const CATEGORIES: { key: Expense['category']; label: string }[] = [
  { key: 'petrol', label: 'Petrol' },
  { key: 'samples', label: 'Samples' },
  { key: 'repairs', label: 'Repairs' },
  { key: 'transport', label: 'Transport' },
  { key: 'other', label: 'Other' },
];

const CATEGORY_KEYS = CATEGORIES.map(c => c.key);

const CATEGORY_ICONS: Record<Expense['category'], string> = {
  petrol: 'gas-station',
  samples: 'bottle-tonic-plus-outline',
  repairs: 'wrench-outline',
  transport: 'truck-outline',
  other: 'receipt',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function toRupees(text: string): number {
  const n = parseInt(text.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function categoryLabel(key: Expense['category']): string {
  return CATEGORIES.find(c => c.key === key)?.label ?? key;
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function ExpensesScreen() {
  const store = useStore();
  const { isBusy, run } = useWriteGuard();

  // ---- one-off expense form ----
  const [amountText, setAmountText] = React.useState('');
  const [category, setCategory] = React.useState<Expense['category']>('petrol');
  const [showNote, setShowNote] = React.useState(false);
  const [note, setNote] = React.useState('');
  // FR-17.2 double-count guard: first Save tap arms, second tap saves.
  const [petrolArmed, setPetrolArmed] = React.useState(false);

  // ---- fixed charge form ----
  const [chargeLabel, setChargeLabel] = React.useState('');
  const [chargeAmountText, setChargeAmountText] = React.useState('');

  const amount = toRupees(amountText);
  const chargeAmount = toRupees(chargeAmountText);

  const now = new Date();
  const monthExpenses = store.expenses
    .filter(e => {
      const d = new Date(e.date);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    })
    .sort((a, b) => b.date - a.date);
  const monthTotal = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const fixedTotal = store.fixedCharges.filter(c => c.active).reduce((s, c) => s + c.amount, 0);

  const petrolIsFixed = store.fixedCharges.some(
    c => c.active && c.label.toLowerCase().includes('petrol'),
  );
  const petrolWarning = category === 'petrol' && petrolIsFixed;

  const saveExpense = () => {
    if (amount <= 0) return;
    if (petrolWarning && !petrolArmed) {
      setPetrolArmed(true); // first tap only arms — second tap saves
      return;
    }
    // Guarded only around the write, so the arm/confirm pair above still needs
    // its two taps; what this stops is the same expense being logged twice.
    run('expense', () => {
      store.addExpense({
        amount,
        category,
        note: note.trim() ? note.trim() : undefined,
        date: Date.now(),
      });
      setAmountText('');
      setNote('');
      setShowNote(false);
      setPetrolArmed(false);
    });
  };

  const pickCategory = (key: Expense['category']) => {
    setCategory(key);
    setPetrolArmed(false);
  };

  const saveFixedCharge = () => {
    if (!chargeLabel.trim() || chargeAmount <= 0) return;
    // A duplicate here bills the same rent or salary every month, twice.
    run('charge', () => {
      store.addFixedCharge({ label: chargeLabel.trim(), amount: chargeAmount, active: true });
      setChargeLabel('');
      setChargeAmountText('');
    });
  };

  const salaryPeople = store.employees.filter(e => e.role !== 'admin');

  return (
    <KeyboardScreen style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.subLine}>Log spending as it happens — fixed charges count themselves every month</Text>

      <View style={styles.tiles}>
        <Tile
          label="Spent this month"
          value={`Rs ${monthTotal.toLocaleString()}`}
          icon="receipt"
        />
        <Tile
          label="Fixed charges every month"
          value={`Rs ${fixedTotal.toLocaleString()}`}
          icon="calendar-refresh"
          accent={fixedTotal > 0 ? color.warn : color.success}
        />
      </View>

      <SectionLabel>This month's expenses</SectionLabel>
      <Card>
        <View style={styles.cardHead}>
          <IconTile name="receipt" size={34} />
          <Text style={styles.cardHeadLabel} numberOfLines={2}>Add an expense</Text>
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>How much did you spend?</Text>
          <TextInput
            style={styles.input}
            value={amountText}
            onChangeText={t => { setAmountText(t); setPetrolArmed(false); }}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={color.textFaint}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>What was it for?</Text>
          <View style={styles.optionStack}>
            <OptionBar
              options={CATEGORY_KEYS.slice(0, 3)}
              value={category}
              render={categoryLabel}
              onChange={pickCategory}
            />
            <OptionBar
              options={CATEGORY_KEYS.slice(3)}
              value={category}
              render={categoryLabel}
              onChange={pickCategory}
            />
          </View>
        </View>
        {showNote ? (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Note</Text>
            <TextInput
              style={styles.input}
              value={note}
              onChangeText={setNote}
              placeholder="Note (optional)"
              placeholderTextColor={color.textFaint}
            />
          </View>
        ) : (
          <Pressable onPress={() => setShowNote(true)} style={styles.noteLink}>
            <Icon name="plus" size={16} color={color.primary} />
            <Text style={styles.noteLinkText}>Add a note</Text>
          </Pressable>
        )}
        {petrolWarning && (
          <Card style={styles.warnCard}>
            <View style={styles.warnRow}>
              <Icon name="alert-outline" size={18} color={color.warn} />
              <Text style={styles.warnText}>
                Petrol is already a monthly fixed charge — add this as well?
              </Text>
            </View>
          </Card>
        )}
        <PrimaryButton
          label={petrolWarning && petrolArmed ? 'Yes — add it as well' : 'Save expense'}
          icon="plus"
          onPress={saveExpense}
          disabled={amount <= 0}
          disabledReason="Amount first"
          busy={isBusy('expense')}
        />
      </Card>

      {monthExpenses.length === 0 ? (
        <EmptyState
          icon="receipt"
          title="Nothing spent this month yet"
          hint="Add your first expense above."
        />
      ) : (
        monthExpenses.map(e => (
          <Card key={e.id}>
            <ListRow
              icon={CATEGORY_ICONS[e.category]}
              title={categoryLabel(e.category)}
              sub={e.note ? `${e.note} — ${dayLabel(e.date)}` : dayLabel(e.date)}
              right={<Money amount={e.amount} size={font.h2} bold />}
            />
            {/* The row stays until the delete comes back down the listener,
                so the chip goes dead rather than inviting a second confirm. */}
            <View style={styles.chipRow}>
              <Chip small danger label="Delete"
                onPress={isBusy(`expense:${e.id}`) ? undefined : () =>
                  Alert.alert('Delete this expense?',
                    `${categoryLabel(e.category)} — Rs ${e.amount.toLocaleString()} (${dayLabel(e.date)})`, [
                      { text: 'Keep it', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => run(`expense:${e.id}`, () => store.removeExpense(e.id)) },
                    ])
                } />
            </View>
          </Card>
        ))
      )}

      <SectionLabel>Fixed monthly charges</SectionLabel>
      <Text style={styles.hint}>Bills that come every month — rent, salaries, petrol allowance.</Text>

      {store.fixedCharges.length === 0 ? (
        <EmptyState
          icon="calendar-refresh"
          title="No fixed charges yet"
          hint="Add your first one below."
        />
      ) : (
        store.fixedCharges.map(c => (
          <Card key={c.id}>
            <ListRow
              icon="calendar-refresh"
              tint={c.active ? color.success : color.textFaint}
              bg={c.active ? color.successSoft : color.surfaceAlt}
              title={c.label}
              sub={c.active ? 'Counted every month' : 'Paused'}
              right={
                <View style={styles.rowRight}>
                  <Money amount={c.amount} size={font.h2} bold />
                  <Tag
                    label={c.active ? 'ACTIVE' : 'PAUSED'}
                    tone={c.active ? 'success' : 'danger'}
                  />
                </View>
              }
            />
            <View style={styles.chipRow}>
              {/* Pause/Resume is a flip: a second tap put the charge straight
                  back the way it was. */}
              <Chip small label={c.active ? 'Pause' : 'Resume'}
                onPress={isBusy(`charge:${c.id}`) ? undefined
                  : () => run(`charge:${c.id}`, () => store.updateFixedCharge(c.id, { active: !c.active }))} />
              <Chip small danger label="Delete"
                onPress={isBusy(`charge:${c.id}`) ? undefined : () =>
                  Alert.alert('Delete this charge?', `${c.label} — Rs ${c.amount.toLocaleString()}/month`, [
                    { text: 'Keep it', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => run(`charge:${c.id}`, () => store.removeFixedCharge(c.id)) },
                  ])
                } />
            </View>
          </Card>
        ))
      )}

      <Card>
        <View style={styles.cardHead}>
          <IconTile name="calendar-refresh" size={34} />
          <Text style={styles.cardHeadLabel} numberOfLines={2}>Add a fixed charge</Text>
        </View>
        {salaryPeople.length > 0 && (
          <View style={styles.chipRow}>
            {salaryPeople.map(e => (
              <Chip
                key={e.email}
                small
                label={`Salary — ${e.name}`}
                selected={chargeLabel === `Salary — ${e.name}`}
                onPress={() => setChargeLabel(`Salary — ${e.name}`)}
              />
            ))}
          </View>
        )}
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>What is it for?</Text>
          <TextInput
            style={styles.input}
            value={chargeLabel}
            onChangeText={setChargeLabel}
            placeholder="e.g. Shop rent"
            placeholderTextColor={color.textFaint}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Amount every month</Text>
          <TextInput
            style={styles.input}
            value={chargeAmountText}
            onChangeText={setChargeAmountText}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={color.textFaint}
          />
        </View>
        <PrimaryButton
          label="Save fixed charge"
          variant="quiet"
          icon="calendar-refresh"
          onPress={saveFixedCharge}
          disabled={!chargeLabel.trim() || chargeAmount <= 0}
          disabledReason={!chargeLabel.trim() ? 'Name it first' : 'Amount first'}
          busy={isBusy('charge')}
        />
      </Card>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingTop: space.s, paddingBottom: space.xl + space.l },
  subLine: {
    fontSize: font.sub, color: color.textSub,
    marginHorizontal: space.l, marginBottom: space.xs,
  },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space.s + 2 },
  hint: {
    fontSize: font.sub, color: color.textSub,
    marginHorizontal: space.l, marginTop: 2, marginBottom: space.xs,
  },

  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.s },
  cardHeadLabel: {
    flex: 1, minWidth: 0, fontSize: font.body, fontWeight: '600',
    color: color.text, marginLeft: space.m,
  },

  field: { marginBottom: space.s },
  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginBottom: space.xs },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 40,
    fontSize: font.body, color: color.text,
  },
  optionStack: { gap: space.s },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: space.xs, marginHorizontal: -space.xs },
  // Tighter than before, but minHeight holds the tap target at 40.
  noteLink: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: space.s, minHeight: 40,
  },
  noteLinkText: { fontSize: font.body, fontWeight: '600', color: color.primary, marginLeft: space.xs },

  warnCard: {
    backgroundColor: color.warnSoft,
    marginHorizontal: 0, marginVertical: 0, marginBottom: space.s,
  },
  warnRow: { flexDirection: 'row', alignItems: 'center' },
  warnText: {
    flex: 1, minWidth: 0, fontSize: font.sub, fontWeight: '600',
    color: color.warn, marginLeft: space.s,
  },
  // The amount + tag column must not shrink when a charge label is long.
  rowRight: { flexShrink: 0, alignItems: 'flex-end', gap: space.xs, marginLeft: space.s },
});
