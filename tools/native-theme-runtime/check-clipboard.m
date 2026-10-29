/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
#import "ZenNativeClipboard.h"
#include <zlib.h>

static void Require(BOOL condition, NSString *message) {
  if (!condition) { fprintf(stderr, "%s\n", message.UTF8String); exit(1); }
}
static void Write32(uint8_t *p, uint32_t value) {
  p[0] = value >> 24; p[1] = value >> 16; p[2] = value >> 8; p[3] = value;
}
int main(void) {
  @autoreleasepool {
    NSPasteboard *board = [NSPasteboard pasteboardWithUniqueName];
    NSBitmapImageRep *image = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL
      pixelsWide:2 pixelsHigh:2 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES
      isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:8 bitsPerPixel:32];
    const uint8_t pixels[] = {255,0,0,255, 0,255,0,255, 0,0,255,255, 0,0,0,0};
    memcpy(image.bitmapData, pixels, sizeof(pixels));
    NSData *png = [image representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
    Require(png != nil, @"Fixture encoding failed");
    Require(ZenWritePNG(board, png.bytes, png.length) == 0, @"PNG copy failed");
    NSData *read = [board dataForType:NSPasteboardTypePNG];
    Require([read isEqual:png], @"Encoded PNG bytes changed");
    fprintf(stdout, "Pasteboard flavors: %s\n", board.types.description.UTF8String);
    // macOS advertises legacy aliases and a convertible TIFF representation
    // even though this writer supplies only the original PNG bytes.
    Require([board.types containsObject:NSPasteboardTypePNG],
      @"Unexpected clipboard flavors");
    NSBitmapImageRep *decoded = [NSBitmapImageRep imageRepWithData:read];
    Require(decoded.pixelsWide == 2 && decoded.pixelsHigh == 2, @"PNG cannot be decoded");
    NSInteger change = board.changeCount;
    for (NSUInteger length = 0; length < png.length; ++length)
      Require(ZenWritePNG(board, png.bytes, length) == 1, @"Truncated PNG accepted");
    NSMutableData *bad = png.mutableCopy;
    ((uint8_t *)bad.mutableBytes)[40] ^= 1;
    Require(ZenWritePNG(board, bad.bytes, bad.length) == 1, @"Bad checksum accepted");
    bad = png.mutableCopy;
    uint8_t *bytes = bad.mutableBytes;
    Write32(bytes + 16, 16385);
    Write32(bytes + 29, (uint32_t)crc32(0, bytes + 12, 17));
    Require(ZenWritePNG(board, bad.bytes, bad.length) == 1, @"Oversized PNG accepted");
    Require(ZenWritePNG(board, NULL, png.length) == 1, @"Null bytes accepted");
    Require(board.changeCount == change && [[board dataForType:NSPasteboardTypePNG] isEqual:png],
      @"Invalid input changed the pasteboard");
    __block int backgroundResult = 0;
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
      backgroundResult = ZenWritePNG(board, png.bytes, png.length);
      dispatch_semaphore_signal(done);
    });
    Require(dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC)) == 0,
      @"Background guard timed out");
    Require(backgroundResult == 2 && board.changeCount == change, @"Wrong-thread guard failed");
    [board releaseGlobally];
    puts("Native PNG checks passed: byte preservation, native decode, bounds, CRC, truncation, main-thread guard, no mutation on invalid input.");
  }
}
