#import <AppKit/AppKit.h>
#include <stdio.h>

extern int zen_popover_observe_appearance(void);
extern void zen_popover_shutdown(void);

// Standalone, hidden fixture windows; no live browser or user data is accessed.
@interface PopupWindow : NSWindow
@property(strong) NSPopover *popover;
@end
@implementation PopupWindow
@end

@interface CountingPopover : NSPopover
@property NSUInteger writes;
@end
@implementation CountingPopover
- (void)setAppearance:(NSAppearance *)appearance {
  self.writes++;
  [super setAppearance:appearance];
}
@end

static void Check(BOOL condition, const char *message) {
  if (!condition) { fprintf(stderr, "%s\n", message); exit(1); }
}

static PopupWindow *Window(NSPopover *popover) {
  PopupWindow *window = [[PopupWindow alloc]
      initWithContentRect:NSMakeRect(0, 0, 50, 50)
      styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered
      defer:YES];
  window.releasedWhenClosed = NO;
  window.popover = popover;
  return window;
}

static void WillShow(id object) {
  [NSNotificationCenter.defaultCenter postNotificationName:
      NSPopoverWillShowNotification object:object];
}

static void OnBackground(dispatch_block_t block) {
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0), ^{
    @autoreleasepool { block(); }
    dispatch_semaphore_signal(done);
  });
  dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
}

int main(void) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    __block int offThread = 0;
    OnBackground(^{
      offThread = zen_popover_observe_appearance();
    });
    Check(offThread == 1, "observer installation must stay on the main thread");
    Check(zen_popover_observe_appearance() == 0, "observer installation");
    Check(zen_popover_observe_appearance() == 0, "idempotent installation");
    CountingPopover *popover = [[CountingPopover alloc] init];
    PopupWindow *backing = Window(popover);
    Check([NSApp.windows containsObject:backing], "hidden fixture is registered");
    backing.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    popover.writes = 0;
    WillShow(popover);
    Check(popover.appearance == backing.appearance, "copy before showing");
    Check(popover.writes == 1, "duplicate installation must not duplicate writes");
    Check(!popover.shown && !backing.visible, "no visible fixture UI");

    CountingPopover *unrelated = [[CountingPopover alloc] init];
    unrelated.writes = 0;
    WillShow(unrelated);
    WillShow(@"not a popover");
    Check(unrelated.writes == 0 && popover.writes == 1,
          "unrelated notifications cannot change a popover");

    backing.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
    WillShow(popover);
    Check(popover.appearance == backing.appearance, "light appearance follows Gecko");
    backing.appearance = nil;
    WillShow(popover);
    Check(popover.appearance == nil, "nil restores inherited appearance");

    PopupWindow *ambiguous = Window(popover);
    backing.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    NSUInteger writes = popover.writes;
    WillShow(popover);
    Check(popover.writes == writes, "ambiguous ownership is rejected");
    [ambiguous close];
    ambiguous.popover = nil;
    OnBackground(^{
      WillShow(popover);
    });
    Check(popover.writes == writes, "off-thread notifications are ignored");

    zen_popover_shutdown();
    zen_popover_shutdown();
    WillShow(popover);
    Check(popover.writes == writes, "shutdown removes observer");
    Check(zen_popover_observe_appearance() == 0, "observer can restart");
    WillShow(popover);
    Check(popover.appearance == backing.appearance, "restart copies appearance");
    zen_popover_shutdown();
    [backing close];
    puts("Popover observer: ownership, first-show, appearance, lifecycle and thread checks passed.");
  }
}
