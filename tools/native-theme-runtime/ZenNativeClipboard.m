/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
#import "ZenNativeClipboard.h"
#include <zlib.h>
#include <string.h>

static uint32_t Read32(const uint8_t *p) {
  return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3];
}

// Input is produced by our bounded canvas encoder. Validate its framing and
// checksums before touching the pasteboard; never decode or re-encode pixels.
static BOOL ValidPNG(const uint8_t *bytes, size_t length) {
  static const uint8_t signature[] = {137, 80, 78, 71, 13, 10, 26, 10};
  if (!bytes || length < 57 || length > 144 * 1024 * 1024 ||
      memcmp(bytes, signature, sizeof(signature))) return NO;
  BOOL header = NO, pixels = NO;
  for (size_t offset = 8; offset <= length - 12;) {
    uint32_t size = Read32(bytes + offset);
    if (size > length - offset - 12) return NO;
    const uint8_t *type = bytes + offset + 4, *data = type + 4;
    uint32_t checksum = (uint32_t)crc32(0, type, size + 4);
    if (checksum != Read32(data + size)) return NO;
    if (!memcmp(type, "IHDR", 4)) {
      if (header || offset != 8 || size != 13) return NO;
      uint32_t width = Read32(data), height = Read32(data + 4);
      if (!width || !height || width > 16384 || height > 16384 ||
          (uint64_t)width * height > 32 * 1024 * 1024) return NO;
      // OffscreenCanvas PNG exports are 8-bit RGB or RGBA, non-interlaced.
      if (data[8] != 8 || (data[9] != 2 && data[9] != 6) ||
          data[10] || data[11] || data[12]) return NO;
      header = YES;
    } else if (!header || !memcmp(type, "acTL", 4)) return NO;
    else if (!memcmp(type, "IDAT", 4)) pixels = YES;
    else if (!memcmp(type, "IEND", 4))
      return pixels && size == 0 && offset + 12 == length;
    offset += (size_t)size + 12;
  }
  return NO;
}

int ZenWritePNG(NSPasteboard *pasteboard, const uint8_t *bytes, size_t length) {
  if (!NSThread.isMainThread) return 2;
  if (!ValidPNG(bytes, length)) return 1;
  @autoreleasepool {
    @try {
      // NSData owns its bytes before the synchronous ctypes call returns. No
      // JS pointer, callback, file, or delayed pasteboard provider is retained.
      NSData *data = [NSData dataWithBytes:bytes length:length];
      NSPasteboardItem *item = [NSPasteboardItem new];
      if (!data || !item || ![item setData:data forType:NSPasteboardTypePNG]) return 3;
      if (!pasteboard) return 3;
      [pasteboard clearContents];
      return [pasteboard writeObjects:@[item]] ? 0 : 3;
    } @catch (NSException *exception) { return 3; }
  }
}

int zen_clipboard_version(void) { return 1; }
int zen_clipboard_copy_png(const uint8_t *bytes, size_t length) {
  if (!NSThread.isMainThread) return 2;
  return ZenWritePNG(NSPasteboard.generalPasteboard, bytes, length);
}
