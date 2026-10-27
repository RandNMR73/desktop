/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#import "ZenNativeToast.h"
#import <QuartzCore/QuartzCore.h>
#import <objc/runtime.h>
#include <math.h>

static const char toastKey;

@interface ZenToastPanel : NSPanel
@end
@implementation ZenToastPanel
- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

@class ZenCopyToast;
@interface ZenToastView : NSVisualEffectView
@property(weak) ZenCopyToast *owner;
@property NSTrackingArea *tracking;
@end

@interface ZenToastButton : NSButton
@property BOOL hovered;
@property BOOL whiteForeground;
@property NSTrackingArea *tracking;
@end

@interface ZenCopyToast : NSObject <NSSharingServicePickerDelegate>
@property(weak) NSWindow *parent;
@property ZenToastPanel *panel;
@property ZenToastView *surface;
@property NSTextField *label;
@property ZenToastButton *button;
@property NSURL *url;
@property NSTimer *timer;
@property NSArray *observers;
@property NSSharingServicePicker *picker;
@property CGFloat viewportHeight;
@property NSTimeInterval timeout;
@property BOOL hovered;
@property BOOL hold;
@property BOOL closed;
@property NSUInteger generation;
- (void)schedule;
- (void)hover:(BOOL)value;
- (void)close;
- (void)position;
- (void)share:(id)sender;
@end

@implementation ZenToastView
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (self.tracking) [self removeTrackingArea:self.tracking];
  self.tracking = [[NSTrackingArea alloc] initWithRect:NSZeroRect options:
    NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect
    owner:self userInfo:nil];
  [self addTrackingArea:self.tracking];
}
- (void)mouseEntered:(NSEvent *)event { [self.owner hover:YES]; }
- (void)mouseExited:(NSEvent *)event { [self.owner hover:NO]; }
@end

@implementation ZenToastButton
- (BOOL)acceptsFirstResponder { return NO; }
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (self.tracking) [self removeTrackingArea:self.tracking];
  self.tracking = [[NSTrackingArea alloc] initWithRect:NSZeroRect options:
    NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect
    owner:self userInfo:nil];
  [self addTrackingArea:self.tracking];
}
- (void)mouseEntered:(NSEvent *)event { self.hovered = YES; self.needsDisplay = YES; }
- (void)mouseExited:(NSEvent *)event { self.hovered = NO; self.needsDisplay = YES; }
- (void)drawRect:(NSRect)dirty {
  NSBezierPath *path = [NSBezierPath bezierPathWithRoundedRect:
    NSInsetRect(self.bounds, .5, .5) xRadius:7 yRadius:7];
  NSColor *shade = self.whiteForeground ? NSColor.blackColor : NSColor.whiteColor;
  CGFloat upper = self.hovered ? .8 : .65, lower = self.hovered ? .6 : .45;
  if (self.highlighted) { upper -= .15; lower -= .15; }
  NSGradient *gradient = [[NSGradient alloc] initWithStartingColor:
    [shade colorWithAlphaComponent:upper] endingColor:[shade colorWithAlphaComponent:lower]];
  [gradient drawInBezierPath:path angle:-90];
  [[NSColor.blackColor colorWithAlphaComponent:.3] setStroke];
  path.lineWidth = .5;
  [path stroke];
  NSImage *image = [NSImage imageWithSystemSymbolName:@"square.and.arrow.up" accessibilityDescription:nil];
  image = [image imageWithSymbolConfiguration:
    [NSImageSymbolConfiguration configurationWithPointSize:16 weight:NSFontWeightRegular]];
  NSColor *foreground = self.whiteForeground ? NSColor.whiteColor : NSColor.blackColor;
  image = [image imageWithSymbolConfiguration:
    [NSImageSymbolConfiguration configurationWithPaletteColors:@[foreground]]];
  NSRect icon = NSMakeRect((NSWidth(self.bounds) - image.size.width) / 2,
    (NSHeight(self.bounds) - image.size.height) / 2, image.size.width, image.size.height);
  [image drawInRect:icon];
}
@end

@implementation ZenCopyToast
- (instancetype)init {
  if (!(self = [super init])) return nil;
  self.panel = [[ZenToastPanel alloc] initWithContentRect:NSMakeRect(0, 0, 196, 47)
    styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel
    backing:NSBackingStoreBuffered defer:NO];
  self.panel.releasedWhenClosed = NO;
  self.panel.opaque = NO;
  self.panel.backgroundColor = NSColor.clearColor;
  self.panel.hasShadow = YES;
  self.panel.hidesOnDeactivate = YES;
  self.panel.animationBehavior = NSWindowAnimationBehaviorNone;
  self.panel.collectionBehavior = NSWindowCollectionBehaviorFullScreenAuxiliary |
    NSWindowCollectionBehaviorTransient | NSWindowCollectionBehaviorIgnoresCycle;
  self.surface = [[ZenToastView alloc] initWithFrame:self.panel.contentView.bounds];
  self.surface.owner = self;
  self.surface.material = (NSVisualEffectMaterial)1; // Reference: legacy Light.
  self.surface.blendingMode = NSVisualEffectBlendingModeWithinWindow;
  self.surface.state = NSVisualEffectStateActive;
  self.surface.emphasized = NO;
  self.surface.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
  self.surface.wantsLayer = YES;
  self.surface.layer.cornerRadius = 12;
  self.surface.layer.cornerCurve = kCACornerCurveContinuous;
  self.surface.layer.masksToBounds = YES;
  self.panel.contentView = self.surface;
  self.label = [NSTextField labelWithString:@""];
  self.label.font = [NSFont systemFontOfSize:14 weight:NSFontWeightMedium];
  self.label.lineBreakMode = NSLineBreakByTruncatingTail;
  self.label.maximumNumberOfLines = 1;
  [self.surface addSubview:self.label];
  self.button = [[ZenToastButton alloc] initWithFrame:NSMakeRect(0, 10, 31, 27)];
  self.button.title = @"";
  self.button.bordered = NO;
  self.button.target = self;
  self.button.action = @selector(share:);
  self.button.accessibilityLabel = @"Share Current URL";
  self.button.toolTip = @"Share";
  [self.surface addSubview:self.button];
  return self;
}
- (void)position {
  if (self.closed || !self.parent) return;
  NSView *content = self.parent.contentView;
  NSRect bounds = content.bounds;
  NSSize size = self.panel.frame.size;
  // Gecko's inner height excludes any native titlebar; content views may not.
  CGFloat top = fmin(self.viewportHeight, NSHeight(bounds));
  NSRect target = NSMakeRect(NSMaxX(bounds) - 18 - size.width,
    NSMinY(bounds) + top - 18 - size.height, size.width, size.height);
  target = [self.parent convertRectToScreen:[content convertRect:target toView:nil]];
  [self.panel setFrameOrigin:target.origin];
}
- (void)schedule {
  [self.timer invalidate]; self.timer = nil;
  if (self.closed || self.hold || self.hovered || self.picker) return;
  __weak ZenCopyToast *weakSelf = self;
  self.timer = [NSTimer timerWithTimeInterval:self.timeout repeats:NO block:^(NSTimer *timer) {
    ZenCopyToast *owner = weakSelf;
    if (!owner || owner.hovered || owner.picker || owner.hold) return;
    NSUInteger generation = owner.generation;
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
      context.duration = NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion ? 0 : .2;
      owner.panel.animator.alphaValue = 0;
    } completionHandler:^{
      if (owner.generation == generation && !owner.hovered && !owner.picker) [owner close];
    }];
  }];
  [NSRunLoop.mainRunLoop addTimer:self.timer forMode:NSRunLoopCommonModes];
}
- (void)hover:(BOOL)value {
  self.hovered = value;
  if (value) { ++self.generation; self.panel.alphaValue = 1; }
  [self schedule];
}
- (void)share:(id)sender {
  if (!self.url || self.closed || self.picker) return;
  [self.timer invalidate]; self.timer = nil;
  self.picker = [[NSSharingServicePicker alloc] initWithItems:@[self.url]];
  self.picker.delegate = self;
  [self.picker showRelativeToRect:self.button.bounds ofView:self.button preferredEdge:NSMinYEdge];
}
- (void)sharingServicePicker:(NSSharingServicePicker *)picker didChooseSharingService:(NSSharingService *)service {
  self.picker.delegate = nil;
  self.picker = nil;
  [self schedule];
}
- (void)close {
  if (self.closed) return;
  self.closed = YES;
  ++self.generation;
  [self.timer invalidate]; self.timer = nil;
  self.picker.delegate = nil; self.picker = nil;
  for (id observer in self.observers) [NSNotificationCenter.defaultCenter removeObserver:observer];
  self.observers = nil;
  [self.parent removeChildWindow:self.panel];
  [self.panel orderOut:nil];
  [self.panel close];
  self.surface.owner = nil;
  self.button.target = nil;
  self.url = nil;
  if (objc_getAssociatedObject(self.parent, &toastKey) == self)
    objc_setAssociatedObject(self.parent, &toastKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}
@end

void ZenCloseCopyToast(NSWindow *window) {
  ZenCopyToast *toast = objc_getAssociatedObject(window, &toastKey);
  [toast close];
}

int ZenCopyToastStatus(NSWindow *window) {
  ZenCopyToast *toast = objc_getAssociatedObject(window, &toastKey);
  return toast && !toast.closed ? (toast.panel.visible ? 1 : 0) |
    (toast.hovered ? 2 : 0) | (toast.picker ? 4 : 0) | (toast.timer ? 8 : 0) |
    (toast.url ? 16 : 0) : 0;
}

// Bounded, read-only diagnostics: no label, URL, profile or history data.
int ZenCopyToastGeometry(NSWindow *window, double *values, int count) {
  ZenCopyToast *toast = objc_getAssociatedObject(window, &toastKey);
  if (!toast || toast.closed || !values || count != 12) return 1;
  NSRect frame = toast.panel.frame, parent = window.frame;
  double result[] = {frame.origin.x, frame.origin.y, frame.size.width, frame.size.height,
    parent.origin.x, parent.origin.y, parent.size.width, parent.size.height,
    toast.panel.alphaValue, toast.surface.bounds.size.width, toast.surface.bounds.size.height,
    window.contentView.isFlipped};
  memcpy(values, result, sizeof(result));
  return 0;
}

int ZenShowCopyToast(NSWindow *window, NSDictionary *palette, NSDictionary *request) {
  id average = palette[@"average"], label = request[@"label"], urlString = request[@"url"];
  if (![average isKindOfClass:NSArray.class] || [average count] != 4 ||
      ![palette[@"darkHighlight"] isKindOfClass:NSNumber.class] ||
      ![palette[@"whiteForeground"] isKindOfClass:NSNumber.class] ||
      ![label isKindOfClass:NSString.class] || ![label length] || [label length] > 512 ||
      ![request[@"height"] isKindOfClass:NSNumber.class] ||
      ![request[@"timeout"] isKindOfClass:NSNumber.class] ||
      ![request[@"hold"] isKindOfClass:NSNumber.class]) return 2;
  for (id value in average) if (![value isKindOfClass:NSNumber.class] ||
    !isfinite([value doubleValue]) || [value doubleValue] < 0 || [value doubleValue] > 1) return 2;
  double height = [request[@"height"] doubleValue], timeout = [request[@"timeout"] doubleValue];
  if (!isfinite(height) || height < 100 || height > 32768 || !isfinite(timeout) ||
      timeout < 0 || timeout > 60000) return 2;
  NSURL *url = nil;
  if (urlString && urlString != NSNull.null) {
    if (![urlString isKindOfClass:NSString.class] || [urlString length] > 8192) return 2;
    url = [NSURL URLWithString:urlString];
    if (!url.host.length || ![@[@"http", @"https"] containsObject:url.scheme.lowercaseString]) return 2;
  }
  ZenCopyToast *toast = objc_getAssociatedObject(window, &toastKey);
  BOOL reused = toast && !toast.closed;
  if (!reused) {
    toast = [ZenCopyToast new];
    toast.parent = window;
    objc_setAssociatedObject(window, &toastKey, toast, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    __weak ZenCopyToast *weakToast = toast;
    NSMutableArray *observers = [NSMutableArray new];
    for (NSNotificationName name in @[NSWindowWillCloseNotification, NSWindowWillMiniaturizeNotification])
      [observers addObject:[NSNotificationCenter.defaultCenter addObserverForName:name object:window
        queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { [weakToast close]; }]];
    [observers addObject:[NSNotificationCenter.defaultCenter addObserverForName:NSWindowDidResizeNotification
      object:window queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { [weakToast close]; }]];
    toast.observers = observers;
  }
  ++toast.generation;
  toast.url = url; // Repeated copies replace, or remove, the previous Share target.
  toast.timeout = timeout / 1000;
  toast.hold = [request[@"hold"] boolValue];
  toast.viewportHeight = height;
  toast.label.stringValue = label;
  BOOL white = [palette[@"whiteForeground"] boolValue], dark = [palette[@"darkHighlight"] boolValue];
  toast.label.textColor = white ? NSColor.whiteColor : NSColor.blackColor;
  toast.button.whiteForeground = white;
  toast.button.hidden = !url;
  toast.button.needsDisplay = YES;
  CGFloat labelWidth = ceil(fmin(420, toast.label.intrinsicContentSize.width));
  CGFloat width = labelWidth + 24 + (url ? 39 : 0);
  [toast.panel setContentSize:NSMakeSize(width, 47)];
  toast.label.frame = NSMakeRect(12, (47 - toast.label.intrinsicContentSize.height) / 2,
    labelWidth, toast.label.intrinsicContentSize.height);
  toast.button.frame = NSMakeRect(width - 43, 10, 31, 27);
  // Keep the native material beneath both color layers. A flat RGB background
  // misses the material contribution and is visibly too dark.
  for (CALayer *layer in [toast.surface.layer.sublayers copy])
    if ([layer.name isEqualToString:@"zen-toast-paint"]) [layer removeFromSuperlayer];
  CALayer *color = [CALayer layer]; color.name = @"zen-toast-paint";
  color.frame = toast.surface.bounds;
  color.backgroundColor = [NSColor colorWithRed:[average[0] doubleValue]
    green:[average[1] doubleValue] blue:[average[2] doubleValue]
    alpha:[average[3] doubleValue] * .8].CGColor;
  [toast.surface.layer insertSublayer:color atIndex:0];
  CAGradientLayer *gradient = [CAGradientLayer layer]; gradient.name = @"zen-toast-paint";
  gradient.frame = color.frame;
  NSColor *shade = dark ? NSColor.blackColor : NSColor.whiteColor;
  gradient.colors = @[(id)[shade colorWithAlphaComponent:dark ? .2 : .4].CGColor,
                      (id)[shade colorWithAlphaComponent:dark ? .4 : .2].CGColor];
  gradient.startPoint = CGPointMake(.5, 1); gradient.endPoint = CGPointMake(.5, 0);
  [toast.surface.layer insertSublayer:gradient above:color];
  toast.surface.layer.borderWidth = .5;
  toast.surface.layer.borderColor = [NSColor.blackColor colorWithAlphaComponent:.3].CGColor;
  [toast position];
  toast.panel.alphaValue = 1;
  if (!reused) { [window addChildWindow:toast.panel ordered:NSWindowAbove]; [toast.panel orderFront:nil]; }
  [toast schedule];
  NSAccessibilityPostNotificationWithUserInfo(toast.surface, NSAccessibilityAnnouncementRequestedNotification,
    @{NSAccessibilityAnnouncementKey: label, NSAccessibilityPriorityKey: @(NSAccessibilityPriorityMedium)});
  return 0;
}
