/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
#import <AppKit/AppKit.h>

// Internal entry point accepts a private pasteboard for isolated unit checks.
// Returns 0 on success, 1 for invalid input, 2 for wrong thread, 3 on write failure.
int ZenWritePNG(NSPasteboard *pasteboard, const uint8_t *bytes, size_t length);
