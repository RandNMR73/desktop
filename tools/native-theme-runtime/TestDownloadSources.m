#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <unistd.h>

static NSUInteger checks;
static NSString *ownedDirectory;
static uint32_t (*request)(const char *);
static int (*result)(uint32_t, char *, uint32_t);
static void (*releaseRequest)(uint32_t);
static void Check(BOOL value, NSString *message) {
  if (!value) {
    if (ownedDirectory) [NSFileManager.defaultManager removeItemAtPath:ownedDirectory error:nil];
    fprintf(stderr, "%s\n", message.UTF8String); exit(1);
  }
  checks++;
}
static uint32_t Start(NSDictionary *input) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:input options:0 error:nil];
  return request([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}
static NSDictionary *Query(NSDictionary *input) {
  uint32_t token = Start(input);
  Check(token != 0, @"start source query");
  char buffer[32768]; int length = 0;
  for (NSUInteger i = 0; i < 1000 && !length; i++) {
    length = result(token, buffer, sizeof(buffer));
    if (!length) usleep(10000);
  }
  releaseRequest(token);
  Check(length > 0, @"source query completed");
  return [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:buffer length:length] options:0 error:nil];
}
static NSString *Fixture(NSString *folder, NSString *name, NSTimeInterval time) {
  NSString *path = [folder stringByAppendingPathComponent:name];
  Check([@"owned fixture" writeToFile:path atomically:NO encoding:NSUTF8StringEncoding error:nil], @"write fixture");
  Check([NSFileManager.defaultManager setAttributes:@{NSFileModificationDate:
    [NSDate dateWithTimeIntervalSince1970:time]} ofItemAtPath:path error:nil], @"set fixture date");
  char *resolved = realpath(path.fileSystemRepresentation, NULL);
  Check(resolved != NULL, @"resolve owned fixture path");
  NSString *canonical = [NSString stringWithUTF8String:resolved];
  free(resolved);
  return canonical;
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    Check(argc == 2, @"native library required");
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    Check(library != NULL, @"load native library");
    request = dlsym(library, "zen_downloads_request");
    result = dlsym(library, "zen_downloads_result");
    releaseRequest = dlsym(library, "zen_downloads_release");
    Check(request && result && releaseRequest, @"downloads ABI available");
    NSFileManager *fm = NSFileManager.defaultManager;
    ownedDirectory = [[NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString] stringByResolvingSymlinksInPath];
    NSString *media = [ownedDirectory stringByAppendingPathComponent:@"media"];
    NSString *downloads = [ownedDirectory stringByAppendingPathComponent:@"downloads"];
    Check([fm createDirectoryAtPath:media withIntermediateDirectories:YES attributes:nil error:nil], @"create media folder");
    Check([fm createDirectoryAtPath:downloads withIntermediateDirectories:YES attributes:nil error:nil], @"create download folder");
    media = [NSURL fileURLWithPath:media].URLByResolvingSymlinksInPath.path;
    downloads = [NSURL fileURLWithPath:downloads].URLByResolvingSymlinksInPath.path;
    NSTimeInterval now = NSDate.date.timeIntervalSince1970;
    for (NSUInteger i = 0; i < 6; i++) {
      Fixture(media, [NSString stringWithFormat:@"old-%lu.png", i], now - 100 - i);
      Fixture(media, [NSString stringWithFormat:@"new-%lu.pdf", i], now - i);
    }
    Fixture(media, @".hidden.png", now + 100);
    Fixture(media, @"pending.png.crdownload", now + 100);
    Fixture(media, @"voice.mp3", now + 100);
    NSString *nested = [media stringByAppendingPathComponent:@"nested"];
    Check([fm createDirectoryAtPath:nested withIntermediateDirectories:NO attributes:nil error:nil], @"create nested folder");
    Fixture(nested, @"nested.png", now + 100);
    NSString *movie = Fixture(media, @"recording.mov", now - 50);
    NSString *download = Fixture(downloads, @"installer.dmg", now - 25);
    Check([fm createSymbolicLinkAtPath:[media stringByAppendingPathComponent:@"link.png"]
      withDestinationPath:[media stringByAppendingPathComponent:@"old-0.png"] error:nil], @"create owned symbolic link");

    NSMutableDictionary *input = [@{@"operation": @"list", @"path": media,
      @"directories": @[@{@"path": media, @"mediaOnly": @YES}]} mutableCopy];
    NSArray *files = Query(input)[@"files"];
    Check(files.count == 4, @"four eligible media files despite newer PDFs, audio, hidden and nested files");
    Check([files[0][@"path"] isEqual:movie], [NSString stringWithFormat:@"movies qualify as media; got %@", files]);
    Check([files[0][@"media"] boolValue], @"media provenance survives the native query");
    for (NSUInteger i = 1; i < files.count; i++) {
      Check([[files[i][@"path"] lastPathComponent] isEqual:
        [NSString stringWithFormat:@"old-%lu.png", i - 1]], @"media filtering precedes limit");
    }
    input[@"directories"] = @[@{@"path": media, @"mediaOnly": @YES},
      @{@"path": downloads, @"mediaOnly": @NO}, @{@"path": media, @"mediaOnly": @YES}];
    files = Query(input)[@"files"];
    Check(files.count == 4, @"four items across source folders");
    Check([files[0][@"path"] isEqual:download] && [files[1][@"path"] isEqual:movie], @"downloads allow non-media and merge by date");
    Check(![files[0][@"media"] boolValue] && [files[1][@"media"] boolValue], @"merged files retain independent source membership");
    Check([NSSet setWithArray:[files valueForKey:@"path"]].count == 4, @"overlapping sources do not duplicate rows");
    NSString *hidden = [ownedDirectory stringByAppendingPathComponent:@"hidden.json"];
    Check([[NSJSONSerialization dataWithJSONObject:@{@"paths": @[movie], @"downloadPaths": @[download]}
      options:0 error:nil] writeToFile:hidden atomically:YES], @"write hidden sources");
    input[@"excludedPathsFile"] = hidden;
    files = Query(input)[@"files"];
    Check(files.count == 4 && [[files[0][@"path"] lastPathComponent] isEqual:@"old-0.png"], @"hidden items replaced before limit");
    [input removeObjectForKey:@"excludedPathsFile"];
    input[@"directories"] = @[@{@"path": media, @"mediaOnly": @YES}, @{@"path": media, @"mediaOnly": @NO}];
    files = Query(input)[@"files"];
    Check([[files[0][@"path"] lastPathComponent] isEqual:@"voice.mp3"], @"Downloads accepts audio when sharing a media directory");
    Check([NSSet setWithArray:[files valueForKey:@"path"]].count == 4, @"shared unrestricted directory is read once");
    // Hiding a browser download must not suppress an image which is also in an
    // enabled media folder. A hidden non-media file has no such second source.
    NSString *hiddenImage = Fixture(media, @"hidden-download.png", now + 200);
    NSString *hiddenPDF = Fixture(media, @"hidden-download.pdf", now + 201);
    Check([[NSJSONSerialization dataWithJSONObject:@{@"paths": @[],
      @"downloadPaths": @[hiddenImage, hiddenPDF]} options:0 error:nil]
      writeToFile:hidden atomically:YES], @"hide two browser downloads");
    input[@"excludedPathsFile"] = hidden;
    files = Query(input)[@"files"];
    Check([files[0][@"path"] isEqual:hiddenImage] && [files[0][@"media"] boolValue], @"overlapping media survives hidden browser record");
    Check(![[files valueForKey:@"path"] containsObject:hiddenPDF], @"hidden non-media download is excluded before limit");
    input[@"directories"] = @[@{@"path": media, @"mediaOnly": @YES}];
    Check([Query(input)[@"files"][0][@"path"] isEqual:hiddenImage], @"independent media folder ignores hidden-download records");
    input[@"directories"] = @[@{@"path": media, @"mediaOnly": @NO}];
    Check(![[Query(input)[@"files"] valueForKey:@"path"] containsObject:hiddenImage], @"Downloads-only query still hides browser record fallback");
    input[@"directories"] = @[@{@"path": media, @"mediaOnly": @YES}, @{@"path": media, @"mediaOnly": @NO}];
    Check([[NSJSONSerialization dataWithJSONObject:@{@"paths": @[hiddenImage],
      @"downloadPaths": @[hiddenPDF]} options:0 error:nil]
      writeToFile:hidden atomically:YES], @"hide discovered media file");
    Check(![[Query(input)[@"files"] valueForKey:@"path"] containsObject:hiddenImage], @"hidden disk item stays excluded through overlapping sources");
    input[@"directories"] = @[];
    Check([Query(input)[@"files"] count] == 0, @"all folder sources disabled");
    input[@"directories"] = @[@{@"path": @"relative", @"mediaOnly": @YES}];
    Check(Start(input) == 0, @"reject relative folder");
    input[@"directories"] = @[@{}];
    Check(Start(input) == 0, @"reject incomplete folder");
    input[@"directories"] = @[@{}, @{}, @{}, @{}, @{}];
    Check(Start(input) == 0, @"query has at most four folder sources");
    files = Query(@{@"operation": @"sources", @"path": downloads,
      @"sources": @{@"download": @YES}})[@"files"];
    Check(files.count == 1 && [files[0][@"path"] isEqual:download], @"production source request reads only the selected Downloads folder");
    Check([Query(@{@"operation": @"sources", @"path": downloads,
      @"sources": @{}})[@"files"] count] == 0, @"disabled source request does not fall back to Downloads");
    Check(Start(@{@"operation": @"sources", @"path": downloads, @"sources": @[]}) == 0, @"reject malformed source preferences");
    Check(Start(@{@"operation": @"sources", @"path": downloads,
      @"sources": @{@"desktop": @"true"}}) == 0, @"source flags require boolean numbers");
    NSDictionary *locations = Query(@{@"operation": @"locations", @"path": ownedDirectory});
    NSString *home = NSHomeDirectory();
    Check([locations[@"documents"] isEqual:[home stringByAppendingPathComponent:@"Documents"]], @"Documents resolves under current home");
    Check([locations[@"desktop"] isEqual:[home stringByAppendingPathComponent:@"Desktop"]], @"Desktop resolves under current home");
    id preference = [[[NSUserDefaults alloc] initWithSuiteName:@"com.apple.screencapture"] objectForKey:@"location"];
    Check([locations[@"screenshot"] isEqual:[preference isKindOfClass:NSString.class]
      ? [preference stringByExpandingTildeInPath] : locations[@"desktop"]], @"Screenshot location follows existing macOS preference without changing it");
    int (*mediaVersion)(void) = dlsym(library, "zen_downloads_media_version");
    Check(mediaVersion && mediaVersion() == 1, @"Media capability is independently versioned");
    for (NSUInteger i = 0; i < 60; i++) {
      Fixture(media, [NSString stringWithFormat:@"grid-%02lu.png", i], now + 1000 + i);
    }
    Fixture(media, @"newer.pdf", now + 3000);
    Fixture(media, @"newer.mp3", now + 3000);
    Fixture(nested, @"newer-nested.png", now + 3000);
    movie = Fixture(downloads, @"grid-video.mov", now + 2000);
    input = [@{@"operation": @"media", @"path": @"/",
      @"folders": @[media, downloads, media]} mutableCopy];
    files = Query(input)[@"files"];
    Check(files.count == 50, @"Media keeps fifty eligible items across distinct roots");
    Check([files[0][@"path"] isEqual:movie] && [files[0][@"kind"] isEqual:@"video"], @"Media merges movies by modification date");
    Check([[files[1][@"path"] lastPathComponent] isEqual:@"grid-59.png"] &&
      [files[1][@"kind"] isEqual:@"image"], @"native image classification survives query");
    Check([[files.lastObject[@"path"] lastPathComponent] isEqual:@"grid-11.png"], @"Media filters PDFs, audio and nested files before its bound");
    Check([NSSet setWithArray:[files valueForKey:@"path"]].count == 50, @"Media deduplicates overlapping roots");
    NSString *newestImage = files[1][@"path"];
    Check([[NSJSONSerialization dataWithJSONObject:@{@"paths": @[newestImage], @"downloadPaths": @[movie]}
      options:0 error:nil] writeToFile:hidden atomically:YES], @"hide Media item and browser movie record");
    input[@"excludedPathsFile"] = hidden;
    files = Query(input)[@"files"];
    Check(files.count == 50 && [files[0][@"path"] isEqual:movie], @"Media ignores hidden browser-only records");
    Check(![[files valueForKey:@"path"] containsObject:newestImage] &&
      [[files.lastObject[@"path"] lastPathComponent] isEqual:@"grid-10.png"], @"hiding Media replaces the fiftieth item");
    Check([Query(@{@"operation": @"media", @"path": @"/", @"folders": @[]})[@"files"] count] == 0, @"empty Media source list scans nothing");
    Check(Start(@{@"operation": @"media", @"path": @"/", @"folders": @42}) == 0, @"reject malformed Media sources");
    Check(Start(@{@"operation": @"media", @"path": @"/", @"folders": @[@42]}) == 0, @"reject non-string Media source");
    Check([fm removeItemAtPath:ownedDirectory error:nil], @"remove owned fixtures");
    printf("{\"passed\":%lu,\"fixtureOnly\":true}\n", checks);
  }
}
