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
    // Two doors that really are two doors. These used to be one call apart
    // only in the wording of a refusal, which meant the screen offered a
    // choice and then ignored it — and needed a line underneath admitting so.
    workForBusiness: 'I work for a business',
    // Sits under the button. The rider does not know what a "login" is until
    // he is told where it comes from: the man who hired him.
    workForBusinessSub: 'Your owner gives you a login ID and PIN',
    ownBusiness: 'I own a business',
    ownBusinessSub: 'Sign in with Google',
    createBusiness: 'Create a new business',
    startingFresh: 'Starting fresh?',
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
    // A revoked token locally looks identical whether the man was removed or
    // his PIN was just reset — the phone is holding a dead session either way
    // and cannot ask which. Telling a rider whose PIN was reset that his access
    // was "ended by the owner" reads as being fired, so this covers both and
    // accuses nobody.
    signedOutRemotely:
      'The owner signed this phone out. If your PIN was reset, sign in with the new one — otherwise ask him.',
    // Staff lane. Deliberately does NOT say which of the three was wrong: a
    // six-digit PIN stops being six digits' worth of protection the moment the
    // screen confirms that a login ID exists.
    badStaffLogin:
      'Business code, login ID or PIN is wrong. Check the slip your owner gave you — or ask him to reset your PIN.',
    pinLocked:
      'Too many wrong tries. Wait a few minutes and try again, or ask your owner to reset your PIN.',
    // Says the PIN is fine FIRST, because the man holding the slip will
    // otherwise spend the morning retyping six digits that were always right.
    // The bracket is for whoever is setting the business up — it is the only
    // string in the app that names a console, and it earns it: this error has
    // exactly one cause and exactly one fix.
    staffLoginsOff:
      'Staff logins are not switched on for this app yet — your PIN is fine. The owner needs to finish setup (Firebase Console → Authentication → Sign-in method → enable Email/Password).',
    // The account authenticated but its directory row is gone — a broken
    // record, not an uninvited guest, so it must not read like a rejection.
    staffNotOnList:
      'This login is no longer connected to a business. Ask your owner to set it up again.',
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
    // `newOrder` is a screen title now, not a tab — booking is reached from Route.
    booker: { route: 'Route', areaMap: 'Map', newOrder: 'New order', myDay: 'My Day' },
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
