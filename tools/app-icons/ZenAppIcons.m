// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.
#import <AppKit/AppKit.h>
#include <string.h>

// The only writable target is this process's own application. Custom Finder
// icons live outside Contents; changing one must never re-sign the application.
static NSURL *iconDirectory(void) {
  return [NSBundle.mainBundle.resourceURL URLByAppendingPathComponent:@"zen-app-icons" isDirectory:YES];
}
static NSString *selectionKey(void) {
  return [@"ZenSelectedAppIcon:" stringByAppendingString:NSBundle.mainBundle.bundleURL.path];
}
static NSImage *imageForSlug(NSString *slug) {
  if (!slug.length || slug.length > 64 ||
      [slug rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:
        @"abcdefghijklmnopqrstuvwxyz0123456789-"].invertedSet].location != NSNotFound) return nil;
  NSData *data = [NSData dataWithContentsOfURL:[iconDirectory() URLByAppendingPathComponent:@"catalog.json"]];
  id catalog = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
  if (![catalog isKindOfClass:NSArray.class]) return nil;
  BOOL present = NO;
  for (id item in catalog) {
    if ([item isKindOfClass:NSDictionary.class] && [item[@"slug"] isEqual:slug]) present = YES;
  }
  if (!present) return nil;
  NSURL *url = [iconDirectory() URLByAppendingPathComponent:
    [NSString stringWithFormat:@"arc-%@.icns", slug]];
  NSImage *image = [[NSImage alloc] initWithContentsOfURL:url];
  return image.valid ? image : nil;
}

__attribute__((visibility("default"))) int zen_app_icons_version(void) { return 1; }

// 0 success, 1 invalid choice/bundle, 2 wrong thread, 3 macOS refused the write.
__attribute__((visibility("default"))) int zen_app_icon_apply(const char *value) {
  if (!NSThread.isMainThread) return 2;
  NSString *slug = value ? [NSString stringWithUTF8String:value] : nil;
  if (!slug || ![NSBundle.mainBundle.bundleURL.pathExtension isEqualToString:@"app"]) return 1;
  NSImage *image = slug.length ? imageForSlug(slug) : nil;
  if (slug.length && !image) return 1;
  if (![NSWorkspace.sharedWorkspace setIcon:image forFile:NSBundle.mainBundle.bundlePath options:0]) return 3;
  NSApp.applicationIconImage = image;
  [NSApp.dockTile display];
  // An empty value records an explicit return to the app's original icon.
  [NSUserDefaults.standardUserDefaults setObject:slug forKey:selectionKey()];
  return 0;
}

// -1 means no selection made by this chooser. The caller must not claim the
// default is selected: a custom icon may already have been set through Finder.
__attribute__((visibility("default"))) int zen_app_icon_selected(char *buffer, unsigned capacity) {
  if (!NSThread.isMainThread) return -2;
  NSString *slug = [NSUserDefaults.standardUserDefaults stringForKey:selectionKey()];
  if (!slug) return -1;
  const char *text = slug.UTF8String;
  size_t length = strlen(text);
  if (!buffer || capacity <= length) return -2;
  memcpy(buffer, text, length + 1);
  return 0;
}

__attribute__((visibility("default"))) int zen_app_icon_restore(void) {
  if (!NSThread.isMainThread) return 2;
  NSString *slug = [NSUserDefaults.standardUserDefaults stringForKey:selectionKey()];
  if (!slug.length) return 0;
  NSImage *image = imageForSlug(slug);
  if (!image) return 1;
  // A browser update replaces the app directory. Reapply the saved custom
  // Finder icon to this bundle, then restore its running Dock image.
  BOOL written = [NSWorkspace.sharedWorkspace setIcon:image forFile:NSBundle.mainBundle.bundlePath options:0];
  NSApp.applicationIconImage = image;
  [NSApp.dockTile display];
  return written ? 0 : 3;
}
