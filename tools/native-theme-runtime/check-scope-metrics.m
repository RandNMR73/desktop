/* Any copyright is dedicated to the Public Domain.
 * https://creativecommons.org/publicdomain/zero/1.0/ */
#import <AppKit/AppKit.h>
#include <dlfcn.h>
#include <math.h>
#include <stdio.h>
#include <assert.h>
int main(int argc, const char **argv) {
  @autoreleasepool {
    assert(argc == 2);
    void *lib = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL); assert(lib);
    int (*version)(void) = dlsym(lib, "zen_command_scope_metrics_version");
    int (*measure)(const char *, double, double *, uint32_t) = dlsym(lib, "zen_command_scope_metrics");
    assert(version && version() == 1 && measure);
    double out[3] = {-1, -1, -1}; int checks = 0;
    assert(measure(NULL, 2, out, 3) != 0); checks++;
    assert(measure("X", 2, NULL, 3) != 0); checks++;
    assert(measure("X", 2, out, 2) != 0); checks++;
    for (NSNumber *value in @[@(NAN), @(INFINITY), @0, @0.4, @9]) {
      assert(measure("X", value.doubleValue, out, 3) != 0); checks++;
    }
    assert(measure("", 2, out, 3) != 0); checks++;
    const char invalid[] = {(char)0xff, 0};
    assert(measure(invalid, 2, out, 3) != 0); checks++;
    NSString *large = [@"x" stringByPaddingToLength:513 withString:@"x" startingAtIndex:0];
    assert(measure(large.UTF8String, 2, out, 3) != 0); checks++;
    assert(out[0] == -1 && out[1] == -1 && out[2] == -1); checks++;
    for (NSString *text in @[@"YouTube", @"café", @"搜索", @"👩‍💻", @"مرحبا"]) {
      for (NSNumber *scale in @[@1, @1.5, @2, @3]) {
        assert(measure(text.UTF8String, scale.doubleValue, out, 3) == 0);
        assert(out[0] > 0 && out[1] > 0 && out[2] >= 1 && out[2] <= 1000);
        assert(fabs(out[0]*scale.doubleValue-round(out[0]*scale.doubleValue)) < 0.00001);
        checks++;
      }
    }
    __block int background = 0;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      double values[3]; background = measure("X", 2, values, 3);
      dispatch_semaphore_signal(done);
    });
    dispatch_semaphore_wait(done, DISPATCH_TIME_FOREVER);
    assert(background != 0); checks++;
    printf("{\"pass\":true,\"checks\":%d}\n", checks);
  }
}
