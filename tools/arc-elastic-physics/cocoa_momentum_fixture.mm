#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#include <cmath>
#include <memory>
#include <string>
#include <unistd.h>

static NSView* FindChildView(NSView* view) {
  if ([NSStringFromClass(view.class) isEqualToString:@"ChildView"]) return view;
  for (NSView* child in view.subviews) {
    if (NSView* found = FindChildView(child)) return found;
  }
  return nil;
}

static NSDictionary* Dispatch(NSDictionary* request) {
  if (![NSThread isMainThread] || [request[@"pid"] intValue] != getpid()) {
    return @{@"ok": @NO, @"error": @"Owned main-thread process required"};
  }
  NSString* bundle = NSBundle.mainBundle.bundleIdentifier;
  if (![bundle isEqualToString:@"app.astralforge.arc-physics-candidate"] &&
      ![bundle isEqualToString:@"app.astralforge.arc-color-physics-candidate"]) {
    return @{@"ok": @NO, @"error": @"Isolated candidate bundle required"};
  }
  NSWindow* window = NSApp.keyWindow;
  if (!window.isVisible || ![window.title containsString:@"Cocoa bounce:"]) {
    return @{@"ok": @NO, @"error": @"Owned visible Cocoa fixture window required"};
  }
  NSView* view = FindChildView(window.contentView);
  if (!view || ![view respondsToSelector:@selector(scrollWheel:)]) {
    return @{@"ok": @NO, @"error": @"Gecko ChildView missing"};
  }
  int phase = [request[@"phase"] intValue];
  int momentum = [request[@"momentum"] intValue];
  int delta = [request[@"dy"] intValue];
  if ((phase != 0 && phase != 1 && phase != 2 && phase != 4 && phase != 8 && phase != 128) ||
      momentum < 0 || momentum > 3 || (phase && momentum) || (!phase && !momentum) ||
      std::abs(delta) > 800 || ((phase == 4 || phase == 8 || phase == 128 || momentum == 3) && delta)) {
    return @{@"ok": @NO, @"error": @"Invalid native gesture phase or delta"};
  }
  double x = [request[@"x"] doubleValue], y = [request[@"y"] doubleValue];
  if (!std::isfinite(x) || !std::isfinite(y)) {
    return @{@"ok": @NO, @"error": @"Invalid point"};
  }
  auto release = [](CGEventRef event) { CFRelease(event); };
  std::unique_ptr<__CGEvent, decltype(release)> ownedEvent(
      CGEventCreateScrollWheelEvent(nullptr, kCGScrollEventUnitPixel, 3, delta, 0, 0), release);
  CGEventRef cgEvent = ownedEvent.get();
  if (!cgEvent) return @{@"ok": @NO, @"error": @"Cannot allocate scroll event"};
  CGEventSetIntegerValueField(cgEvent, kCGScrollWheelEventScrollPhase, phase);
  CGEventSetIntegerValueField(cgEvent, kCGScrollWheelEventMomentumPhase, momentum);
  // Match nsCocoaWindow's direct scrollWheel test dispatch; never post globally.
  CGEventSetLocation(cgEvent, CGPointMake(x / window.backingScaleFactor - NSMinX(window.frame),
                                         y / window.backingScaleFactor + NSMinY(window.frame)));
  CGEventSetTimestamp(cgEvent, NSProcessInfo.processInfo.systemUptime * 1000000000ULL);
  NSEvent* event = [NSEvent eventWithCGEvent:cgEvent];
  [event setValue:window forKey:@"_window"];
  NSPoint point = [view convertPoint:event.locationInWindow fromView:nil];
  if (!NSPointInRect(point, view.bounds)) {
    return @{@"ok": @NO, @"error": @"Input point outside owned ChildView"};
  }
  NSDictionary* result = @{@"ok": @YES, @"pid": @(getpid()), @"bundle": bundle,
    @"windowNumber": @(window.windowNumber), @"title": window.title,
    @"phase": @(event.phase), @"momentumPhase": @(event.momentumPhase),
    @"precise": @(event.hasPreciseScrollingDeltas), @"dy": @(event.scrollingDeltaY),
    @"rawPointDeltaY": @(CGEventGetIntegerValueField(cgEvent, kCGScrollWheelEventPointDeltaAxis1)),
    @"timestamp": @(event.timestamp), @"backingScale": @(window.backingScaleFactor)};
  [view scrollWheel:event];
  return result;
}

extern "C" const char* zen_cocoa_fixture_scroll(const char* input) {
  static std::string output;
  @autoreleasepool {
    NSDictionary* result;
    @try {
      NSData* data = [[NSString stringWithUTF8String:input] dataUsingEncoding:NSUTF8StringEncoding];
      id request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
      result = [request isKindOfClass:NSDictionary.class] ? Dispatch(request)
        : @{@"ok": @NO, @"error": @"JSON object required"};
    } @catch (NSException* exception) {
      result = @{@"ok": @NO, @"error": exception.reason ?: @"Native exception"};
    }
    NSData* encoded = [NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
    output.assign(static_cast<const char*>(encoded.bytes), encoded.length);
  }
  return output.c_str();
}
