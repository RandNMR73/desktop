/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
// Offscreen shader verification only: no browser attachment or window capture.
#import <AppKit/AppKit.h>
#import <Metal/Metal.h>
#import "ZenDynamicTheme.h"

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) return 2;
    NSData *input = [NSData dataWithContentsOfFile:@(argv[2])];
    NSArray *cases = [NSJSONSerialization JSONObjectWithData:input options:0 error:NULL];
    if (![cases isKindOfClass:NSArray.class]) return 2;
    id<MTLDevice> device = MTLCreateSystemDefaultDevice();
    id<MTLLibrary> library = [device newLibraryWithURL:[NSURL fileURLWithPath:@(argv[1])] error:NULL];
    id<MTLCommandQueue> queue = [device newCommandQueue];
    if (!library || !queue) return 3;
    MTLTextureDescriptor *noiseDesc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm width:1 height:1 mipmapped:NO];
    noiseDesc.usage = MTLTextureUsageShaderRead;
    id<MTLTexture> noise = [device newTextureWithDescriptor:noiseDesc];
    uint8_t noisePixel[] = {128, 64, 192, 255};
    [noise replaceRegion:MTLRegionMake2D(0, 0, 1, 1) mipmapLevel:0 withBytes:noisePixel bytesPerRow:4];
    NSMutableArray *results = [NSMutableArray array];
    for (NSDictionary *item in cases) {
      ZenDynamicThemeParameters dynamic;
      float grain;
      if (!ZenBuildDynamicTheme(item[@"request"], &dynamic, &grain)) {
        [results addObject:@{@"valid":@NO}]; continue;
      }
      NSUInteger width = [item[@"width"] unsignedIntegerValue], height = [item[@"height"] unsignedIntegerValue];
      if (!width || width > 256 || !height || height > 256) return 4;
      BOOL half = [item[@"half"] boolValue];
      MTLPixelFormat format = half ? MTLPixelFormatRGBA16Float : MTLPixelFormatRGBA32Float;
      MTLRenderPipelineDescriptor *pipelineDesc = [MTLRenderPipelineDescriptor new];
      pipelineDesc.vertexFunction = [library newFunctionWithName:@"themeVertex"];
      pipelineDesc.fragmentFunction = [library newFunctionWithName:@"themeDynamicFragment"];
      pipelineDesc.colorAttachments[0].pixelFormat = format;
      id<MTLRenderPipelineState> pipeline = [device newRenderPipelineStateWithDescriptor:pipelineDesc error:NULL];
      if (!pipeline) return 5;
      MTLTextureDescriptor *targetDesc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:format width:width height:height mipmapped:NO];
      targetDesc.usage = MTLTextureUsageRenderTarget;
      targetDesc.storageMode = MTLStorageModeShared;
      id<MTLTexture> target = [device newTextureWithDescriptor:targetDesc];
      MTLRenderPassDescriptor *pass = [MTLRenderPassDescriptor renderPassDescriptor];
      pass.colorAttachments[0].texture = target;
      pass.colorAttachments[0].loadAction = MTLLoadActionClear;
      pass.colorAttachments[0].storeAction = MTLStoreActionStore;
      float k = (float)height / width;
      struct { float axis, grain; vector_float2 repeats; } geometry = {
        k <= 1 ? (1 - .5f*k + .5f*k*k)/(1+k*k) : (.5f*k + .5f)/(1+k*k), grain, {width/200.f, height/200.f}};
      id<MTLCommandBuffer> command = [queue commandBuffer];
      id<MTLRenderCommandEncoder> encoder = [command renderCommandEncoderWithDescriptor:pass];
      [encoder setRenderPipelineState:pipeline];
      [encoder setFragmentTexture:noise atIndex:1];
      [encoder setFragmentBytes:&geometry length:sizeof(geometry) atIndex:0];
      [encoder setFragmentBytes:&dynamic length:sizeof(dynamic) atIndex:1];
      [encoder drawPrimitives:MTLPrimitiveTypeTriangleStrip vertexStart:0 vertexCount:4];
      [encoder endEncoding]; [command commit]; [command waitUntilCompleted];
      if (command.status != MTLCommandBufferStatusCompleted) return 6;
      NSMutableData *pixels = [NSMutableData dataWithLength:width*height*(half ? 8 : 16)];
      [target getBytes:pixels.mutableBytes bytesPerRow:width*(half ? 8 : 16) fromRegion:MTLRegionMake2D(0, 0, width, height) mipmapLevel:0];
      NSMutableArray *samples = [NSMutableArray array], *srgb = [NSMutableArray array];
      for (NSNumber *y in @[@0, @(height/2), @(height-1)]) for (NSNumber *x in @[@0, @(width/2), @(width-1)]) {
        NSUInteger offset = (y.unsignedIntegerValue*width + x.unsignedIntegerValue)*4;
        NSMutableArray *rgba = [NSMutableArray array];
        for (NSUInteger i = 0; i < 4; ++i) [rgba addObject:@(half ? (float)((const _Float16 *)pixels.bytes)[offset+i] : ((const float *)pixels.bytes)[offset+i])];
        [samples addObject:@{@"x":x, @"y":y, @"rgba":rgba}];
      }
      for (NSArray *rgb in item[@"request"][@"colors"]) {
        CGFloat components[] = {[rgb[0] doubleValue], [rgb[1] doubleValue], [rgb[2] doubleValue], 1};
        NSColor *p3 = [NSColor colorWithColorSpace:NSColorSpace.displayP3ColorSpace components:components count:4];
        NSColor *converted = [p3 colorUsingColorSpace:NSColorSpace.extendedSRGBColorSpace];
        [srgb addObject:@[@(converted.redComponent), @(converted.greenComponent), @(converted.blueComponent), @1]];
      }
      [results addObject:@{@"valid":@YES, @"samples":samples, @"srgb":srgb, @"grain":@(grain)}];
    }
    NSData *output = [NSJSONSerialization dataWithJSONObject:results options:0 error:NULL];
    [[NSFileHandle fileHandleWithStandardOutput] writeData:output];
    return 0;
  }
}
