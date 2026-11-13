#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <sys/stat.h>
#include <unistd.h>

// No browser profile, TCC changes, or user files. The denied directory is
// created here and always made accessible again before checking results.
typedef uint32_t (*Request)(const char *);
typedef int (*Result)(uint32_t, char *, uint32_t);
typedef void (*Release)(uint32_t);
static NSUInteger checks;
static void Check(BOOL value, NSString *message) {
  if (!value) { fprintf(stderr, "%s\n", message.UTF8String); exit(1); }
  checks++;
}

static NSDictionary *Read(Request request, Result result, Release release, NSURL *url) {
  NSData *input = [NSJSONSerialization dataWithJSONObject:
    @{ @"operation": @"thumbnail", @"path": url.path, @"size": @24, @"scale": @2 }
    options:0 error:nil];
  uint32_t token = request([[NSString alloc] initWithData:input encoding:NSUTF8StringEncoding].UTF8String);
  if (!token) return nil;
  char buffer[262144];
  int length = 0;
  for (NSUInteger i = 0; i < 500 && length == 0; i++) {
    length = result(token, buffer, sizeof(buffer));
    if (length == 0) usleep(10000);
  }
  release(token);
  if (length <= 0) return nil;
  return [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:buffer length:length]
    options:0 error:nil];
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    Check(argc == 2, @"native library path required");
    void *library = dlopen(argv[1], RTLD_LOCAL | RTLD_NOW);
    Check(library != NULL, @"load native library");
    Request request = (Request)dlsym(library, "zen_downloads_request");
    Result result = (Result)dlsym(library, "zen_downloads_result");
    Release release = (Release)dlsym(library, "zen_downloads_release");
    Check(request && result && release, @"native download ABI");
    NSFileManager *fm = NSFileManager.defaultManager;
    NSURL *root = [NSURL fileURLWithPath:[NSTemporaryDirectory()
      stringByAppendingPathComponent:NSUUID.UUID.UUIDString] isDirectory:YES];
    Check([fm createDirectoryAtURL:root withIntermediateDirectories:NO attributes:nil error:nil], @"create owned directory");
    NSURL *denied = [root URLByAppendingPathComponent:@"denied" isDirectory:YES];
    Check([fm createDirectoryAtURL:denied withIntermediateDirectories:NO attributes:nil error:nil], @"create inaccessible fixture");
    NSArray *cases = @[@[@"image.png", @"image"], @[@"disk.dmg", @"disk-image"],
      @[@"document.PDF", @"pdf"], @[@"movie.mov", @"movie"], @[@"audio.mp3", @"audio"],
      @[@"compressed.zip", @"zip"], @[@"archive.tar", @"archive"],
      @[@"data.json", @"download"], @[@"unknown.zen-no-such-type", @"download"],
      @[@"no-extension", @"download"]];
    for (NSArray *item in cases) {
      Check([[@"owned fixture" dataUsingEncoding:NSUTF8StringEncoding]
        writeToURL:[denied URLByAppendingPathComponent:item[0]] atomically:YES], @"write owned file");
    }
    NSURL *folder = [root URLByAppendingPathComponent:@"folder.pdf" isDirectory:YES];
    Check([fm createDirectoryAtURL:folder withIntermediateDirectories:NO attributes:nil error:nil], @"create nonregular file fixture");
    NSMutableArray *observations = [NSMutableArray array];
    BOOL unavailable = NO;
    NSDictionary *folderResult = nil;
    @try {
      Check(chmod(denied.fileSystemRepresentation, 0000) == 0, @"deny owned directory access");
      NSURL *fresh = [NSURL fileURLWithPath:[[denied URLByAppendingPathComponent:@"document.PDF"] path]];
      NSError *error = nil;
      unavailable = [fresh resourceValuesForKeys:@[NSURLIsRegularFileKey,
        NSURLIsUbiquitousItemKey, NSURLUbiquitousItemDownloadingStatusKey] error:&error] == nil && error != nil;
      for (NSArray *item in cases) {
        NSDictionary *value = Read(request, result, release, [denied URLByAppendingPathComponent:item[0]]);
        [observations addObject:@{ @"file": item[0], @"expected": item[1], @"result": value ?: NSNull.null }];
      }
      folderResult = Read(request, result, release, folder);
    } @finally {
      chmod(denied.fileSystemRepresentation, 0700);
      [fm removeItemAtURL:root error:nil];
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:
      @{ @"metadataUnavailable": @(unavailable), @"cases": observations,
        @"folderResult": folderResult ?: NSNull.null, @"ownedFilesRemoved": @(![fm fileExistsAtPath:root.path]) }
      options:NSJSONWritingPrettyPrinted error:nil];
    puts([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
    Check(unavailable, @"fixture must reproduce unavailable metadata");
    Check(folderResult && folderResult.count == 0, @"directories must not become document previews");
    for (NSDictionary *item in observations) {
      NSDictionary *value = item[@"result"];
      Check([value isKindOfClass:NSDictionary.class] && [value[@"downloadKind"] isEqual:item[@"expected"]],
        [@"file type lost without a preview: " stringByAppendingString:item[@"file"]]);
      Check(value[@"url"] == nil && value[@"preview"] == nil, @"unavailable content has no thumbnail");
    }
    fprintf(stderr, "Passed %lu checks\n", checks);
  }
}
