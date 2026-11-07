#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

static NSArray *controlPoints(CAMediaTimingFunction *function) {
  if (!function) return @[];
  NSMutableArray *points = [NSMutableArray array];
  for (int i = 0; i < 4; i++) {
    float values[2];
    [function getControlPointAtIndex:i values:values];
    [points addObject:@[@(values[0]), @(values[1])]];
  }
  return points;
}

int main(void) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    NSMutableDictionary *result = [NSMutableDictionary dictionary];
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(50, 50, 64, 64)
      styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    window.releasedWhenClosed = NO;
    NSImageView *view = [[NSImageView alloc] initWithFrame:NSMakeRect(0, 0, 32, 32)];
    view.wantsLayer = YES;
    [window.contentView addSubview:view];
    view.alphaValue = 0;
    [window orderBack:nil];
    [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
    [NSAnimationContext runAnimationGroup:^(NSAnimationContext *context) {
      context.allowsImplicitAnimation = YES;
      result[@"duration"] = @(context.duration);
      result[@"allowsImplicitAnimation"] = @(context.allowsImplicitAnimation);
      result[@"timingFunction"] = context.timingFunction.description ?: @"nil";
      result[@"transactionDuration"] = @([CATransaction animationDuration]);
      result[@"transactionTimingFunction"] = [CATransaction animationTimingFunction].description ?: @"nil";
      CABasicAnimation *animation = [CABasicAnimation animationWithKeyPath:@"opacity"];
      result[@"defaultAnimationDuration"] = @(animation.duration);
      result[@"defaultAnimationTimingFunction"] = animation.timingFunction.description ?: @"nil";
      view.alphaValue = 1;
    } completionHandler:nil];
    NSMutableArray *animations = [NSMutableArray array];
    for (NSString *key in view.layer.animationKeys) {
      CAAnimation *animation = [view.layer animationForKey:key];
      [animations addObject:@{@"key":key, @"duration":@(animation.duration),
        @"timing":controlPoints(animation.timingFunction),
        @"description":animation.description}];
    }
    result[@"imageViewAnimations"] = animations;
    result[@"defaultTimingPoints"] = controlPoints([CAMediaTimingFunction functionWithName:kCAMediaTimingFunctionDefault]);
    [window close];
    NSData *data = [NSJSONSerialization dataWithJSONObject:result options:NSJSONWritingPrettyPrinted error:nil];
    puts([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
  }
  return 0;
}
