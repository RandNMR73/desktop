/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
#import <Foundation/Foundation.h>
#import <simd/simd.h>

// Matches DynamicThemeParameters in theme.metal; all members have 16-byte alignment.
typedef struct {
  vector_float4 base0, base1, overlay, settings;
} ZenDynamicThemeParameters;

BOOL ZenBuildDynamicTheme(NSDictionary *request, ZenDynamicThemeParameters *parameters,
                         float *grain);
