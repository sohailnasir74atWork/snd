/**
 * UI kit — every screen builds from these pieces and the theme tokens only.
 * Visual reference: Vyapar-class polish — white cards with soft shadows on a
 * light blue canvas, pastel icon tiles, small refined chips, one crimson
 * pill CTA per screen, quiet secondary text.
 */
import React from 'react';
import {
  ActivityIndicator, Animated, Pressable, StyleSheet,
  Text as RNText, TextInput as RNTextInput, View, ViewStyle,
} from 'react-native';
import type { TextProps, TextInputProps } from 'react-native';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { formatAmount } from '../lib/money';
import { color, font, radius, shadow, space } from './theme';

export { color, font, radius, shadow, space } from './theme';

/**
 * How far the PHONE's own font setting may stretch this app.
 *
 * 2026-08-12, and this is the answer to "our text is bigger than Vyapar's on
 * the same handset". It was — but not because the type scale was wrong. React
 * Native multiplies every `fontSize` by the system font-size setting, and
 * nothing in this app capped it: on a phone set to Large, our 14pt body became
 * 18pt while Vyapar's stayed put, and the icon tiles beside it did not grow at
 * all, which is what made the rows look unbalanced rather than merely big.
 * Verified by setting `font_scale` to 1.3 on the emulator and reproducing the
 * owner's screenshot exactly.
 *
 * 1.15 rather than 1.0. Refusing to scale at all is what Vyapar appears to do
 * and it would match them exactly, but it also tells a shopkeeper with poor
 * eyesight that his phone's accessibility setting does not apply here — and
 * the people using this app are middle-aged men reading a khata in daylight.
 * 15% is enough to help and small enough that no row goes to two lines.
 *
 * **This is the only number to change if the app still reads too large.** Put
 * it to 1.0 to match Vyapar exactly; do not shrink the type scale to
 * compensate, or phones at the normal setting get an app nobody can read.
 */
export const MAX_FONT_SCALE = 1.15;

/**
 * `Text`, capped — and the reason every screen imports Text from here rather
 * than from react-native.
 *
 * The cap is a prop, and React Native offers no global for it: `defaultProps`
 * is gone in React 19, and monkey-patching `Text.render` breaks silently on an
 * upgrade with no compile error to catch it. One wrapper is duller and it is
 * checked by the type system.
 *
 * The default is spread BEFORE props, so a caller that genuinely wants a
 * different cap can still pass one.
 */
export function Text(props: TextProps) {
  return <RNText maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} />;
}

/** Same cap, same reason — a field that grows past its box is worse than text. */
export function TextInput(props: TextInputProps) {
  return <RNTextInput maxFontSizeMultiplier={MAX_FONT_SCALE} {...props} />;
}
// Back-compat aliases (screens written before the design pass).
export const ACCENT = color.primary;
export const DANGER = color.danger;
export const OK = color.success;

/** Wrapped vector icon — screens never import the font library directly. */
export function Icon({ name, size = 20, color: c = color.text }: { name: string; size?: number; color?: string }) {
  return <MCIcon name={name} size={size} color={c} />;
}

/** Pastel rounded-square icon tile — the Quick Links look. */
/**
 * The pastel square behind an icon.
 *
 * Smaller and with a larger glyph inside it than it used to be (38 at 0.55,
 * so a 21pt icon in a 38pt box). Beside Vyapar the old tile read as the loudest
 * thing in a row — a big block of pastel with a small mark floating in the
 * middle of it — and on the More screen that is nine blocks of colour down the
 * left before a single word is read. The tile is meant to hold the icon, not
 * to be the icon.
 *
 * 32 at 0.6 keeps the same glyph SIZE while dropping the block around it, so
 * rows get shorter and the mark itself is no less legible.
 */
export function IconTile({ name, tint = color.primary, bg = color.primarySoft, size = 32 }: {
  name: string; tint?: string; bg?: string; size?: number;
}) {
  return (
    <View style={{
      width: size, height: size, borderRadius: radius.tile,
      backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
    }}>
      <MCIcon name={name} size={size * 0.6} color={tint} />
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

/**
 * The one bold pill CTA per screen (Vyapar's red pill).
 *
 * `busy` is not decoration. Every button here writes money or stock, and a
 * second tap while the first write is in flight books the order twice. Passing
 * `busy` blocks the press AND shows a spinner, so the person can see why
 * nothing is happening instead of tapping again.
 */
export function PrimaryButton({
  label, onPress, disabled, disabledReason, icon, variant = 'cta', busy, busyLabel,
}: {
  label: string; onPress: () => void; disabled?: boolean; disabledReason?: string;
  icon?: string; variant?: 'cta' | 'primary' | 'quiet'; busy?: boolean; busyLabel?: string;
}) {
  const off = disabled || busy;
  const bg = off ? color.textFaint
    : variant === 'cta' ? color.cta
    : variant === 'primary' ? color.primary
    : color.surface;
  const fg = variant === 'quiet' && !off ? color.primary : color.onDark;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      disabled={off}
      accessibilityState={{ disabled: !!off, busy: !!busy }}
      style={[
        styles.pill,
        { backgroundColor: bg },
        variant === 'quiet' && !off && styles.pillQuiet,
        !off && variant !== 'quiet' && shadow.fab,
      ]}>
      {busy
        ? <ActivityIndicator size="small" color={fg} style={styles.pillSpinner} />
        : icon ? <MCIcon name={icon} size={17} color={fg} style={styles.pillIcon} /> : null}
      {/* Shrink and wrap rather than run off the pill: several labels carry a
          shop name and an amount, which is long in the field. */}
      <Text style={[styles.pillText, { color: fg }]} numberOfLines={2}>
        {busy ? (busyLabel ?? 'Saving…') : disabled && disabledReason ? disabledReason : label}
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
        {icon ? <IconTile name={icon} size={30} tint={accent ?? color.primary}
          bg={accent === color.danger ? color.dangerSoft : accent === color.success ? color.successSoft : accent === color.warn ? color.warnSoft : color.primarySoft} /> : null}
        <Text
          style={[styles.tileValue, icon ? { marginLeft: 8 } : null]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}>
          {value}
        </Text>
      </View>
      <Text style={styles.tileLabel} numberOfLines={2}>{label}</Text>
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
      {icon ? <IconTile name={icon} tint={tint} bg={bg} size={34} /> : null}
      {/* minWidth 0 is what lets a long shop name shrink instead of pushing
          the amount off the right edge. */}
      <View style={[styles.listBody, { marginLeft: icon ? 10 : 0 }]}>
        <Text style={styles.listTitle} numberOfLines={2}>{title}</Text>
        {sub ? <Text style={styles.listSub} numberOfLines={2}>{sub}</Text> : null}
      </View>
      {right ? <View style={styles.listRight}>{right}</View> : null}
      {chevron ? <MCIcon name="chevron-right" size={20} color={color.textFaint} /> : null}
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
            {/* Joined bars carry up to four labels; shrink the text rather
                than clip it ("+ old khata" used to lose its tail). */}
            <Text
              style={[styles.optionText, active && styles.optionTextActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}>
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

/**
 * One step of a guided form: render nothing until `when` is true, then fade in.
 *
 * The point is what the person sees when they ARRIVE. A setup form showing
 * seven inputs at once reads as paperwork and gets abandoned; the same seven
 * revealed one at a time as each is answered reads as a short conversation.
 * Nothing is removed — the last field is still the last field — but the screen
 * is never wider than the question being asked.
 *
 * Once revealed it STAYS revealed, even if the field that opened it is
 * cleared. A form that collapses under you while you are correcting a typo is
 * worse than one that was always long.
 *
 * Use for the required chain. For the optional tail, use `MoreFields`.
 *
 * Deliberately NOT for the daily field loop — the rider's close-out, Collect,
 * quantity entry. Those are run sixty times a day by someone who knows exactly
 * what they are doing, and hiding a field he is reaching for costs him a tap
 * and the context around it. This is a first-time-user technique.
 */
export function Reveal({ when, children }: { when: boolean; children: React.ReactNode }) {
  const [shown, setShown] = React.useState(when);
  const fade = React.useRef(new Animated.Value(when ? 1 : 0)).current;

  React.useEffect(() => {
    if (!when || shown) return;
    setShown(true);
    Animated.timing(fade, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [when, shown, fade]);

  if (!shown) return null;
  return (
    <Animated.View
      style={{
        opacity: fade,
        // A short rise rather than a slide: enough to read as "this arrived",
        // not enough to push the keyboard-adjacent field around.
        transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
      }}
    >
      {children}
    </Animated.View>
  );
}

/**
 * The optional tail of a form, behind one tap.
 *
 * Everything in here already has a working default in the code — pack size,
 * MRP, opening stock — so hiding it removes nothing except the impression
 * that the app is asking for a lot. `count` names how much is waiting so the
 * tap is an informed one.
 */
export function MoreFields({
  label, count, children,
}: { label: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  if (open) return <>{children}</>;
  return (
    <Pressable
      onPress={() => setOpen(true)}
      style={({ pressed }) => [styles.moreFields, pressed && styles.moreFieldsPressed]}
      accessibilityRole="button"
    >
      <MCIcon name="tune-variant" size={16} color={color.primary} />
      <Text style={styles.moreFieldsLabel}>
        {label}{count ? ` (${count})` : ''}
      </Text>
    </Pressable>
  );
}

/** Guided empty state (§5.4) with an icon instead of an illustration. */
/**
 * The "nothing here yet" panel — 21 screens share this one drawing.
 *
 * The concentric ring is the same device BrandHero uses on the sign-in screen:
 * a halo, then the shape. A lone pastel disc read as an icon that had been
 * left somewhere; the ring gives it a place to sit and ties every empty screen
 * in the app to the artwork the owner met on his first day.
 */
export function EmptyState({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyArt}>
        <View style={styles.emptyRing} />
        <View style={styles.emptyIcon}>
          <MCIcon name={icon} size={38} color={color.primary} />
        </View>
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyHint}>{hint}</Text>
    </View>
  );
}

/**
 * Small status tag — the green "SALE" style label.
 *
 * NO `alignSelf`, deliberately. It used to carry `alignSelf: 'flex-start'`,
 * and alignSelf beats the parent's alignItems — so a pill overruled every
 * container it was dropped into, from in here, silently:
 *
 *   - in a ROW next to a Chip it pinned itself to the top, and NO PIN sat
 *     visibly above the button beside it;
 *   - in a right-aligned COLUMN (`tagCol` on Employees, `listRight`) it
 *     left-aligned instead, so RIDER / INVITED stacked with a ragged edge
 *     while the container had explicitly asked for flush right.
 *
 * A shared pill cannot know which axis it is on — only its parent can. So the
 * parent decides now, and every container holding one states an alignment.
 * The one place that wants neither is a tag alone in a column, which wraps
 * itself in a `flex-start` View (`tagWrap` in CollectScreen, RiderScreens)
 * rather than pushing the problem back in here.
 */
export function Tag({ label, tone = 'success' }: { label: string; tone?: 'success' | 'warn' | 'danger' | 'primary' }) {
  const map = {
    success: [color.successSoft, color.success],
    warn: [color.warnSoft, color.warn],
    danger: [color.dangerSoft, color.danger],
    primary: [color.primarySoft, color.primary],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
      <Text style={{ color: fg, fontSize: font.tiny, fontWeight: '800', letterSpacing: 0.4 }} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/**
 * The mark on a document number the phone issued itself, offline.
 *
 * Every confirmation screen shows its serial in `font.h1` and hands it to a
 * shopkeeper, so an unmarked `LOCAL-RCP-7` reads exactly like a real serial.
 * The wording lives here rather than at the four call sites so the screen and
 * the printed sheet (src/documents/templates.ts) cannot drift apart — and it
 * promises no replacement number, because nothing issues one (HANDOFF §4.14).
 *
 * The `isProvisional()` test stays at the call site on purpose: this file must
 * not pull the MMKV-backed serial module into every screen that imports a Card.
 */
export function ProvisionalNote() {
  return (
    <View style={{ alignItems: 'center', gap: 4, marginBottom: space.xs }}>
      <Tag label="PROVISIONAL" tone="warn" />
      <Text style={{ fontSize: font.tiny, color: color.textSub, textAlign: 'center' }}>
        Written with no internet — this number came from the phone, not the company's list.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.chip,
    borderWidth: 1, borderColor: color.border, backgroundColor: color.surface, margin: 3,
  },
  chipSmall: { paddingHorizontal: 9, paddingVertical: 4 },
  chipSelected: { backgroundColor: color.primary, borderColor: color.primary },
  chipDanger: { borderColor: color.danger, backgroundColor: color.dangerSoft },
  chipText: { fontSize: font.sub, fontWeight: '600', color: color.textSub },
  chipTextSelected: { color: color.onDark },
  chipTextDanger: { color: color.danger },

  segmentedRow: { flexDirection: 'row', gap: 8, marginHorizontal: space.gutter, marginVertical: space.s },
  segment: {
    flex: 1, borderRadius: radius.pill, borderWidth: 1, borderColor: color.border,
    backgroundColor: color.surface, paddingVertical: 8, alignItems: 'center',
  },
  segmentActive: { borderColor: color.cta, backgroundColor: color.ctaSoft },
  segmentText: { fontSize: font.sub, fontWeight: '600', color: color.textSub },
  segmentTextActive: { color: color.cta, fontWeight: '700' },

  pill: {
    borderRadius: radius.pill, paddingVertical: 12, paddingHorizontal: 18,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
    marginVertical: 6, alignSelf: 'stretch',
  },
  pillQuiet: { borderWidth: 1, borderColor: color.primary },
  pillIcon: { marginRight: 7 },
  // Same width as the icon it replaces, so the label does not jump on press.
  pillSpinner: { marginRight: 7, width: 17 },
  pillText: { fontSize: font.body, fontWeight: '700', flexShrink: 1, textAlign: 'center' },

  tile: {
    backgroundColor: color.surface, borderRadius: radius.card, padding: 12,
    margin: 5, minWidth: 138, flexGrow: 1, flexBasis: 0,
  },
  tileTop: { flexDirection: 'row', alignItems: 'center' },
  tileValue: { fontSize: font.stat, fontWeight: '800', color: color.text, flexShrink: 1 },
  tileLabel: { fontSize: font.sub, color: color.textSub, marginTop: 4 },

  card: {
    backgroundColor: color.surface, borderRadius: radius.card, padding: 12,
    // The hairline that replaced the Android drop shadow — see shadow.card.
    borderWidth: StyleSheet.hairlineWidth, borderColor: color.cardEdge,
    // The gutter, not a spacing step — see space.gutter.
    marginHorizontal: space.gutter, marginVertical: 5,
  },
  listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  listBody: { flex: 1, minWidth: 0 },
  listRight: { flexShrink: 0, marginLeft: space.s, alignItems: 'flex-end' },
  listTitle: { fontSize: font.body + 1, fontWeight: '700', color: color.text },
  listSub: { fontSize: font.sub, color: color.textSub, marginTop: 1 },

  moreFields: {
    flexDirection: 'row', alignItems: 'center', gap: space.s,
    alignSelf: 'flex-start', marginTop: space.m,
    paddingVertical: space.s, paddingHorizontal: space.m,
    borderRadius: radius.chip, backgroundColor: color.primarySoft,
  },
  moreFieldsPressed: { opacity: 0.7 },
  moreFieldsLabel: { color: color.primary, fontSize: font.sub, fontWeight: '700' },
  sectionLabel: {
    fontSize: font.tiny + 1, fontWeight: '800', color: color.textSub,
    marginHorizontal: space.gutter, marginTop: space.m, marginBottom: 3,
    textTransform: 'uppercase', letterSpacing: 0.6,
  },

  optionBar: {
    flexDirection: 'row', backgroundColor: color.surfaceAlt,
    borderRadius: radius.tile, borderWidth: 1, borderColor: color.border, padding: 3,
  },
  optionSeg: {
    flex: 1, minWidth: 0, paddingVertical: 8, paddingHorizontal: 4,
    borderRadius: radius.tile - 3, alignItems: 'center', justifyContent: 'center',
  },
  optionSegActive: {
    backgroundColor: color.primary,
    shadowColor: color.primaryDark, shadowOpacity: 0.3, shadowRadius: 5,
    shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  optionText: { fontSize: font.sub, fontWeight: '600', color: color.textSub, textAlign: 'center' },
  optionTextActive: { color: color.onDark, fontWeight: '800' },

  empty: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 28 },
  // The ring is absolute so the disc keeps the layout box — swapping to a
  // 100pt art block would otherwise shift the title down on all 21 screens.
  emptyArt: { width: 68, height: 68, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyRing: {
    position: 'absolute', width: 100, height: 100, borderRadius: 50,
    borderWidth: StyleSheet.hairlineWidth, borderColor: color.border,
  },
  emptyIcon: {
    width: 68, height: 68, borderRadius: 34, backgroundColor: color.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  emptyTitle: { fontSize: font.h2, fontWeight: '700', color: color.text, textAlign: 'center' },
  emptyHint: { fontSize: font.sub, color: color.textSub, textAlign: 'center', marginTop: 5, lineHeight: 17 },
});
