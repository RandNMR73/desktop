/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
#import "ZenNativeFileActions.h"
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

static UTType *FileType(NSURL *url) {
  UTType *type = nil;
  [url getResourceValue:&type forKey:NSURLContentTypeKey error:nil];
  return type ?: [UTType typeWithFilenameExtension:url.pathExtension];
}

static BOOL IsFile(NSURL *url) {
  NSNumber *regular = nil;
  [url getResourceValue:&regular forKey:NSURLIsRegularFileKey error:nil];
  return regular.boolValue;
}

static NSDictionary *Failure(NSError *error) {
  return @{ @"succeeded": @NO, @"error": error.localizedDescription ?: @"File unavailable" };
}

NSDictionary *ZenFileDetails(NSURL *url) {
  if (![NSThread isMainThread] || !url.isFileURL) return @{};
  UTType *type = FileType(url);
  NSString *kind = [type conformsToType:UTTypeImage] ? @"image"
    : [type conformsToType:UTTypeMovie] ? @"movie"
    : [type conformsToType:UTTypePDF] ? @"pdf" : @"file";
  NSURL *application = [NSWorkspace.sharedWorkspace URLForApplicationToOpenURL:url];
  NSBundle *bundle = application ? [NSBundle bundleWithURL:application] : nil;
  NSString *name = [bundle objectForInfoDictionaryKey:@"CFBundleDisplayName"]
    ?: [bundle objectForInfoDictionaryKey:@"CFBundleName"];
  if (![name isKindOfClass:NSString.class]) name = nil;
  return @{ @"kind": kind, @"exists": @(IsFile(url)),
    @"previewable": @(!url.hasDirectoryPath &&
      ([kind isEqual:@"image"] || [kind isEqual:@"pdf"])),
    @"application": name ?: @"" };
}

NSDictionary *ZenCopyFile(NSURL *url, NSPasteboard *pasteboard) {
  if (![NSThread isMainThread] || !IsFile(url)) return Failure(nil);
  id<NSPasteboardWriting> item = url;
  if ([FileType(url) conformsToType:UTTypeImage]) {
    NSImage *image = [[NSImage alloc] initWithContentsOfURL:url];
    if (image) item = image;
  }
  [pasteboard clearContents];
  return @{ @"succeeded": @([pasteboard writeObjects:@[item]]) };
}

NSDictionary *ZenShareFile(NSURL *url, NSString *operation) {
  if (![NSThread isMainThread] || !IsFile(url)) return Failure(nil);
  NSSharingServiceName name = [operation isEqual:@"message"]
    ? NSSharingServiceNameComposeMessage : NSSharingServiceNameSendViaAirDrop;
  NSSharingService *service = [NSSharingService sharingServiceNamed:name];
  if (![service canPerformWithItems:@[url]]) return Failure(nil);
  // Only called by an explicit file-menu command. No recipients or message
  // text are supplied; macOS presents the user's normal sharing interface.
  [service performWithItems:@[url]];
  return @{ @"succeeded": @YES };
}

NSDictionary *ZenTrashFile(NSURL *url, NSURL **resultingURL) {
  if (!IsFile(url)) return Failure(nil);
  NSError *error = nil;
  NSURL *destination = nil;
  BOOL moved = [NSFileManager.defaultManager trashItemAtURL:url
    resultingItemURL:&destination error:&error];
  if (moved && resultingURL) *resultingURL = destination;
  // Never fall back to removeItem: Trash must remain recoverable.
  return moved ? @{ @"succeeded": @YES } : Failure(error);
}
