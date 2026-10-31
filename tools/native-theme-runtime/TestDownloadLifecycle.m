// Exercise blocked directory reads in an owned process, without opening any
// protected user folder or changing permissions. The production ABI is loaded
// unchanged; only this test process's NSFileManager method is intercepted.
#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#include <dlfcn.h>
#include <unistd.h>

static NSUInteger checks, entered, active;
static BOOL blocked = YES;
static NSCondition *gate;
static NSString *ownedRoot;
static IMP originalDirectoryRead;
static uint32_t (*startRequest)(const char *);
static int (*requestResult)(uint32_t, char *, uint32_t);
static void (*releaseRequest)(uint32_t);

static void Check(BOOL value, NSString *message) {
  if (!value) {
    if (ownedRoot) [NSFileManager.defaultManager removeItemAtPath:ownedRoot error:nil];
    fprintf(stderr, "%s\n", message.UTF8String); exit(1);
  }
  checks++;
}

static NSArray *DirectoryRead(id self, SEL cmd, NSURL *url, NSArray *keys,
                              NSDirectoryEnumerationOptions options, NSError **error) {
  BOOL owned = [url.path hasPrefix:[ownedRoot stringByAppendingString:@"/"]];
  if (owned && [url.lastPathComponent isEqual:@"denied"]) {
    if (error) *error = [NSError errorWithDomain:NSCocoaErrorDomain code:NSFileReadNoPermissionError userInfo:nil];
    return nil;
  }
  if (owned) {
    [gate lock];
    entered++; active++;
    while (blocked) [gate wait];
    [gate unlock];
  }
  NSArray *files = ((NSArray *(*)(id, SEL, NSURL *, NSArray *,
    NSDirectoryEnumerationOptions, NSError **))originalDirectoryRead)(self, cmd, url, keys, options, error);
  if (owned) { [gate lock]; active--; [gate unlock]; }
  return files;
}

static BOOL WaitFor(BOOL (^predicate)(void)) {
  for (NSUInteger i = 0; i < 500; i++) {
    if (predicate()) return YES;
    usleep(10000);
  }
  return predicate();
}

static NSUInteger Count(BOOL currentlyActive) {
  [gate lock]; NSUInteger value = currentlyActive ? active : entered; [gate unlock];
  return value;
}

static uint32_t Start(NSDictionary *input) {
  NSData *data = [NSJSONSerialization dataWithJSONObject:input options:0 error:nil];
  return startRequest([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding].UTF8String);
}

static NSDictionary *Scan(NSUInteger index) {
  return @{ @"operation": @"list", @"path": [ownedRoot stringByAppendingPathComponent:
    [NSString stringWithFormat:@"%lu", index]] };
}

static NSDictionary *Read(uint32_t token) {
  char storage[32768]; char *buffer = storage; __block int length = 0;
  Check(WaitFor(^BOOL { length = requestResult(token, buffer, sizeof(storage)); return length != 0; }),
    @"query must settle after directory read resumes");
  releaseRequest(token);
  Check(length > 0, @"query must return JSON");
  return [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:buffer length:length] options:0 error:nil];
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    Check(argc == 2, @"native library path required");
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    Check(library != NULL, @"load native library");
    startRequest = dlsym(library, "zen_downloads_request");
    requestResult = dlsym(library, "zen_downloads_result");
    releaseRequest = dlsym(library, "zen_downloads_release");
    Check(startRequest && requestResult && releaseRequest, @"download ABI available");
    ownedRoot = [[NSTemporaryDirectory() stringByAppendingPathComponent:NSUUID.UUID.UUIDString]
      stringByResolvingSymlinksInPath];
    for (NSUInteger i = 0; i < 33; i++) {
      Check([NSFileManager.defaultManager createDirectoryAtPath:Scan(i)[@"path"]
        withIntermediateDirectories:YES attributes:nil error:nil], @"create owned folder");
    }
    gate = [NSCondition new];
    Method method = class_getInstanceMethod(NSFileManager.class,
      @selector(contentsOfDirectoryAtURL:includingPropertiesForKeys:options:error:));
    originalDirectoryRead = method_setImplementation(method, (IMP)DirectoryRead);

    uint32_t first = Start(Scan(0));
    Check(first != 0 && WaitFor(^BOOL { return Count(YES) == 1; }), @"first scan reaches held OS call");
    releaseRequest(first);
    for (NSUInteger i = 0; i < 128; i++) {
      uint32_t retry = Start(Scan(0));
      Check(retry != 0, @"retry can subscribe after previous owner timed out");
      releaseRequest(retry);
    }
    usleep(50000);
    Check(Count(NO) == 1, @"128 released retries share one actual directory read");
    uint32_t subscriber = Start(Scan(0));
    uint32_t otherSubscriber = Start(Scan(0));
    uint32_t releasedSubscriber = Start(Scan(0));
    releaseRequest(releasedSubscriber);
    Check(subscriber && otherSubscriber, @"concurrent windows receive separate polling handles");
    Check(requestResult(releasedSubscriber, NULL, 0) == -1, @"released handle stays invalid");

    for (NSUInteger i = 1; i < 32; i++) {
      uint32_t token = Start(Scan(i));
      Check(token != 0, @"distinct scan fits native worker budget");
      releaseRequest(token);
    }
    Check(WaitFor(^BOOL { return Count(YES) == 32; }), @"32 actual OS reads are held");
    for (NSUInteger i = 0; i < 128; i++) {
      Check(Start(Scan(32)) == 0, @"releasing polling handles does not reopen worker capacity");
    }
    uint32_t joinedAtCapacity = Start(Scan(0));
    Check(joinedAtCapacity != 0, @"pending scan still accepts subscribers at worker capacity");
    Check(Count(NO) == 32, @"rejected queries create no queued native reads");
    [gate lock]; blocked = NO; [gate broadcast]; [gate unlock];
    Check([Read(subscriber)[@"files"] count] == 0, @"first live subscriber receives empty directory success");
    Check([Read(otherSubscriber)[@"files"] count] == 0, @"second window receives same completion");
    Check([Read(joinedAtCapacity)[@"files"] count] == 0, @"late subscriber receives completion");
    Check(WaitFor(^BOOL { return Count(YES) == 0; }), @"all held reads finish");
    __block uint32_t fresh = 0;
    Check(WaitFor(^BOOL { fresh = Start(Scan(32)); return fresh != 0; }), @"capacity returns after native work ends");
    Check([Read(fresh)[@"files"] count] == 0, @"new query works after pressure clears");
    NSString *file = [Scan(0)[@"path"] stringByAppendingPathComponent:@"new.txt"];
    Check([@"new result" writeToFile:file atomically:NO encoding:NSUTF8StringEncoding error:nil], @"write owned new item");
    Check([Read(Start(Scan(0)))[@"files"] count] == 1, @"completed scans are not reused as a stale cache");
    NSDictionary *missing = Read(Start(@{ @"operation": @"list", @"path":
      [ownedRoot stringByAppendingPathComponent:@"missing"] }));
    Check([missing[@"files"] isEqual:@[]], @"missing folder is a successful empty source");
    NSDictionary *mixed = Read(Start(@{ @"operation": @"list", @"path": ownedRoot,
      @"directories": @[@{ @"path": Scan(0)[@"path"], @"mediaOnly": @NO },
                        @{ @"path": [ownedRoot stringByAppendingPathComponent:@"missing"], @"mediaOnly": @YES }] }));
    Check([mixed[@"files"] count] == 1, @"missing media folder does not suppress existing Downloads files");
    NSDictionary *failure = Read(Start(@{ @"operation": @"list", @"path":
      [ownedRoot stringByAppendingPathComponent:@"denied"] }));
    Check(failure[@"error"] != nil && failure[@"files"] == nil, @"permission failure is distinct from empty success");
    method_setImplementation(method, originalDirectoryRead);
    Check([NSFileManager.defaultManager removeItemAtPath:ownedRoot error:nil], @"remove owned fixtures");
    printf("{\"passed\":%lu,\"fixtureOnly\":true,\"releasedRetries\":256,\"maximumBlockedReads\":32}\n", checks);
  }
}
