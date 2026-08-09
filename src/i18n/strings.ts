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
    // The first two are the SAME sign-in: admitSignIn reads the employee
    // directory and hands back the role. They are worded separately only so
    // each person recognises themselves — an owner coming back after a
    // sign-out did not see himself in "I work for a business", and the only
    // other button on the screen offered to start a second business.
    workForBusiness: 'I work for a business',
    ownBusiness: 'I own a business',
    createBusiness: 'Create a new business',
    createBusinessConfirmTitle: 'Type your business name to create it',
    // Shown when "I own a business" was refused. The generic refusal tells the
    // person to ask their owner, which is the wrong sentence for the one who
    // IS the owner — and it left him staring at a screen whose only remaining
    // route was the link he had already walked past.
    ownerNotOnList: (email: string) =>
      `${email} is not on any business's employee list yet. If the business is yours, type its name below to create it — if you work for someone, ask them to add exactly this address.`,
  },
  signIn: {
    google: 'Sign in with Google',
    noInternetFirstTime: 'Connect to the internet once to sign in — after that the app works offline.',
    notOnList: (email: string) =>
      `This Google account (${email}) is not on any business's employee list. Ask your owner to add exactly this address.`,
    accessEnded: 'Your access was ended by the owner.',
    // "Create a new business" from someone the directory already knows. They
    // are signed in to the business they belong to, so this explains the
    // workspace they asked for and did not get.
    alreadyInBusiness: (business: string, role: 'admin' | 'booker' | 'rider') => {
      const who = role === 'admin' ? 'the owner' : role === 'rider' ? 'a rider' : 'a booker';
      const where = business || 'a business';
      return `One email belongs to one business, and yours is already on ${where}'s employee list as ${who}. Nothing new was created — you are signed in to ${where}.`;
    },
  },
  tabs: {
    admin: { action: 'Action', dashboard: 'Dashboard', more: 'More' },
    booker: { route: 'Route', areaMap: 'Map', newOrder: 'New Order', myDay: 'My Day' },
    rider: { route: 'Route', areaMap: 'Map', history: 'History', handover: 'Handover' },
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
