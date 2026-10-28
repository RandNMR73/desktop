/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#import <AppKit/AppKit.h>
#import <MetalKit/MetalKit.h>
#import <objc/runtime.h>
#import <simd/simd.h>
#include <math.h>
#import "ZenNativeToast.h"

// Optional bundle-local renderer. No hooks, swizzling, profile paths, or input
// interception. JS checks frame readiness only during an invalidation; there
// are no asynchronous ctypes callbacks into Gecko's JavaScript runtime.
static const char surfaceKey;
static BOOL stopped;

@interface ZenThemeResources : NSObject
@property id<MTLDevice> device;
@property id<MTLCommandQueue> queue;
@property id<MTLRenderPipelineState> pipeline;
@property NSArray<id<MTLTexture>> *fields;
@property NSArray<NSNumber *> *grains;
@property NSArray *toastPalettes;
@property id<MTLTexture> grain;
- (instancetype)initWithURL:(NSURL *)url;
@end

// Read a bounded regular file; never follow resource symlinks outside the app.
static NSData *Read(NSURL *root, NSString *name, NSUInteger limit) {
  NSURL *url = [root URLByAppendingPathComponent:name];
  NSDictionary *values = [url resourceValuesForKeys:@[NSURLIsRegularFileKey,
    NSURLIsSymbolicLinkKey, NSURLFileSizeKey] error:NULL];
  if (![values[NSURLIsRegularFileKey] boolValue] ||
      [values[NSURLIsSymbolicLinkKey] boolValue] ||
      [values[NSURLFileSizeKey] unsignedLongLongValue] > limit) return nil;
  return [NSData dataWithContentsOfURL:url];
}

@implementation ZenThemeResources
- (instancetype)initWithURL:(NSURL *)url {
  if (!(self = [super init])) return nil;
  NSData *data = Read(url, @"themes.json", 262144);
  id model = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL] : nil;
  if (![model isKindOfClass:NSDictionary.class] || ![model[@"version"] isEqual:@1] ||
      ![model[@"themes"] isKindOfClass:NSArray.class]) return nil;
  NSArray *themes = model[@"themes"];
  if (!themes.count || themes.count > 64) return nil;
  self.device = MTLCreateSystemDefaultDevice();
  if (!self.device) return nil;
  self.queue = [self.device newCommandQueue];
  // Validate the library location before asking Metal to open it.
  if (!Read(url, @"theme.metallib", 4194304)) return nil;
  id<MTLLibrary> library = [self.device newLibraryWithURL:
    [url URLByAppendingPathComponent:@"theme.metallib"] error:NULL];
  if (!library || !self.queue) return nil;
  MTLRenderPipelineDescriptor *desc = [MTLRenderPipelineDescriptor new];
  desc.vertexFunction = [library newFunctionWithName:@"themeVertex"];
  desc.fragmentFunction = [library newFunctionWithName:@"themeFragment"];
  if (!desc.vertexFunction || !desc.fragmentFunction) return nil;
  desc.colorAttachments[0].pixelFormat = MTLPixelFormatRGBA16Float;
  self.pipeline = [self.device newRenderPipelineStateWithDescriptor:desc error:NULL];
  if (!self.pipeline) return nil;
  NSMutableArray *fields = [NSMutableArray array];
  NSMutableArray *grains = [NSMutableArray array];
  NSMutableArray *toastPalettes = [NSMutableArray array];
  NSUInteger total = 0;
  for (NSUInteger i = 0; i < themes.count; ++i) {
    id item = themes[i];
    if (![item isKindOfClass:NSDictionary.class]) return nil;
    [toastPalettes addObject:[item[@"toastPalette"] isKindOfClass:NSDictionary.class]
      ? item[@"toastPalette"] : NSNull.null];
    for (NSString *key in @[@"width", @"height", @"grain"]) {
      if (![item[key] isKindOfClass:NSNumber.class]) return nil;
    }
    double w = [item[@"width"] doubleValue], h = [item[@"height"] doubleValue];
    double grain = [item[@"grain"] doubleValue];
    if (!isfinite(w) || !isfinite(h) || w < 1 || h < 1 || w > 512 || h > 512 ||
        floor(w) != w || floor(h) != h || !isfinite(grain) || grain < 0 || grain > 1) return nil;
    NSUInteger width = w, height = h, size = width * height * 16;
    total += size;
    if (total > 16777216) return nil;
    NSData *raw = Read(url, [NSString stringWithFormat:@"theme-%lu.rgba32f", i], size);
    if (raw.length != size) return nil;
    NSMutableData *half = [NSMutableData dataWithLength:size / 2];
    const float *input = raw.bytes;
    _Float16 *output = half.mutableBytes;
    for (NSUInteger j = 0; j < width * height * 4; ++j) {
      if (!isfinite(input[j]) || fabsf(input[j]) > 65504 ||
          (j % 4 == 3 && (input[j] < 0 || input[j] > 1))) return nil;
      output[j] = (_Float16)input[j];
    }
    MTLTextureDescriptor *td = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:
      MTLPixelFormatRGBA16Float width:width height:height mipmapped:NO];
    td.usage = MTLTextureUsageShaderRead;
    id<MTLTexture> field = [self.device newTextureWithDescriptor:td];
    if (!field) return nil;
    [field replaceRegion:MTLRegionMake2D(0, 0, width, height) mipmapLevel:0
      withBytes:half.bytes bytesPerRow:width * 8];
    [fields addObject:field];
    [grains addObject:@(grain)];
  }
  NSData *grain = Read(url, @"grain.rgba8", 200 * 200 * 4);
  if (grain.length != 200 * 200 * 4) return nil;
  MTLTextureDescriptor *td = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:
    MTLPixelFormatRGBA8Unorm width:200 height:200 mipmapped:NO];
  td.usage = MTLTextureUsageShaderRead;
  self.grain = [self.device newTextureWithDescriptor:td];
  if (!self.grain) return nil;
  [self.grain replaceRegion:MTLRegionMake2D(0, 0, 200, 200) mipmapLevel:0
    withBytes:grain.bytes bytesPerRow:800];
  self.fields = fields;
  self.grains = grains;
  self.toastPalettes = toastPalettes;
  return self;
}
@end

@interface ZenThemeView : MTKView <MTKViewDelegate>
@property ZenThemeResources *resources;
@property uint64_t handle;
@property uint32_t ticket;
@property NSUInteger index;
@property NSUInteger frames;
@property BOOL disposed;
@property int status;
- (instancetype)initWithFrame:(NSRect)frame resources:(ZenThemeResources *)resources;
@end

@implementation ZenThemeView
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (BOOL)isAccessibilityElement { return NO; }
- (NSArray *)accessibilityChildren { return @[]; }
- (instancetype)initWithFrame:(NSRect)frame resources:(ZenThemeResources *)resources {
  if (!(self = [super initWithFrame:frame device:resources.device])) return nil;
  self.resources = resources;
  self.colorPixelFormat = MTLPixelFormatRGBA16Float;
  self.clearColor = MTLClearColorMake(0, 0, 0, 0);
  self.paused = YES;
  self.enableSetNeedsDisplay = YES;
  self.autoResizeDrawable = YES;
  self.delegate = self;
  CAMetalLayer *layer = (CAMetalLayer *)self.layer;
  layer.opaque = NO;
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceExtendedSRGB);
  layer.colorspace = space;
  CGColorSpaceRelease(space);
  return self;
}
- (void)mtkView:(MTKView *)view drawableSizeWillChange:(CGSize)size {
  if (!self.disposed) { self.status = 0; self.needsDisplay = YES; }
}
- (void)report:(int)status ticket:(uint32_t)ticket {
  if (self.disposed || self.ticket != ticket || stopped) return;
  self.status = status == 0 ? 1 : -1;
}
- (void)drawInMTKView:(MTKView *)view {
  if (self.disposed || stopped || !self.ticket) return;
  uint32_t ticket = self.ticket;
  MTLRenderPassDescriptor *pass = self.currentRenderPassDescriptor;
  id<CAMetalDrawable> drawable = self.currentDrawable;
  if (!pass || !drawable || self.drawableSize.width <= 0 || self.drawableSize.height <= 0) {
    // A minimized window can draw after becoming visible. JS retains its CSS
    // fallback until a successful command completes, without polling/timers.
    return;
  }
  float k = self.drawableSize.height / self.drawableSize.width;
  float axis = k <= 1 ? (1 - .5f*k + .5f*k*k) / (1 + k*k) : (.5f*k + .5f) / (1 + k*k);
  struct { float axis; float grain; vector_float2 repeats; } params = {
    axis, [self.resources.grains[self.index] floatValue],
    {self.drawableSize.width / 200, self.drawableSize.height / 200}};
  id<MTLCommandBuffer> command = [self.resources.queue commandBuffer];
  id<MTLRenderCommandEncoder> encoder = [command renderCommandEncoderWithDescriptor:pass];
  if (!command || !encoder) { [self report:-1 ticket:ticket]; return; }
  [encoder setRenderPipelineState:self.resources.pipeline];
  [encoder setFragmentTexture:self.resources.fields[self.index] atIndex:0];
  [encoder setFragmentTexture:self.resources.grain atIndex:1];
  [encoder setFragmentBytes:&params length:sizeof(params) atIndex:0];
  [encoder drawPrimitives:MTLPrimitiveTypeTriangleStrip vertexStart:0 vertexCount:4];
  [encoder endEncoding];
  [command presentDrawable:drawable];
  __weak ZenThemeView *weakSelf = self;
  [command addCompletedHandler:^(id<MTLCommandBuffer> buffer) {
    int status = buffer.status == MTLCommandBufferStatusCompleted ? 0 : -1;
    dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf report:status ticket:ticket]; });
  }];
  [command commit];
  ++self.frames;
}
@end

@interface ZenThemeSurface : NSVisualEffectView
@property ZenThemeView *renderer;
@end
@implementation ZenThemeSurface
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (BOOL)isAccessibilityElement { return NO; }
- (NSArray *)accessibilityChildren { return @[]; }
@end

static ZenThemeResources *resources;
static BOOL attemptedResources;
static NSWindow *FindWindow(uint64_t handle) {
  if (![NSThread isMainThread] || stopped) return nil;
  // Never dereference a caller-supplied pointer.
  for (NSWindow *window in NSApp.windows)
    if ((uintptr_t)(__bridge void *)window == handle) return window;
  return nil;
}
static void Clear(NSWindow *window) {
  ZenCloseCopyToast(window);
  ZenThemeSurface *surface = objc_getAssociatedObject(window, &surfaceKey);
  surface.renderer.disposed = YES;
  surface.renderer.delegate = nil;
  [surface removeFromSuperview];
  objc_setAssociatedObject(window, &surfaceKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}
#define API __attribute__((visibility("default")))
API int zen_theme_version(void) { return 1; }
// Optional extension to the v1 theme ABI. Older installed libraries simply
// lack these exports; Gecko retains its DOM notification in that case.
API int zen_toast_show(uint64_t handle, int index, const char *json) {
  NSWindow *window = FindWindow(handle);
  if (!window || !json || !resources || index < 0 ||
      (NSUInteger)index >= resources.toastPalettes.count) return 1;
  @try {
    if (NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency ||
        NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast) {
      ZenCloseCopyToast(window); return 2;
    }
    NSUInteger length = strnlen(json, 32769);
    if (length > 32768) return 3;
    NSData *data = [NSData dataWithBytes:json length:length];
    id request = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
    id palette = resources.toastPalettes[index];
    if (![request isKindOfClass:NSDictionary.class] || ![palette isKindOfClass:NSDictionary.class]) return 3;
    int result = ZenShowCopyToast(window, palette, request);
    if (result) ZenCloseCopyToast(window);
    return result;
  } @catch (NSException *exception) { ZenCloseCopyToast(window); return 4; }
}
API int zen_toast_clear(uint64_t handle) {
  NSWindow *window = FindWindow(handle);
  if (!window) return 1;
  ZenCloseCopyToast(window); return 0;
}
API int zen_toast_status(uint64_t handle) {
  NSWindow *window = FindWindow(handle);
  return window ? ZenCopyToastStatus(window) : 0;
}
API int zen_toast_geometry(uint64_t handle, double *values, int count) {
  NSWindow *window = FindWindow(handle);
  return window ? ZenCopyToastGeometry(window, values, count) : 1;
}
API int zen_theme_clear(uint64_t handle) {
  NSWindow *window = FindWindow(handle);
  if (!window) return 1;
  Clear(window);
  return 0;
}
API int zen_theme_apply(uint64_t handle, int index, uint32_t ticket) {
  NSWindow *window = FindWindow(handle);
  if (!window || !ticket) return 1;
  @try {
    NSView *content = window.contentView;
    // Fail closed on different Firefox host layouts, including popup windows.
    if (![NSStringFromClass(content.class) isEqualToString:@"ZenWindowMaterialView"] ||
        ![content.subviews filteredArrayUsingPredicate:[NSPredicate predicateWithBlock:
          ^BOOL(NSView *v, NSDictionary *bindings) {
            return [NSStringFromClass(v.class) isEqualToString:@"ChildView"];
          }]].count || NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency ||
        NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast) {
      Clear(window); return 2;
    }
    if (!attemptedResources) {
      attemptedResources = YES;
      NSURL *root = [NSBundle.mainBundle.resourceURL URLByAppendingPathComponent:@"zen-native-theme"];
      NSNumber *symlink;
      [root getResourceValue:&symlink forKey:NSURLIsSymbolicLinkKey error:NULL];
      if (!symlink.boolValue) resources = [[ZenThemeResources alloc] initWithURL:root];
    }
    if (!resources || index < 0 || (NSUInteger)index >= resources.fields.count) {
      Clear(window); return 3;
    }
    ZenThemeSurface *surface = objc_getAssociatedObject(window, &surfaceKey);
    if (surface && surface.superview != content) { Clear(window); surface = nil; }
    if (!surface) {
      surface = [[ZenThemeSurface alloc] initWithFrame:content.bounds];
      surface.material = NSVisualEffectMaterialHUDWindow;
      surface.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
      surface.blendingMode = NSVisualEffectBlendingModeBehindWindow;
      surface.state = NSVisualEffectStateActive;
      surface.emphasized = NO;
      surface.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      surface.renderer = [[ZenThemeView alloc] initWithFrame:surface.bounds resources:resources];
      if (!surface.renderer) return 4;
      surface.renderer.autoresizingMask = surface.autoresizingMask;
      [surface addSubview:surface.renderer];
      [content addSubview:surface positioned:NSWindowBelow relativeTo:content.subviews.firstObject];
      objc_setAssociatedObject(window, &surfaceKey, surface, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    // New surfaces begin hidden; a reused surface keeps its last completed
    // drawable visible until Metal presents the next Space atomically.
    if (!surface.renderer.ticket) surface.alphaValue = 0;
    surface.renderer.status = 0;
    surface.renderer.handle = handle;
    surface.renderer.ticket = ticket;
    surface.renderer.index = index;
    [surface.renderer draw];
    return 0;
  } @catch (NSException *exception) { Clear(window); return 5; }
}
API int zen_theme_activate(uint64_t handle, uint32_t ticket) {
  NSWindow *window = FindWindow(handle);
  ZenThemeSurface *surface = window ? objc_getAssociatedObject(window, &surfaceKey) : nil;
  if (!surface || surface.renderer.disposed || surface.renderer.status != 1 ||
      surface.renderer.ticket != ticket || surface.superview != window.contentView) return 1;
  surface.alphaValue = 1;
  return 0;
}
API int zen_theme_status(uint64_t handle, uint32_t ticket) {
  NSWindow *window = FindWindow(handle);
  ZenThemeSurface *surface = window ? objc_getAssociatedObject(window, &surfaceKey) : nil;
  if (!surface || surface.renderer.disposed || surface.renderer.ticket != ticket ||
      surface.superview != window.contentView ||
      NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency ||
      NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast) return -1;
  return surface.renderer.status;
}
// Read-only diagnostic counter, no logging or timers in the normal path.
API uint64_t zen_theme_frames(uint64_t handle) {
  NSWindow *window = FindWindow(handle);
  ZenThemeSurface *surface = window ? objc_getAssociatedObject(window, &surfaceKey) : nil;
  return surface.renderer.frames;
}
API void zen_theme_shutdown(void) {
  if (![NSThread isMainThread]) return;
  for (NSWindow *window in NSApp.windows) Clear(window);
  resources = nil;
  stopped = YES;
}
