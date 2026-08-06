/**
 * Role-based navigation — §7: three fixed bottom tabs per role,
 * nothing used daily more than two taps from home.
 */
import React from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { strings } from '../i18n/strings';
import { Icon, color } from '../components/ui';
import type { Role } from './types';
import { BookerRouteScreen, MyDayScreen, NewOrderScreen } from '../features/booker/BookerScreens';
import { RiderHandoverScreen, RiderHistoryScreen, RiderRouteScreen } from '../features/rider/RiderScreens';
import { CollectScreen } from '../features/rider/CollectScreen';
import { AdminActionScreen, AdminDashboardScreen, AdminMoreMenu } from '../features/admin/AdminScreens';
import { ProductsScreen } from '../features/admin/ProductsScreen';
import { ShopsScreen } from '../features/admin/ShopsScreen';
import { EmployeesScreen } from '../features/admin/EmployeesScreen';
import { SettingsScreen } from '../features/admin/SettingsScreen';
import { ReportsScreen } from '../features/admin/ReportsScreen';
import { ExpensesScreen } from '../features/admin/ExpensesScreen';

const MoreStack = createNativeStackNavigator();
const RiderStack = createNativeStackNavigator();

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
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
        headerShadowVisible: false,
      }}>
      <RiderStack.Screen name="HandoverHome" component={RiderHandoverScreen}
        options={({ navigation }) => ({
          title: 'Handover',
          headerRight: () => (
            <Pressable onPress={() => navigation.navigate('History')} style={{ paddingHorizontal: 12 }}>
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
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
        headerShadowVisible: false,
      }}>
      <MoreStack.Screen name="MoreHome" component={AdminMoreMenu} options={{ title: strings.common.appName }} />
      <MoreStack.Screen name="Shops" component={ShopsScreen} options={{ title: 'Shops' }} />
      <MoreStack.Screen name="Products" component={ProductsScreen} options={{ title: 'Products' }} />
      <MoreStack.Screen name="Employees" component={EmployeesScreen} options={{ title: 'Employees' }} />
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
  NewOrder: 'cart-outline',
  MyDay: 'notebook-outline',
  RouteRider: 'truck-outline',
  Collect: 'cash-plus',
  History: 'history',
  Handover: 'cash-multiple',
};

const SCREENS: Record<string, React.ComponentType> = {
  Action: AdminActionScreen,
  Dashboard: AdminDashboardScreen,

  Route: BookerRouteScreen,
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

export function RoleTabs({ role, onSwitchRole }: { role: Role; onSwitchRole?: () => void }) {
  const t = strings.tabs;
  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: color.surface },
        headerTintColor: color.text,
        headerTitleStyle: { fontWeight: '700', fontSize: 18 },
        headerShadowVisible: false,
        tabBarActiveTintColor: color.primary,
        tabBarInactiveTintColor: color.textFaint,
        tabBarStyle: { backgroundColor: color.surface, borderTopColor: color.border, height: 60, paddingBottom: 6, paddingTop: 4 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        headerRight: onSwitchRole
          ? () => (
              <Pressable onPress={onSwitchRole} style={{ paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }}>
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
        tabScreen('Route', t.booker.route, "Today's visit list builds itself: due shops, grouped by area, a day's work at most."),
        tabScreen('NewOrder', t.booker.newOrder, 'Pick the shop you are standing at, tap Same as last time, choose Today or Tomorrow, send.'),
        tabScreen('MyDay', t.booker.myDay, 'Your orders, shelf counts, reward claims and the evening float handover.'),
      ]}
      {role === 'rider' && [
        tabScreen('RouteRider', t.rider.route, 'Load list first — Start route freezes the van. Then area-grouped stops with amounts to collect.'),
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
 */
export function WelcomeScreen({
  onSignIn,
  onCreateBusiness,
}: {
  onSignIn: () => void;
  onCreateBusiness: (businessName: string) => void;
}) {
  const [creating, setCreating] = React.useState(false);
  const [businessName, setBusinessName] = React.useState('');
  return (
    <View style={styles.welcome}>
      <View style={styles.logoMark}>
        <Text style={styles.logoS}>S</Text>
        <Text style={styles.logoN}>n</Text>
        <Text style={styles.logoD}>D</Text>
      </View>
      <Text style={styles.appName}>{strings.common.appName}</Text>
      <Text style={styles.appTag}>Orders, deliveries and khata — in one app</Text>
      {!creating ? (
        <>
          <Pressable style={styles.primaryBtn} onPress={onSignIn}>
            <Text style={styles.primaryBtnText}>{strings.welcome.workForBusiness}</Text>
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={() => setCreating(true)}>
            <Text style={styles.secondaryBtnText}>{strings.welcome.createBusiness}</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.confirmTitle}>{strings.welcome.createBusinessConfirmTitle}</Text>
          <TextInput
            style={styles.input}
            value={businessName}
            onChangeText={setBusinessName}
            placeholder="e.g. Glow Skincare"
            autoFocus
          />
          <Pressable
            style={[styles.primaryBtn, !businessName.trim() && styles.btnDisabled]}
            disabled={!businessName.trim()}
            onPress={() => onCreateBusiness(businessName.trim())}>
            <Text style={styles.primaryBtnText}>
              {businessName.trim()
                ? `Create "${businessName.trim()}"`
                : 'Type the name to continue'}
            </Text>
          </Pressable>
          <Pressable style={styles.secondaryBtn} onPress={() => setCreating(false)}>
            <Text style={styles.secondaryBtnText}>Back</Text>
          </Pressable>
        </>
      )}
    </View>
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
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: color.bg },
  placeholderTitle: { fontSize: 22, fontWeight: '700', color: color.text, marginBottom: 10 },
  placeholderHint: { fontSize: 15, color: color.textSub, textAlign: 'center', lineHeight: 22 },
  welcome: { flex: 1, alignItems: 'stretch', justifyContent: 'center', padding: 28, backgroundColor: color.bg },
  logoMark: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: '#0F172A', borderRadius: 24, paddingHorizontal: 22, paddingVertical: 14,
    marginBottom: 18, shadowColor: '#0F172A', shadowOpacity: 0.3, shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  logoS: { color: '#2DD4BF', fontSize: 40, fontWeight: '800' },
  logoN: { color: '#94A3B8', fontSize: 26, fontWeight: '800', marginBottom: 2 },
  logoD: { color: '#FFFFFF', fontSize: 40, fontWeight: '800' },
  appName: { fontSize: 30, fontWeight: '800', color: color.text, textAlign: 'center', marginBottom: 6 },
  appTag: { fontSize: 14, color: color.textSub, textAlign: 'center', marginBottom: 44 },
  primaryBtn: {
    backgroundColor: color.cta, borderRadius: 26, paddingVertical: 17, alignItems: 'center', marginBottom: 14,
    shadowColor: color.cta, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  primaryBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  secondaryBtn: {
    borderRadius: 26, paddingVertical: 13, alignItems: 'center', borderWidth: 1,
    borderColor: color.primary, backgroundColor: color.surface,
  },
  secondaryBtnText: { color: color.primary, fontSize: 15, fontWeight: '700' },
  btnDisabled: { opacity: 0.4 },
  confirmTitle: { fontSize: 17, fontWeight: '600', color: color.text, marginBottom: 12, textAlign: 'center' },
  input: {
    backgroundColor: color.surface, borderRadius: 12, borderWidth: 1, borderColor: color.border,
    padding: 14, fontSize: 17, marginBottom: 16, color: color.text,
  },
});
