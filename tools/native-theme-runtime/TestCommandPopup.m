/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Hidden AppKit windows exercise the actual compiled decoration API. No
// browser, activation, query text, or changes to the user's accessibility prefs.
#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <dlfcn.h>
#include <stdint.h>

@interface CommandOwner : NSWindow
@end
@implementation CommandOwner
- (BOOL)isVisible { return YES; }
@end
@interface PopupWindow : NSWindow
@property (weak) NSWindow *testParent;
@property BOOL testVisible;
@end
@implementation PopupWindow
- (NSWindow *)parentWindow { return self.testParent; }
- (BOOL)isVisible { return self.testVisible; }
@end
@interface ChildView : NSView
@end
@implementation ChildView
- (BOOL)isFlipped { return YES; }
@end

static NSUInteger checks;
static void Require(BOOL value, const char *label) {
  ++checks;
  if (!value) { fprintf(stderr, "FAIL: %s\n", label); exit(1); }
}
static NSView *Surface(PopupWindow *window) {
  for (NSView *view in window.contentView.subviews)
    if ([NSStringFromClass(view.class) isEqualToString:@"ZenCommandPopupSurface"]) return view;
  return nil;
}
static NSView *Backdrop(NSWindow *window) {
  for (NSView *child in window.contentView.subviews)
    for (NSView *view in child.subviews)
      if ([NSStringFromClass(view.class) isEqualToString:@"ZenCommandBackdrop"]) return view;
  return nil;
}
static PopupWindow *Popup(NSWindow *owner) {
  PopupWindow *window = [[PopupWindow alloc] initWithContentRect:NSMakeRect(40, 40, 400, 200)
    styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
  window.releasedWhenClosed = NO;
  window.testParent = owner; window.testVisible = YES;
  [window.contentView addSubview:[[ChildView alloc] initWithFrame:window.contentView.bounds]];
  return window;
}
int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc != 2) return 2;
    [NSApplication sharedApplication];
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    if (!library) { fprintf(stderr, "%s\n", dlerror()); return 2; }
    int (*sync)(uint64_t, const char *) = dlsym(library, "zen_command_popup_sync");
    int (*clear)(uint64_t) = dlsym(library, "zen_command_popup_clear");
    Require(sync && clear, "optional API available");
    CommandOwner *owner = [[CommandOwner alloc] initWithContentRect:NSMakeRect(0, 0, 800, 600)
      styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    owner.releasedWhenClosed = NO;
    ChildView *ownerChild = [[ChildView alloc] initWithFrame:owner.contentView.bounds];
    [owner.contentView addSubview:ownerChild];
    PopupWindow *popup = Popup(owner);
    popup.hasShadow = YES;
    uint64_t handle = (uintptr_t)(__bridge void *)owner;
    double top = NSMaxY(NSScreen.screens.firstObject.frame);
    NSDictionary *dark = @{@"space":@"srgb", @"rgba":@[@.08,@.09,@.1,@1]};
    NSDictionary *red = @{@"space":@"display-p3", @"rgba":@[@1,@0,@0,@1]};
    NSMutableDictionary *request = [@{
      @"popup": @[@40,@(top-240),@400,@200], @"clip": @[@10,@60,@380,@130],
      @"background": @{@"rect":@[@0,@0,@400,@200], @"color":dark, @"radius":@14},
      @"selected": @{@"rect":@[@10,@55,@380,@46], @"color":red, @"radius":@6},
      @"pill": @{@"rect":@[@50,@20,@73,@24], @"color":red, @"radius":@12}
    } mutableCopy];
    int (^apply)(void) = ^{
      NSData *data = [NSJSONSerialization dataWithJSONObject:request options:0 error:NULL];
      return sync(handle, [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
    };
    Require(apply() == 0, "matching popup accepts decorations");
    NSView *surface = Surface(popup);
    Require(surface && popup.contentView.subviews.firstObject == surface, "decorations below editor");
    Require([surface hitTest:NSMakePoint(20,20)] == nil, "no input interception");
    Require(!surface.isAccessibilityElement && surface.accessibilityChildren.count == 0, "no duplicate AX tree");
    CALayer *selected = [surface valueForKey:@"selectedFill"];
    Require(CFEqual(CGColorSpaceGetName(CGColorGetColorSpace(selected.backgroundColor)),
      kCGColorSpaceDisplayP3), "P3 color space retained");
    const CGFloat *components = CGColorGetComponents(selected.backgroundColor);
    Require(components[0] == 1 && components[1] == 0 && components[2] == 0, "red components retained");
    CALayer *clip = [surface valueForKey:@"rowsClip"];
    Require(clip.masksToBounds && selected.frame.origin.y == 89 && clip.frame.origin.y == 10,
      "scrolled row retains geometry inside the result clip");
    NSUInteger updates = [[surface valueForKey:@"updates"] unsignedIntegerValue];
    Require(apply() == 0 && [[surface valueForKey:@"updates"] unsignedIntegerValue] == updates,
      "identical request is an idle no-op");
    request[@"selected"] = NSNull.null;
    Require(apply() == 0 && selected.hidden, "cleared selection hides native row");
    NSMutableDictionary *background = [request[@"background"] mutableCopy];
    background[@"color"] = @{@"space":@"srgb", @"rgba":@[@.1,@.1,@.1,@.89]};
    request[@"background"] = background;
    Require(apply() == 3 && !Surface(popup), "translucent background restores CSS");
    request[@"material"] = @"popover";
    Require(apply() == 0, "explicit native material accepts translucent background");
    NSView *backdrop = Backdrop(owner);
    Require(backdrop && ownerChild.subviews.lastObject == backdrop,
      "material samples above the compositor inside the owning ChildView");
    Require(NSEqualRects(backdrop.frame, ownerChild.bounds) &&
      NSEqualRects([[backdrop valueForKey:@"panelRect"] rectValue], NSMakeRect(40,40,400,200)),
      "material matches popup body with viewport space for its shadow");
    CALayer *shadow = [backdrop valueForKey:@"shadowLayer"];
    Require(shadow.shadowOpacity == .5 && shadow.shadowRadius == 48 &&
      shadow.shadowOffset.height == -24 && shadow.shadowPath && !popup.hasShadow,
      "one native panel shadow has the reference geometry");
    Require([backdrop hitTest:NSMakePoint(20,20)] == nil && !backdrop.isAccessibilityElement &&
      backdrop.accessibilityHidden && backdrop.accessibilityChildren.count == 0,
      "material leaves input and accessibility to Gecko");
    Require([[Surface(popup) valueForKey:@"bodyFill"] isHidden], "material has no second solid background");
    updates = [[Surface(popup) valueForKey:@"updates"] unsignedIntegerValue];
    Require(apply() == 0 && [[Surface(popup) valueForKey:@"updates"] unsignedIntegerValue] == updates,
      "unchanged material is an idle no-op");
    CGPathRef shadowPath = shadow.shadowPath;
    request[@"selected"] = @{@"rect":@[@10,@101,@380,@46], @"color":red, @"radius":@6};
    Require(apply() == 0 && shadow.shadowPath == shadowPath,
      "changing a selected row does not regenerate the panel shadow");
    CAShapeLayer *mask = [backdrop valueForKey:@"shadowMask"];
    Require(!CGPathContainsPoint(mask.path, NULL, CGPointMake(100,100), YES) &&
      CGPathContainsPoint(mask.path, NULL, CGPointMake(500,300), YES),
      "shadow excludes the material body so it cannot darken its sampled page");
    [owner setFrameOrigin:NSMakePoint(10,20)];
    Require(apply() == 0 && NSEqualRects([[Backdrop(owner) valueForKey:@"panelRect"] rectValue],
      NSMakeRect(30,20,400,200)), "moving the owner cannot leave an idle request at stale coordinates");
    [owner setFrameOrigin:NSZeroPoint];
    Require(apply() == 0, "owner coordinates restore");
    int (*transitionVersion)(void) = dlsym(library, "zen_command_popup_transition_version");
    Require(transitionVersion && transitionVersion() == 1, "scope transition capability available");
    request[@"flash"] = @1; request[@"bounce"] = @1;
    Require(apply() == 0 && [Surface(popup) valueForKey:@"splash"] != nil,
      "entry creates a colored splash");
    CASpringAnimation *spring = (id)[popup.contentView.layer animationForKey:@"zen_commandBarBounce"];
    Require(spring && spring.duration == .1 && spring.autoreverses && spring.repeatCount == 1 &&
      fabs(spring.stiffness-pow(2*M_PI/.7,2)) < 1e-8 && fabs(spring.damping-.9*4*M_PI/.7) < 1e-8 &&
      fabs([spring.toValue CATransform3DValue].m11-.95) < 1e-8, "entry uses the reference spring");
    request[@"flash"] = @0; request[@"bounce"] = @2; request[@"pill"] = NSNull.null;
    Require(apply() == 0 && [Surface(popup) valueForKey:@"splash"] == nil,
      "exit immediately removes the colored splash");
    spring = (id)[popup.contentView.layer animationForKey:@"zen_commandBarBounce"];
    Require(spring && spring.duration == .1 && spring.autoreverses && spring.repeatCount == 1 &&
      fabs([spring.toValue CATransform3DValue].m11-.95) < 1e-8 &&
      [Backdrop(owner).layer animationForKey:@"zen_commandBarBounce"] != nil,
      "exit springs both the editor and page material without a scope pill");
    [popup.contentView.layer removeAnimationForKey:@"zen_commandBarBounce"];
    request[@"selected"] = NSNull.null;
    Require(apply() == 0 && ![popup.contentView.layer animationForKey:@"zen_commandBarBounce"],
      "selection updates cannot replay a completed transition token");
    request[@"pill"] = @{@"rect":@[@50,@20,@73,@24], @"color":red, @"radius":@12};
    request[@"flash"] = @3; request[@"bounce"] = @3;
    Require(apply() == 0 && [Surface(popup) valueForKey:@"splash"] &&
      [popup.contentView.layer animationForKey:@"zen_commandBarBounce"], "rapid re-entry replaces the exit spring");
    request[@"flash"] = @0; request[@"bounce"] = @0;
    Require(apply() == 0 && ![Surface(popup) valueForKey:@"splash"] &&
      ![popup.contentView.layer animationForKey:@"zen_commandBarBounce"] &&
      ![Backdrop(owner).layer animationForKey:@"zen_commandBarBounce"], "zero tokens cancel both effects");
    request[@"flash"] = @4; [request removeObjectForKey:@"bounce"];
    Require(apply() == 0 && [popup.contentView.layer animationForKey:@"zen_commandBarBounce"],
      "legacy callers retain their entry spring");
    request[@"bounce"] = @(-1);
    Require(apply() == 2 && !Surface(popup), "invalid transition tokens clear stale effects");
    request[@"bounce"] = @0; request[@"flash"] = @0;
    Require(apply() == 0, "valid requests recover after malformed tokens");
    [ownerChild removeFromSuperview];
    Require(apply() == 4 && !Surface(popup) && !Backdrop(owner), "missing page compositor clears both decorations");
    [owner.contentView addSubview:ownerChild];
    Require(apply() == 0 && clear(handle) == 0 && !Backdrop(owner) && !Surface(popup) && popup.hasShadow,
      "closing material removes decorations and restores the original window shadow");
    request[@"material"] = NSNull.null;
    background[@"color"] = dark;
    Require(apply() == 0, "fallback can recover");
    PopupWindow *ambiguous = Popup(owner);
    Require(apply() == 4 && !Surface(popup) && !Surface(ambiguous), "ambiguous target fails closed");
    ambiguous.testVisible = NO;
    Require(apply() == 0, "unique target recovers");
    popup.testParent = nil;
    Require(apply() == 4 && !Surface(popup), "foreign owner is rejected");
    popup.testParent = owner;
    Require(apply() == 0, "owned target recovers");
    Require(sync(handle, "invalid JSON") == 2 && !Surface(popup), "invalid request clears stale fills");
    Require(sync(UINT64_MAX, "{}") == 1, "untrusted handle is not dereferenced");
    Require(apply() == 0 && clear(handle) == 0 && !Surface(popup), "close removes decorations");
    Require(clear(handle) == 0, "repeated cleanup is safe");
    [ambiguous close]; [popup close]; [owner close];
    printf("{\"checks\":%lu,\"passed\":true}\n", (unsigned long)checks);
  }
  return 0;
}
