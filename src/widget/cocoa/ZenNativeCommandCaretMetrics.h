/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef ZenNativeCommandCaretMetrics_h
#define ZenNativeCommandCaretMetrics_h

#include <CoreGraphics/CGFont.h>
#include "ZenNativeCommandCaret.h"

namespace mozilla::widget {

bool GetNativeCommandCaretMetricsForFont(CGFontRef aFont, double aPointSize,
                                         NativeCommandCaretMetrics* aMetrics);

}  // namespace mozilla::widget

#endif
