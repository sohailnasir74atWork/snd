/**
 * The two things a person standing at a shop can record about the place
 * itself: what it looks like, and where it is.
 *
 * Shared by the booker's route card, the rider's stop card and the admin's
 * shop list on purpose — this is exactly the kind of behaviour that, written
 * twice, drifts apart and hides a bug in the half nobody was looking at
 * (HANDOFF §5). One implementation, three call sites.
 */
import React from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Chip, space } from '../../components/ui';
import { capturePhotoBase64 } from '../../lib/photos';
import { uploadPhotoBase64 } from '../../lib/storage';
import type { Shop } from '../../data/models';

/**
 * Camera → CDN → the URL, or an explained failure.
 *
 * The upload needs signal (the slot is issued by a Cloud Function), so this
 * WILL fail in the field and that is not an error state worth panicking over:
 * the shop keeps working, the photo is simply not there yet. What it must
 * never do is fail silently, which is how the dead PDF share survived a whole
 * release.
 */
export function useShopPhoto() {
  const [capturing, setCapturing] = React.useState(false);
  const capture = React.useCallback((onUrl: (url: string) => void) => {
    if (capturing) return;
    setCapturing(true);
    void (async () => {
      try {
        const base64 = await capturePhotoBase64();
        if (base64 === null) return; // a real cancel, nothing to say
        const url = await uploadPhotoBase64(base64, 'shop');
        onUrl(url);
      } catch (e) {
        Alert.alert(
          'Photo not saved',
          `${e instanceof Error ? e.message : String(e)}\n\nThe shop is fine — add the photo next time you have signal.`,
        );
      } finally {
        setCapturing(false);
      }
    })();
  }, [capturing]);
  return { capturing, capture };
}

/**
 * The pin/photo chips for a shop that already exists.
 *
 * `Chip` still has no busy state (HANDOFF §6.4), so the double-tap guard is
 * the house fallback: swap the label and drop the handler.
 */
export function ShopPlaceChips({
  shop,
  onPin,
  onPhotoUrl,
}: {
  shop: Shop;
  onPin: () => void;
  onPhotoUrl: (url: string) => void;
}) {
  const { capturing, capture } = useShopPhoto();
  return (
    <>
      <Chip
        small
        // Absent is the case worth pushing: an unpinned shop is invisible to
        // the route. Once it has one, re-pinning is a quiet correction.
        selected={!shop.location}
        label={shop.location ? 'Move pin' : 'Save location'}
        onPress={onPin}
      />
      <Chip
        small
        label={capturing ? 'Saving photo…' : shop.photoUrl ? 'Retake photo' : 'Add photo'}
        onPress={capturing ? undefined : () => capture(onPhotoUrl)}
      />
    </>
  );
}

/**
 * The same pair inside the "new shop" form, where there is no document to
 * write to yet — both are held locally and travel with the create.
 */
export function NewShopPlaceChips({
  hasLocation,
  hasPhoto,
  onPin,
  onPhotoUrl,
}: {
  hasLocation: boolean;
  hasPhoto: boolean;
  onPin: () => void;
  onPhotoUrl: (url: string) => void;
}) {
  const { capturing, capture } = useShopPhoto();
  return (
    <View style={styles.row}>
      <Chip
        small
        selected={hasLocation}
        label={hasLocation ? '✓ Location saved' : 'Save location'}
        onPress={onPin}
      />
      <Chip
        small
        selected={hasPhoto}
        label={capturing ? 'Saving photo…' : hasPhoto ? '✓ Photo added' : 'Add photo'}
        onPress={capturing ? undefined : () => capture(onPhotoUrl)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
});
