/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Standalone validation entry point. Compile together with ZenNativeTheme.m;
// it allocates Metal resources but never creates a window or installs anything.
#import <Foundation/Foundation.h>
@interface ZenThemeResources : NSObject
- (instancetype)initWithURL:(NSURL *)url;
@end
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 2;
    @try {
      NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]]];
      return [[ZenThemeResources alloc] initWithURL:url] ? 0 : 1;
    } @catch (NSException *exception) { return 3; }
  }
}
