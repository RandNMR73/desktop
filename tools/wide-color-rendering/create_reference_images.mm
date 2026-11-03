#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <filesystem>

int main(int argc, const char* argv[]) {
  if (argc != 2) return 1;
  const std::filesystem::path output(argv[1]);
  std::filesystem::create_directories(output);
  struct Swatch {
    const char* name;
    CFStringRef space;
    std::array<uint8_t, 4> rgba;
  };
  auto p3 = CGColorSpaceCreateWithName(kCGColorSpaceDisplayP3);
  auto srgb = CGColorSpaceCreateWithName(kCGColorSpaceExtendedSRGB);
  const CGFloat orange[] = {1, 77.0 / 255, 0, 128.0 / 255};
  auto foreground = CGColorCreate(p3, orange);
  auto extended = CGColorCreateCopyByMatchingToColorSpace(
      srgb, kCGRenderingIntentRelativeColorimetric, foreground, nullptr);
  const auto* components = CGColorGetComponents(extended);
  CGFloat composed[] = {0, 0, 0, 1};
  for (int channel = 0; channel < 3; ++channel) {
    composed[channel] = components[channel] * orange[3] + 1 - orange[3];
  }
  auto blended = CGColorCreate(srgb, composed);
  auto outputColor = CGColorCreateCopyByMatchingToColorSpace(
      p3, kCGRenderingIntentRelativeColorimetric, blended, nullptr);
  std::array<uint8_t, 4> rootAlpha = {0, 0, 0, 255};
  for (int channel = 0; channel < 3; ++channel) {
    rootAlpha[channel] = std::lround(
        std::clamp(CGColorGetComponents(outputColor)[channel], CGFloat(0), CGFloat(1)) * 255);
  }
  CGColorRelease(outputColor);
  CGColorRelease(blended);
  CGColorRelease(extended);
  CGColorRelease(foreground);
  CGColorSpaceRelease(srgb);
  CGColorSpaceRelease(p3);
  const Swatch swatches[] = {
      {"p3-orange.png", kCGColorSpaceDisplayP3, {255, 77, 0, 255}},
      {"p3-green.png", kCGColorSpaceDisplayP3, {0, 255, 0, 255}},
      {"srgb-blue.png", kCGColorSpaceSRGB, {0, 0, 246, 255}},
      {"p3-orange-alpha.png", kCGColorSpaceDisplayP3, {255, 77, 0, 128}},
      {"p3-blue-alpha.png", kCGColorSpaceDisplayP3, {0, 0, 255, 128}},
      {"p3-repaint.png", kCGColorSpaceDisplayP3, {255, 51, 0, 255}},
      {"p3-root-alpha.png", kCGColorSpaceDisplayP3, rootAlpha},
  };
  for (const auto& swatch : swatches) {
    auto space = CGColorSpaceCreateWithName(swatch.space);
    auto provider = CGDataProviderCreateWithData(
        nullptr, swatch.rgba.data(), swatch.rgba.size(), nullptr);
    auto image = CGImageCreate(1, 1, 8, 32, 4, space, kCGImageAlphaLast,
                               provider, nullptr, false,
                               kCGRenderingIntentRelativeColorimetric);
    const auto path = (output / swatch.name).string();
    auto url = CFURLCreateFromFileSystemRepresentation(
        nullptr, reinterpret_cast<const UInt8*>(path.data()), path.size(), false);
    auto destination = CGImageDestinationCreateWithURL(url, CFSTR("public.png"), 1,
                                                        nullptr);
    if (!space || !provider || !image || !url || !destination) return 2;
    CGImageDestinationAddImage(destination, image, nullptr);
    if (!CGImageDestinationFinalize(destination)) return 3;
    CFRelease(destination);
    CFRelease(url);
    CGImageRelease(image);
    CGDataProviderRelease(provider);
    CGColorSpaceRelease(space);
  }
}
