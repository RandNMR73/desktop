/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "ZenNativeCommandCaretMetrics.h"
#include "gfxMacFont.h"

namespace mozilla::widget {

bool GetNativeCommandCaretMetrics(gfxFont* aFont, double aPointSize,
                                  NativeCommandCaretMetrics* aMetrics) {
  if (!aFont || aFont->GetType() != gfxFont::FONT_TYPE_MAC) {
    return false;
  }
  return GetNativeCommandCaretMetricsForFont(
      static_cast<gfxMacFont*>(aFont)->GetCGFontRef(), aPointSize, aMetrics);
}

}  // namespace mozilla::widget
