/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Exercise the compiled renderer and AppKit notifications in hidden windows.
// No browser, activation, or changes to the user's window state.
#import <AppKit/AppKit.h>
#import <MetalKit/MetalKit.h>
#import <objc/runtime.h>
#include <dlfcn.h>
#include <math.h>

@interface ZenThemeResources : NSObject
@property NSArray<NSNumber *> *grains;
@property NSDictionary *textures;
- (instancetype)initWithURL:(NSURL *)url;
@end
@interface ZenThemeView : MTKView
@property BOOL disposed;
@property BOOL dynamic;
@property float dynamicGrain;
@property NSUInteger index;
@property int status;
@property BOOL usesWindowCoordinates;
- (float)grainOpacity;
- (instancetype)initWithFrame:(NSRect)frame resources:(ZenThemeResources *)resources;
@end
@interface ActivityWindow : NSWindow
@property BOOL testKey;
@property BOOL testMain;
@property (weak) NSWindow *testParent;
@end
@implementation ActivityWindow
- (BOOL)isKeyWindow { return self.testKey; }
- (BOOL)isMainWindow { return self.testMain; }
- (NSWindow *)parentWindow { return self.testParent; }
@end

static char requestKey;
static IMP originalSetNeedsDisplay;
static void TrackNeedsDisplay(id view, SEL selector, BOOL flag) {
  if (flag) objc_setAssociatedObject(view, &requestKey,
    @([objc_getAssociatedObject(view, &requestKey) unsignedIntegerValue] + 1),
    OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  ((void (*)(id, SEL, BOOL))originalSetNeedsDisplay)(view, selector, flag);
}
static NSUInteger Requests(id view) {
  return [objc_getAssociatedObject(view, &requestKey) unsignedIntegerValue];
}
static void ResetRequests(id view) {
  objc_setAssociatedObject(view, &requestKey, @0, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}
static void Require(BOOL condition, NSString *message) {
  if (!condition) { fprintf(stderr, "%s\n", message.UTF8String); exit(1); }
}
static void Notify(NSNotificationName name, NSWindow *window) {
  [NSNotificationCenter.defaultCenter postNotificationName:name object:window];
}
static ActivityWindow *Window(void) {
  ActivityWindow *w = [[ActivityWindow alloc] initWithContentRect:NSMakeRect(0,0,400,400)
    styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:YES];
  w.releasedWhenClosed = NO;
  return w;
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 2;
    NSString *root = [NSString stringWithUTF8String:argv[1]];
    Require(dlopen([[root stringByAppendingPathComponent:@"libzen-native-theme.dylib"]
      fileSystemRepresentation], RTLD_NOW | RTLD_LOCAL) != NULL, @"load library");
    [NSApplication sharedApplication];
    Class renderer = NSClassFromString(@"ZenThemeView");
    Class spy = objc_allocateClassPair(renderer, "ActivityRenderer", 0);
    Method method = class_getInstanceMethod(renderer, @selector(setNeedsDisplay:));
    originalSetNeedsDisplay = method_getImplementation(method);
    class_addMethod(spy, @selector(setNeedsDisplay:), (IMP)TrackNeedsDisplay,
      method_getTypeEncoding(method));
    objc_registerClassPair(spy);
    ZenThemeResources *r = [[NSClassFromString(@"ZenThemeResources") alloc] initWithURL:
      [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"zen-native-theme"]]];
    Require(r.grains.count > 0, @"resources");
    ActivityWindow *owner = Window(), *parent = Window(), *unrelated = Window();
    NSUInteger checks = 0;
    for (BOOL region = NO;; region = YES) {
      for (NSUInteger index = 0; index < r.grains.count + 2; ++index) {
        ZenThemeView *v = [[spy alloc]
          initWithFrame:NSMakeRect(0,0,100,100) resources:r];
        v.usesWindowCoordinates = region;
        v.dynamic = index >= r.grains.count;
        v.index = v.dynamic ? 0 : index;
        v.dynamicGrain = index == r.grains.count ? .17f : 0.f;
        const float legacy = v.dynamic ? v.dynamicGrain : r.grains[index].floatValue;
        const float full = r.textures ? legacy / (66.f / 255) : legacy;
        owner.testKey = NO; owner.testMain = NO; parent.testKey = NO; parent.testMain = NO;
        owner.testParent = nil;
        [owner.contentView addSubview:v];
        Require(fabsf(v.grainOpacity-full*.25f) < 1e-7, @"initial inactive");
        v.status = 1;
        ResetRequests(v);
        owner.testKey = YES; Notify(NSWindowDidBecomeKeyNotification,owner);
        Require(fabsf(v.grainOpacity-full) < 1e-7, @"key window active");
        Require(Requests(v) == (full != 0), @"redraw only textured theme");
        Require(v.status == 1, @"retain current ready frame");
        ResetRequests(v); Notify(NSWindowDidBecomeKeyNotification,owner);
        unrelated.testKey = YES; Notify(NSWindowDidBecomeKeyNotification,unrelated);
        Require(!Requests(v), @"duplicate/unrelated notifications are idle");
        owner.testMain = YES; owner.testKey = NO; Notify(NSWindowDidResignKeyNotification,owner);
        Require(v.grainOpacity == full && !Requests(v), @"main remains active with a key panel");
        owner.testMain = NO; Notify(NSWindowDidResignMainNotification,owner);
        Require(fabsf(v.grainOpacity-full*.25f) < 1e-7, @"resigned window inactive");
        owner.testParent = parent; parent.testMain = YES;
        Notify(NSWindowDidBecomeMainNotification,parent);
        Require(v.grainOpacity == full, @"active ancestor");
        parent.testMain = NO; Notify(NSWindowDidResignMainNotification,parent);
        Require(fabsf(v.grainOpacity-full*.25f) < 1e-7, @"inactive ancestor");
        parent.testKey = YES; Notify(NSWindowDidBecomeKeyNotification,parent);
        Require(v.grainOpacity == full, @"key ancestor");
        [v removeFromSuperview]; ResetRequests(v);
        parent.testKey = NO; Notify(NSWindowDidResignKeyNotification,parent);
        Require(!Requests(v), @"detached renderer does no work");
        [owner.contentView addSubview:v];
        Require(fabsf(v.grainOpacity-full*.25f) < 1e-7, @"reattach synchronizes state");
        [unrelated.contentView addSubview:v];
        Require(v.grainOpacity == full, @"move to an active window");
        v.disposed = YES; ResetRequests(v);
        unrelated.testKey = NO; Notify(NSWindowDidResignKeyNotification,unrelated);
        Require(!Requests(v) && v.grainOpacity == full, @"disposed renderer does no work");
        [v removeFromSuperview];
        ++checks;
      }
      if (region) break;
    }
    __weak ZenThemeView *weakView;
    @autoreleasepool {
      ZenThemeView *view = [[spy alloc]
        initWithFrame:NSMakeRect(0,0,100,100) resources:r];
      weakView = view; [owner.contentView addSubview:view]; [view removeFromSuperview];
    }
    // AppKit/Metal can release scheduled layout work at the next run loop.
    for (NSUInteger i = 0; weakView && i < 20; ++i) {
      @autoreleasepool {
        [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.01]];
      }
    }
    Require(!weakView, @"observation does not retain renderer");
    Notify(NSWindowDidBecomeKeyNotification,owner);
    printf("{\"themeAndRegionCases\":%lu,\"focusTransitionsAndLifecycle\":true,\"released\":true}\n",checks);
  }
  return 0;
}
