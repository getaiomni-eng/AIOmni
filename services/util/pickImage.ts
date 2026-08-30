// services/util/pickImage.ts
//
// Pick a photo and hand back a SMALL base64 payload.
//
// v2026-08-29: both vision surfaces (Coach draft-board reader, Trade
// screenshot reader) called ImagePicker with `base64: true` at full
// resolution. A modern iPhone photo is 12-48MP, so:
//   - encoding blocked the JS thread long enough to look like a freeze
//   - the resulting string was multiple MB, making the upload slow and
//     fragile on cell connections
// and because the vision request had no timeout, a stalled upload left
// the UI stuck in its "reading" state with no way back out — exactly
// what a user hit mid-draft.
//
// Downscaling first fixes all of it: a 1400px-wide JPEG is far more than
// enough for a model to read names off a draft board or trade sheet, and
// the payload drops by roughly an order of magnitude.

import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

export type PickedImage = { base64: string; mimeType: string };

export type PickImageResult =
  | { status: 'ok'; image: PickedImage }
  | { status: 'canceled' }
  | { status: 'no_permission' }
  | { status: 'failed' };

export type PickImagesResult =
  | { status: 'ok'; images: PickedImage[] }
  | { status: 'canceled' }
  | { status: 'no_permission' }
  | { status: 'failed' };

// A draft board rarely fits in one screenshot — a 12-team, 15-round board
// is several screens. Three is the cap: enough to cover a full board,
// still a payload the vision call answers quickly.
export const MAX_IMAGES = 3;

const MAX_WIDTH = 1400;
const JPEG_QUALITY = 0.7;

// Multi-select variant. Downscales each pick in parallel; a single failed
// resize is dropped rather than failing the whole batch.
export async function pickImagesForVision(limit = MAX_IMAGES): Promise<PickImagesResult> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { status: 'no_permission' };

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      allowsMultipleSelection: true,
      selectionLimit: limit,
      orderedSelection: true,   // reading order matters for a draft board
    });
    if (res.canceled || !res.assets?.length) return { status: 'canceled' };

    const picked = await Promise.all(
      res.assets.slice(0, limit).map(async (a) => {
        try {
          const out = await manipulateAsync(
            a.uri,
            [{ resize: { width: MAX_WIDTH } }],
            { compress: JPEG_QUALITY, format: SaveFormat.JPEG, base64: true },
          );
          return out.base64 ? { base64: out.base64, mimeType: 'image/jpeg' } : null;
        } catch {
          return null;
        }
      }),
    );
    const images = picked.filter((i): i is PickedImage => i !== null);
    return images.length ? { status: 'ok', images } : { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

export async function pickImageForVision(): Promise<PickImageResult> {
  try {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return { status: 'no_permission' };

    // Note: no base64 here — we only want the URI until AFTER the resize.
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return { status: 'canceled' };

    const out = await manipulateAsync(
      res.assets[0].uri,
      [{ resize: { width: MAX_WIDTH } }],
      { compress: JPEG_QUALITY, format: SaveFormat.JPEG, base64: true },
    );
    if (!out.base64) return { status: 'failed' };
    return { status: 'ok', image: { base64: out.base64, mimeType: 'image/jpeg' } };
  } catch {
    return { status: 'failed' };
  }
}
