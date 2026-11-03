#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#include <array>
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
  const Swatch swatches[] = {
      {"p3-orange.png", kCGColorSpaceDisplayP3, {255, 77, 0, 255}},
      {"p3-green.png", kCGColorSpaceDisplayP3, {0, 255, 0, 255}},
      {"srgb-blue.png", kCGColorSpaceSRGB, {0, 0, 246, 255}},
      {"p3-orange-alpha.png", kCGColorSpaceDisplayP3, {255, 77, 0, 128}},
      {"p3-blue-alpha.png", kCGColorSpaceDisplayP3, {0, 0, 255, 128}},
      {"p3-repaint.png", kCGColorSpaceDisplayP3, {255, 51, 0, 255}},
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
