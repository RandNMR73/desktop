/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#import <AppKit/AppKit.h>
#import "../native-theme-runtime/ZenNativeToast.h"
#include <assert.h>
#include <math.h>

// Model Gecko's native host invariant without loading a browser/profile.
@interface ChildView : NSView
@end
@implementation ChildView
- (BOOL)isFlipped { return YES; }
@end

int main(void) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(200, 200, 720, 420)
      styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];
    NSDictionary *palette = @{@"average":@[@.4,@.5,@.6,@1],
      @"darkHighlight":@NO, @"whiteForeground":@NO};
    NSDictionary *request = @{@"label":@"Copied Current URL",
      @"url":@"http://127.0.0.1/", @"height":@420, @"timeout":@2000, @"hold":@YES};
    NSView *content = window.contentView;
    ChildView *browser = [[ChildView alloc] initWithFrame:content.bounds];
    [content addSubview:browser];
    assert(ZenShowCopyToast(window, palette, request) == 0);
    assert(content.subviews.lastObject == browser);
    assert(content.subviews.count == 1);
    assert(browser.subviews.count == 1);
    NSView *toast = browser.subviews.lastObject;
    assert(fabs(NSMinY(toast.frame) - 18) < .01);
    assert(fabs(NSMaxX(toast.frame) - (NSWidth(browser.bounds) - 18)) < .01);
    assert(ZenShowCopyToast(window, palette, request) == 0);
    assert(browser.subviews.count == 1 && browser.subviews.lastObject == toast);

    // Replacing the Gecko host must detach the old view before recreation.
    [browser removeFromSuperview];
    ChildView *replacement = [[ChildView alloc] initWithFrame:content.bounds];
    [content addSubview:replacement];
    assert(ZenShowCopyToast(window, palette, request) == 0);
    assert(browser.subviews.count == 0 && replacement.subviews.count == 1);
    assert(content.subviews.lastObject == replacement);
    ZenCloseCopyToast(window);
    assert(replacement.subviews.count == 0 && ZenCopyToastStatus(window) == 0);

    // The standalone AppKit probe still supports an ordinary, unflipped host.
    [replacement removeFromSuperview];
    assert(ZenShowCopyToast(window, palette, request) == 0);
    assert(content.subviews.count == 1);
    toast = content.subviews.lastObject;
    assert(fabs(NSMaxY(toast.frame) - (NSHeight(content.bounds) - 18)) < .01);
    ZenCloseCopyToast(window);
    assert(content.subviews.count == 0);
    puts("Native notification host checks passed");
  }
  return 0;
}
