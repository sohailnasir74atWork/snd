/**
 * Employees — the owner's access list (FR-1.3), two ways in.
 *
 *   App login  — the owner picks a login ID and the app generates a PIN. The
 *                man can sign in the second he is handed the slip. This is the
 *                default because the owner knows his rider's face and phone
 *                number, not his Gmail — and the rider frequently does not know
 *                it either.
 *   Google     — invite an address. Stays "Invited" until they sign in. Right
 *                for a manager with a real work address, wrong for the road.
 *
 * The last admin can never be removed (the button says why instead of
 * erroring).
 */
import React from 'react';
import { Alert, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Card, Chip, EmptyState, ListRow, Money, OptionBar, PrimaryButton, SectionLabel, Tag,
  color, font, radius, space,
} from '../../components/ui';
import { KeyboardScreen, useWriteGuard } from './AdminScreens';
import { useNeed, useStore } from '../../data/store';
import type { Employee } from '../../data/models';

const FLOAT_STEPS = [1000, 2000, 5000] as const;

/**
 * Reward float (FR-16): the owner hands staff cash to pay approved counter
 * rewards from. Issue adds, "Take back" zeroes; approved claims subtract on
 * their own as payout rows.
 */
function FloatSection() {
  const store = useStore();
  // floatMovements as well as the list: floatBalance() below is computed from
  // it, and without the declaration every staff member's cash float would
  // render a confident Rs 0 instead of what he is actually holding.
  useNeed('employeeList', 'floatMovements');
  // Float chips hand out real cash and the row stays put after the write, so
  // this is the screen's worst double-tap: +1,000 twice issued Rs 2,000.
  const { isBusy, run } = useWriteGuard();
  const staff = Object.entries(store.staffNames);
  if (staff.length === 0) return null;
  return (
    <>
      <SectionLabel>Cash float — rewards</SectionLabel>
      <Card style={styles.tightCard}>
        {staff.map(([uid, name], i) => {
          const balance = store.floatBalance(uid);
          return (
            <View key={uid} style={[styles.empRow, i < staff.length - 1 && styles.rowDivider]}>
              <ListRow
                icon="wallet-outline"
                title={name || 'Staff member'}
                sub="holds this much of your cash"
                right={<Money amount={balance} bold color={balance > 0 ? color.warn : undefined} />}
              />
              <View style={styles.actionRow}>
                <View style={styles.spring} />
                {FLOAT_STEPS.map(v => (
                  <Chip key={v} small label={`+${v.toLocaleString()}`}
                    onPress={isBusy(`issue:${uid}:${v}`) ? undefined
                      : () => run(`issue:${uid}:${v}`, () => store.moveFloat(uid, v, 'issue'))} />
                ))}
                {balance > 0 && (
                  // Keyed on the balance too: taking back the same figure twice
                  // drove the float negative.
                  <Chip small danger label="Take back"
                    onPress={isBusy(`return:${uid}:${balance}`) ? undefined
                      : () => run(`return:${uid}:${balance}`, () => store.moveFloat(uid, balance, 'return'))} />
                )}
              </View>
            </View>
          );
        })}
      </Card>
    </>
  );
}

const ROLE_LABELS: Record<Employee['role'], string> = {
  admin: 'Owner',
  booker: 'Booker',
  rider: 'Rider',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Matches the server. 2–20 so "ali" works and a sentence does not.
const LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{1,19}$/;

const METHODS = ['app', 'google'] as const;
type Method = (typeof METHODS)[number];
const METHOD_LABELS: Record<Method, string> = {
  app: 'App login',
  google: 'Google',
};

/**
 * Six digits, never starting with a zero.
 *
 * A leading zero is dropped by half the people who copy a number onto a slip of
 * paper, and the resulting five-digit PIN is one the owner will swear he wrote
 * down correctly.
 */
const newPin = () => String(Math.floor(Math.random() * 900000) + 100000);

/** What the owner hands over. The PIN is never recoverable after this. */
function handoutText(name: string, companyCode: string, loginId: string, pin: string) {
  return (
    `${name} — your login for SnD Manager\n\n` +
    `Business code: ${companyCode}\n` +
    `Login ID: ${loginId}\n` +
    `PIN: ${pin}`
  );
}

export function EmployeesScreen() {
  const store = useStore();
  const [adding, setAdding] = React.useState(false);
  const [method, setMethod] = React.useState<Method>('app');
  const [email, setEmail] = React.useState('');
  const [loginId, setLoginId] = React.useState('');
  const [pin, setPin] = React.useState(newPin);
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState<Employee['role']>('booker');
  // All of these call a cloud function, so there is a real round-trip to
  // wait on — and a real window in which a second tap called it again.
  const [saving, setSaving] = React.useState(false);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [resetting, setResetting] = React.useState<string | null>(null);

  const adminCount = store.employees.filter(e => e.role === 'admin').length;
  const companyCode = store.settings.companyCode ?? '';
  const canSave =
    name.trim().length > 0 &&
    (method === 'google' ? EMAIL_RE.test(email) : LOGIN_ID_RE.test(loginId) && /^\d{6}$/.test(pin));

  const resetForm = () => {
    setEmail('');
    setLoginId('');
    setPin(newPin());
    setName('');
    setRole('booker');
    setAdding(false);
  };

  /** The slip. Offered for sharing because WhatsApp is how this actually travels. */
  const showHandout = (who: string, code: string, id: string, secret: string, title: string) => {
    const body = handoutText(who, code, id, secret);
    Alert.alert(title, `${body}\n\nThe PIN is not shown again. Send it or write it down now.`, [
      { text: 'Done', style: 'cancel' },
      { text: 'Send', onPress: () => void Share.share({ message: body }).catch(() => {}) },
    ]);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (method === 'google') {
        await store.addEmployee(email, name.trim(), role);
        resetForm();
      } else {
        const who = name.trim();
        const issued = pin; // resetForm rolls a fresh one for the next person
        const res = await store.createStaffLogin({ name: who, loginId, pin: issued, role });
        resetForm();
        showHandout(who, res.companyCode, res.loginId, issued, `${who} can sign in now`);
      }
    } catch (e) {
      Alert.alert('Could not add', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false); // always restore, including on the error path
    }
  };

  /**
   * The owner IS the password-reset flow — nothing can be mailed to a
   * synthesised address. Confirmed first because it signs the man's phone out
   * inside a minute, which is wrong to do to someone mid-round by accident.
   */
  const resetPin = (emp: Employee) => {
    if (resetting) return;
    Alert.alert(
      `Reset ${emp.name || emp.loginId}'s PIN?`,
      'They will be signed out and will need the new PIN to get back in.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset PIN',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setResetting(emp.email);
              const fresh = newPin();
              try {
                // The server's answer, not the settings listener's — a company
                // whose code was minted moments ago may not have it locally.
                const res = await store.resetStaffPin(emp.email, fresh);
                showHandout(
                  emp.name || emp.loginId || '',
                  res.companyCode || companyCode,
                  res.loginId || emp.loginId || '',
                  fresh,
                  'New PIN',
                );
              } catch (e) {
                Alert.alert('Could not reset', e instanceof Error ? e.message : String(e));
              } finally {
                setResetting(null);
              }
            })();
          },
        },
      ],
    );
  };

  const remove = async (emp: Employee) => {
    if (removing) return;
    setRemoving(emp.email);
    try {
      await store.removeEmployee(emp.email);
    } catch (e) {
      Alert.alert('Could not remove', e instanceof Error ? e.message : String(e));
    } finally {
      setRemoving(null); // always restore, including on the error path
    }
  };

  return (
    <KeyboardScreen style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.subLine}>Give them a login, or invite a Google address</Text>

      {/* The one thing every staff member types at every sign-in. It belongs
          on screen permanently, not only in the alert that appeared once when
          the login was created. */}
      {!!companyCode && (
        <Card style={styles.codeCard}>
          <Text style={styles.codeLabel}>YOUR BUSINESS CODE</Text>
          <Text style={styles.codeValue} selectable>{companyCode}</Text>
          <Text style={styles.codeHint}>Everyone types this to sign in</Text>
        </Card>
      )}

      {store.employees.length === 0 && (
        <EmptyState
          icon="account-multiple-outline"
          title="No one here yet"
          hint="Add your first employee below. You pick their login ID, the app makes a PIN, and they can sign in straight away."
        />
      )}

      {store.employees.length > 0 && (
        <>
          <SectionLabel>Team</SectionLabel>
          <Card style={styles.tightCard}>
            {store.employees.map((emp, i) => {
              const isOnlyAdmin = emp.role === 'admin' && adminCount <= 1;
              const last = i === store.employees.length - 1;
              return (
                <View key={emp.email} style={[styles.empRow, !last && styles.rowDivider]}>
                  <ListRow
                    icon={emp.staffLogin ? 'key-outline' : 'account-outline'}
                    title={emp.name || emp.loginId || emp.email}
                    // A staff address is synthesised and means nothing to the
                    // owner. What he needs to see is the ID he issued.
                    sub={emp.staffLogin ? `Login ID: ${emp.loginId ?? '—'}` : emp.email}
                    right={
                      <View style={styles.tagCol}>
                        {/* A mirror doc can arrive without a role (see the
                            employeeList listener) — never throw on render. */}
                        <Tag label={(ROLE_LABELS[emp.role] || 'Staff').toUpperCase()} tone="primary" />
                        {/* A minted login has nothing to wait for, so "Invited"
                            would be a lie on those rows — it only ever means an
                            unaccepted Google invitation. */}
                        {emp.joined
                          ? <Tag label="JOINED" tone="success" />
                          : <Tag label="INVITED" tone="warn" />}
                      </View>
                    }
                  />
                  <View style={styles.actionRow}>
                    <View style={styles.spring} />
                    {emp.staffLogin && (
                      <Chip small
                        label={resetting === emp.email ? 'Resetting…' : 'Reset PIN'}
                        onPress={resetting ? undefined : () => resetPin(emp)} />
                    )}
                    {isOnlyAdmin
                      ? <Chip small label="Add another admin first" />
                      : <Chip small danger
                          label={removing === emp.email ? 'Removing…' : 'Remove'}
                          onPress={removing ? undefined : () => remove(emp)} />}
                  </View>
                </View>
              );
            })}
          </Card>
        </>
      )}

      {!adding && (
        <View style={styles.ctaWrap}>
          <PrimaryButton
            label="Add employee"
            icon="account-plus-outline"
            onPress={() => setAdding(true)}
          />
        </View>
      )}

      {adding && (
        <>
          <SectionLabel>Add employee</SectionLabel>
          <Card style={styles.tightCard}>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>How do they sign in?</Text>
              <OptionBar
                options={METHODS}
                value={method}
                render={m => METHOD_LABELS[m]}
                onChange={setMethod}
              />
              <Text style={styles.methodHint}>
                {method === 'app'
                  ? 'You pick the login ID and the app makes a PIN. Nothing to set up on their phone — no Gmail needed.'
                  : 'They sign in with this exact Google address. Best for someone with a real work email.'}
              </Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="Their name"
                placeholderTextColor={color.textFaint}
              />
            </View>

            {method === 'google' ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Google email</Text>
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={t => setEmail(t.toLowerCase())}
                  placeholder="name@gmail.com"
                  placeholderTextColor={color.textFaint}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            ) : (
              <>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Login ID</Text>
                  <TextInput
                    style={styles.input}
                    value={loginId}
                    // Stripped as it is typed, not rejected afterwards: the
                    // owner should never get to the Save button and be told the
                    // name he chose was never allowed.
                    onChangeText={t => setLoginId(t.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                    placeholder="e.g. ali"
                    placeholderTextColor={color.textFaint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    maxLength={20}
                  />
                  <Text style={styles.fieldHint}>
                    Short and easy to say. They type this with the business code.
                  </Text>
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>PIN</Text>
                  <View style={styles.pinRow}>
                    <Text style={styles.pinValue} selectable>{pin}</Text>
                    <Chip small label="New PIN" onPress={() => setPin(newPin())} />
                  </View>
                  <Text style={styles.fieldHint}>
                    You can read this out or send it. Reset it any time from their row.
                  </Text>
                </View>
              </>
            )}

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Role</Text>
              <OptionBar
                options={['booker', 'rider', 'admin'] as const}
                value={role}
                render={r => ROLE_LABELS[r]}
                onChange={setRole}
              />
            </View>

            <PrimaryButton
              label={method === 'app' ? 'Create login' : 'Send invite'}
              icon="check"
              disabled={!canSave}
              disabledReason={
                method === 'app' ? 'Name and login ID first' : 'Name and email first'
              }
              busy={saving}
              busyLabel="Adding…"
              onPress={() => { void save(); }}
            />
            <View style={styles.chipRow}>
              <Chip label="Cancel" onPress={resetForm} />
            </View>
          </Card>
        </>
      )}

      <FloatSection />

      <Text style={styles.note}>
        Forgot a PIN? Reset it from their row — only you can. Google invites
        need the exact address; app logins need nothing at all.
      </Text>
    </KeyboardScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingTop: space.s, paddingBottom: space.xl + space.l },
  subLine: {
    fontSize: font.sub, color: color.textSub,
    marginHorizontal: space.gutter, marginBottom: space.xs,
  },
  tightCard: { paddingVertical: space.xs },

  empRow: { paddingVertical: space.xs },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  // The role/status tags sit beside a long Gmail address, so they hold their
  // width and the address wraps in the ListRow body instead.
  tagCol: { flexShrink: 0, alignItems: 'flex-end', gap: space.xs },
  actionRow: { flexDirection: 'row', alignItems: 'center' },
  spring: { flex: 1, minWidth: 0 },

  // The code the whole team types. Loud on purpose — the owner reads it off
  // this card onto a slip of paper, out loud, down a phone line.
  codeCard: { alignItems: 'center', paddingVertical: space.m },
  codeLabel: { fontSize: font.tiny, fontWeight: '800', color: color.textSub, letterSpacing: 1 },
  codeValue: {
    fontSize: font.h1 + 4, fontWeight: '800', color: color.text,
    letterSpacing: 1, marginTop: space.xs,
  },
  codeHint: { fontSize: font.sub, color: color.textFaint, marginTop: 2 },

  field: { paddingVertical: space.s },
  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginBottom: space.xs },
  fieldHint: { fontSize: font.sub, color: color.textFaint, marginTop: space.xs, lineHeight: 16 },
  methodHint: { fontSize: font.sub, color: color.textSub, marginTop: space.s, lineHeight: 16 },
  // The PIN is generated, never typed — so it is displayed, not input.
  pinRow: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  pinValue: {
    fontSize: font.h1, fontWeight: '800', color: color.text, letterSpacing: 4,
  },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 40,
    fontSize: font.body, color: color.text,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.s, marginHorizontal: -space.xs },
  ctaWrap: { paddingHorizontal: space.gutter },
  note: {
    fontSize: font.sub, color: color.textSub, textAlign: 'center',
    marginTop: space.m, marginHorizontal: space.xl,
  },
});
