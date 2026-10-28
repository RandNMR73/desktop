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
    browser.accessibilityElement = YES;
    browser.accessibilityRole = NSAccessibilityGroupRole;
    [content addSubview:browser];
    NSArray *originalChildren = window.accessibilityChildren;
    assert([originalChildren containsObject:browser]);
    assert(ZenShowCopyToast(window, palette, request) == 0);
    assert(content.subviews.lastObject == browser);
    assert(content.subviews.count == 1);
    assert(browser.subviews.count == 1);
    NSView *toast = browser.subviews.lastObject;
    NSArray *shownChildren = window.accessibilityChildren;
    assert(shownChildren.count == originalChildren.count + 1);
    assert(shownChildren.lastObject == toast);
    assert(toast.accessibilityParent == window);
    assert([shownChildren containsObject:browser]);
    assert(fabs(NSMinY(toast.frame) - 18) < .01);
    assert(fabs(NSMaxX(toast.frame) - (NSWidth(browser.bounds) - 18)) < .01);
    assert(ZenShowCopyToast(window, palette, request) == 0);
    assert(browser.subviews.count == 1 && browser.subviews.lastObject == toast);

    // Replacing the Gecko host must detach the old view before recreation.
    [browser removeFromSuperview];
    ChildView *replacement = [[ChildView alloc] initWithFrame:content.bounds];
    replacement.accessibilityElement = YES;
    replacement.accessibilityRole = NSAccessibilityGroupRole;
    [content addSubview:replacement];
    assert(ZenShowCopyToast(window, palette, request) == 0);
    assert(browser.subviews.count == 0 && replacement.subviews.count == 1);
    assert(content.subviews.lastObject == replacement);
    ZenCloseCopyToast(window);
    assert(replacement.subviews.count == 0 && ZenCopyToastStatus(window) == 0);
    NSArray *replacementChildren = window.accessibilityChildren;
    assert([replacementChildren containsObject:replacement]);
    assert(![replacementChildren containsObject:browser]);
    assert(![replacementChildren containsObject:toast]);

    // The window must also reflect a root replacement after the toast closes.
    [replacement removeFromSuperview];
    [content addSubview:browser];
    assert([window.accessibilityChildren containsObject:browser]);
    assert(![window.accessibilityChildren containsObject:replacement]);
    [browser removeFromSuperview];
    [content addSubview:replacement];

    // A different UI may update the published children during the toast's
    // lifetime. Cleanup removes only our group and retains that update.
    assert(ZenShowCopyToast(window, palette, request) == 0);
    NSAccessibilityElement *other = [NSAccessibilityElement accessibilityElementWithRole:
      NSAccessibilityGroupRole frame:NSZeroRect label:@"Other UI" parent:window];
    NSArray *updated = [window.accessibilityChildren arrayByAddingObject:other];
    window.accessibilityChildren = updated;
    ZenCloseCopyToast(window);
    NSArray *remaining = window.accessibilityChildren;
    assert(remaining.count == replacementChildren.count + 1);
    assert(remaining.lastObject == other);

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
