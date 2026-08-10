/**
 * The welcome illustration — the app's one piece of real artwork.
 *
 * It draws the sentence the tagline says: a van on a round, a shop at the end
 * of it, and a khata page with a line ticked off. A distributor recognises his
 * own working day in it before he has read a word, which is the whole job of a
 * hero on a sign-in screen.
 *
 * Every colour is a theme token. Nothing here invents a shade — an illustration
 * that drifts off the palette is what makes an app look assembled rather than
 * designed. The two literals are the logo teal and a darker crimson used only
 * as the van's own shading, neither of which is a UI colour.
 *
 * Vector, not a PNG: this sits on a light canvas at whatever width the phone
 * happens to be, and a raster asset would either band on the gradient or ship
 * three densities to avoid it.
 */
import React from 'react';
import { View } from 'react-native';
import Svg, {
  Circle, Defs, Ellipse, G, Path, RadialGradient, Rect, Stop,
} from 'react-native-svg';
import { color } from './theme';

/** The van's shadow side. Not a UI colour — it exists only inside this drawing. */
const CTA_DEEP = '#BE123C';
/** The `n` of the SnD mark, reused on the shop's signboard. */
const BRAND_TEAL = '#2DD4BF';
const LINE = '#CBD5E1';

export function BrandHero({ height = 190 }: { height?: number }) {
  return (
    <View style={{ height, width: '100%' }} pointerEvents="none">
      {/* One viewBox, scaled to whatever height the caller asks for — the
          create-business form passes a short one so the keyboard still leaves
          room for the field it is covering. */}
      <Svg width="100%" height="100%" viewBox="0 0 320 190" preserveAspectRatio="xMidYMid meet">
        <Defs>
          {/* Fades into the canvas instead of ending on a hard disc edge. */}
          <RadialGradient id="halo" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color.primarySoft} stopOpacity="0.85" />
            <Stop offset="1" stopColor={color.primarySoft} stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Circle cx="160" cy="92" r="86" fill="url(#halo)" />

        {/* ---- The round: a dashed arc from the van to the shop ------------ */}
        <Path
          d="M 100 58 C 128 16 200 16 228 92"
          stroke={color.primary}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="1 8"
          fill="none"
          opacity="0.55"
        />
        {/* The stop at the top of the arc. */}
        <G>
          <Path
            d="M 164 14 a 10 10 0 0 1 10 10 c 0 7.5 -10 17 -10 17 s -10 -9.5 -10 -17 a 10 10 0 0 1 10 -10 Z"
            fill={color.cta}
          />
          <Circle cx="164" cy="24" r="3.8" fill={color.surface} />
        </G>

        {/* ---- Khata: the page that gets ticked ---------------------------
            Clear of the signboard in both axes. At x=14/y=36 its right edge
            landed exactly on the sign's left edge (x=58) and overlapped it
            vertically — and since the shop is drawn after this, the sign cut
            across the card and it read as clipped rather than as a separate
            thing floating nearby. */}
        <G>
          <Rect x="8" y="16" width="44" height="34" rx="5"
            fill={color.surface} stroke={color.border} strokeWidth="1.5" />
          <Rect x="15" y="25" width="22" height="2.6" rx="1.3" fill={LINE} />
          <Rect x="15" y="32" width="15" height="2.6" rx="1.3" fill={LINE} />
          <Path d="M 15 41 l 4.5 4.5 l 9 -10"
            stroke={color.success} strokeWidth="2.6" strokeLinecap="round"
            strokeLinejoin="round" fill="none" />
        </G>

        {/* ---- Ground: contact shadows, not a drawn line ------------------ */}
        <Ellipse cx="100" cy="157" rx="56" ry="5" fill={color.textFaint} opacity="0.16" />
        <Ellipse cx="228" cy="157" rx="52" ry="5" fill={color.textFaint} opacity="0.16" />

        {/* ---- The shop ---------------------------------------------------- */}
        <G>
          {/* Signboard, in the mark's own dark with the mark's own teal dot. */}
          <Rect x="58" y="56" width="84" height="17" rx="4" fill={color.text} />
          <Circle cx="68" cy="64.5" r="3.4" fill={BRAND_TEAL} />
          <Rect x="77" y="63" width="54" height="3" rx="1.5" fill={color.onDark} opacity="0.55" />

          <Rect x="56" y="82" width="88" height="74" rx="4"
            fill={color.surface} stroke={color.border} strokeWidth="1.5" />
          {/* Awning: one solid sweep with a darker lip, rather than scallops
              that turn to mush below about 40pt tall. */}
          <Path d="M 62 74 L 138 74 L 148 94 L 52 94 Z" fill={BRAND_TEAL} />
          <Path d="M 52 94 L 148 94 L 148 98 L 52 98 Z" fill={BRAND_TEAL} opacity="0.55" />

          <Rect x="66" y="112" width="28" height="44" rx="3" fill={color.primarySoft} />
          <Circle cx="88" cy="134" r="2.2" fill={color.textFaint} />
          <Rect x="104" y="112" width="32" height="26" rx="3" fill={color.primarySoft} />
        </G>

        {/* ---- The van ----------------------------------------------------- */}
        <G>
          <Rect x="180" y="98" width="60" height="46" rx="5" fill={color.cta} />
          {/* Cab, a shade deeper so the box reads as a separate volume. */}
          <Path d="M 240 110 L 256 110 L 272 130 L 272 144 L 240 144 Z" fill={CTA_DEEP} />
          <Path d="M 244 115 L 254 115 L 265 129 L 244 129 Z" fill={color.primarySoft} />
          <Rect x="180" y="144" width="92" height="5" rx="2.5" fill={CTA_DEEP} />
          {/* The parcel on the side — the one thing the van is carrying. */}
          <Rect x="192" y="110" width="26" height="22" rx="3" fill={color.onDark} opacity="0.9" />
          <Rect x="192" y="119" width="26" height="3" fill={color.cta} opacity="0.35" />

          <Circle cx="200" cy="149" r="11" fill={color.text} />
          <Circle cx="200" cy="149" r="4.6" fill={color.surfaceAlt} />
          <Circle cx="256" cy="149" r="11" fill={color.text} />
          <Circle cx="256" cy="149" r="4.6" fill={color.surfaceAlt} />
        </G>
      </Svg>
    </View>
  );
}

/**
 * The staff door's illustration — the slip, and the key it is.
 *
 * It draws the exact object the man is holding while he looks at this screen:
 * a piece of paper with three things written on it, the last of them six
 * digits. Nothing abstract, because the one question this screen has to answer
 * on sight is "where do I get these from" — and the answer is "the thing in
 * your hand".
 *
 * Short and wide on purpose: the form below it is three fields and a keyboard,
 * and a tall drawing here would push the PIN box under the keys.
 */
export function StaffHero({ height = 124 }: { height?: number }) {
  return (
    <View style={{ height, width: '100%' }} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 320 130" preserveAspectRatio="xMidYMid meet">
        <Defs>
          <RadialGradient id="staffHalo" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color.primarySoft} stopOpacity="0.85" />
            <Stop offset="1" stopColor={color.primarySoft} stopOpacity="0" />
          </RadialGradient>
        </Defs>

        <Circle cx="158" cy="64" r="66" fill="url(#staffHalo)" />
        <Ellipse cx="185" cy="120" rx="68" ry="5" fill={color.textFaint} opacity="0.15" />

        {/* ---- The slip ---------------------------------------------------- */}
        <G>
          <Rect x="110" y="14" width="150" height="100" rx="10"
            fill={color.surface} stroke={color.border} strokeWidth="1.5" />
          <Rect x="124" y="26" width="52" height="6" rx="3" fill={LINE} />

          {/* Business code, login ID — a coloured bullet each, so the three
              lines read as three separate things rather than a paragraph. */}
          <Circle cx="128" cy="50" r="4" fill={BRAND_TEAL} />
          <Rect x="140" y="46" width="64" height="7" rx="3.5" fill={color.text} opacity="0.82" />
          <Circle cx="128" cy="72" r="4" fill={color.primary} />
          <Rect x="140" y="68" width="48" height="7" rx="3.5" fill={color.text} opacity="0.82" />

          {/* The PIN, drawn as six — the count is the point. */}
          <Circle cx="128" cy="94" r="4" fill={color.cta} />
          {[142, 152, 162, 172, 182, 192].map(cx => (
            <Circle key={cx} cx={cx} cy="94" r="3.4" fill={color.text} opacity="0.82" />
          ))}
        </G>

        {/* ---- The key, laid across the slip ------------------------------- */}
        <G>
          <Circle cx="56" cy="64" r="15" fill="none" stroke={color.cta} strokeWidth="6" />
          <Rect x="70" y="61" width="42" height="6" rx="3" fill={color.cta} />
          <Rect x="94" y="67" width="6" height="9" rx="2" fill={color.cta} />
          <Rect x="104" y="67" width="6" height="13" rx="2" fill={color.cta} />
        </G>
      </Svg>
    </View>
  );
}
