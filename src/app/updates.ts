/**
 * Keep the installed build current — Google Play in-app updates.
 *
 * The booker and the rider never open the Play Store, so a shipped fix would
 * simply never reach their phones. Play's own flow is used rather than a
 * home-made "new version" dialog: the store downloads and installs, so nothing
 * here ever touches an APK.
 *
 * Two rules, both learned from what this app is for:
 *
 *  1. It NEVER blocks the field. No signal means no update is detected and the
 *     app carries on; every failure path here is silent.
 *  2. Only a HIGH-PRIORITY release takes over the screen. Priority is set per
 *     release in the Play Console (0–5); anything below 4 downloads quietly in
 *     the background and asks to restart when the person is between jobs.
 *     Forcing a full-screen update onto a rider halfway through a route is
 *     exactly the wrong moment.
 *
 * Only works on a build INSTALLED BY PLAY — a sideloaded or emulator build
 * reports no update available, which is why this cannot be smoke-tested
 * locally.
 */
import { Alert, Platform } from 'react-native';
import SpInAppUpdates, {
  IAUInstallStatus,
  IAUUpdateKind,
  type AndroidNeedsUpdateResponse,
  type StatusUpdateEvent,
} from 'sp-react-native-in-app-updates';

/** Play Console "update priority" at or above which we interrupt the person. */
const FORCE_AT_PRIORITY = 4;

export async function checkForAppUpdate(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const updates = new SpInAppUpdates(__DEV__);
    const result = (await updates.checkNeedsUpdate()) as AndroidNeedsUpdateResponse;
    if (!result.shouldUpdate) return;

    const extras = result.other;
    const priority = extras?.updatePriority ?? 0;

    if (priority >= FORCE_AT_PRIORITY && extras?.isImmediateUpdateAllowed) {
      // Play takes the screen and installs; the app restarts on its own.
      await updates.startUpdate({ updateType: IAUUpdateKind.IMMEDIATE });
      return;
    }

    if (!extras?.isFlexibleUpdateAllowed) return;

    // Flexible: Play fetches the bytes in the background. We only speak up
    // once it is fully downloaded, so a delivery is never interrupted by it.
    const onStatus = (status: StatusUpdateEvent) => {
      if (status.status !== IAUInstallStatus.DOWNLOADED) return;
      updates.removeStatusUpdateListener(onStatus);
      Alert.alert(
        'Update ready',
        'A new version is downloaded. It installs when the app restarts — anything ' +
          'you saved without a signal is kept and still syncs afterwards.',
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Restart now', onPress: () => updates.installUpdate() },
        ],
      );
    };
    updates.addStatusUpdateListener(onStatus);
    await updates.startUpdate({ updateType: IAUUpdateKind.FLEXIBLE });
  } catch {
    // An update check must never be the reason someone cannot start work.
  }
}
