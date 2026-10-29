// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { drawPortrait } from "./ZenPortraitCaptureImage.mjs";

// A one-job worker. No document access, network requests, persistence or idle
// lifetime. The owner terminates it immediately when the preview is cancelled.
self.onmessage = async ({ data: { image, settings } }) => {
  const canvas = new OffscreenCanvas(1, 1);
  try {
    drawPortrait(canvas, image, settings);
    const blob = await canvas.convertToBlob({ type: "image/png" });
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: String(error) });
  } finally {
    image.close();
    canvas.width = canvas.height = 0;
    self.close();
  }
};
