#import "ZenNativeFileActions.h"
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

// Standalone test: all mutations use files created by this process and a
// private pasteboard. Sharing is inspected, never invoked.
static NSUInteger checks;
static void Check(BOOL value, NSString *message) {
  if (!value) { fprintf(stderr, "%s\n", message.UTF8String); exit(1); }
  checks++;
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    Check(argc == 2, @"owned fixture directory required");
    NSURL *directory = [NSURL fileURLWithPath:@(argv[1]) isDirectory:YES];
    NSFileManager *fm = NSFileManager.defaultManager;
    Check(![fm fileExistsAtPath:directory.path], @"fixture directory must be new");
    Check([fm createDirectoryAtURL:directory withIntermediateDirectories:NO attributes:nil error:nil], @"create fixtures");
    NSURL *text = [directory URLByAppendingPathComponent:@"owned.txt"];
    Check([@"owned fixture" writeToURL:text atomically:YES encoding:NSUTF8StringEncoding error:nil], @"write file");
    NSURL *picture = [directory URLByAppendingPathComponent:@"owned.png"];
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL pixelsWide:8 pixelsHigh:8 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
    memset(bitmap.bitmapData, 255, bitmap.bytesPerRow * bitmap.pixelsHigh);
    Check([[bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}] writeToURL:picture atomically:YES], @"write image");
    NSDictionary *info = ZenFileDetails(picture);
    Check([info[@"kind"] isEqual:@"image"] && [info[@"exists"] boolValue] && [info[@"previewable"] boolValue], @"image classification");
    Check([info[@"application"] length] > 0, @"default app label");
    Check(![ZenFileDetails(directory)[@"previewable"] boolValue], @"directories cannot preview");
    NSPasteboard *board = [NSPasteboard pasteboardWithUniqueName];
    Check([ZenCopyFile(picture, board)[@"succeeded"] boolValue], @"copy image");
    Check([board canReadObjectForClasses:@[NSImage.class] options:@{}], @"image clipboard content");
    Check(![board.types containsObject:NSPasteboardTypeFileURL], @"image copies pixels, not file URL");
    Check([ZenCopyFile(text, board)[@"succeeded"] boolValue], @"copy document");
    Check([board.types containsObject:NSPasteboardTypeFileURL], @"document copies file URL");
    NSString *before = [board stringForType:NSPasteboardTypeFileURL];
    NSURL *missing = [directory URLByAppendingPathComponent:@"missing.txt"];
    Check(![ZenCopyFile(missing, board)[@"succeeded"] boolValue], @"missing copy fails");
    Check([[board stringForType:NSPasteboardTypeFileURL] isEqual:before], @"failed copy preserves clipboard");
    Check(![ZenTrashFile(missing, nil)[@"succeeded"] boolValue], @"missing trash fails");
    NSURL *moved = nil;
    Check([ZenTrashFile(text, &moved)[@"succeeded"] boolValue], @"move owned file to Trash");
    Check(![fm fileExistsAtPath:text.path], @"original path gone");
    Check(moved && [[NSString stringWithContentsOfURL:moved encoding:NSUTF8StringEncoding error:nil] isEqual:@"owned fixture"], @"Trash retains recoverable owned file");
    Check([fm moveItemAtURL:moved toURL:text error:nil], @"restore owned fixture");
    [board releaseGlobally];
    Check([fm removeItemAtURL:directory error:nil], @"remove owned test fixtures");
    printf("{\"passed\":%lu,\"sharingInvoked\":false,\"privatePasteboard\":true}\n", checks);
  }
}
