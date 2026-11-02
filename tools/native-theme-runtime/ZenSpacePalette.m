/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#import <AppKit/AppKit.h>
#include <math.h>
#include <stdint.h>
#include <string.h>

// Arc 1.171: primary 0x100d85a58, semantic 0x100d86004. Adjust lightness
// in the color pad's Display P3 space, then store extended sRGB. AppKit's
// conversion (including CGColor round trips) must precede compositing.
static double luminance(NSColor *color) {
  NSColor *rgb = [NSColor colorWithCGColor:color.CGColor] ?: color;
  CGFloat r, g, b, a;
  [rgb getRed:&r green:&g blue:&b alpha:&a];
  double sum = 0, channels[] = {r, g, b}, weights[] = {.2126, .7152, .0722};
  for (int i = 0; i < 3; i++) {
    double c = channels[i];
    sum += weights[i] * (c <= .03928 ? c / 12.92 : pow((c + .055) / 1.055, 2.4));
  }
  return sum;
}

static NSColor *shift(NSColor *color, double step) {
  NSColor *rgb = [NSColor colorWithCGColor:color.CGColor] ?: color;
  CGFloat r, g, b, a;
  [rgb getRed:&r green:&g blue:&b alpha:&a];
  double max = fmax(r, fmax(g, b)), min = fmin(r, fmin(g, b));
  double l = (max + min) * .5, d = max - min, h = 0, s = 0;
  if (d != 0) {
    s = d / (l > .5 ? 2 - max - min : max + min);
    h = (max == r ? (g - b) / d : max == g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
  }
  l = fmax(0, fmin(1, l + step));
  double q = l > .5 ? l + s - l * s : l * (1 + s), p = 2 * l - q;
  double offsets[] = {1.0 / 3, 0, -1.0 / 3};
  CGFloat values[4] = {0, 0, 0, a};
  for (int i = 0; i < 3; i++) {
    double t = fmod(fmod(h + offsets[i], 1) + 1, 1);
    values[i] = t < 1.0 / 6 ? p + (q - p) * t * 6
      : t < .5 ? q : t < 2.0 / 3 ? p + (q - p) * (2.0 / 3 - t) * 6 : p;
  }
  return [NSColor colorWithColorSpace:color.colorSpace components:values count:4];
}

static NSColor *adjust(NSColor *input, double low, double high) {
  NSColor *color = input;
  // A bounded replacement for the reference's recursive .01-lightness steps.
  for (int i = 0; i <= 101; i++) {
    double y = luminance(color);
    if (y >= low && y <= high) break;
    color = shift(color, y < low ? .01 : -.01);
  }
  return [color colorUsingColorSpace:NSColorSpace.extendedSRGBColorSpace];
}

static void store(NSColor *color, double *output) {
  CGFloat r, g, b, a;
  [color getRed:&r green:&g blue:&b alpha:&a];
  output[0] = r; output[1] = g; output[2] = b; output[3] = a;
}

// Straight-alpha composition in extended sRGB; no clipping or linearization.
static void blend(const double *color, double alpha, double base, double baseAlpha, double *out) {
  double a = 1 - (1 - alpha) * (1 - baseAlpha);
  CGFloat values[4];
  for (int i = 0; i < 3; i++) values[i] = color[i] * alpha / a + (1 - alpha) * base * baseAlpha / a;
  values[3] = a;
  store([NSColor colorWithColorSpace:NSColorSpace.extendedSRGBColorSpace components:values count:4], out);
}

int zen_space_palette_version(void) { return 1; }

// space: 0=sRGB, 1=Display P3. Output: four primary and 12 light + 12 dark
// RGBA colors. No window access, timers, Arc bundle dependency, or disk reads.
int zen_space_palette(int space, const double *rgb, uint32_t count, double *out, uint32_t length) {
  if ((space != 0 && space != 1) || !rgb || count != 3 || !out || length != 112) return 1;
  for (int i = 0; i < 3; i++) if (!isfinite(rgb[i]) || rgb[i] < 0 || rgb[i] > 1) return 1;
  @autoreleasepool {
    CGFloat values[] = {rgb[0], rgb[1], rgb[2], 1};
    NSColor *color = [NSColor colorWithColorSpace:space ? NSColorSpace.displayP3ColorSpace : NSColorSpace.sRGBColorSpace
                                    components:values count:4];
    color = [color colorUsingColorSpace:NSColorSpace.displayP3ColorSpace];
    if (!color) return 2;
    double result[112], ranges[][2] = {{.85, .95}, {.3, .5}, {0, .5}, {0, .1}};
    for (int i = 0; i < 4; i++) {
      NSColor *adjusted = adjust(color, ranges[i][0], ranges[i][1]);
      if (!adjusted) return 2;
      store(adjusted, result + 4 * i);
    }
    const double *t = result, *m = result + 4, *s = result + 8, *d = result + 12;
    double *light = result + 16, *dark = result + 64;
    const double *lightCopies[] = {s, m, t, d, t}, *darkCopies[] = {t, m, s, t, d};
    for (int i = 0; i < 5; i++) {
      memcpy(light + 4 * i, lightCopies[i], 4 * sizeof(double));
      memcpy(dark + 4 * i, darkCopies[i], 4 * sizeof(double));
    }
    blend(d, .01, 1, 1, light + 20); blend(d, .1, 1, 1, light + 24);
    blend(d, .5, 1, 1, light + 28); blend(d, .2, 1, 1, light + 32);
    memcpy(light + 36, t, 4 * sizeof(double));
    blend(d, .3, 0, 1, light + 40); blend(d, .4, 1, 1, light + 44);
    blend(d, .15, 0, 1, dark + 20); blend(d, .3, 0, 1, dark + 24);
    blend(d, .65, 1, .45, dark + 28); blend(d, .35, 1, .2, dark + 32);
    memcpy(dark + 36, d, 4 * sizeof(double));
    blend(d, .15, 1, 1, dark + 40); blend(t, .5, 0, 1, dark + 44);
    for (int i = 0; i < 112; i++) if (!isfinite(result[i]) || fabs(result[i]) > 4) return 2;
    memcpy(out, result, sizeof(result));
    return 0;
  }
}
