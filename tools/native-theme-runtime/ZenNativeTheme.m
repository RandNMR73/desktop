/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#import <AppKit/AppKit.h>
#import <MetalKit/MetalKit.h>
#import <QuartzCore/QuartzCore.h>
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
@property NSArray<NSString *> *materials;
@property NSUInteger littleIndex;
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
  NSMutableArray *materials = [NSMutableArray array];
  NSMutableArray *toastPalettes = [NSMutableArray array];
  self.littleIndex = NSNotFound;
  NSUInteger total = 0;
  for (NSUInteger i = 0; i < themes.count; ++i) {
    id item = themes[i];
    if (![item isKindOfClass:NSDictionary.class]) return nil;
    if (item[@"role"]) {
      if (![item[@"role"] isEqual:@"little"] ||
          ![item[@"id"] isEqual:@"little-default-v1"] || self.littleIndex != NSNotFound) return nil;
      self.littleIndex = i;
    }
    id material = item[@"material"] ?: @"light";
    if (![material isEqual:@"light"] && ![material isEqual:@"dark"]) return nil;
    [materials addObject:material];
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
  self.materials = materials;
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

// The shortened fresh Little panel exposes its shadow over the native field.
// Keep the shadow in Core Animation: its radius is not a CSS blur radius.
@interface ZenLittleShadowView : NSView
@property CALayer *shadowLayer;
@property NSRect panelRect;
@property CGFloat panelRadius;
@property NSUInteger updates;
@end
@implementation ZenLittleShadowView
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (BOOL)isAccessibilityElement { return NO; }
- (NSArray *)accessibilityChildren { return @[]; }
- (instancetype)initWithFrame:(NSRect)frame {
  if (!(self = [super initWithFrame:frame])) return nil;
  self.wantsLayer = YES;
  self.layer.masksToBounds = YES;
  self.shadowLayer = CALayer.layer;
  self.shadowLayer.shadowColor = NSColor.blackColor.CGColor;
  self.shadowLayer.shadowOpacity = 0.5;
  self.shadowLayer.shadowRadius = 48;
  // This view uses AppKit's unflipped coordinates; positive screen Y is down.
  self.shadowLayer.shadowOffset = CGSizeMake(0, -24);
  [self.layer addSublayer:self.shadowLayer];
  return self;
}
@end

@interface ZenThemeSurface : NSVisualEffectView
@property ZenThemeView *renderer;
@property ZenLittleShadowView *littleShadow;
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
API int zen_theme_material_version(void) { return 1; }
// Optional extension. Geometry is in CSS pixels, relative to the full chrome
// viewport. The native surface supplies the CSS-to-AppKit scale and clipping.
API int zen_little_shadow_sync(uint64_t handle, uint32_t ticket, double x, double y,
    double width, double height, double radius, double viewportWidth, double viewportHeight) {
  NSWindow *window = FindWindow(handle);
  ZenThemeSurface *surface = window ? objc_getAssociatedObject(window, &surfaceKey) : nil;
  if (!surface || surface.renderer.disposed || surface.renderer.ticket != ticket ||
      surface.superview != window.contentView) return 1;
  @try {
    // Zero extent is the explicit clear request, also valid while a drawable
    // is temporarily unavailable. Clearing cannot create a native view.
    if (width == 0 && height == 0) {
      [surface.littleShadow removeFromSuperview]; surface.littleShadow = nil; return 0;
    }
    if (surface.renderer.index != resources.littleIndex || surface.renderer.status != 1 ||
        surface.alphaValue != 1 ||
        NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency ||
        NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast) return 2;
    if (!isfinite(x) || !isfinite(y) || !isfinite(width) || !isfinite(height) ||
        !isfinite(radius) || !isfinite(viewportWidth) || !isfinite(viewportHeight) ||
        x < 0 || y < 0 || width <= 0 || height <= 0 || radius < 0 || radius > 32 ||
        viewportWidth <= 0 || viewportHeight <= 0 || viewportWidth > 32768 || viewportHeight > 32768 ||
        x + width > viewportWidth + 1 || y + height > viewportHeight + 1) return 3;
    NSRect bounds = surface.bounds;
    CGFloat sx = bounds.size.width / viewportWidth, sy = bounds.size.height / viewportHeight;
    if (!isfinite(sx) || !isfinite(sy) || sx <= 0 || sy <= 0 || fabs(sx-sy) > 0.01) return 3;
    NSRect rect = NSMakeRect(x*sx, bounds.size.height-(y+height)*sy, width*sx, height*sy);
    CGFloat corner = radius*sx;
    ZenLittleShadowView *view = surface.littleShadow;
    if (!view) {
      view = [[ZenLittleShadowView alloc] initWithFrame:bounds];
      surface.littleShadow = view;
      view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      [surface addSubview:view positioned:NSWindowAbove relativeTo:surface.renderer];
    }
    CGFloat scale = window.backingScaleFactor;
    if (NSEqualRects(view.panelRect, rect) && view.panelRadius == corner &&
        view.shadowLayer.contentsScale == scale) return 0;
    [CATransaction begin]; [CATransaction setDisableActions:YES];
    view.panelRect = rect; view.panelRadius = corner;
    view.shadowLayer.frame = rect;
    view.shadowLayer.contentsScale = scale;
    CGPathRef path = CGPathCreateWithRoundedRect(view.shadowLayer.bounds, corner, corner, NULL);
    view.shadowLayer.shadowPath = path;
    CGPathRelease(path);
    [CATransaction commit];
    ++view.updates;
    return 0;
  } @catch (NSException *exception) {
    [surface.littleShadow removeFromSuperview]; surface.littleShadow = nil; return 4;
  }
}
// Read-only diagnostics for packaged lifecycle/idle tests; no timers or logs.
API int zen_little_shadow_geometry(uint64_t handle, double *values, int count) {
  NSWindow *window = FindWindow(handle);
  ZenThemeSurface *surface = window ? objc_getAssociatedObject(window, &surfaceKey) : nil;
  ZenLittleShadowView *view = surface.littleShadow;
  if (!view || !values || count != 9) return 1;
  NSRect rect = view.panelRect;
  values[0] = rect.origin.x; values[1] = surface.bounds.size.height-NSMaxY(rect);
  values[2] = rect.size.width; values[3] = rect.size.height; values[4] = view.panelRadius;
  values[5] = view.shadowLayer.shadowRadius; values[6] = -view.shadowLayer.shadowOffset.height;
  values[7] = view.shadowLayer.shadowOpacity; values[8] = view.updates;
  return 0;
}
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
      // The imported light translucency uses AppKit's legacy light material.
      // HUDWindow lifts solid-color Spaces even with identical floating-point
      // color layers; keep the material separate from the Space's foreground.
      surface.material = NSVisualEffectMaterialLight;
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
    BOOL darkMaterial = [resources.materials[index] isEqual:@"dark"];
    surface.material = darkMaterial ? NSVisualEffectMaterialDark : NSVisualEffectMaterialLight;
    surface.appearance = [NSAppearance appearanceNamed:darkMaterial
      ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
    // New surfaces begin hidden; a reused surface keeps its last completed
    // drawable visible until Metal presents the next Space atomically.
    if (!surface.renderer.ticket) surface.alphaValue = 0;
    surface.renderer.status = 0;
    surface.renderer.handle = handle;
    surface.renderer.ticket = ticket;
    surface.renderer.index = index;
    if ((NSUInteger)index != resources.littleIndex) {
      [surface.littleShadow removeFromSuperview]; surface.littleShadow = nil;
    }
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
