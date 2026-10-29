/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#import <AppKit/AppKit.h>
#import <objc/message.h>
#include <math.h>
#include <stdint.h>

// Gecko sets the PopupWindow's appearance, but its visible NSPopover can keep
// inheriting the light parent appearance. Bridge that setting for unrebuilt
// engines. There are no hooks, timers, callbacks, or foreign-process access.
__attribute__((visibility("default")))
int zen_popover_sync_appearance(uint64_t ownerHandle, double x, double y,
                               double width, double height) {
  if (!NSThread.isMainThread || !isfinite(x) || !isfinite(y) ||
      !isfinite(width) || !isfinite(height) || width <= 0 || height <= 0)
    return 1;
  @try {
    NSWindow *owner = nil;
    for (NSWindow *window in NSApp.windows) {
      if ((uintptr_t)(__bridge void *)window == ownerHandle) owner = window;
    }
    if (!owner || !owner.isVisible || !NSScreen.screens.count) return 2;

    NSPopover *match = nil;
    NSAppearance *appearance = nil;
    const CGFloat screenTop = NSMaxY(NSScreen.screens.firstObject.frame);
    for (NSWindow *window in NSApp.windows) {
      if (![NSStringFromClass(window.class) isEqualToString:@"PopupWindow"] ||
          ![window respondsToSelector:@selector(popover)]) continue;
      NSPopover *popover = ((NSPopover *(*)(id, SEL))objc_msgSend)(
          window, @selector(popover));
      if (!popover.shown) continue;
      NSView *content = popover.contentViewController.view;
      NSWindow *visibleWindow = content.window;
      if (visibleWindow.parentWindow != owner) continue;
      NSRect bounds = [visibleWindow convertRectToScreen:
          [content convertRect:content.bounds toView:nil]];
      if (fabs(bounds.origin.x - x) > 1 ||
          fabs(screenTop - NSMaxY(bounds) - y) > 1 ||
          fabs(bounds.size.width - width) > 1 ||
          fabs(bounds.size.height - height) > 1) continue;
      // A stale or ambiguous match must never change another popup.
      if (match) return 3;
      match = popover;
      appearance = window.appearance;
    }
    if (!match) return 4;
    // nil is intentional: it restores native inheritance when Gecko requests it.
    match.appearance = appearance;
    return 0;
  } @catch (NSException *exception) { return 5; }
}
