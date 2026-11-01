#import <AppKit/AppKit.h>
#include <stdio.h>
int zen_app_icon_apply(const char *);
int zen_app_icon_selected(char *, unsigned);
int zen_app_icon_restore(void);

int main(int argc, const char **argv) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp finishLaunching];
    if (argc > 1 && strcmp(argv[1], "clear") == 0) return zen_app_icon_apply("");
    if (argc > 1 && strcmp(argv[1], "restore") == 0) {
      if (zen_app_icon_restore() != 0) return 10;
      char selected[65];
      if (zen_app_icon_selected(selected, sizeof selected) != 0 || strcmp(selected, "neon")) return 11;
      NSURL *url = [NSBundle.mainBundle.resourceURL URLByAppendingPathComponent:@"zen-app-icons/arc-neon.icns"];
      NSImage *expected = [[NSImage alloc] initWithContentsOfURL:url];
      NSRect rect = NSMakeRect(0, 0, 128, 128);
      CGColorSpaceRef color = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
      unsigned char pixels[2][128 * 128 * 4] = {0};
      NSArray *images = @[NSApp.applicationIconImage, expected];
      for (unsigned i = 0; i < 2; ++i) {
        CGContextRef context = CGBitmapContextCreate(pixels[i], 128, 128, 8, 128 * 4,
          color, kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
        CGContextDrawImage(context, NSRectToCGRect(rect),
          [images[i] CGImageForProposedRect:&rect context:nil hints:nil]);
        CGContextRelease(context);
      }
      CGColorSpaceRelease(color);
      double error = 0;
      for (unsigned i = 0; i < sizeof pixels[0]; ++i) error += abs(pixels[0][i] - pixels[1][i]);
      error /= sizeof pixels[0];
      printf("restart artwork mean byte error: %.6f\n", error);
      if (error > 1.0) return 12;
      puts("restart: restored neon");
      return 0;
    }
    NSArray *slugs = @[@"original", @"candy", @"neon", @"fluted-glass", @"schoolbook", @"colorful"];
    char selected[65];
    for (NSString *slug in slugs) {
      if (zen_app_icon_apply(slug.UTF8String) != 0) return 1;
      if (zen_app_icon_selected(selected, sizeof selected) != 0 || ![slug isEqualToString:@(selected)]) return 2;
      if (!NSApp.applicationIconImage.valid) return 3;
      printf("selected %s\n", selected);
    }
    for (NSString *invalid in @[@"../original", @"unlisted", @"/tmp/icon", @"ORIGINAL", @"original.icns"]) {
      if (zen_app_icon_apply(invalid.UTF8String) != 1) return 4;
      if (zen_app_icon_selected(selected, sizeof selected) != 0 || strcmp(selected, "colorful")) return 5;
    }
    if (zen_app_icon_apply("") != 0 || zen_app_icon_selected(selected, sizeof selected) != 0 || selected[0]) return 6;
    if (zen_app_icon_apply("neon") != 0) return 7;
    puts("six selections, rejected invalid choices, default reset: passed");
  }
  return 0;
}
