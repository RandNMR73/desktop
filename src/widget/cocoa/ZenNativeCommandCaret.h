/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef ZenNativeCommandCaret_h
#define ZenNativeCommandCaret_h

class gfxFont;

namespace mozilla::widget {

struct NativeCommandCaretMetrics {
  double mAscent;
  double mLineHeight;
};

// Main-thread only. Values use AppKit points, before backing-scale rounding.
bool GetNativeCommandCaretMetrics(gfxFont* aFont, double aPointSize,
                                  NativeCommandCaretMetrics* aMetrics);

}  // namespace mozilla::widget

#endif
