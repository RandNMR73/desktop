#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <string.h>

// This test supplies extensions only: no browser profile or file fixtures.
typedef int (*Kind)(const char *, char *, uint32_t);
static NSUInteger checks;
static void Check(BOOL value, NSString *message) {
  if (!value) { fprintf(stderr, "%s\n", message.UTF8String); exit(1); }
  checks++;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    Check(argc == 2, @"native library path required");
    void *library = dlopen(argv[1], RTLD_LOCAL | RTLD_NOW);
    Check(library != NULL, @"load native library");
    Kind kind = (Kind)dlsym(library, "zen_downloads_kind_for_extension");
    Check(kind != NULL, @"extension-only download kind ABI");
    NSArray *cases = @[@[@"png", @"image"], @[@"dmg", @"disk-image"],
      @[@"PDF", @"pdf"], @[@"mov", @"movie"], @[@"mp3", @"audio"],
      @[@"zip", @"zip"], @[@"tar", @"archive"], @[@"json", @"download"],
      @[@"zen-no-such-type", @"download"], @[@"", @"download"]];
    NSMutableArray *observations = [NSMutableArray array];
    char buffer[32];
    for (NSArray *item in cases) {
      memset(buffer, 0x7f, sizeof(buffer));
      int length = kind([item[0] UTF8String], buffer, sizeof(buffer));
      Check(length == (int)[item[1] length], [@"kind length: " stringByAppendingString:item[0]]);
      Check(buffer[length] == 0, @"kind is null terminated");
      Check(strcmp(buffer, [item[1] UTF8String]) == 0, [@"kind value: " stringByAppendingString:item[0]]);
      [observations addObject:@{ @"extension": item[0], @"kind": [NSString stringWithUTF8String:buffer] }];
    }
    memset(buffer, 0x7f, sizeof(buffer));
    Check(kind("pdf", buffer, 3) == 0, @"buffer needs space for terminator");
    Check(buffer[0] == 0x7f, @"small buffer remains untouched");
    Check(kind("pdf", buffer, 4) == 3 && strcmp(buffer, "pdf") == 0, @"exact buffer capacity");
    Check(kind(NULL, buffer, sizeof(buffer)) == 0, @"null extension");
    Check(kind("pdf", NULL, sizeof(buffer)) == 0, @"null buffer");
    Check(kind("pdf", buffer, 0) == 0, @"zero capacity");
    Check(kind("/owned/report.pdf", buffer, sizeof(buffer)) == 0, @"paths are not extensions");
    Check(kind("owned\\report.pdf", buffer, sizeof(buffer)) == 0, @"backslash path rejected");
    Check(kind(".pdf", buffer, sizeof(buffer)) == 0, @"dotted suffix rejected");
    const char malformed[] = { (char)0xff, 0 };
    Check(kind(malformed, buffer, sizeof(buffer)) == 0, @"invalid UTF-8 rejected");
    char oversized[1026];
    memset(oversized, 'x', sizeof(oversized));
    oversized[sizeof(oversized) - 1] = 0;
    Check(kind(oversized, buffer, sizeof(buffer)) == 0, @"oversized extension rejected");
    NSData *json = [NSJSONSerialization dataWithJSONObject:
      @{ @"cases": observations, @"checksPassed": @(checks), @"fileFixtures": @NO }
      options:NSJSONWritingPrettyPrinted error:NULL];
    puts([[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding].UTF8String);
    fprintf(stderr, "Passed %lu checks\n", checks);
  }
}
