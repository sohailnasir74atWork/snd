/**
 * Centralised strings — §5.4 / §13 Localisation.
 *
 * English only in v1 (owner decision, SRS v1.9). Every user-visible string
 * lives here; hardcoded literals in components fail lint. The complete Urdu
 * set with RTL drops in as v1.1+ translation work, no redesign.
 */

export const strings = {
  common: {
    appName: 'SnD Manager',
    more: 'More',
    refresh: 'Refresh',
    undo: 'Undo',
    today: 'Today',
    tomorrow: 'Tomorrow',
    pendingSync: 'pending sync',
    call: 'Call',
    navigate: 'Navigate',
    whatsapp: 'WhatsApp',
  },
  welcome: {
    workForBusiness: 'I work for a business',
    createBusiness: 'Create a new business',
    createBusinessConfirmTitle: 'Type your business name to create it',
  },
  signIn: {
    google: 'Sign in with Google',
    noInternetFirstTime: 'Connect to the internet once to sign in — after that the app works offline.',
    notOnList: (email: string) =>
      `This Google account (${email}) is not on any business's employee list. Ask your owner to add exactly this address.`,
    accessEnded: 'Your access was ended by the owner.',
  },
  tabs: {
    admin: { action: 'Action', dashboard: 'Dashboard', more: 'More' },
    booker: { route: 'Route', newOrder: 'New Order', myDay: 'My Day' },
    rider: { route: 'Route', history: 'History', handover: 'Handover' },
  },
  order: {
    sameAsLastTime: 'Same as last time',
    startEmpty: 'Start empty',
    noOrder: 'No order',
    tellTheRider: 'Tell the rider',
    confirmationHeading: 'ORDER CONFIRMATION — this is not a bill',
    confirmationFooter: 'Your bill comes with the delivery',
  },
  delivery: {
    startRoute: 'Start route',
    vanLoadedDeliverTomorrow: 'Van already loaded — deliver tomorrow',
    full: 'FULL',
    oldKhata: '+ old khata',
    tryTomorrow: 'Try tomorrow',
    sendBack: 'Send back',
  },
  money: {
    handOver: 'Hand over',
    confirm: 'Confirm',
    withStaff: 'with staff',
    confirmed: 'confirmed',
    cashExceptionButton: 'Cash accepted — exception',
    payNow: (formatted: string) => `Pay ${formatted} now`,
  },
  statuses: {
    toDeliver: 'To deliver',
    done: 'Done',
    problem: 'Problem',
  },
  rewards: {
    section: 'Counter-staff rewards',
    approve: 'Approve',
    reject: 'Reject',
  },
} as const;

export type Strings = typeof strings;
