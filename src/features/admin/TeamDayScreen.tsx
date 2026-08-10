/**
 * Admin — Team today. Who started when, who is still out, what they have done.
 *
 * The owner's question is never "show me the audit log", it is "has Imran
 * started yet" and "is anyone still out at seven". So this is one row per
 * person, ordered by who is still working, and the two times are the headline.
 *
 * Nobody clocks in — see `lib/workday.ts` for why, and for the rule that turns
 * work into a start and an end. A derived start is marked as such rather than
 * presented as fact: it is the first shop, which is later than the real start
 * by however long the first ride took, and an owner about to have a word with
 * someone should know which number he is holding.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  Card, EmptyState, Icon, IconTile, Money, SectionLabel, Tag,
  color, font, space,
} from '../../components/ui';
import { useStore } from '../../data/store';
import { computeWorkday, clockTime, durationLabel } from '../../lib/workday';
import type { Workday } from '../../lib/workday';

export function TeamDayScreen() {
  const store = useStore();
  // Anchored to the WORKING day, the same one the rest of the app uses, so a
  // rider still out past midnight stays on today's row instead of vanishing.
  const dayStartMs = new Date(`${store.day.date}T00:00:00`).getTime();
  const dayEndMs = dayStartMs + 86400_000 - 1;
  const now = Date.now();

  const people = React.useMemo(() => {
    // Everyone who could have worked today: the employee list is the roster,
    // and staffNames catches anyone holding money who is no longer on it.
    const ids = new Set<string>();
    Object.keys(store.staffNames).forEach(id => ids.add(id));
    store.orders.forEach(o => {
      if (o.bookedAt >= dayStartMs) ids.add(o.bookedBy);
      if (o.assignedTo && o.deliveredAt && o.deliveredAt >= dayStartMs) ids.add(o.assignedTo);
    });
    store.payments.forEach(p => { if (p.createdAt >= dayStartMs) ids.add(p.collectedBy); });

    return [...ids]
      .map(staffId => computeWorkday({
        staffId,
        dayStartMs,
        dayEndMs,
        orders: store.orders,
        payments: store.payments,
        rewardClaims: store.rewardClaims,
        day: store.staffDays.find(d => d.staffId === staffId),
      }, now))
      // Still out first — that is the only row anyone acts on. Then whoever
      // worked, earliest start first. People who did nothing sink.
      .sort((a, b) => {
        if (a.stillWorking !== b.stillWorking) return a.stillWorking ? -1 : 1;
        if ((a.startedAt === null) !== (b.startedAt === null)) return a.startedAt === null ? 1 : -1;
        return (a.startedAt ?? 0) - (b.startedAt ?? 0);
      });
  }, [store.staffNames, store.orders, store.payments, store.rewardClaims, store.staffDays,
      dayStartMs, dayEndMs, now]);

  const working = people.filter(p => p.stillWorking);
  const started = people.filter(p => p.startedAt !== null);
  const notStarted = people.filter(p => p.startedAt === null);

  const nameOf = (staffId: string) => store.staffNames[staffId] || 'Removed employee';

  const row = (w: Workday) => (
    <Card key={w.staffId}>
      <View style={styles.head}>
        <IconTile
          name={w.stillWorking ? 'walk' : w.handedOver ? 'check-circle-outline' : 'sleep'}
          tint={w.stillWorking ? color.success : color.textSub}
          bg={w.stillWorking ? color.successSoft : color.surfaceAlt}
          size={38}
        />
        <View style={styles.headBody}>
          <Text style={styles.name} numberOfLines={1}>{nameOf(w.staffId)}</Text>
          <Text style={styles.times} numberOfLines={1}>
            {clockTime(w.startedAt)} → {w.handedOver || !w.stillWorking ? clockTime(w.lastActionAt) : 'now'}
          </Text>
        </View>
        <View style={styles.headRight}>
          <Text style={styles.duration}>{durationLabel(w.activeMs)}</Text>
        </View>
      </View>

      <View style={styles.tagRow}>
        {w.stillWorking && <Tag label="OUT NOW" tone="success" />}
        {w.handedOver && <Tag label="HANDED OVER" tone="primary" />}
        {/* The honest caveat: this start is the first shop, not the depot. */}
        {w.startSource === 'derived' && <Tag label="FROM FIRST SHOP" tone="warn" />}
      </View>

      <View style={styles.stats}>
        {w.shopsTouched > 0 && <Stat label="shops" value={String(w.shopsTouched)} />}
        {w.ordersBooked > 0 && <Stat label="booked" value={String(w.ordersBooked)} />}
        {w.deliveries > 0 && <Stat label="delivered" value={String(w.deliveries)} />}
        {w.claims > 0 && <Stat label="claims" value={String(w.claims)} />}
      </View>

      {w.collected > 0 && (
        <View style={styles.moneyRow}>
          <Text style={styles.moneyLabel}>Collected today</Text>
          <Money amount={w.collected} bold />
        </View>
      )}
    </Card>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.subLine}>
        {working.length > 0
          ? `${working.length} out now • ${started.length} worked today`
          : started.length > 0
            ? `Nobody out • ${started.length} worked today`
            : 'Nobody has started yet today.'}
      </Text>

      {started.map(row)}

      {notStarted.length > 0 && (
        <>
          <SectionLabel>{`Not started (${notStarted.length})`}</SectionLabel>
          <Card>
            <Text style={styles.quiet}>
              {notStarted.map(w => nameOf(w.staffId)).join(', ')}
            </Text>
            <View style={styles.noteRow}>
              <Icon name="information-outline" size={16} color={color.textFaint} />
              <Text style={styles.note}>
                Nothing recorded against them today. A day only appears here once someone
                books, delivers or takes money — the app has no clock-in button.
              </Text>
            </View>
          </Card>
        </>
      )}

      {people.length === 0 && (
        <EmptyState
          icon="account-clock-outline"
          title="No team activity yet"
          hint="Once your booker or rider starts working, their day shows up here with the time they started."
        />
      )}
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  content: { paddingTop: space.s, paddingBottom: space.xl + space.l },
  subLine: {
    fontSize: font.sub, color: color.textSub,
    marginHorizontal: space.gutter, marginBottom: space.xs,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  // flex + minWidth 0: a long name must ellipsise, not shove the duration off.
  headBody: { flex: 1, minWidth: 0 },
  headRight: { flexShrink: 0, alignItems: 'flex-end' },
  name: { fontSize: font.h2, fontWeight: '700', color: color.text },
  times: { fontSize: font.sub, color: color.textSub, marginTop: 2 },
  duration: { fontSize: font.stat, fontWeight: '800', color: color.primary },
  tagRow: {
    flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    gap: space.s, marginTop: space.s,
  },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.l, marginTop: space.m },
  stat: { alignItems: 'flex-start' },
  statValue: { fontSize: font.h2, fontWeight: '700', color: color.text },
  statLabel: { fontSize: font.tiny, color: color.textSub, textTransform: 'uppercase' },
  moneyRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: space.m, paddingTop: space.s,
    borderTopWidth: 1, borderTopColor: color.border,
  },
  moneyLabel: { fontSize: font.sub, color: color.textSub },
  quiet: { fontSize: font.body, color: color.text },
  noteRow: { flexDirection: 'row', gap: space.s, marginTop: space.s },
  note: {
    flex: 1, minWidth: 0, fontSize: font.sub, color: color.textFaint,
    lineHeight: font.sub + 6,
  },
});
