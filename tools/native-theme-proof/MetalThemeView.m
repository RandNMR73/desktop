/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#import "MetalThemeView.h"

@implementation MetalThemeView {
  NSUInteger _submittedFrames;
}
- (NSUInteger)submittedFrames { return _submittedFrames; }
- (BOOL)isAccessibilityElement { return YES; }
- (NSString *)accessibilityRole { return NSAccessibilityImageRole; }
- (NSString *)accessibilityLabel { return @"Native theme renderer"; }
- (id)accessibilityValue {
  return [NSString stringWithFormat:@"Submitted frames: %lu", _submittedFrames];
}
- (instancetype)initWithFrame:(NSRect)frame {
  id<MTLDevice> device = MTLCreateSystemDefaultDevice();
  self = [super initWithFrame:frame device:device];
  if (!self || !device) abort();
  self.colorPixelFormat = MTLPixelFormatRGBA16Float;
  self.clearColor = MTLClearColorMake(0,0,0,0);
  self.paused = YES;
  self.enableSetNeedsDisplay = YES;
  self.autoResizeDrawable = YES;
  self.delegate = self;
  CAMetalLayer *layer = (CAMetalLayer *)self.layer;
  layer.opaque = NO;
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceExtendedSRGB);
  layer.colorspace = space;
  CGColorSpaceRelease(space);
  self.queue = [device newCommandQueue];
  NSURL *libraryURL = [[NSBundle mainBundle] URLForResource:@"theme" withExtension:@"metallib"];
  NSError *error = nil;
  id<MTLLibrary> library = [device newLibraryWithURL:libraryURL error:&error];
  if (!library) { NSLog(@"%@",error); abort(); }
  MTLRenderPipelineDescriptor *pipeline = [MTLRenderPipelineDescriptor new];
  pipeline.vertexFunction = [library newFunctionWithName:@"themeVertex"];
  pipeline.fragmentFunction = [library newFunctionWithName:@"themeFragment"];
  pipeline.colorAttachments[0].pixelFormat = self.colorPixelFormat;
  self.pipeline = [device newRenderPipelineStateWithDescriptor:pipeline error:&error];
  if (!self.pipeline) { NSLog(@"%@",error); abort(); }
  NSData *data = [NSData dataWithContentsOfURL:[[NSBundle mainBundle] URLForResource:@"themes" withExtension:@"json"]];
  self.themes = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
  NSMutableArray *fields = [NSMutableArray array];
  for (NSUInteger i = 0; i < self.themes.count; ++i) {
    NSUInteger width = [self.themes[i][@"width"] unsignedIntegerValue];
    NSUInteger height = [self.themes[i][@"height"] unsignedIntegerValue];
    NSString *name = [NSString stringWithFormat:@"theme-%lu",i];
    NSData *raw = [NSData dataWithContentsOfURL:[[NSBundle mainBundle] URLForResource:name withExtension:@"rgba32f"]];
    if (raw.length != width*height*16) abort();
    NSMutableData *half = [NSMutableData dataWithLength:width*height*8];
    const float *input = raw.bytes; _Float16 *output = half.mutableBytes;
    for (NSUInteger j = 0; j < width*height*4; ++j) output[j] = (_Float16)input[j];
    MTLTextureDescriptor *desc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA16Float width:width height:height mipmapped:NO];
    desc.usage = MTLTextureUsageShaderRead;
    id<MTLTexture> texture = [device newTextureWithDescriptor:desc];
    [texture replaceRegion:MTLRegionMake2D(0,0,width,height) mipmapLevel:0 withBytes:half.bytes bytesPerRow:width*8];
    [fields addObject:texture];
  }
  self.fields = fields;
  NSData *grain = [NSData dataWithContentsOfURL:[[NSBundle mainBundle] URLForResource:@"grain" withExtension:@"rgba8"]];
  if (grain.length != 200*200*4) abort();
  MTLTextureDescriptor *desc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatRGBA8Unorm width:200 height:200 mipmapped:NO];
  desc.usage = MTLTextureUsageShaderRead;
  self.grainTexture = [device newTextureWithDescriptor:desc];
  [self.grainTexture replaceRegion:MTLRegionMake2D(0,0,200,200) mipmapLevel:0 withBytes:grain.bytes bytesPerRow:200*4];
  return self;
}
- (void)selectTheme:(NSInteger)index {
  if (index < 0 || (NSUInteger)index >= self.fields.count) return;
  self.selectedTheme = index;
  self.needsDisplay = YES;
}
- (void)mtkView:(MTKView *)view drawableSizeWillChange:(CGSize)size { self.needsDisplay = YES; }
- (void)drawInMTKView:(MTKView *)view {
  MTLRenderPassDescriptor *pass = self.currentRenderPassDescriptor;
  id<CAMetalDrawable> drawable = self.currentDrawable;
  if (!pass || !drawable || self.drawableSize.width <= 0 || self.drawableSize.height <= 0) return;
  float k = self.drawableSize.height / self.drawableSize.width;
  float axis = k <= 1 ? (1-.5f*k+.5f*k*k)/(1+k*k) : (.5f*k+.5f)/(1+k*k);
  struct { float axis; float grain; vector_float2 repeats; } params = {
    axis, [self.themes[self.selectedTheme][@"grain"] floatValue],
    {self.drawableSize.width/200,self.drawableSize.height/200}};
  id<MTLCommandBuffer> command = [self.queue commandBuffer];
  id<MTLRenderCommandEncoder> encoder = [command renderCommandEncoderWithDescriptor:pass];
  [encoder setRenderPipelineState:self.pipeline];
  [encoder setFragmentTexture:self.fields[self.selectedTheme] atIndex:0];
  [encoder setFragmentTexture:self.grainTexture atIndex:1];
  [encoder setFragmentBytes:&params length:sizeof(params) atIndex:0];
  [encoder drawPrimitives:MTLPrimitiveTypeTriangleStrip vertexStart:0 vertexCount:4];
  [encoder endEncoding];
  [command presentDrawable:drawable];
  [command commit];
  ++_submittedFrames;
}
@end
