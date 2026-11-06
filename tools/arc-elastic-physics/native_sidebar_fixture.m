#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <unistd.h>
static NSMutableArray *events;
static NSScrollView *scroll;
static double now(void) { return NSProcessInfo.processInfo.systemUptime; }
static void record(NSString *type, NSDictionary *extra) {
  NSMutableDictionary *d=[@{@"type":type,@"time":@(now()),@"y":@(scroll.contentView.bounds.origin.y)} mutableCopy];
  [d addEntriesFromDictionary:extra ?: @{}];[events addObject:d];
}
@interface Document : NSView @end
@implementation Document
- (BOOL)isFlipped { return YES; }
- (void)drawRect:(NSRect)rect {
  [[NSColor whiteColor] setFill]; NSRectFill(rect);
  [[NSColor systemPinkColor] setFill]; NSRectFill(NSMakeRect(0,0,self.bounds.size.width,4));
  for(int y=40;y<3000;y+=40) { [[NSColor colorWithWhite:0.8 alpha:1] setFill];NSRectFill(NSMakeRect(0,y,self.bounds.size.width,1)); }
}
@end
@interface ScrollControl : NSScrollView @end
@implementation ScrollControl
- (void)scrollWheel:(NSEvent *)event {
  record(@"input",@{@"phase":@(event.phase),@"momentum":@(event.momentumPhase),@"delta":@(event.scrollingDeltaY),@"eventTime":@(event.timestamp),@"precise":@(event.hasPreciseScrollingDeltas)});
  [super scrollWheel:event];
  record(@"afterInput",@{@"phase":@(event.phase)});
}
@end
static void post(CGPoint point,int delta,int phase) {
  if(NSWorkspace.sharedWorkspace.frontmostApplication.processIdentifier!=getpid())return;
  CGEventRef e=CGEventCreateScrollWheelEvent(NULL,kCGScrollEventUnitPixel,2,delta,0);
  CGEventSetLocation(e,point);CGEventSetIntegerValueField(e,kCGScrollWheelEventScrollPhase,phase);
  CGEventSetIntegerValueField(e,kCGScrollWheelEventMomentumPhase,0);
  CGEventSetTimestamp(e,(uint64_t)(now()*1e9));CGEventPost(kCGHIDEventTap,e);CFRelease(e);
}
int main(int argc,const char **argv) { @autoreleasepool {
  if(argc<4)return 2;
  int amount=atoi(argv[1]);double hold=atof(argv[2]);NSString *path=@(argv[3]);int interrupt=argc>4?atoi(argv[4]):-1;
  if(abs(amount)>1600 || hold<0 || hold>3 || interrupt>500)return 2;
  [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];events=[NSMutableArray array];
  NSWindow *window=[[NSWindow alloc]initWithContentRect:NSMakeRect(80,120,400,730) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable backing:NSBackingStoreBuffered defer:NO];
  window.title=@"Arc bounce native control R67";
  scroll=[[ScrollControl alloc]initWithFrame:window.contentView.bounds];scroll.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
  scroll.hasVerticalScroller=YES;scroll.autohidesScrollers=YES;scroll.scrollerStyle=NSScrollerStyleOverlay;
  scroll.verticalScrollElasticity=NSScrollElasticityAllowed;scroll.horizontalScrollElasticity=NSScrollElasticityNone;
  scroll.documentView=[[Document alloc]initWithFrame:NSMakeRect(0,0,400,3000)];[window.contentView addSubview:scroll];
  scroll.contentView.postsBoundsChangedNotifications=YES;
  [[NSNotificationCenter defaultCenter]addObserverForName:NSViewBoundsDidChangeNotification object:scroll.contentView queue:nil usingBlock:^(NSNotification*n){record(@"bounds",nil);}];
  [window makeKeyAndOrderFront:nil];[NSApp activateIgnoringOtherApps:YES];
  [scroll.contentView scrollToPoint:NSMakePoint(0,0)];[scroll reflectScrolledClipView:scroll.contentView];
  record(@"ready",@{@"height":@(scroll.contentView.bounds.size.height),@"scale":@(window.backingScaleFactor)});
  NSPoint at=[window convertPointToScreen:NSMakePoint(200,365)];CGPoint point=CGPointMake(at.x,NSScreen.screens.firstObject.frame.size.height-at.y);
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW,800*NSEC_PER_MSEC),dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0),^{
    CGEventRef move=CGEventCreateMouseEvent(NULL,kCGEventMouseMoved,point,kCGMouseButtonLeft);CGEventPost(kCGHIDEventTap,move);CFRelease(move);usleep(50000);
    post(point,0,1);int sent=0;for(int i=1;i<=20;i++){int next=amount*i/20;post(point,next-sent,2);sent=next;usleep(16000);}
    usleep((useconds_t)(hold*1e6));post(point,0,4);
    if(interrupt>=0){usleep(interrupt*1000);post(point,0,128);usleep(600000);post(point,0,8);}
    usleep(700000);
    dispatch_async(dispatch_get_main_queue(),^{record(@"finished",nil);NSData *data=[NSJSONSerialization dataWithJSONObject:events options:NSJSONWritingPrettyPrinted error:nil];[data writeToFile:path atomically:YES];[NSApp terminate:nil];});
  });[NSApp run];
}return 0;}
