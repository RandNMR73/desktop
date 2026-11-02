/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
// Read-only reference test: compare the bundled shader with Arc's own two-pass
// overlay/render shaders and image loader. No windows or browser attachment.
#import <AppKit/AppKit.h>
#import <MetalKit/MetalKit.h>
#import <simd/simd.h>
#include <math.h>

static id<MTLDevice> device;
static id<MTLCommandQueue> queue;
static id<MTLRenderPipelineState> Pipeline(id<MTLLibrary> library, NSString *v, NSString *f) {
  MTLRenderPipelineDescriptor *d = [MTLRenderPipelineDescriptor new];
  d.vertexFunction = [library newFunctionWithName:v];
  d.fragmentFunction = [library newFunctionWithName:f];
  d.colorAttachments[0].pixelFormat = MTLPixelFormatRGBA16Float;
  return [device newRenderPipelineStateWithDescriptor:d error:NULL];
}
static id<MTLTexture> Texture(NSUInteger w, NSUInteger h, MTLPixelFormat format) {
  MTLTextureDescriptor *d = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:format width:w height:h mipmapped:NO];
  d.usage = MTLTextureUsageRenderTarget | MTLTextureUsageShaderRead;
  d.storageMode = MTLStorageModeShared;
  return [device newTextureWithDescriptor:d];
}
static NSData *Pixels(id<MTLTexture> t) {
  NSMutableData *data = [NSMutableData dataWithLength:t.width*t.height*8];
  [t getBytes:data.mutableBytes bytesPerRow:t.width*8 fromRegion:MTLRegionMake2D(0,0,t.width,t.height) mipmapLevel:0];
  return data;
}
static BOOL Draw(id<MTLTexture> target, void (^encode)(id<MTLRenderCommandEncoder>)) {
  MTLRenderPassDescriptor *p = [MTLRenderPassDescriptor renderPassDescriptor];
  p.colorAttachments[0].texture = target;
  p.colorAttachments[0].loadAction = MTLLoadActionClear;
  p.colorAttachments[0].storeAction = MTLStoreActionStore;
  id<MTLCommandBuffer> command = [queue commandBuffer];
  id<MTLRenderCommandEncoder> e = [command renderCommandEncoderWithDescriptor:p];
  encode(e);
  [e drawPrimitives:MTLPrimitiveTypeTriangleStrip vertexStart:0 vertexCount:4];
  [e endEncoding]; [command commit]; [command waitUntilCompleted];
  return command.status == MTLCommandBufferStatusCompleted;
}
int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) return 2;
    NSURL *resources = [NSURL fileURLWithPath:@(argv[1])];
    NSBundle *arc = [NSBundle bundleWithPath:@(argv[2])];
    device = MTLCreateSystemDefaultDevice(); queue = [device newCommandQueue];
    id<MTLLibrary> reference = [device newLibraryWithURL:[arc URLForResource:@"default" withExtension:@"metallib"] error:NULL];
    id<MTLLibrary> library = [device newLibraryWithURL:[resources URLByAppendingPathComponent:@"theme.metallib"] error:NULL];
    id<MTLRenderPipelineState> overlay = Pipeline(reference,@"overlayVertex",@"overlayFragment");
    id<MTLRenderPipelineState> render = Pipeline(reference,@"renderVertex",@"renderFragment");
    id<MTLRenderPipelineState> zen = Pipeline(library,@"themeRegionVertex",@"themeTextureFragment");
    if (!overlay || !render || !zen) return 3;
    NSArray *names = @[@"grain",@"sand",@"denim",@"tweed"];
    const float strengths[] = {.8,.15,.6,.4};
    const NSUInteger sizes[][6] = {{200,200,0,0,200,200},{319,241,0,0,319,241},
      {512,400,4,7,116,381},{400,512,11,5,116,503}};
    double maximum = 0, sum = 0; NSUInteger checks = 0, samples = 0;
    for (NSUInteger n = 0; n < names.count; ++n) {
      NSString *name = names[n];
      NSImage *image = [arc imageForResource:[name stringByAppendingString:@"_metal"]];
      NSRect rect = {NSZeroPoint,image.size};
      CGImageRef cg = [image CGImageForProposedRect:&rect context:nil hints:nil];
      MTKTextureLoader *loader = [[MTKTextureLoader alloc] initWithDevice:device];
      id<MTLTexture> source = [loader newTextureWithCGImage:cg options:@{MTKTextureLoaderOptionSRGB:@NO,
        MTKTextureLoaderOptionGenerateMipmaps:@NO, MTKTextureLoaderOptionTextureUsage:@(MTLTextureUsageShaderRead),
        MTKTextureLoaderOptionTextureStorageMode:@(MTLStorageModeShared)} error:NULL];
      if (!source || source.width != 200 || source.height != 200) return 4;
      NSData *raw = [NSData dataWithContentsOfURL:[resources URLByAppendingPathComponent:
        [NSString stringWithFormat:@"texture-%@.rgba8",name]]];
      NSMutableData *original = [NSMutableData dataWithLength:160000];
      [source getBytes:original.mutableBytes bytesPerRow:800 fromRegion:MTLRegionMake2D(0,0,200,200) mipmapLevel:0];
      if (source.pixelFormat == MTLPixelFormatBGRA8Unorm) {
        uint8_t *p = original.mutableBytes;
        for (NSUInteger i=0;i<160000;i+=4) { uint8_t c=p[i];p[i]=p[i+2];p[i+2]=c; }
      } else if (source.pixelFormat != MTLPixelFormatRGBA8Unorm) return 5;
      if (![raw isEqual:original]) return 6;
      id<MTLTexture> imported = Texture(200,200,MTLPixelFormatRGBA8Unorm);
      [imported replaceRegion:MTLRegionMake2D(0,0,200,200) mipmapLevel:0 withBytes:raw.bytes bytesPerRow:800];
      for (NSUInteger noise = 0; noise < 3; ++noise) for (NSUInteger active = 0; active < 2; ++active) {
        float strength = strengths[n] * (noise == 0 ? 0 : noise == 1 ? .7f : 1.f) * (active ? 1.f : .25f);
        id<MTLTexture> tile = Texture(200,200,MTLPixelFormatRGBA16Float);
        if (!Draw(tile,^(id<MTLRenderCommandEncoder> e){
          float config[] = {strength,strength,0};
          [e setRenderPipelineState:overlay];
          [e setFragmentBytes:config length:sizeof(config) atIndex:0];
          [e setFragmentTexture:source atIndex:0];[e setFragmentTexture:source atIndex:1];
        })) return 7;
        for (NSUInteger c=0;c<4;++c) for (NSUInteger b=0;b<2;++b) {
          const NSUInteger *v = sizes[c];
          id<MTLTexture> base = Texture(1,1,MTLPixelFormatRGBA16Float);
          _Float16 basePixel[4] = {b ? .8f : -.1f,b ? .6f : .35f,b ? .2f : .6f,b ? 1.f : .7f};
          [base replaceRegion:MTLRegionMake2D(0,0,1,1) mipmapLevel:0 withBytes:basePixel bytesPerRow:8];
          id<MTLTexture> expected = Texture(v[4],v[5],MTLPixelFormatRGBA16Float);
          id<MTLTexture> actual = Texture(v[4],v[5],MTLPixelFormatRGBA16Float);
          vector_float4 region = {(float)v[2]/v[0],(float)v[3]/v[1],(float)(v[2]+v[4])/v[0],(float)(v[3]+v[5])/v[1]};
          if (!Draw(expected,^(id<MTLRenderCommandEncoder> e){
            vector_float2 vertices[] = {region.xy,{region.x,region.w},{region.z,region.y},region.zw};
            struct {vector_float4 cutout;vector_float2 repeats;} config = {{0,0,0,0},{v[0]/200.f,v[1]/200.f}};
            [e setRenderPipelineState:render];
            [e setVertexBytes:vertices length:sizeof(vertices) atIndex:0];
            [e setFragmentBytes:&config length:sizeof(config) atIndex:0];
            [e setFragmentTexture:base atIndex:0];[e setFragmentTexture:tile atIndex:1];
          })) return 8;
          if (!Draw(actual,^(id<MTLRenderCommandEncoder> e){
            struct {float axis,opacity;vector_float2 repeats;} config = {.5f,strength,{v[0]/200.f,v[1]/200.f}};
            [e setRenderPipelineState:zen];
            [e setVertexBytes:&region length:sizeof(region) atIndex:0];
            [e setFragmentBytes:&config length:sizeof(config) atIndex:0];
            [e setFragmentTexture:base atIndex:0];[e setFragmentTexture:imported atIndex:1];
          })) return 9;
          NSData *a=Pixels(actual),*r=Pixels(expected);
          const _Float16 *ap=a.bytes,*rp=r.bytes;
          for(NSUInteger i=0;i<a.length/2;++i){
            double error=fabs((double)ap[i]-rp[i]);
            if(!isfinite(error))return 10;
            maximum=fmax(maximum,error);sum+=error;++samples;
            if(error>.002){fprintf(stderr,"%s noise=%lu active=%lu case=%lu base=%lu sample=%lu actual=%g expected=%g error=%g\n",name.UTF8String,noise,active,c,b,i,(double)ap[i],(double)rp[i],error);return 11;}
          }
          ++checks;
        }
      }
    }
    printf("{\"checks\":%lu,\"textureBytesMatchReference\":true,\"maxChannelError\":%.9f,\"meanChannelError\":%.9f,\"samples\":%lu}\n",checks,maximum,sum/samples,samples);
  }
  return 0;
}
