/**
 * Role-based navigation — §7: three fixed bottom tabs per role,
 * nothing used daily more than two taps from home.
 */
import React from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { strings } from '../i18n/strings';
import { Icon, color, font, radius, space } from '../components/ui';
import type { Role } from './types';
import {
  BookerRouteScreen, MyDayScreen, NewOrderScreen, ShopSearchScreen,
} from '../features/booker/BookerScreens';
import { RiderHandoverScreen, RiderHistoryScreen, RiderRouteScreen } from '../features/rider/RiderScreens';
import { CollectScreen } from '../features/rider/CollectScreen';
import { AdminActionScreen, AdminDashboardScreen, AdminMoreMenu } from '../features/admin/AdminScreens';
import { ProductsScreen } from '../features/admin/ProductsScreen';
import { ShopsScreen } from '../features/admin/ShopsScreen';
import { AreasScreen } from '../features/admin/AreasScreen';
import { TeamDayScreen } from '../features/admin/TeamDayScreen';
import { AreaSweepScreen } from '../features/shops/AreaSweepScreen';
import { EmployeesScreen } from '../features/admin/EmployeesScreen';
import { SettingsScreen } from '../features/admin/SettingsScreen';
import { ReportsScreen } from '../features/admin/ReportsScreen';
import { ExpensesScreen } from '../features/admin/ExpensesScreen';

const MoreStack = createNativeStackNavigator();
const RiderStack = createNativeStackNavigator();
const BookerStack = createNativeStackNavigator();

/**
 * The booker's first tab: his round, with the order form and the shop search
 * pushed on top of it.
 *
 * "New order" used to be a tab of its own, and a tab has to be able to stand
 * on its own — so it opened on a picker listing his whole round grouped by
 * area, which is the Route screen drawn a second time from the same shops. Two
 * lists of the same thing is where the confusion came from, and it doubled
 * every future change to a shop row. There is one list now, and booking is
 * something you do TO a shop rather than a place you go.
 *
 * `onSwitchRole` is threaded through because the tab's own header is gone:
 * the account switch lives on this stack's header instead, beside the search.
 */
function BookerRouteStack({ onSwitchRole }: { onSwitchRole?: () => void }) {
  return (
    <BookerStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: color.surface },
        headerTintColor: color.text,
        headerTitleStyle: { fontWeight: '700', fontSize: font.h2 },
        headerShadowVisible: false,
      }}>
      <BookerStack.Screen
        name="RouteHome"
        component={BookerRouteScreen}
        options={({ navigation }) => ({
          title: strings.tabs.booker.route,
          headerRight: () => (
            <View style={styles.headerRow}>
              <Pressable onPress={() => navigation.navigate('ShopSearch')} style={styles.headerBtn}>
                <Icon name="magnify" size={22} color={color.primary} />
              </Pressable>
              {onSwitchRole && (
                <Pressable onPress={onSwitchRole} style={styles.headerBtn}>
                  <Icon name="account-switch-outline" size={20} color={color.primary} />
                </Pressable>
              )}
            </View>
          ),
        })}
      />
      <BookerStack.Screen name="NewOrder" component={NewOrderScreen}
        options={{ title: strings.tabs.booker.newOrder }} />
      <BookerStack.Screen name="ShopSearch" component={ShopSearchScreen}
        options={{ title: 'Find a shop' }} />
    </BookerStack.Navigator>
  );
}

/**
 * The rider's third tab: today's handover, with his past days one tap behind
 * it. Keeps the three-fixed-tabs rule (§5.4) without orphaning History.
 */
function RiderHandoverStack() {
  return (
    <RiderStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: color.surface },
        headerTintColor: color.text,
        headerTitleStyle: { fontWeight: '700', fontSize: font.h2 },
        headerShadowVisible: false,
      }}>
      <RiderStack.Screen name="HandoverHome" component={RiderHandoverScreen}
        options={({ navigation }) => ({
          title: 'Handover',
          headerRight: () => (
            <Pressable onPress={() => navigation.navigate('History')} style={styles.headerBtn}>
              <Icon name="history" size={22} color={color.primary} />
            </Pressable>
          ),
        })} />
      <RiderStack.Screen name="History" component={RiderHistoryScreen} options={{ title: 'Past days' }} />
    </RiderStack.Navigator>
  );
}

function AdminMoreStack() {
  return (
    <MoreStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: color.surface },
        headerTintColor: color.text,
        headerTitleStyle: { fontWeight: '700', fontSize: font.h2 },
        headerShadowVisible: false,
      }}>
      <MoreStack.Screen name="MoreHome" component={AdminMoreMenu} options={{ title: strings.common.appName }} />
      <MoreStack.Screen name="Shops" component={ShopsScreen} options={{ title: 'Shops' }} />
      <MoreStack.Screen name="Areas" component={AreasScreen} options={{ title: 'Areas' }} />
      <MoreStack.Screen name="Products" component={ProductsScreen} options={{ title: 'Products' }} />
      <MoreStack.Screen name="Employees" component={EmployeesScreen} options={{ title: 'Employees' }} />
      <MoreStack.Screen name="TeamDay" component={TeamDayScreen} options={{ title: 'Team today' }} />
      <MoreStack.Screen name="Reports" component={ReportsScreen} options={{ title: 'Reports' }} />
      <MoreStack.Screen name="Expenses" component={ExpensesScreen} options={{ title: 'Expenses' }} />
      <MoreStack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </MoreStack.Navigator>
  );
}

/** Guided empty state (§5.4) shown while a feature area is under construction. */
function Placeholder({ title, hint }: { title: string; hint: string }) {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderTitle}>{title}</Text>
      <Text style={styles.placeholderHint}>{hint}</Text>
    </View>
  );
}

const Tab = createBottomTabNavigator();

/** Outline vector icons — §5.4: obvious for first-time smartphone users. */
const TAB_ICONS: Record<string, string> = {
  Action: 'lightning-bolt-outline',
  Dashboard: 'view-dashboard-outline',
  MoreAdmin: 'menu',
  Route: 'map-marker-outline',
  AreaMap: 'map-marker-path',
  NewOrder: 'cart-outline',
  MyDay: 'notebook-outline',
  RouteRider: 'truck-outline',
  AreaMapRider: 'map-marker-path',
  Collect: 'cash-plus',
  History: 'history',
  Handover: 'cash-multiple',
};

const SCREENS: Record<string, React.ComponentType> = {
  Action: AdminActionScreen,
  Dashboard: AdminDashboardScreen,

  Route: BookerRouteScreen,
  // Same screen for both roles: the round is the round, whoever is walking it.
  AreaMap: AreaSweepScreen,
  AreaMapRider: AreaSweepScreen,
  NewOrder: NewOrderScreen,
  MyDay: MyDayScreen,
  RouteRider: RiderRouteScreen,
  Collect: CollectScreen,
  History: RiderHistoryScreen,
  Handover: RiderHandoverScreen,
};

function tabScreen(name: string, title: string, hint: string) {
  const Screen = SCREENS[name];
  return (
    <Tab.Screen
      key={name}
      name={name}
      options={{
        title,
        tabBarIcon: ({ focused }) => (
          <Icon name={TAB_ICONS[name] ?? 'circle-small'} size={24}
            color={focused ? color.primary : color.textFaint} />
        ),
      }}>
      {Screen ? () => <Screen /> : () => <Placeholder title={title} hint={hint} />}
    </Tab.Screen>
  );
}

/**
 * The account-switch button shares the header row, so the screen name is
 * pinned to one line and ellipsised rather than wrapped or cropped.
 * Defined at module scope so the header is not rebuilt on every render.
 */
function renderHeaderTitle({ children }: { children: string }) {
  return <Text style={styles.headerTitle} numberOfLines={1}>{children}</Text>;
}

export function RoleTabs({ role, onSwitchRole }: { role: Role; onSwitchRole?: () => void }) {
  const t = strings.tabs;
  // Android 15+ forces edge-to-edge for targetSdk 35+, so the system gesture
  // bar draws OVER the tab bar unless we grow it by the bottom inset. A fixed
  // height here silently cut the labels in half on real phones.
  const insets = useSafeAreaInsets();
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: color.surface },
        headerTintColor: color.text,
        headerTitleStyle: { fontWeight: '700', fontSize: font.h2 },
        headerTitle: renderHeaderTitle,
        headerShadowVisible: false,
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.textFaint,
        tabBarStyle: {
          backgroundColor: color.surface,
          borderTopColor: color.border,
          // 56 (was 60) is the tightest constant that still clears the 24pt
          // icon plus the 11pt label. The `+ insets.bottom` terms must stay.
          height: 56 + insets.bottom,
          paddingBottom: space.s + insets.bottom,
          paddingTop: space.xs,
        },
        tabBarLabelStyle: { fontSize: font.tiny + 1, fontWeight: '700' },
        headerRight: onSwitchRole
          ? () => (
              <Pressable onPress={onSwitchRole} style={styles.headerBtn}>
                <Icon name="account-switch-outline" size={20} color={color.primary} />
              </Pressable>
            )
          : undefined,
      }}>
      {role === 'admin' && [
        tabScreen('Action', t.admin.action, 'Cash to confirm, problem orders and old credit will stack here — an empty screen means a calm day.'),
        tabScreen('Dashboard', t.admin.dashboard, "Today's sales, cash (confirmed vs with staff), profit and stock tiles arrive here."),
        <Tab.Screen
          key="MoreAdmin"
          name="MoreAdmin"
          component={AdminMoreStack}
          options={{
            title: t.admin.more,
            headerShown: false,
            tabBarIcon: ({ focused }) => (
              <Icon name={TAB_ICONS.MoreAdmin} size={24}
                color={focused ? color.primary : color.textFaint} />
            ),
          }}
        />,
      ]}
      {role === 'booker' && [
        <Tab.Screen
          key="RouteTab"
          name="RouteTab"
          options={{
            title: t.booker.route,
            headerShown: false,
            tabBarIcon: ({ focused }) => (
              <Icon name={TAB_ICONS.Route} size={24}
                color={focused ? color.primary : color.textFaint} />
            ),
          }}>
          {() => <BookerRouteStack onSwitchRole={onSwitchRole} />}
        </Tab.Screen>,
        tabScreen('AreaMap', t.booker.areaMap, 'Pick a round and be walked through it shop by shop, nearest first.'),
        tabScreen('MyDay', t.booker.myDay, 'Your orders, shelf counts, reward claims and the evening float handover.'),
      ]}
      {role === 'rider' && [
        tabScreen('RouteRider', t.rider.route, 'Load list first — Start route freezes the van. Then area-grouped stops with amounts to collect.'),
        tabScreen('AreaMapRider', t.rider.areaMap, 'Pick a round and be walked through it shop by shop, nearest first.'),
        tabScreen('Collect', 'Collect', 'Take money from a shop without a delivery.'),
        <Tab.Screen
          key="HandoverTab"
          name="HandoverTab"
          component={RiderHandoverStack}
          options={{
            title: t.rider.handover,
            headerShown: false,
            tabBarIcon: ({ focused }) => (
              <Icon name={TAB_ICONS.Handover} size={24}
                color={focused ? color.primary : color.textFaint} />
            ),
          }}
        />,
      ]}
    </Tab.Navigator>
  );
}

/**
 * Welcome — §7.1: the employee button is the big target; creating a business
 * demands a typed name first so a stray tap can never make an empty workspace.
 *
 * `busy` is the gate's sign-in flag. Sign-in opens the Google account chooser
 * and then a Cloud Function that can bootstrap a whole business, so every
 * button here has to go dead — and visibly so — until it comes back.
 */
/** Which button was pressed. The server decides the role either way — this
 *  only says how to read a REFUSAL, which is different for the two people. */
export type SignInIntent = 'employee' | 'owner';

export function WelcomeScreen({
  onSignIn,
  onCreateBusiness,
  onContinue,
  onUseAnother,
  lastAccount,
  busy,
  creating,
  onCreatingChange,
  createNote,
}: {
  onSignIn: (intent: SignInIntent) => void;
  onCreateBusiness: (businessName: string) => void;
  /** Returning person on their own phone — straight back in, no chooser. */
  onContinue?: () => void;
  onUseAnother?: () => void;
  lastAccount?: { email: string; name: string } | null;
  busy?: boolean;
  /**
   * Controlled by the gate, not by this screen: a refused "I own a business"
   * has to be able to open this form itself. Owned locally, the owner who was
   * turned away had nowhere to go but the link he had already walked past.
   */
  creating: boolean;
  onCreatingChange: (creating: boolean) => void;
  /** Why the form opened, when it opened by itself rather than by a tap. */
  createNote?: string | null;
}) {
  const [businessName, setBusinessName] = React.useState('');
  // One press only: a typed name AND no sign-in already in flight.
  const canCreate = businessName.trim().length > 0 && !busy;
  // "Do you work for a business, or are you starting one?" is worth asking
  // once. After that the phone knows, and putting "Create a new business"
  // under the returning owner's thumb is just a way to go wrong.
  const returning = !creating && !!lastAccount && !!onContinue;
  return (
    <KeyboardAvoidingView
      style={styles.fill}
      // The business-name field sits low on the screen and autofocuses. The
      // manifest's adjustResize is not enough on its own now the app is
      // edge-to-edge (targetSdk 36) — without this the keyboard covers the
      // field and the confirm button under it.
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.welcome}
        contentContainerStyle={styles.welcomeContent}
        // Otherwise the first tap on the confirm button only dismisses the
        // keyboard and the press itself is swallowed.
        keyboardShouldPersistTaps="handled">
        <View style={styles.logoMark}>
          <Text style={styles.logoS}>S</Text>
          <Text style={styles.logoN}>n</Text>
          <Text style={styles.logoD}>D</Text>
        </View>
        <Text style={styles.appName}>{strings.common.appName}</Text>
        <Text style={styles.appTag}>Orders, deliveries and khata — in one app</Text>
        {returning ? (
          <>
            <Pressable
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
              disabled={busy}
              accessibilityState={{ disabled: !!busy, busy: !!busy }}
              onPress={busy ? undefined : onContinue}>
              <View style={styles.btnRow}>
                {busy ? <ActivityIndicator size="small" color={color.onDark} /> : null}
                <Text style={styles.primaryBtnText} numberOfLines={1}>
                  {lastAccount?.name ? `Continue as ${lastAccount.name}` : 'Continue'}
                </Text>
              </View>
            </Pressable>
            <Text style={styles.accountLine} numberOfLines={1}>{lastAccount?.email}</Text>
            <Pressable
              style={[styles.secondaryBtn, busy && styles.secondaryBtnDisabled]}
              disabled={busy}
              accessibilityState={{ disabled: !!busy }}
              onPress={busy ? undefined : onUseAnother}>
              <Text style={[styles.secondaryBtnText, busy && styles.secondaryBtnTextDisabled]}>
                Use a different account
              </Text>
            </Pressable>
          </>
        ) : !creating ? (
          <>
            {/* Both of these are one and the same sign-in — the server reads
                the employee directory and hands back the role. They are two
                buttons so each person recognises themselves, not because the
                app needs to be told. Starting a business is the rare path and
                is demoted to a link so nobody reaches for it by default. */}
            <Pressable
              style={[styles.primaryBtn, busy && styles.btnDisabled]}
              disabled={busy}
              accessibilityState={{ disabled: !!busy, busy: !!busy }}
              onPress={busy ? undefined : () => onSignIn('employee')}>
              <View style={styles.btnRow}>
                {busy ? <ActivityIndicator size="small" color={color.onDark} /> : null}
                <Text style={styles.primaryBtnText}>{strings.welcome.workForBusiness}</Text>
              </View>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, busy && styles.secondaryBtnDisabled]}
              disabled={busy}
              accessibilityState={{ disabled: !!busy, busy: !!busy }}
              onPress={busy ? undefined : () => onSignIn('owner')}>
              <View style={styles.btnRow}>
                {busy ? <ActivityIndicator size="small" color={color.primary} /> : null}
                <Text style={[styles.secondaryBtnText, busy && styles.secondaryBtnTextDisabled]}>
                  {strings.welcome.ownBusiness}
                </Text>
              </View>
            </Pressable>
            <Text style={styles.signInNote}>Both sign in with Google — we know who you are</Text>
            <Pressable
              style={styles.linkBtn}
              disabled={busy}
              accessibilityState={{ disabled: !!busy }}
              onPress={busy ? undefined : () => onCreatingChange(true)}>
              <Text style={[styles.linkBtnText, busy && styles.secondaryBtnTextDisabled]}>
                {strings.welcome.createBusiness}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            {createNote ? <Text style={styles.createNote}>{createNote}</Text> : null}
            <Text style={styles.confirmTitle}>{strings.welcome.createBusinessConfirmTitle}</Text>
            <TextInput
              style={styles.input}
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="e.g. Glow Skincare"
              autoFocus
              // The name is already on its way to the server; let it settle.
              editable={!busy}
            />
            <Pressable
              style={[styles.primaryBtn, !canCreate && styles.btnDisabled]}
              disabled={!canCreate}
              accessibilityState={{ disabled: !canCreate, busy: !!busy }}
              onPress={canCreate ? () => onCreateBusiness(businessName.trim()) : undefined}>
              <View style={styles.btnRow}>
                {busy ? <ActivityIndicator size="small" color={color.onDark} /> : null}
                <Text style={styles.primaryBtnText}>
                  {businessName.trim()
                    ? `Create "${businessName.trim()}"`
                    : 'Type the name to continue'}
                </Text>
              </View>
            </Pressable>
            <Pressable
              style={[styles.secondaryBtn, busy && styles.secondaryBtnDisabled]}
              disabled={busy}
              accessibilityState={{ disabled: !!busy }}
              onPress={busy ? undefined : () => onCreatingChange(false)}>
              <Text style={[styles.secondaryBtnText, busy && styles.secondaryBtnTextDisabled]}>Back</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function AppNavigation({ role, onSwitchRole }: { role: Role; onSwitchRole?: () => void }) {
  return (
    <NavigationContainer>
      <RoleTabs role={role} onSwitchRole={onSwitchRole} />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  headerTitle: { fontSize: font.h2, fontWeight: '700', color: color.text },
  // Header icon buttons: a 44pt-tall target inside the header row.
  headerBtn: {
    paddingHorizontal: space.l, minHeight: 44,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
  },
  // Two header buttons side by side: search, then the account switch. Tighter
  // padding than a lone button so the pair does not crowd the title.
  headerRow: { flexDirection: 'row', alignItems: 'center', marginRight: -space.s },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: color.bg },
  placeholderTitle: { fontSize: font.h1, fontWeight: '700', color: color.text, marginBottom: space.m },
  placeholderHint: { fontSize: font.body, color: color.textSub, textAlign: 'center', lineHeight: 20 },
  fill: { flex: 1 },
  // Split in two so the keyboard can shrink the scroller: the canvas keeps
  // flex, the old padding/centring moves to the content container.
  welcome: { flex: 1, backgroundColor: color.bg },
  welcomeContent: { flexGrow: 1, alignItems: 'stretch', justifyContent: 'center', padding: 24 },
  logoMark: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: '#0F172A', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 12,
    marginBottom: space.l, shadowColor: '#0F172A', shadowOpacity: 0.3, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  // Brand literals stay; only the mark's scale comes down with the new type.
  logoS: { color: '#2DD4BF', fontSize: 34, fontWeight: '800' },
  logoN: { color: '#94A3B8', fontSize: 22, fontWeight: '800', marginBottom: 2 },
  logoD: { color: '#FFFFFF', fontSize: 34, fontWeight: '800' },
  appName: { fontSize: 24, fontWeight: '800', color: color.text, textAlign: 'center', marginBottom: space.s },
  appTag: { fontSize: font.body, color: color.textSub, textAlign: 'center', marginBottom: 32 },
  primaryBtn: {
    backgroundColor: color.cta, borderRadius: radius.pill, paddingVertical: space.l,
    // minHeight keeps the one-handed target at 48 even as the padding tightens.
    minHeight: 48, alignItems: 'center', justifyContent: 'center', marginBottom: space.m,
    shadowColor: color.cta, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  primaryBtnText: { color: '#fff', fontSize: font.body + 1, fontWeight: '700', flexShrink: 1 },
  // Spinner beside the label while the press is being served.
  btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.s },
  secondaryBtn: {
    borderRadius: radius.pill, paddingVertical: space.m + 2, minHeight: 44,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
    borderColor: color.primary, backgroundColor: color.surface,
  },
  secondaryBtnText: { color: color.primary, fontSize: font.body, fontWeight: '700' },
  // Unavailable reads as a flat grey fill, not a dimmed crimson pill — at
  // arm's length in daylight, opacity alone still looked pressable.
  btnDisabled: { backgroundColor: color.textFaint, shadowOpacity: 0, elevation: 0 },
  secondaryBtnDisabled: { borderColor: color.border, backgroundColor: color.surfaceAlt },
  secondaryBtnTextDisabled: { color: color.textFaint },
  // The address sits under the button rather than inside it: the button says
  // who you are, this says which account that is, without crowding the label.
  accountLine: {
    fontSize: font.sub, color: color.textSub, textAlign: 'center',
    marginTop: space.xs, marginBottom: space.xs,
  },
  // Says the quiet part out loud: the two buttons above are one action, so
  // picking the "wrong" one costs nothing.
  signInNote: {
    fontSize: font.sub, color: color.textFaint, textAlign: 'center',
    marginTop: space.s,
  },
  linkBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: space.m },
  linkBtnText: { fontSize: font.body, fontWeight: '700', color: color.primary },
  // Why this form appeared without being asked for. Sits above the title so
  // the refused address is the first thing read, not an afterthought.
  createNote: {
    fontSize: font.sub, color: color.textSub, textAlign: 'center',
    lineHeight: font.sub + 6, marginBottom: space.l,
  },
  confirmTitle: { fontSize: font.h2, fontWeight: '600', color: color.text, marginBottom: space.m, textAlign: 'center' },
  input: {
    backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.border,
    // Padding down to space.m, so minHeight carries the 44pt touch target.
    padding: space.m, minHeight: 44, fontSize: font.body + 1, marginBottom: space.l, color: color.text,
  },
});
