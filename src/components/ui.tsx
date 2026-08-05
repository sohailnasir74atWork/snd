/**
 * UI kit — every screen builds from these pieces and the theme tokens only.
 * Visual reference: Vyapar-class polish — white cards with soft shadows on a
 * light blue canvas, pastel icon tiles, small refined chips, one crimson
 * pill CTA per screen, quiet secondary text.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { formatAmount } from '../lib/money';
import { color, font, radius, shadow, space } from './theme';

export { color, font, radius, shadow, space } from './theme';
// Back-compat aliases (screens written before the design pass).
export const ACCENT = color.primary;
export const DANGER = color.danger;
export const OK = color.success;

/** Wrapped vector icon — screens never import the font library directly. */
export function Icon({ name, size = 22, color: c = color.text }: { name: string; size?: number; color?: string }) {
  return <MCIcon name={name} size={size} color={c} />;
}

/** Pastel rounded-square icon tile — the Quick Links look. */
export function IconTile({ name, tint = color.primary, bg = color.primarySoft, size = 44 }: {
  name: string; tint?: string; bg?: string; size?: number;
}) {
  return (
    <View style={{
      width: size, height: size, borderRadius: radius.tile,
      backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
    }}>
      <MCIcon name={name} size={size * 0.55} color={tint} />
    </View>
  );
}

export function Chip({
  label, selected, onPress, danger, small,
}: { label: string; selected?: boolean; onPress?: () => void; danger?: boolean; small?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip, small && styles.chipSmall,
        selected && styles.chipSelected,
        danger && styles.chipDanger,
      ]}>
      <Text style={[
        styles.chipText, small && { fontSize: font.tiny + 1 },
        selected && styles.chipTextSelected, danger && styles.chipTextDanger,
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Segmented pill pair — the Transaction/Party toggle look. */
export function Segmented({ options, value, onChange }: {
  options: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <View style={styles.segmentedRow}>
      {options.map(o => (
        <Pressable
          key={o}
          onPress={() => onChange(o)}
          style={[styles.segment, value === o && styles.segmentActive]}>
          <Text style={[styles.segmentText, value === o && styles.segmentTextActive]}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** The one bold pill CTA per screen (Vyapar's red pill). */
export function PrimaryButton({
  label, onPress, disabled, disabledReason, icon, variant = 'cta',
}: {
  label: string; onPress: () => void; disabled?: boolean; disabledReason?: string;
  icon?: string; variant?: 'cta' | 'primary' | 'quiet';
}) {
  const bg = disabled ? color.textFaint
    : variant === 'cta' ? color.cta
    : variant === 'primary' ? color.primary
    : color.surface;
  const fg = variant === 'quiet' && !disabled ? color.primary : color.onDark;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[
        styles.pill,
        { backgroundColor: bg },
        variant === 'quiet' && !disabled && styles.pillQuiet,
        !disabled && variant !== 'quiet' && shadow.fab,
      ]}>
      {icon ? <MCIcon name={icon} size={19} color={fg} style={{ marginRight: 8 }} /> : null}
      <Text style={[styles.pillText, { color: fg }]}>
        {disabled && disabledReason ? disabledReason : label}
      </Text>
    </Pressable>
  );
}

export function Money({ amount, size = font.body, bold, color: c }: {
  amount: number; size?: number; bold?: boolean; color?: string;
}) {
  return (
    <Text style={{ fontSize: size, fontWeight: bold ? '700' : '500', color: c ?? color.text }}>
      Rs {formatAmount(amount)}
    </Text>
  );
}

/** Stat tile — dashboard numbers. */
export function Tile({ label, value, accent, icon }: {
  label: string; value: string; accent?: string; icon?: string;
}) {
  return (
    <View style={[styles.tile, shadow.card]}>
      <View style={styles.tileTop}>
        {icon ? <IconTile name={icon} size={34} tint={accent ?? color.primary}
          bg={accent === color.danger ? color.dangerSoft : accent === color.success ? color.successSoft : accent === color.warn ? color.warnSoft : color.primarySoft} /> : null}
        <Text style={[styles.tileValue, icon ? { marginLeft: 10 } : null]}>{value}</Text>
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

export function Card({ children, onPress, style }: {
  children: React.ReactNode; onPress?: () => void; style?: ViewStyle;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.card, shadow.card, style]}>
      {children}
    </Pressable>
  );
}

/** List row inside a Card group: icon tile + title/sub + right accessory. */
export function ListRow({ icon, tint, bg, title, sub, right, onPress, chevron }: {
  icon?: string; tint?: string; bg?: string; title: string; sub?: string;
  right?: React.ReactNode; onPress?: () => void; chevron?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={styles.listRow}>
      {icon ? <IconTile name={icon} tint={tint} bg={bg} size={40} /> : null}
      <View style={{ flex: 1, marginLeft: icon ? 12 : 0 }}>
        <Text style={styles.listTitle}>{title}</Text>
        {sub ? <Text style={styles.listSub}>{sub}</Text> : null}
      </View>
      {right}
      {chevron ? <MCIcon name="chevron-right" size={22} color={color.textFaint} /> : null}
    </Pressable>
  );
}

/** Joined equal-width segmented bar — active option is a solid blue pill. */
export function OptionBar<T extends string | number>({ options, value, onChange, render }: {
  options: readonly T[]; value: T; onChange: (v: T) => void; render?: (v: T) => string;
}) {
  return (
    <View style={styles.optionBar}>
      {options.map(o => {
        const active = o === value;
        return (
          <Pressable
            key={String(o)}
            onPress={() => onChange(o)}
            style={[styles.optionSeg, active && styles.optionSegActive]}>
            <Text style={[styles.optionText, active && styles.optionTextActive]}>
              {render ? render(o) : String(o)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SectionLabel({ children }: { children: string }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

/** Guided empty state (§5.4) with an icon instead of an illustration. */
export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <MCIcon name={icon} size={44} color={color.primary} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyHint}>{hint}</Text>
    </View>
  );
}

/** Small status tag — the green "SALE" style label. */
export function Tag({ label, tone = 'success' }: { label: string; tone?: 'success' | 'warn' | 'danger' | 'primary' }) {
  const map = {
    success: [color.successSoft, color.success],
    warn: [color.warnSoft, color.warn],
    danger: [color.dangerSoft, color.danger],
    primary: [color.primarySoft, color.primary],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' }}>
      <Text style={{ color: fg, fontSize: font.tiny, fontWeight: '800', letterSpacing: 0.4 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.chip,
    borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, margin: 4,
  },
  chipSmall: { paddingHorizontal: 10, paddingVertical: 5 },
  chipSelected: { backgroundColor: color.primary, borderColor: color.primary },
  chipDanger: { borderColor: color.danger, backgroundColor: color.dangerSoft },
  chipText: { fontSize: font.sub, fontWeight: '600', color: color.textSub },
  chipTextSelected: { color: color.onDark },
  chipTextDanger: { color: color.danger },

  segmentedRow: { flexDirection: 'row', gap: 10, marginHorizontal: space.l, marginVertical: space.s },
  segment: {
    flex: 1, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border,
    backgroundColor: color.surface, paddingVertical: 10, alignItems: 'center',
  },
  segmentActive: { borderColor: color.cta, backgroundColor: color.ctaSoft },
  segmentText: { fontSize: font.body, fontWeight: '600', color: color.textSub },
  segmentTextActive: { color: color.cta, fontWeight: '700' },

  pill: {
    borderRadius: radius.pill, paddingVertical: 15, paddingHorizontal: 22,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
    marginVertical: 8, alignSelf: 'stretch',
  },
  pillQuiet: { borderWidth: 1, borderColor: color.primary },
  pillText: { fontSize: font.body + 1, fontWeight: '700' },

  tile: {
    backgroundColor: color.surface, borderRadius: radius.card, padding: 14,
    margin: 6, minWidth: 150, flexGrow: 1,
  },
  tileTop: { flexDirection: 'row', alignItems: 'center' },
  tileValue: { fontSize: font.stat, fontWeight: '800', color: color.text },
  tileLabel: { fontSize: font.sub, color: color.textSub, marginTop: 6 },

  card: {
    backgroundColor: color.surface, borderRadius: radius.card, padding: 14,
    marginHorizontal: space.l, marginVertical: 6,
  },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  listTitle: { fontSize: font.h2 - 1, fontWeight: '700', color: color.text },
  listSub: { fontSize: font.sub, color: color.textSub, marginTop: 1 },

  sectionLabel: {
    fontSize: font.sub, fontWeight: '800', color: color.textSub,
    marginHorizontal: space.l, marginTop: space.l, marginBottom: 4,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  optionBar: {
    flexDirection: 'row', backgroundColor: color.surfaceAlt,
    borderRadius: radius.tile, borderWidth: 1, borderColor: color.border, padding: 3,
  },
  optionSeg: {
    flex: 1, paddingVertical: 9, borderRadius: radius.tile - 3,
    alignItems: 'center', justifyContent: 'center',
  },
  optionSegActive: {
    backgroundColor: color.primary,
    shadowColor: color.primaryDark, shadowOpacity: 0.35, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  optionText: { fontSize: font.sub, fontWeight: '600', color: color.textSub },
  optionTextActive: { color: color.onDark, fontWeight: '800' },

  empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32 },
  emptyIcon: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: color.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  emptyTitle: { fontSize: font.h2, fontWeight: '700', color: color.text, textAlign: 'center' },
  emptyHint: { fontSize: font.sub, color: color.textSub, textAlign: 'center', marginTop: 6, lineHeight: 19 },
});
