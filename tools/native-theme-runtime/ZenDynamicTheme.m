/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
#import <AppKit/AppKit.h>
#import "ZenDynamicTheme.h"
#include <math.h>

static BOOL UnitNumber(id value) {
  return [value isKindOfClass:NSNumber.class] &&
    CFGetTypeID((__bridge CFTypeRef)value) != CFBooleanGetTypeID() &&
    isfinite([value doubleValue]) && [value doubleValue] >= 0 && [value doubleValue] <= 1;
}
static double Linear(double c) {
  double a = fabs(c);
  return copysign(a <= .04045 ? a / 12.92 : pow((a + .055) / 1.055, 2.4), c);
}
static vector_float4 OKLab(NSColor *color) {
  double r = Linear(color.redComponent), g = Linear(color.greenComponent), b = Linear(color.blueComponent);
  double l = cbrt(.4122214708*r + .5363325363*g + .0514459929*b);
  double m = cbrt(.2119034982*r + .6806995451*g + .1073969566*b);
  double s = cbrt(.0883024619*r + .2817188376*g + .6299787005*b);
  return (vector_float4){.2104542553*l + .7936177850*m - .0040720468*s,
    1.9779984951*l - 2.4285922050*m + .4505937099*s,
    .0259040371*l + .7827717662*m - .8086757660*s, 1};
}

BOOL ZenBuildDynamicTheme(NSDictionary *request, ZenDynamicThemeParameters *parameters, float *grain) {
  if (!parameters || !grain || ![request isKindOfClass:NSDictionary.class] ||
      ![request[@"version"] isEqual:@1] || ![request[@"colors"] isKindOfClass:NSArray.class] ||
      !UnitNumber(request[@"intensity"]) || !UnitNumber(request[@"noise"])) return NO;
  NSArray *colors = request[@"colors"];
  if (!colors.count || colors.count > 3) return NO;
  NSString *appearance = request[@"appearance"];
  if (![appearance isEqual:@"dark"] && ![appearance isEqual:@"light"]) return NO;
  id texture = request[@"texture"];
  if (![texture isKindOfClass:NSString.class]) return NO;
  NSNumber *strength = @{@"grain":@.8, @"sand":@.15, @"denim":@.6, @"tweed":@.4}[texture];
  if (!strength) return NO;
  vector_float4 lab[3];
  for (NSUInteger i = 0; i < colors.count; ++i) {
    id rgb = colors[i];
    if (![rgb isKindOfClass:NSArray.class] || [rgb count] != 3) return NO;
    for (id value in rgb) if (!UnitNumber(value)) return NO;
    CGFloat values[] = {[rgb[0] doubleValue], [rgb[1] doubleValue], [rgb[2] doubleValue], 1};
    NSColor *p3 = [NSColor colorWithColorSpace:NSColorSpace.displayP3ColorSpace components:values count:4];
    NSColor *srgb = [p3 colorUsingColorSpace:NSColorSpace.extendedSRGBColorSpace];
    if (!srgb) return NO;
    lab[i] = OKLab(srgb);
  }
  float alpha = .55 * [request[@"intensity"] doubleValue] + .2;
  BOOL dark = [appearance isEqual:@"dark"];
  *parameters = (ZenDynamicThemeParameters){lab[0], colors.count > 1 ? lab[1] : lab[0],
    colors.count > 2 ? lab[2] : (vector_float4){0, 0, 0, 0},
    {alpha, fminf(alpha, .5) * (dark ? .35 : 1), dark ? 0 : 1, colors.count > 2 ? 1 : 0}};
  *grain = (66.f / 255) * strength.floatValue * [request[@"noise"] floatValue];
  return YES;
}
