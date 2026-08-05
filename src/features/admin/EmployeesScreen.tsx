/**
 * Employees — the owner's access list (FR-1.3). Add people by their Google
 * email; they appear as "Invited" until they sign in. The last admin can
 * never be removed (the button says why instead of erroring).
 */
import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  Card, Chip, EmptyState, ListRow, OptionBar, PrimaryButton, SectionLabel, Tag,
  color, font, radius, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import type { Employee } from '../../data/models';

const ROLE_LABELS: Record<Employee['role'], string> = {
  admin: 'Owner',
  booker: 'Booker',
  rider: 'Rider',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmployeesScreen() {
  const store = useStore();
  const [adding, setAdding] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [name, setName] = React.useState('');
  const [role, setRole] = React.useState<Employee['role']>('booker');

  const adminCount = store.employees.filter(e => e.role === 'admin').length;
  const canSave = EMAIL_RE.test(email) && name.trim().length > 0;

  const resetForm = () => {
    setEmail('');
    setName('');
    setRole('booker');
    setAdding(false);
  };

  const save = async () => {
    try {
      await store.addEmployee(email, name.trim(), role);
      resetForm();
    } catch (e) {
      Alert.alert('Could not add', e instanceof Error ? e.message : String(e));
    }
  };

  const remove = (emp: Employee) => {
    store.removeEmployee(emp.email).catch(e => {
      Alert.alert('Could not remove', e instanceof Error ? e.message : String(e));
    });
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.subLine}>They sign in with Google — invite by email</Text>

      {store.employees.length === 0 && (
        <EmptyState
          icon="account-multiple-outline"
          title="No one here yet"
          hint="Add your first employee below — they sign in with Google."
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
                    icon="account-outline"
                    title={emp.name}
                    sub={emp.email}
                    right={
                      <View style={styles.tagCol}>
                        <Tag label={ROLE_LABELS[emp.role].toUpperCase()} tone="primary" />
                        {emp.joined
                          ? <Tag label="JOINED" tone="success" />
                          : <Tag label="INVITED" tone="warn" />}
                      </View>
                    }
                  />
                  <View style={styles.actionRow}>
                    <View style={styles.spring} />
                    {isOnlyAdmin
                      ? <Chip small label="Add another admin first" />
                      : <Chip small label="Remove" danger onPress={() => remove(emp)} />}
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
              label="Save"
              icon="check"
              disabled={!canSave}
              disabledReason="Email and name first"
              onPress={() => { void save(); }}
            />
            <View style={styles.chipRow}>
              <Chip label="Cancel" onPress={resetForm} />
            </View>
          </Card>
        </>
      )}

      <Text style={styles.note}>
        They sign in with this exact Google address — nothing to set up.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingTop: space.s, paddingBottom: space.xl + space.l },
  subLine: {
    fontSize: font.sub, color: color.textSub,
    marginHorizontal: space.l, marginBottom: space.xs,
  },
  tightCard: { paddingVertical: space.xs },

  empRow: { paddingVertical: space.xs },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  tagCol: { alignItems: 'flex-end', gap: space.xs },
  actionRow: { flexDirection: 'row', alignItems: 'center' },
  spring: { flex: 1 },

  field: { paddingVertical: space.s },
  fieldLabel: { fontSize: font.sub, fontWeight: '700', color: color.textSub, marginBottom: 6 },
  input: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.tile,
    borderWidth: 1, borderColor: color.border,
    paddingHorizontal: space.m, height: 46,
    fontSize: font.body, color: color.text,
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: space.s, marginHorizontal: -space.xs },
  ctaWrap: { paddingHorizontal: space.l },
  note: {
    fontSize: font.sub, color: color.textSub, textAlign: 'center',
    marginTop: space.l, marginHorizontal: space.xl,
  },
});
