/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Validate native theme appearance selection without opening a window.
#import <AppKit/AppKit.h>
#include <dlfcn.h>

@interface ZenThemeResources : NSObject
@property NSAppearance *themeAppearance;
- (instancetype)initWithURL:(NSURL *)url;
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 2;
    NSString *root = [NSString stringWithUTF8String:argv[1]];
    if (!dlopen([[root stringByAppendingPathComponent:@"libzen-native-theme.dylib"]
          fileSystemRepresentation], RTLD_NOW | RTLD_LOCAL)) return 3;
    NSFileManager *fm = NSFileManager.defaultManager;
    NSURL *source = [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"zen-native-theme"]];
    NSURL *temporary = [[NSURL fileURLWithPath:NSTemporaryDirectory()]
      URLByAppendingPathComponent:[@"zen-theme-appearance-" stringByAppendingString:NSUUID.UUID.UUIDString]];
    if (![fm copyItemAtURL:source toURL:temporary error:NULL]) return 4;
    int result = 0;
    @try {
      NSURL *metadata = [temporary URLByAppendingPathComponent:@"themes.json"];
      NSMutableDictionary *model = [NSJSONSerialization JSONObjectWithData:
        [NSData dataWithContentsOfURL:metadata] options:NSJSONReadingMutableContainers error:NULL];
      if (!model) return 5;
      NSArray *cases = @[@"dark", @"light", NSNull.null, @"unsupported"];
      for (id appearance in cases) {
        if (appearance == NSNull.null) [model removeObjectForKey:@"appearance"];
        else model[@"appearance"] = appearance;
        NSData *data = [NSJSONSerialization dataWithJSONObject:model options:0 error:NULL];
        if (![data writeToURL:metadata atomically:YES]) { result = 6; break; }
        ZenThemeResources *r = [[NSClassFromString(@"ZenThemeResources") alloc] initWithURL:temporary];
        if (!r) { result = 7; break; }
        NSString *expected = [appearance isEqual:@"dark"] ? NSAppearanceNameDarkAqua
          : [appearance isEqual:@"light"] ? NSAppearanceNameAqua : nil;
        if (expected ? ![r.themeAppearance.name isEqual:expected] : r.themeAppearance != nil) {
          result = 8; break;
        }
        if (expected) {
          NSView *parent = [NSView new], *surface = [NSView new];
          parent.appearance = [NSAppearance appearanceNamed:[appearance isEqual:@"dark"]
            ? NSAppearanceNameVibrantLight : NSAppearanceNameVibrantDark];
          [parent addSubview:surface];
          surface.appearance = r.themeAppearance;
          if (![surface.effectiveAppearance.name isEqual:expected] ||
              [parent.effectiveAppearance.name isEqual:expected]) { result = 9; break; }
        }
      }
    } @finally {
      [fm removeItemAtURL:temporary error:NULL];
    }
    if (!result) puts("{\"appearanceCases\":4,\"independentOfParent\":true,\"olderMetadataLoads\":true}");
    return result;
  }
}
