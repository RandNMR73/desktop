/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
#import <AppKit/AppKit.h>

// Called only on the AppKit main thread. No callbacks into Gecko.
void ZenCloseCopyToast(NSWindow *window);
int ZenShowCopyToast(NSWindow *window, NSDictionary *palette, NSDictionary *request);
int ZenCopyToastStatus(NSWindow *window);
int ZenCopyToastGeometry(NSWindow *window, double *values, int count);
