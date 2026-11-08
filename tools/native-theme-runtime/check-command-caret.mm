#import <AppKit/AppKit.h>
#include <CoreText/CoreText.h>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <limits>
#include <thread>

#include "../../src/widget/cocoa/ZenNativeCommandCaretMetrics.h"

using mozilla::widget::GetNativeCommandCaretMetricsForFont;
using mozilla::widget::NativeCommandCaretMetrics;

int main(int argc, const char* argv[]) {
  @autoreleasepool {
    if (argc != 2) {
      return 2;
    }
    NSData* data = [NSData dataWithContentsOfFile:@(argv[1])];
    NSArray* references = data ? [NSJSONSerialization JSONObjectWithData:data
                                     options:0 error:nil] : nil;
    if (![references isKindOfClass:[NSArray class]] || !references.count) {
      return 2;
    }
    NSMutableArray* results = [NSMutableArray array];
    bool passed = true;
    for (NSDictionary* reference in references) {
      NSString* name = reference[@"font"];
      const double size = [reference[@"size"] doubleValue];
      NSFont* font = [name isEqualToString:@"system"]
                         ? [NSFont systemFontOfSize:size weight:NSFontWeightMedium]
                         : [NSFont fontWithName:name size:size];
      CGFontRef cg = font ? CTFontCopyGraphicsFont((CTFontRef)font, nullptr) : nullptr;
      NativeCommandCaretMetrics metrics = {};
      const bool ok = GetNativeCommandCaretMetricsForFont(cg, size, &metrics) &&
          metrics.mAscent == [reference[@"nativeBaseline"] doubleValue] &&
          metrics.mLineHeight == [reference[@"nativeLine"] doubleValue];
      passed &= ok;
      [results addObject:@{@"font":name, @"size":@(size), @"passed":@(ok),
          @"ascent":@(metrics.mAscent), @"lineHeight":@(metrics.mLineHeight)}];
      if (cg) {
        CGFontRelease(cg);
      }
    }

    NSFont* system = [NSFont systemFontOfSize:18 weight:NSFontWeightMedium];
    CGFontRef cg = CTFontCopyGraphicsFont((CTFontRef)system, nullptr);
    NativeCommandCaretMetrics metrics = {101, 202};
    bool guards = !GetNativeCommandCaretMetricsForFont(nullptr, 18, &metrics) &&
        !GetNativeCommandCaretMetricsForFont(cg, 18, nullptr);
    for (const double size : {0.0, -1.0, std::numeric_limits<double>::infinity(),
                               std::numeric_limits<double>::quiet_NaN()}) {
      guards &= !GetNativeCommandCaretMetricsForFont(cg, size, &metrics);
    }
    bool backgroundAccepted = true;
    std::thread background([&] {
      backgroundAccepted = GetNativeCommandCaretMetricsForFont(cg, 18, &metrics);
    });
    background.join();
    guards &= !backgroundAccepted && metrics.mAscent == 101 &&
              metrics.mLineHeight == 202;
    passed &= guards;

    constexpr int count = 100000;
    passed &= GetNativeCommandCaretMetricsForFont(cg, 18, &metrics);
    const auto start = std::chrono::steady_clock::now();
    for (int i = 0; i < count; ++i) {
      passed &= GetNativeCommandCaretMetricsForFont(cg, 18, &metrics) &&
                metrics.mAscent == 17 && metrics.mLineHeight == 21;
    }
    const double micros = std::chrono::duration<double, std::micro>(
        std::chrono::steady_clock::now() - start).count() / count;
    CGFontRelease(cg);
    NSDictionary* result = @{@"passed":@(passed), @"matrix":results,
        @"invalidAndThreadGuards":@(guards), @"cachedIterations":@(count),
        @"cachedMicrosecondsPerCall":@(micros)};
    NSData* output = [NSJSONSerialization dataWithJSONObject:result
                          options:NSJSONWritingPrettyPrinted error:nil];
    fwrite(output.bytes, 1, output.length, stdout);
    puts("");
    return passed ? 0 : 1;
  }
}
