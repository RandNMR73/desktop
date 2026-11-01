/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Offscreen Metal regression: a floating region must equal the corresponding
// pixels of the whole window, including grain phase and extended RGB channels.
// Loads a built bundle; creates no windows and changes no browser state.
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <simd/simd.h>
#include <dlfcn.h>
#include <math.h>

@interface ZenThemeResources : NSObject
@property id<MTLDevice> device;
@property id<MTLCommandQueue> queue;
@property id<MTLRenderPipelineState> pipeline;
@property id<MTLRenderPipelineState> regionPipeline;
@property NSArray<id<MTLTexture>> *fields;
@property NSArray<NSNumber *> *grains;
@property id<MTLTexture> grain;
- (instancetype)initWithURL:(NSURL *)url;
@end

static NSData *Render(ZenThemeResources *r, NSUInteger index,
    NSUInteger fullWidth, NSUInteger fullHeight, NSUInteger x, NSUInteger y,
    NSUInteger width, NSUInteger height, BOOL region) {
  MTLTextureDescriptor *desc = [MTLTextureDescriptor
    texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA16Float
    width:width height:height mipmapped:NO];
  desc.usage = MTLTextureUsageRenderTarget;
  desc.storageMode = MTLStorageModeShared;
  id<MTLTexture> output = [r.device newTextureWithDescriptor:desc];
  MTLRenderPassDescriptor *pass = [MTLRenderPassDescriptor renderPassDescriptor];
  pass.colorAttachments[0].texture = output;
  pass.colorAttachments[0].loadAction = MTLLoadActionClear;
  pass.colorAttachments[0].storeAction = MTLStoreActionStore;
  id<MTLCommandBuffer> command = [r.queue commandBuffer];
  id<MTLRenderCommandEncoder> encoder = [command renderCommandEncoderWithDescriptor:pass];
  float k = (float)fullHeight / fullWidth;
  float axis = k <= 1 ? (1 - .5f*k + .5f*k*k)/(1 + k*k) : (.5f*k + .5f)/(1 + k*k);
  struct { float axis; float grain; vector_float2 repeats; } params = {
    axis, r.grains[index].floatValue, {(float)fullWidth / 200, (float)fullHeight / 200}};
  [encoder setRenderPipelineState:region ? r.regionPipeline : r.pipeline];
  if (region) {
    vector_float4 coordinates = {(float)x/fullWidth, (float)y/fullHeight,
      (float)(x+width)/fullWidth, (float)(y+height)/fullHeight};
    [encoder setVertexBytes:&coordinates length:sizeof(coordinates) atIndex:0];
  }
  [encoder setFragmentTexture:r.fields[index] atIndex:0];
  [encoder setFragmentTexture:r.grain atIndex:1];
  [encoder setFragmentBytes:&params length:sizeof(params) atIndex:0];
  [encoder drawPrimitives:MTLPrimitiveTypeTriangleStrip vertexStart:0 vertexCount:4];
  [encoder endEncoding];
  [command commit];
  [command waitUntilCompleted];
  if (command.status != MTLCommandBufferStatusCompleted) return nil;
  NSMutableData *data = [NSMutableData dataWithLength:width * height * 8];
  [output getBytes:data.mutableBytes bytesPerRow:width * 8
    fromRegion:MTLRegionMake2D(0, 0, width, height) mipmapLevel:0];
  return data;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) return 2;
    NSString *root = [NSString stringWithUTF8String:argv[1]];
    if (!dlopen([[root stringByAppendingPathComponent:@"libzen-native-theme.dylib"]
          fileSystemRepresentation], RTLD_NOW | RTLD_LOCAL)) return 3;
    ZenThemeResources *r = [[NSClassFromString(@"ZenThemeResources") alloc] initWithURL:
      [NSURL fileURLWithPath:[root stringByAppendingPathComponent:@"zen-native-theme"]]];
    if (!r.regionPipeline) return 4;
    // Landscape, portrait, and a wider window with the same sidebar bounds.
    const NSUInteger cases[][6] = {{512,400,4,4,116,392}, {400,512,11,7,116,498},
      {768,400,4,4,116,392}, {512,400,380,51,116,277}};
    double maximum = 0, previousError = 0;
    NSUInteger checks = 0;
    for (NSUInteger index = 0; index < r.fields.count; ++index) {
      for (NSUInteger c = 0; c < sizeof(cases)/sizeof(cases[0]); ++c) {
        const NSUInteger *v = cases[c];
        NSData *full = Render(r,index,v[0],v[1],0,0,v[0],v[1],NO);
        NSData *crop = Render(r,index,v[0],v[1],v[2],v[3],v[4],v[5],YES);
        NSData *old = Render(r,index,v[4],v[5],0,0,v[4],v[5],NO);
        if (!full || !crop || !old) return 5;
        const _Float16 *f = full.bytes, *s = crop.bytes, *o = old.bytes;
        for (NSUInteger y = 0; y < v[5]; ++y) {
          for (NSUInteger x = 0; x < v[4]; ++x) {
            for (NSUInteger channel = 0; channel < 4; ++channel) {
              NSUInteger a = ((y+v[3])*v[0]+x+v[2])*4+channel;
              NSUInteger b = (y*v[4]+x)*4+channel;
              double error = fabs((double)f[a] - s[b]);
              if (!isfinite(error) || error > 0.004) return 6;
              maximum = fmax(maximum,error);
              previousError = fmax(previousError,fabs((double)f[a]-o[b]));
            }
          }
        }
        ++checks;
      }
    }
    // Ensure the fixture detects the original stretch-and-restart-grain bug.
    if (previousError < 0.1) return 7;
    printf("{\"checks\":%lu,\"maxChannelError\":%.9f,\"oldMaxChannelError\":%.9f}\n",
      checks, maximum, previousError);
    return 0;
  }
}
