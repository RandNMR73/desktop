/* Independent native conversion reference; no browser control or capture. */
#import <CoreGraphics/CoreGraphics.h>
#include <algorithm>
#include <cmath>
#include <cstdio>

int main() {
  CGColorSpaceRef srgb = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
  CGColorSpaceRef p3 = CGColorSpaceCreateWithName(kCGColorSpaceDisplayP3);
  if (!srgb || !p3) return 1;
  int red, green, blue, qr, qg, qb, count = 0, maximum = 0;
  double total = 0;
  while (std::scanf("%d,%d,%d,%d,%d,%d", &red, &green, &blue,
                   &qr, &qg, &qb) == 6) {
    CGFloat components[] = {red / 255., green / 255., blue / 255., 1.};
    CGColorRef source = CGColorCreate(srgb, components);
    CGColorRef converted = CGColorCreateCopyByMatchingToColorSpace(
        p3, kCGRenderingIntentPerceptual, source, nullptr);
    if (!converted || CGColorGetNumberOfComponents(converted) != 4) return 2;
    const CGFloat* values = CGColorGetComponents(converted);
    const int qcms[] = {qr, qg, qb};
    for (int i = 0; i != 3; ++i) {
      int native = std::lround(std::clamp(values[i], 0., 1.) * 255.);
      int difference = std::abs(qcms[i] - native);
      maximum = std::max(maximum, difference);
      total += difference;
    }
    CGColorRelease(converted);
    CGColorRelease(source);
    ++count;
  }
  CGColorSpaceRelease(p3);
  CGColorSpaceRelease(srgb);
  std::printf("{\"rgbSamples\":%d,\"identityAndAlphaCases\":%d,"
              "\"maxChannelDifference\":%d,\"meanChannelDifference\":%.8f}\n",
              count, count * 5, maximum, total / std::max(1, count * 3));
  return count == 4096 && maximum <= 2 ? 0 : 3;
}
