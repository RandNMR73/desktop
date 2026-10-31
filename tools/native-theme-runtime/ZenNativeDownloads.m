/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#import <AppKit/AppKit.h>
#import <QuickLookThumbnailing/QuickLookThumbnailing.h>
#import "ZenNativeFileActions.h"
#include <sys/stat.h>

// No callbacks enter JS from a native thread. Each bounded request is polled
// by its owner, then released (including on window teardown or timeout).
@interface ZenDownloadRequest : NSObject
@property(nonatomic, strong) NSData *result;
@property(nonatomic, strong) QLThumbnailGenerationRequest *thumbnail;
@end
@implementation ZenDownloadRequest
@end

static NSMutableDictionary<NSNumber *, ZenDownloadRequest *> *requests;
static uint32_t nextRequest;
static NSObject *requestLock;

static BOOL IsDataless(NSURL *url) {
  struct stat info;
  return lstat(url.fileSystemRepresentation, &info) == 0 && (info.st_flags & SF_DATALESS);
}

static void Initialize(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    requests = [NSMutableDictionary dictionary];
    requestLock = [NSObject new];
  });
}

static void Complete(NSNumber *key, ZenDownloadRequest *request, id result) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:result ?: @{}
                                               options:0 error:nil];
  @synchronized(requestLock) {
    if (requests[key] == request) request.result = data;
  }
}

static NSDictionary *ImageResult(CGImageRef image, BOOL preview) {
  if (!image) return @{};
  NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithCGImage:image];
  NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  if (!png || png.length > 196608) return @{};
  return @{ @"url": [@"data:image/png;base64," stringByAppendingString:
                      [png base64EncodedStringWithOptions:0]], @"preview": @(preview) };
}

int zen_downloads_version(void) { return 1; }
int zen_downloads_actions_version(void) { return 1; }

uint32_t zen_downloads_request(const char *json) {
  Initialize();
  if (!json || strlen(json) > 32768) return 0;
  NSString *encoded = [NSString stringWithUTF8String:json];
  if (!encoded) return 0;
  NSDictionary *input = [NSJSONSerialization JSONObjectWithData:
    [encoded dataUsingEncoding:NSUTF8StringEncoding] options:0 error:nil];
  if (![input isKindOfClass:NSDictionary.class] ||
      ![input[@"path"] isKindOfClass:NSString.class] ||
      ![input[@"path"] isAbsolutePath]) return 0;
  NSString *operation = input[@"operation"];
  if (![@[@"list", @"thumbnail", @"info", @"copy", @"message", @"airdrop", @"trash"]
        containsObject:operation]) return 0;
  ZenDownloadRequest *request = [ZenDownloadRequest new];
  NSNumber *key;
  @synchronized(requestLock) {
    if (requests.count >= 32) return 0;
    do { key = @(++nextRequest); } while (!nextRequest || requests[key]);
    requests[key] = request;
  }
  NSURL *url = [NSURL fileURLWithPath:input[@"path"]];
  if ([@[@"info", @"copy", @"message", @"airdrop"] containsObject:operation]) {
    dispatch_async(dispatch_get_main_queue(), ^{
      @synchronized(requestLock) { if (requests[key] != request) return; }
      NSDictionary *result = [operation isEqual:@"info"] ? ZenFileDetails(url)
        : [operation isEqual:@"copy"] ? ZenCopyFile(url, NSPasteboard.generalPasteboard)
        : ZenShareFile(url, operation);
      Complete(key, request, result);
    });
    return key.unsignedIntValue;
  }
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    @autoreleasepool {
      @synchronized(requestLock) { if (requests[key] != request) return; }
      if ([operation isEqual:@"trash"]) {
        Complete(key, request, ZenTrashFile(url, nil));
        return;
      }
      if ([operation isEqualToString:@"list"]) {
        NSSet *excluded = [NSSet set];
        NSString *ignoredPath = input[@"excludedPathsFile"];
        if ([ignoredPath isKindOfClass:NSString.class] && ignoredPath.isAbsolutePath) {
          NSData *data = [NSData dataWithContentsOfFile:ignoredPath];
          id saved = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
          id paths = [saved isKindOfClass:NSDictionary.class] ? saved[@"paths"] : nil;
          id downloadPaths = [saved isKindOfClass:NSDictionary.class] ? saved[@"downloadPaths"] : nil;
          NSMutableSet *hidden = [NSMutableSet set];
          if ([paths isKindOfClass:NSArray.class]) [hidden addObjectsFromArray:paths];
          if ([downloadPaths isKindOfClass:NSArray.class]) [hidden addObjectsFromArray:downloadPaths];
          excluded = hidden;
        }
        NSArray *keys = @[NSURLIsRegularFileKey, NSURLIsSymbolicLinkKey,
          NSURLCreationDateKey, NSURLContentModificationDateKey, NSURLFileSizeKey,
          NSURLIsUbiquitousItemKey, NSURLUbiquitousItemDownloadingStatusKey];
        NSArray<NSURL *> *files = [[NSFileManager defaultManager]
          contentsOfDirectoryAtURL:url includingPropertiesForKeys:keys
          options:NSDirectoryEnumerationSkipsHiddenFiles error:nil];
        NSMutableArray *newest = [NSMutableArray array];
        for (NSURL *file in files) {
          if ([excluded containsObject:file.path]) continue;
          NSDictionary *v = [file resourceValuesForKeys:keys error:nil];
          if (![v[NSURLIsRegularFileKey] boolValue] ||
              [v[NSURLIsSymbolicLinkKey] boolValue] ||
              [@[@"part", @"crdownload", @"download", @"tmp"] containsObject:
                file.pathExtension.lowercaseString]) continue;
          NSDate *created = v[NSURLCreationDateKey] ?: v[NSURLContentModificationDateKey];
          if (!created) continue;
          BOOL cloud = IsDataless(file) || ([v[NSURLIsUbiquitousItemKey] boolValue] &&
            [v[NSURLUbiquitousItemDownloadingStatusKey]
              isEqual:NSURLUbiquitousItemDownloadingStatusNotDownloaded]);
          [newest addObject:@{ @"path": file.path,
            @"created": @(created.timeIntervalSince1970 * 1000),
            @"modified": @([v[NSURLContentModificationDateKey] timeIntervalSince1970] * 1000),
            @"size": v[NSURLFileSizeKey] ?: @0, @"cloud": @(cloud) }];
          [newest sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
            NSComparisonResult order = [b[@"created"] compare:a[@"created"]];
            return order ?: [a[@"path"] compare:b[@"path"]];
          }];
          if (newest.count > 4) [newest removeLastObject];
        }
        Complete(key, request, @{ @"files": newest });
        return;
      }
      NSDictionary *values = [url resourceValuesForKeys:@[NSURLIsRegularFileKey,
        NSURLIsUbiquitousItemKey, NSURLUbiquitousItemDownloadingStatusKey] error:nil];
      if (![values[NSURLIsRegularFileKey] boolValue] || IsDataless(url) ||
          ([values[NSURLIsUbiquitousItemKey] boolValue] &&
           [values[NSURLUbiquitousItemDownloadingStatusKey]
             isEqual:NSURLUbiquitousItemDownloadingStatusNotDownloaded])) {
        Complete(key, request, @{});
        return;
      }
      NSNumber *requestedScale = input[@"scale"];
      CGFloat scale = [requestedScale isKindOfClass:NSNumber.class]
        ? MIN(3, MAX(1, requestedScale.doubleValue)) : 1;
      QLThumbnailGenerationRequest *thumbnail = [[QLThumbnailGenerationRequest alloc]
        initWithFileAtURL:url size:CGSizeMake(40, 40) scale:scale
        representationTypes:QLThumbnailGenerationRequestRepresentationTypeAll];
      @synchronized(requestLock) {
        if (requests[key] != request) return;
        request.thumbnail = thumbnail;
        [[QLThumbnailGenerator sharedGenerator] generateBestRepresentationForRequest:thumbnail
          completionHandler:^(QLThumbnailRepresentation *representation, NSError *error) {
            Complete(key, request, ImageResult(representation.CGImage,
              representation.type != QLThumbnailRepresentationTypeIcon));
          }];
      }
    }
  });
  return key.unsignedIntValue;
}

// Zero means pending, -1 means missing/released, -2 means insufficient buffer.
int zen_downloads_result(uint32_t token, char *buffer, uint32_t capacity) {
  Initialize();
  @synchronized(requestLock) {
    ZenDownloadRequest *request = requests[@(token)];
    if (!request) return -1;
    NSData *data = request.result;
    if (!data) return 0;
    if (!buffer || capacity <= data.length) return -2;
    memcpy(buffer, data.bytes, data.length);
    buffer[data.length] = 0;
    return (int)data.length;
  }
}

void zen_downloads_release(uint32_t token) {
  Initialize();
  QLThumbnailGenerationRequest *thumbnail;
  @synchronized(requestLock) {
    thumbnail = requests[@(token)].thumbnail;
    [requests removeObjectForKey:@(token)];
  }
  if (thumbnail) [[QLThumbnailGenerator sharedGenerator] cancelRequest:thumbnail];
}

int zen_downloads_relative_date(double timestamp, double now, char *buffer, uint32_t capacity) {
  if (!isfinite(timestamp) || !isfinite(now) || !buffer) return 0;
  NSRelativeDateTimeFormatter *formatter = [NSRelativeDateTimeFormatter new];
  formatter.unitsStyle = NSRelativeDateTimeFormatterUnitsStyleFull;
  formatter.dateTimeStyle = NSRelativeDateTimeFormatterStyleNumeric;
  NSString *text = [formatter localizedStringForDate:
    [NSDate dateWithTimeIntervalSince1970:timestamp / 1000]
    relativeToDate:[NSDate dateWithTimeIntervalSince1970:now / 1000]];
  NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding];
  if (capacity <= data.length) return 0;
  memcpy(buffer, data.bytes, data.length);
  buffer[data.length] = 0;
  return (int)data.length;
}
