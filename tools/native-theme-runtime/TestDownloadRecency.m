#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <unistd.h>

// Exercise the installed ABI against a fresh, disposable directory. Creation
// order deliberately disagrees with modification order, as for copied files.
static NSUInteger checks;
static NSString *ownedDirectory;
static void Check(BOOL value, NSString *message) {
  if (!value) {
    if (ownedDirectory) [NSFileManager.defaultManager removeItemAtPath:ownedDirectory error:nil];
    fprintf(stderr, "%s\n", message.UTF8String); exit(1);
  }
  checks++;
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    Check(argc == 2, @"native library required");
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    Check(library != NULL, @"load native library");
    uint32_t (*request)(const char *) = dlsym(library, "zen_downloads_request");
    int (*result)(uint32_t, char *, uint32_t) = dlsym(library, "zen_downloads_result");
    void (*release)(uint32_t) = dlsym(library, "zen_downloads_release");
    Check(request && result && release, @"downloads ABI available");
    NSFileManager *fm = NSFileManager.defaultManager;
    NSString *directory = [[NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString] stringByResolvingSymlinksInPath];
    Check([fm createDirectoryAtPath:directory withIntermediateDirectories:NO attributes:nil error:nil], @"create owned directory");
    ownedDirectory = directory;
    NSTimeInterval now = NSDate.date.timeIntervalSince1970;
    // File 0 is oldest by creation but newest by modification. File 5 is a
    // newly copied old file and must not displace any of the four newer files.
    for (NSUInteger i = 0; i < 6; i++) {
      NSString *path = [directory stringByAppendingPathComponent:[NSString stringWithFormat:@"file-%lu.json", i]];
      Check([@"{}" writeToFile:path atomically:NO encoding:NSUTF8StringEncoding error:nil], @"write fixture");
      NSDate *created = [NSDate dateWithTimeIntervalSince1970:now - (12 - i) * 86400];
      NSDate *modified = [NSDate dateWithTimeIntervalSince1970:now - (i + 1) * 3600];
      Check([fm setAttributes:@{NSFileCreationDate: created, NSFileModificationDate: modified} ofItemAtPath:path error:nil], @"set distinct dates");
    }
    NSString *newestPath = nil;
    for (NSUInteger pass = 0; pass < 2; pass++) {
      NSMutableDictionary *input = [@{@"operation": @"list", @"path": directory} mutableCopy];
      if (pass) {
        NSString *hidden = [directory stringByAppendingPathComponent:@".hidden.json"];
        NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"paths": @[newestPath]} options:0 error:nil];
        Check([data writeToFile:hidden atomically:YES], @"hide newest fixture");
        input[@"excludedPathsFile"] = hidden;
      }
      NSData *encoded = [NSJSONSerialization dataWithJSONObject:input options:0 error:nil];
      uint32_t token = request([[NSString alloc] initWithData:encoded encoding:NSUTF8StringEncoding].UTF8String);
      Check(token != 0, @"start file query");
      char buffer[32768]; int length = 0;
      for (NSUInteger i = 0; i < 1000 && length == 0; i++) {
        length = result(token, buffer, sizeof(buffer));
        if (!length) usleep(10000);
      }
      release(token);
      Check(length > 0, @"file query completed");
      NSDictionary *value = [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:buffer length:length] options:0 error:nil];
      NSArray *files = value[@"files"];
      Check(files.count == 4, @"exactly four recent files");
      if (!pass) newestPath = files[0][@"path"];
      for (NSUInteger i = 0; i < files.count; i++) {
        NSDictionary *file = files[i];
        Check([[file[@"path"] lastPathComponent] isEqual:[NSString stringWithFormat:@"file-%lu.json", i + pass]], [NSString stringWithFormat:@"expected file-%lu.json at %lu, got %@; records %@", i + pass, i, [file[@"path"] lastPathComponent], files]);
        Check(fabs([file[@"modified"] doubleValue] - (now - (i + pass + 1) * 3600) * 1000) < 1, @"modification timestamp retained");
      }
    }
    Check([fm removeItemAtPath:directory error:nil], @"remove owned fixtures");
    printf("{\"passed\":%lu,\"fixtureOnly\":true}\n", checks);
  }
}
