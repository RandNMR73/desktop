/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "ZenNativeCommandCaretMetrics.h"

#import <AppKit/AppKit.h>
#include <CoreText/CoreText.h>
#include <cmath>

namespace mozilla::widget {

bool GetNativeCommandCaretMetricsForFont(CGFontRef aFont, double aPointSize,
                                  NativeCommandCaretMetrics* aMetrics) {
  if (!aFont || !aMetrics || !std::isfinite(aPointSize) || aPointSize <= 0 ||
      ![NSThread isMainThread]) {
    return false;
  }

  // Repeated caret queries and paints reuse one bounded entry. Keep only the
  // immutable CGFont alive; AppKit objects are released before returning.
  struct Cache {
    CGFontRef mFont = nullptr;
    double mPointSize = 0;
    NativeCommandCaretMetrics mMetrics = {};
    ~Cache() {
      if (mFont) {
        CGFontRelease(mFont);
      }
    }
  };
  static Cache cache;
  if (cache.mFont == aFont && cache.mPointSize == aPointSize) {
    *aMetrics = cache.mMetrics;
    return true;
  }

  @autoreleasepool {
    CTFontRef font = CTFontCreateWithGraphicsFont(aFont, aPointSize, nullptr,
                                                 nullptr);
    if (!font) {
      return false;
    }
    // Reconstruct an AppKit font from the complete descriptor. Passing a
    // Core Text font directly omits AppKit's legacy-font line-spacing rules.
    CTFontDescriptorRef descriptor = CTFontCopyFontDescriptor(font);
    NSFont* nativeFont = [NSFont fontWithDescriptor:(NSFontDescriptor*)descriptor
                                              size:aPointSize];
    CFRelease(descriptor);
    CFRelease(font);
    if (!nativeFont) {
      return false;
    }
    NSLayoutManager* layout = [[NSLayoutManager alloc] init];
    const NativeCommandCaretMetrics metrics = {
        [layout defaultBaselineOffsetForFont:nativeFont],
        [layout defaultLineHeightForFont:nativeFont]};
    [layout release];
    if (!std::isfinite(metrics.mAscent) ||
        !std::isfinite(metrics.mLineHeight) || metrics.mAscent < 0 ||
        metrics.mLineHeight <= 0 || metrics.mAscent > metrics.mLineHeight) {
      return false;
    }
    CGFontRetain(aFont);
    if (cache.mFont) {
      CGFontRelease(cache.mFont);
    }
    cache.mFont = aFont;
    cache.mPointSize = aPointSize;
    cache.mMetrics = metrics;
    *aMetrics = metrics;
    return true;
  }
}

}  // namespace mozilla::widget
