/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#import <AppKit/AppKit.h>
#import <QuickLookThumbnailing/QuickLookThumbnailing.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>
#import "ZenNativeFileActions.h"
#include <sys/stat.h>

@interface ZenDownloadScan : NSObject
@property(nonatomic, copy) NSDictionary *input;
@end
@implementation ZenDownloadScan
@end

// No callbacks enter JS from a native thread. Owners release polling handles,
// but an OS directory read can outlive its owner while awaiting permission.
// Keep those workers bounded independently and share identical pending scans.
@interface ZenDownloadRequest : NSObject
@property(nonatomic, strong) NSData *result;
@property(nonatomic, strong) QLThumbnailGenerationRequest *thumbnail;
@property(nonatomic, strong) ZenDownloadScan *scan;
@end
@implementation ZenDownloadRequest
@end

static NSMutableDictionary<NSNumber *, ZenDownloadRequest *> *requests;
static NSMutableDictionary<NSDictionary *, ZenDownloadScan *> *scans;
static NSUInteger workers;
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
    scans = [NSMutableDictionary dictionary];
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

static void CompleteScan(ZenDownloadScan *scan, id result) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:result ?: @{}
                                               options:0 error:nil];
  @synchronized(requestLock) {
    for (ZenDownloadRequest *request in requests.objectEnumerator) {
      if (request.scan == scan) request.result = data;
    }
    if (scans[scan.input] == scan) [scans removeObjectForKey:scan.input];
  }
}

static void FinishWorker(ZenDownloadScan *scan) {
  @synchronized(requestLock) {
    workers--;
    if (scan && scans[scan.input] == scan) {
      // Ensure an exceptional exit does not strand subscribers indefinitely.
      CompleteScan(scan, @{});
    }
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

// Arc's download rows use this ordered UTType classification, rather than
// Finder's verbose localized type description (JSON remains "Download").
static NSString *DownloadKind(NSURL *url) {
  UTType *type = nil;
  [url getResourceValue:&type forKey:NSURLContentTypeKey error:nil];
  type = type ?: [UTType typeWithFilenameExtension:url.pathExtension];
  if ([type conformsToType:UTTypeImage]) return @"image";
  if ([type conformsToType:UTTypeDiskImage]) return @"disk-image";
  if ([type conformsToType:UTTypePDF]) return @"pdf";
  if ([type conformsToType:UTTypeMovie]) return @"movie";
  if ([type conformsToType:UTTypeAudio]) return @"audio";
  if ([type conformsToType:UTTypeZIP]) return @"zip";
  if ([type conformsToType:UTTypeArchive]) return @"archive";
  return @"download";
}

static NSDictionary *SourceLocations(void) {
  NSString *home = NSHomeDirectory();
  NSString *desktop = [home stringByAppendingPathComponent:@"Desktop"];
  // Arc resolves this preference on each query, with Desktop as the fallback.
  id location = [[[NSUserDefaults alloc] initWithSuiteName:@"com.apple.screencapture"]
    objectForKey:@"location"];
  NSString *screenshots = [location isKindOfClass:NSString.class]
    ? [location stringByExpandingTildeInPath] : desktop;
  return @{ @"documents": [home stringByAppendingPathComponent:@"Documents"],
    @"desktop": desktop, @"screenshot": screenshots };
}

static NSString *MediaKind(NSURL *url) {
  UTType *type = nil;
  [url getResourceValue:&type forKey:NSURLContentTypeKey error:nil];
  type = type ?: [UTType typeWithFilenameExtension:url.pathExtension conformingToType:UTTypeData];
  if ([type conformsToType:UTTypeImage]) return @"image";
  if ([type conformsToType:UTTypeMovie]) return @"video";
  return nil;
}

static NSArray *SourceFiles(NSArray *directories, NSSet *excluded, NSSet *excludedDownloads,
                            NSUInteger limit) {
  // A screenshot location can be Desktop, Documents, or even Downloads. Read
  // each distinct directory once, retaining both source rules. Hiding a browser
  // download suppresses its Downloads fallback, not an independent media item.
  const NSUInteger mediaSource = 1, downloadSource = 2;
  NSMutableDictionary<NSString *, NSNumber *> *roots = [NSMutableDictionary dictionary];
  for (NSDictionary *directory in directories) {
    NSString *path = directory[@"path"];
    BOOL mediaOnly = [directory[@"mediaOnly"] boolValue];
    roots[path] = @(roots[path].unsignedIntegerValue | (mediaOnly ? mediaSource : downloadSource));
  }
  NSArray *keys = @[NSURLIsRegularFileKey, NSURLIsSymbolicLinkKey,
    NSURLCreationDateKey, NSURLContentModificationDateKey, NSURLFileSizeKey,
    NSURLIsUbiquitousItemKey, NSURLUbiquitousItemDownloadingStatusKey];
  NSMutableArray *newest = [NSMutableArray array];
  for (NSString *path in roots) {
    NSUInteger sources = roots[path].unsignedIntegerValue;
    NSURL *url = [NSURL fileURLWithPath:path isDirectory:YES];
    NSError *error = nil;
    NSArray<NSURL *> *files = [[NSFileManager defaultManager]
      contentsOfDirectoryAtURL:url includingPropertiesForKeys:keys
      options:NSDirectoryEnumerationSkipsSubdirectoryDescendants |
        NSDirectoryEnumerationSkipsPackageDescendants | NSDirectoryEnumerationSkipsHiddenFiles
      error:&error];
    if (!files) {
      // A removed/unconfigured directory has no entries. A permission or I/O
      // failure leaves the contents unknown and must not erase the last view.
      if ([error.domain isEqual:NSCocoaErrorDomain] &&
          (error.code == NSFileNoSuchFileError || error.code == NSFileReadNoSuchFileError)) continue;
      return nil;
    }
    for (NSURL *file in files) {
      @autoreleasepool {
        BOOL download = (sources & downloadSource) && ![excludedDownloads containsObject:file.path];
        if ([excluded containsObject:file.path] || (!download && !(sources & mediaSource))) continue;
        NSDictionary *v = [file resourceValuesForKeys:keys error:nil];
        if (![v[NSURLIsRegularFileKey] boolValue] ||
            [v[NSURLIsSymbolicLinkKey] boolValue] ||
            [@[@"part", @"crdownload", @"download", @"tmp"] containsObject:
              file.pathExtension.lowercaseString]) continue;
        NSDate *modified = v[NSURLContentModificationDateKey];
        if (!modified) continue;
        NSTimeInterval timestamp = modified.timeIntervalSince1970 * 1000;
        if (newest.count == limit && timestamp < [newest.lastObject[@"modified"] doubleValue]) continue;
        // Filter before the bound: recent PDFs or text documents in a
        // media folder must not push older eligible images out of the result.
        NSString *kind = (sources & mediaSource) ? MediaKind(file) : nil;
        BOOL media = kind != nil;
        if (!media && !download) continue;
        NSDate *created = v[NSURLCreationDateKey] ?: modified;
        BOOL cloud = IsDataless(file) || ([v[NSURLIsUbiquitousItemKey] boolValue] &&
          [v[NSURLUbiquitousItemDownloadingStatusKey]
            isEqual:NSURLUbiquitousItemDownloadingStatusNotDownloaded]);
        [newest addObject:@{ @"path": file.path,
          @"created": @(created.timeIntervalSince1970 * 1000),
          @"modified": @(timestamp),
          @"size": v[NSURLFileSizeKey] ?: @0, @"cloud": @(cloud), @"media": @(media),
          @"kind": kind ?: @"" }];
        [newest sortUsingComparator:^NSComparisonResult(NSDictionary *a, NSDictionary *b) {
          NSComparisonResult order = [b[@"modified"] compare:a[@"modified"]];
          return order ?: [a[@"path"] compare:b[@"path"]];
        }];
        if (newest.count > limit) [newest removeLastObject];
      }
    }
  }
  return newest;
}

int zen_downloads_version(void) { return 1; }
int zen_downloads_actions_version(void) { return 1; }
int zen_downloads_sources_version(void) { return 1; }
int zen_downloads_media_version(void) { return 1; }

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
  if (![@[@"list", @"sources", @"media", @"locations", @"thumbnail", @"info", @"copy", @"message", @"airdrop", @"trash"]
        containsObject:operation]) return 0;
  if ([operation isEqual:@"media"]) {
    id folders = input[@"folders"];
    if (![folders isKindOfClass:NSArray.class] || [folders count] > 64) return 0;
    for (id folder in folders) {
      if (![folder isKindOfClass:NSString.class] || ![folder length]) return 0;
    }
  }
  if ([operation isEqual:@"sources"]) {
    id sources = input[@"sources"];
    if (![sources isKindOfClass:NSDictionary.class]) return 0;
    for (NSString *name in @[@"download", @"documents", @"desktop", @"screenshot"]) {
      if (sources[name] && ![sources[name] isKindOfClass:NSNumber.class]) return 0;
    }
  }
  id directories = input[@"directories"];
  if ([operation isEqual:@"list"] && directories) {
    if (![directories isKindOfClass:NSArray.class] || [directories count] > 4) return 0;
    for (id directory in directories) {
      if (![directory isKindOfClass:NSDictionary.class] ||
          ![directory[@"path"] isKindOfClass:NSString.class] ||
          ![directory[@"path"] isAbsolutePath] ||
          ![directory[@"mediaOnly"] isKindOfClass:NSNumber.class]) return 0;
    }
  }
  ZenDownloadRequest *request = [ZenDownloadRequest new];
  BOOL isScan = [@[@"list", @"sources", @"media"] containsObject:operation];
  ZenDownloadScan *scan = nil;
  NSNumber *key;
  @synchronized(requestLock) {
    if (requests.count >= 32) return 0;
    if (isScan) scan = scans[input];
    if (!scan && workers >= 32) return 0;
    do { key = @(++nextRequest); } while (!nextRequest || requests[key]);
    requests[key] = request;
    if (scan) {
      request.scan = scan;
      return key.unsignedIntValue;
    }
    workers++;
    if (isScan) {
      scan = [ZenDownloadScan new];
      scan.input = input;
      request.scan = scan;
      scans[input] = scan;
    }
  }
  NSURL *url = [NSURL fileURLWithPath:input[@"path"]];
  if ([@[@"info", @"copy", @"message", @"airdrop"] containsObject:operation]) {
    dispatch_async(dispatch_get_main_queue(), ^{
      @try {
        @synchronized(requestLock) { if (requests[key] != request) return; }
        NSDictionary *result = [operation isEqual:@"info"] ? ZenFileDetails(url)
          : [operation isEqual:@"copy"] ? ZenCopyFile(url, NSPasteboard.generalPasteboard)
          : ZenShareFile(url, operation);
        Complete(key, request, result);
      } @finally { FinishWorker(nil); }
    });
    return key.unsignedIntValue;
  }
  dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
    @autoreleasepool {
      @try {
        @synchronized(requestLock) { if (!scan && requests[key] != request) return; }
        if ([operation isEqual:@"locations"]) {
          Complete(key, request, SourceLocations());
          return;
        }
        if ([operation isEqual:@"trash"]) {
          Complete(key, request, ZenTrashFile(url, nil));
          return;
        }
        if ([operation isEqual:@"list"] || [operation isEqual:@"sources"] ||
            [operation isEqual:@"media"]) {
          NSSet *excluded = [NSSet set], *excludedDownloads = [NSSet set];
          NSString *ignoredPath = input[@"excludedPathsFile"];
          if ([ignoredPath isKindOfClass:NSString.class] && ignoredPath.isAbsolutePath) {
            NSData *data = [NSData dataWithContentsOfFile:ignoredPath];
            id saved = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
            id paths = [saved isKindOfClass:NSDictionary.class] ? saved[@"paths"] : nil;
            id downloadPaths = [saved isKindOfClass:NSDictionary.class] ? saved[@"downloadPaths"] : nil;
            if ([paths isKindOfClass:NSArray.class]) excluded = [NSSet setWithArray:paths];
            if ([downloadPaths isKindOfClass:NSArray.class]) excludedDownloads = [NSSet setWithArray:downloadPaths];
          }
          NSArray *sources = directories ?: @[@{ @"path": input[@"path"], @"mediaOnly": @NO }];
          if ([operation isEqual:@"sources"]) {
            NSMutableArray *selected = [NSMutableArray array];
            NSDictionary *enabled = input[@"sources"];
            if ([enabled[@"download"] boolValue]) {
              [selected addObject:@{ @"path": input[@"path"], @"mediaOnly": @NO }];
            }
            NSDictionary *locations = nil;
            for (NSString *name in @[@"documents", @"desktop", @"screenshot"]) {
              if (![enabled[name] boolValue]) continue;
              if (!locations) locations = SourceLocations();
              NSString *path = locations[name];
              if (path.isAbsolutePath) [selected addObject:@{ @"path": path, @"mediaOnly": @YES }];
            }
            sources = selected;
          }
          BOOL media = [operation isEqual:@"media"];
          if (media) {
            NSMutableDictionary *locations = [SourceLocations() mutableCopy];
            for (NSString *name in @[@"Downloads", @"Pictures", @"Music", @"Movies"]) {
              locations[name.lowercaseString] = [NSHomeDirectory() stringByAppendingPathComponent:name];
            }
            locations[@"videos"] = locations[@"movies"];
            locations[@"screenshots"] = locations[@"screenshot"];
            NSMutableArray *selected = [NSMutableArray array];
            for (NSString *folder in input[@"folders"]) {
              NSString *path = folder.isAbsolutePath ? folder : locations[folder.lowercaseString];
              if (path.isAbsolutePath) [selected addObject:@{ @"path": path, @"mediaOnly": @YES }];
            }
            sources = selected;
          }
          NSArray *files = SourceFiles(sources, excluded, excludedDownloads, media ? 50 : 4);
          CompleteScan(scan, files ? @{ @"files": files } : @{ @"error": @"folder-unavailable" });
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
        CGFloat size = [input[@"size"] isKindOfClass:NSNumber.class] &&
          [input[@"size"] doubleValue] == 24 ? 24 : 40;
        NSString *kind = DownloadKind(url);
        QLThumbnailGenerationRequest *thumbnail = [[QLThumbnailGenerationRequest alloc]
          initWithFileAtURL:url size:CGSizeMake(size, size) scale:scale
          representationTypes:QLThumbnailGenerationRequestRepresentationTypeAll];
        @synchronized(requestLock) {
          if (requests[key] != request) return;
          request.thumbnail = thumbnail;
          [[QLThumbnailGenerator sharedGenerator] generateBestRepresentationForRequest:thumbnail
            completionHandler:^(QLThumbnailRepresentation *representation, NSError *error) {
              NSMutableDictionary *result = [ImageResult(representation.CGImage,
                representation.type != QLThumbnailRepresentationTypeIcon) mutableCopy];
              result[@"downloadKind"] = kind;
              Complete(key, request, result);
            }];
        }
      } @finally { FinishWorker(scan); }
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

// -1/-2 select localized Today/Yesterday headings in Gecko. Other dates use
// Arc's full numeric formatter, with Calendar day boundaries in the user's
// macOS time zone (including 23/25-hour days), not a rolling 24-hour cutoff.
int zen_downloads_date_group(double timestamp, double now, char *buffer, uint32_t capacity) {
  if (!isfinite(now)) return 0;
  NSDate *date = isfinite(timestamp) ?
    [NSDate dateWithTimeIntervalSince1970:timestamp / 1000] : NSDate.distantPast;
  NSDate *reference = [NSDate dateWithTimeIntervalSince1970:now / 1000];
  NSCalendar *calendar = NSCalendar.currentCalendar;
  if ([calendar isDate:date inSameDayAsDate:reference]) return -1;
  NSDate *yesterday = [calendar dateByAddingUnit:NSCalendarUnitDay value:-1
    toDate:reference options:0];
  if ([calendar isDate:date inSameDayAsDate:yesterday]) return -2;
  return zen_downloads_relative_date(date.timeIntervalSince1970 * 1000, now, buffer, capacity);
}

// Arc's hover subtitle uses decimal KB–TB units and a calendar-based remaining
// interval. Keep this formatting separate from the download engine's estimate.
// A nonnegative result includes a valid empty string; -1 selects the JS fallback.
int zen_downloads_transfer_text(double current, double total, double remaining,
                                double now, char *buffer, uint32_t capacity) {
  const double maxInteger = 9007199254740991.0;
  if (!buffer || !capacity || !isfinite(current) || !isfinite(total) ||
      !isfinite(remaining) || !isfinite(now) || current < 0 || current > maxInteger ||
      total < -1 || total > maxInteger || remaining < -1 || remaining > maxInteger ||
      fabs(now) > 8640000000000000.0) return -1;
  @autoreleasepool {
    static NSByteCountFormatter *bytes;
    static NSDateComponentsFormatter *duration;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      bytes = [NSByteCountFormatter new];
      bytes.allowedUnits = NSByteCountFormatterUseKB | NSByteCountFormatterUseMB |
        NSByteCountFormatterUseGB | NSByteCountFormatterUseTB;
      bytes.includesUnit = YES;
      bytes.adaptive = YES;
      bytes.allowsNonnumericFormatting = YES;
      bytes.zeroPadsFractionDigits = YES;
      duration = [NSDateComponentsFormatter new];
      duration.unitsStyle = NSDateComponentsFormatterUnitsStyleAbbreviated;
      duration.zeroFormattingBehavior = NSDateComponentsFormatterZeroFormattingBehaviorDropLeading |
        NSDateComponentsFormatterZeroFormattingBehaviorDropMiddle |
        NSDateComponentsFormatterZeroFormattingBehaviorDropTrailing;
      duration.allowedUnits = NSCalendarUnitDay | NSCalendarUnitHour |
        NSCalendarUnitMinute | NSCalendarUnitSecond;
    });
    @synchronized(bytes) {
      @try {
        NSMutableArray<NSString *> *parts = [NSMutableArray array];
        if (current > 0 && total > 0) {
          NSString *downloaded = [bytes stringFromByteCount:(int64_t)current];
          NSString *all = [bytes stringFromByteCount:(int64_t)total];
          NSPredicate *nonempty = [NSPredicate predicateWithFormat:@"length > 0"];
          NSArray *left = [[downloaded componentsSeparatedByString:@" "] filteredArrayUsingPredicate:nonempty];
          NSArray *right = [[all componentsSeparatedByString:@" "] filteredArrayUsingPredicate:nonempty];
          if ([left.lastObject isEqual:right.lastObject] && left.firstObject) downloaded = left.firstObject;
          [parts addObject:[NSString stringWithFormat:@"%@/%@", downloaded, all]];
        }
        if (remaining > 0) {
          NSDate *start = [NSDate dateWithTimeIntervalSince1970:now / 1000];
          NSString *text = [duration stringFromDate:start toDate:[start dateByAddingTimeInterval:floor(remaining)]];
          if (text) [parts addObject:text];
        }
        NSData *data = [[parts componentsJoinedByString:@" · "] dataUsingEncoding:NSUTF8StringEncoding];
        if (!data || capacity <= data.length) return -1;
        memcpy(buffer, data.bytes, data.length);
        buffer[data.length] = 0;
        return (int)data.length;
      } @catch (__unused NSException *exception) {
        return -1;
      }
    }
  }
}
