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
import { Icon, color, font, radius, shadow, space } from '../components/ui';
import { BrandHero, StaffHero } from '../components/BrandHero';
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
import { BillsScreen } from '../features/admin/BillsScreen';
import { OrderScreen } from '../features/admin/OrderScreen';
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
      <MoreStack.Screen name="Bills" component={BillsScreen} options={{ title: 'Bills' }} />
      <MoreStack.Screen name="Order" component={OrderScreen} options={{ title: 'Order' }} />
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
/**
 * Which door was chosen — and now it genuinely is a door.
 *
 * These two used to be one call apart only in the wording of a refusal: the
 * screen offered a choice, ignored it, and carried a line underneath owning up
 * to that. `employee` opens the login-ID form; `owner` opens Google.
 */
export type SignInIntent = 'employee' | 'owner';

/**
 * The staff door — §7.1. Three fields, all of them off one slip of paper the
 * owner wrote, and no dependency on Google, Play Services, SMS or an address
 * anybody has to remember.
 *
 * A returning man is asked for the PIN alone: the code and the ID are already
 * on the phone, and re-typing a business name he half-remembers at 7am on a
 * market street is exactly the friction this whole lane exists to remove.
 */
export function StaffSignInScreen({
  onSubmit,
  onBack,
  busy,
  initialCompanyCode,
  initialLoginId,
  knownName,
}: {
  onSubmit: (companyCode: string, loginId: string, pin: string) => void;
  onBack: () => void;
  busy?: boolean;
  initialCompanyCode?: string;
  initialLoginId?: string;
  /** Set for a returning person — collapses the form down to the PIN. */
  knownName?: string;
}) {
  const [companyCode, setCompanyCode] = React.useState(initialCompanyCode ?? '');
  const [loginId, setLoginId] = React.useState(initialLoginId ?? '');
  const [pin, setPin] = React.useState('');
  const [showPin, setShowPin] = React.useState(false);
  const returning = !!knownName && !!initialCompanyCode && !!initialLoginId;
  const ready =
    companyCode.trim().length > 0 && loginId.trim().length > 0 && pin.length === 6 && !busy;

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView
        style={styles.welcome}
        contentContainerStyle={styles.welcomeContent}
        keyboardShouldPersistTaps="handled">
        {/* The returning man is typing six digits into an autofocused field
            with the keyboard already up — there is no room for a picture and
            nothing left to explain. */}
        {!returning && <StaffHero />}
        <Text style={styles.staffTitle}>
          {returning ? `Welcome back, ${knownName}` : 'Sign in to work'}
        </Text>
        <Text style={styles.staffHint}>
          {returning
            ? 'Enter your 6-digit PIN to carry on.'
            : 'Use the business code, login ID and PIN your owner gave you.'}
        </Text>

        {!returning && (
          <>
            <Text style={styles.fieldLabel}>Business code</Text>
            <TextInput
              style={styles.input}
              value={companyCode}
              onChangeText={t => setCompanyCode(t.trim().toLowerCase())}
              placeholder="e.g. alitraders"
              placeholderTextColor={color.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />

            <Text style={styles.fieldLabel}>Login ID</Text>
            <TextInput
              style={styles.input}
              value={loginId}
              onChangeText={t => setLoginId(t.trim().toLowerCase())}
              placeholder="e.g. ali"
              placeholderTextColor={color.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!busy}
            />
          </>
        )}

        {returning && (
          <View style={styles.staffWho}>
            <Text style={styles.staffWhoText} numberOfLines={1}>
              {initialLoginId} · {initialCompanyCode}
            </Text>
          </View>
        )}

        <Text style={styles.fieldLabel}>PIN</Text>
        <View style={styles.pinRow}>
          <TextInput
            style={[styles.input, styles.pinInput]}
            value={pin}
            // Digits only, so a stray letter from a sticky keyboard cannot
            // silently make a 6-character PIN that is not the one on the slip.
            onChangeText={t => setPin(t.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            placeholderTextColor={color.textFaint}
            keyboardType="number-pad"
            secureTextEntry={!showPin}
            maxLength={6}
            autoFocus={returning}
            editable={!busy}
          />
          {/* Daylight, a cracked screen and six dots is a bad combination. */}
          <Pressable
            style={styles.pinEye}
            accessibilityLabel={showPin ? 'Hide PIN' : 'Show PIN'}
            onPress={() => setShowPin(v => !v)}>
            <Icon
              name={showPin ? 'eye-off-outline' : 'eye-outline'}
              size={22}
              color={color.textSub}
            />
          </Pressable>
        </View>

        <Pressable
          style={[styles.primaryBtn, styles.staffGo, !ready && styles.btnDisabled]}
          disabled={!ready}
          accessibilityState={{ disabled: !ready, busy: !!busy }}
          onPress={ready ? () => onSubmit(companyCode, loginId, pin) : undefined}>
          <View style={styles.btnRow}>
            {busy ? <ActivityIndicator size="small" color={color.onDark} /> : null}
            <Text style={styles.primaryBtnText}>{busy ? 'Signing in…' : 'Sign in'}</Text>
          </View>
        </Pressable>

        <Pressable
          style={styles.linkBtn}
          disabled={busy}
          accessibilityState={{ disabled: !!busy }}
          onPress={busy ? undefined : onBack}>
          <Text style={[styles.linkBtnText, busy && styles.secondaryBtnTextDisabled]}>
            {returning ? 'Use a different login' : 'Back'}
          </Text>
        </Pressable>

        <Text style={styles.staffFoot}>
          Forgot your PIN? Only your owner can reset it — ask him for a new one.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

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
  lastAccount?: {
    email: string;
    name: string;
    kind: 'google' | 'staff';
    loginId?: string;
    companyCode?: string;
  } | null;
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
        {/* Short while the create-business field is up: the keyboard takes
            most of the screen, and a full-height drawing above a form is a
            drawing nobody can see past. */}
        <BrandHero height={creating ? 116 : 190} />
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
            {/* A staff address is synthesised and meaningless on sight. What
                the man recognises is the pair he was handed on a slip. */}
            <Text style={styles.accountLine} numberOfLines={1}>
              {lastAccount?.kind === 'staff' && lastAccount.loginId
                ? `${lastAccount.loginId} · ${lastAccount.companyCode}`
                : lastAccount?.email}
            </Text>
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
            {/* Two doors that lead to different places, so each one can say
                where it goes. The staff button is the big target — most people
                opening this app for the first time were handed a phone, not a
                bill. Starting a business is the rare path and stays a link, but
                a divider gives it enough room to be found on purpose. */}
            <Pressable
              style={[styles.choiceCard, busy && styles.choiceOff]}
              disabled={busy}
              accessibilityState={{ disabled: !!busy }}
              onPress={busy ? undefined : () => onSignIn('employee')}>
              {/* A key, because that is literally what he was handed. */}
              <View style={[styles.choiceTile, { backgroundColor: color.ctaSoft }]}>
                <Icon name="key-variant" size={22} color={color.cta} />
              </View>
              <View style={styles.choiceBody}>
                <Text style={styles.choiceTitle}>{strings.welcome.workForBusiness}</Text>
                <Text style={styles.choiceSub}>{strings.welcome.workForBusinessSub}</Text>
              </View>
              <Icon name="chevron-right" size={22} color={color.textFaint} />
            </Pressable>

            <Pressable
              style={[styles.choiceCard, busy && styles.choiceOff]}
              disabled={busy}
              accessibilityState={{ disabled: !!busy, busy: !!busy }}
              onPress={busy ? undefined : () => onSignIn('owner')}>
              {/* The shopfront from the drawing above. Only this door does work
                  on press — the other just opens a form — so it is the only one
                  that can be waited on, and the spinner takes the tile's place
                  rather than shoving the title sideways. */}
              <View style={[styles.choiceTile, { backgroundColor: color.primarySoft }]}>
                {busy
                  ? <ActivityIndicator size="small" color={color.primary} />
                  : <Icon name="storefront-outline" size={22} color={color.primary} />}
              </View>
              <View style={styles.choiceBody}>
                <Text style={styles.choiceTitle}>{strings.welcome.ownBusiness}</Text>
                <Text style={styles.choiceSub}>{strings.welcome.ownBusinessSub}</Text>
              </View>
              <Icon name="chevron-right" size={22} color={color.textFaint} />
            </Pressable>

            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{strings.welcome.startingFresh}</Text>
              <View style={styles.dividerLine} />
            </View>

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
  // Carries the canvas colour as well as the flex: when the keyboard shrinks
  // this, anything it uncovers must not flash white.
  fill: { flex: 1, backgroundColor: color.bg },
  // Split in two so the keyboard can shrink the scroller: the canvas keeps
  // flex, the old padding/centring moves to the content container.
  welcome: { flex: 1, backgroundColor: color.bg },
  /**
   * Centred, biased slightly UP.
   *
   * With `justifyContent: center` the free space splits evenly, so the heavier
   * bottom padding lifts the block by half the difference — optical centre sits
   * nearer 45% than 50%, and true centre reads as having drifted low.
   *
   * The bias was 96pt when this screen was mostly empty air; BrandHero fills
   * most of that now, and the demo card sits below this scroller rather than
   * inside it, so a small lift is all that is left to correct.
   *
   * On the staff form with the keyboard up the content is taller than the
   * scroller, so none of this applies and the padding is simply scroll room.
   */
  welcomeContent: {
    flexGrow: 1, alignItems: 'stretch', justifyContent: 'center',
    paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48,
  },
  // The dark rounded SnD square that used to sit here is gone: BrandHero draws
  // the scene and the wordmark below carries the name, so the square was a
  // third brand statement competing with both.
  appName: { fontSize: 24, fontWeight: '800', color: color.text, textAlign: 'center', marginBottom: space.s },
  // Was 32. The buttons now carry a line of their own each, so the old gap on
  // top of that pushed the whole block into the dead middle of the screen.
  appTag: { fontSize: font.body, color: color.textSub, textAlign: 'center', marginBottom: space.xl },
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
  /**
   * The address sits under the button rather than inside it: the button says
   * who you are, this says which account that is, without crowding the label.
   *
   * The spacing is what makes that true, and it used to say the opposite. With
   * 14 above (the button's own margin plus this one) and 4 below, the line was
   * nearer to "Use a different account" than to the button it describes — so
   * it read as a caption for the wrong control, and floated in the gap
   * belonging to neither. It is now roughly 1:2, which groups it upward: the
   * 10 above is the button's margin alone, kept rather than tightened further
   * because the CTA's shadow spreads about that far and text any closer sits
   * inside the glow.
   */
  accountLine: {
    fontSize: font.sub, color: color.textSub, textAlign: 'center',
    marginBottom: space.xl,
  },
  /**
   * The fork, as two cards rather than two pills.
   *
   * The descriptions used to sit BETWEEN the buttons as loose grey lines, which
   * is a caption belonging to nothing — the eye cannot tell whether it explains
   * the button above it or labels the one below. Inside the card there is no
   * question. The icons are the other half: two identical full-width pills gave
   * the eye nothing to sort by, and a key and a shopfront are recognised long
   * before either title is read.
   */
  choiceCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: color.surface,
    borderRadius: radius.card + 2, paddingVertical: space.m, paddingHorizontal: space.l,
    minHeight: 68, marginBottom: space.m,
    // Plain card edge all the way round. The colour lives in the icon tile
    // alone — a solid crimson card put a third saturated red on a screen that
    // already has a red van and a red pin, and it shouted over the artwork it
    // sits under.
    borderWidth: 1, borderColor: color.cardEdge,
    ...shadow.card,
  },
  choiceOff: { opacity: 0.55 },
  choiceTile: {
    width: 40, height: 40, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  choiceBody: { flex: 1, minWidth: 0, marginLeft: space.m },
  choiceTitle: { fontSize: font.h2, fontWeight: '800', color: color.text },
  choiceSub: { fontSize: font.sub, marginTop: 2, lineHeight: 16, color: color.textSub },
  // Gives "Create a new business" a room of its own. It is the rare path, so
  // it stays a link — but a link nobody trips over is also a link nobody finds.
  divider: { flexDirection: 'row', alignItems: 'center', marginTop: space.s, gap: space.m },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: color.border },
  dividerText: { fontSize: font.sub, color: color.textFaint, fontWeight: '600' },
  linkBtn: { alignItems: 'center', justifyContent: 'center', minHeight: 44, marginTop: space.s },
  // Was identical to secondaryBtnText — same size, same weight, same blue — so
  // the third option shouted as loudly as the second. It stays blue, because it
  // is a real action and greying it would read as unavailable; the weight is
  // what puts it third. Size holds at font.body: this screen is read at arm's
  // length in daylight, and shrinking the signup path is the wrong trade.
  linkBtnText: { fontSize: font.body, fontWeight: '600', color: color.primary },
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

  // ---- Staff door ---------------------------------------------------------
  staffTitle: {
    fontSize: font.h1, fontWeight: '800', color: color.text,
    textAlign: 'center', marginBottom: space.s,
  },
  staffHint: {
    fontSize: font.body, color: color.textSub, textAlign: 'center',
    lineHeight: font.body + 6, marginBottom: space.xl,
  },
  fieldLabel: {
    fontSize: font.sub, fontWeight: '700', color: color.textSub, marginBottom: space.xs,
  },
  // The returning man's identity, shown rather than asked for.
  staffWho: {
    backgroundColor: color.surfaceAlt, borderRadius: radius.card,
    paddingVertical: space.m, paddingHorizontal: space.m, marginBottom: space.l,
    alignItems: 'center',
  },
  staffWhoText: { fontSize: font.body, fontWeight: '700', color: color.text },
  // The eye sits INSIDE the field's box rather than beside it, so the row does
  // not shrink the PIN field to make room for a 44pt target.
  pinRow: { position: 'relative', justifyContent: 'center' },
  pinInput: { paddingRight: 52, letterSpacing: 6, fontSize: font.h2 },
  pinEye: {
    position: 'absolute', right: 0, top: 0, bottom: space.l,
    width: 48, alignItems: 'center', justifyContent: 'center',
  },
  staffGo: { marginTop: space.xs },
  staffFoot: {
    fontSize: font.sub, color: color.textFaint, textAlign: 'center',
    lineHeight: font.sub + 6, marginTop: space.l,
  },
});
