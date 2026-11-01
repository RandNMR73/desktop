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
static const char floatingSidebarKey;
static BOOL stopped;

// AppKit's medium system face need not have CSS weight 500 (it is 510 on
// macOS 26). Measure the same 13pt attributed label used by the scoped pill,
// then round its alignment width to the destination display's pixel grid.
int zen_command_scope_metrics_version(void) { return 1; }
int zen_command_scope_metrics(const char *utf8, double scale, double *out, uint32_t count) {
  if (![NSThread isMainThread] || stopped || !utf8 || !out || count != 3 ||
      !isfinite(scale) || scale < 0.5 || scale > 8 || strnlen(utf8, 4097) > 4096) return 1;
  NSString *text = [NSString stringWithUTF8String:utf8];
  if (!text || !text.length || text.length > 512) return 2;
  NSFont *font = [NSFont systemFontOfSize:13 weight:NSFontWeightMedium];
  NSAttributedString *label = [[NSAttributedString alloc] initWithString:text
    attributes:@{NSFontAttributeName:font}];
  NSSize size = label.size;
  NSDictionary *variation = CFBridgingRelease(CTFontCopyVariation((__bridge CTFontRef)font));
  NSNumber *weight = variation[@(0x77676874)]; // OpenType 'wght'.
  double cssWeight = weight ? weight.doubleValue : 500;
  if (!isfinite(size.width) || size.width < 0 || size.width > 32768 ||
      !isfinite(size.height) || size.height <= 0 || size.height > 128 ||
      !isfinite(cssWeight) || cssWeight < 1 || cssWeight > 1000) return 3;
  out[0] = ceil(size.width * scale) / scale;
  out[1] = ceil(size.height * scale) / scale;
  out[2] = cssWeight;
  return 0;
}

@interface ZenThemeResources : NSObject
@property id<MTLDevice> device;
@property id<MTLCommandQueue> queue;
@property id<MTLRenderPipelineState> pipeline;
@property id<MTLRenderPipelineState> regionPipeline;
@property NSAppearance *themeAppearance;
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
  NSString *appearance = model[@"appearance"];
  if ([appearance isEqual:@"dark"] || [appearance isEqual:@"light"]) {
    self.themeAppearance = [NSAppearance appearanceNamed:[appearance isEqual:@"dark"]
      ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua];
  }
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
  // Older shader bundles still support the main window. Only the optional
  // floating surface requires the window-coordinate vertex entry point.
  id<MTLFunction> regionVertex = [library newFunctionWithName:@"themeRegionVertex"];
  if (regionVertex) {
    desc.vertexFunction = regionVertex;
    self.regionPipeline = [self.device newRenderPipelineStateWithDescriptor:desc error:NULL];
  }
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
@property BOOL usesWindowCoordinates;
@property vector_float4 renderCoordinates;
- (instancetype)initWithFrame:(NSRect)frame resources:(ZenThemeResources *)resources;
@end

@implementation ZenThemeView
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (BOOL)isAccessibilityElement { return NO; }
- (NSArray *)accessibilityChildren { return @[]; }
- (instancetype)initWithFrame:(NSRect)frame resources:(ZenThemeResources *)resources {
  if (!(self = [super initWithFrame:frame device:resources.device])) return nil;
  self.resources = resources;
  self.renderCoordinates = (vector_float4){0, 0, 1, 1};
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
  vector_float4 coordinates = self.renderCoordinates;
  vector_float2 fullSize = {self.drawableSize.width, self.drawableSize.height};
  if (self.usesWindowCoordinates) {
    vector_float2 span = coordinates.zw - coordinates.xy;
    if (!self.resources.regionPipeline || !simd_all(isfinite(coordinates)) ||
        !simd_all(span > 0)) { [self report:-1 ticket:ticket]; return; }
    fullSize /= span;
  }
  float k = fullSize.y / fullSize.x;
  float axis = k <= 1 ? (1 - .5f*k + .5f*k*k) / (1 + k*k) : (.5f*k + .5f) / (1 + k*k);
  struct { float axis; float grain; vector_float2 repeats; } params = {
    axis, [self.resources.grains[self.index] floatValue],
    fullSize / 200};
  id<MTLCommandBuffer> command = [self.resources.queue commandBuffer];
  id<MTLRenderCommandEncoder> encoder = [command renderCommandEncoderWithDescriptor:pass];
  if (!command || !encoder) { [self report:-1 ticket:ticket]; return; }
  [encoder setRenderPipelineState:self.usesWindowCoordinates
    ? self.resources.regionPipeline : self.resources.pipeline];
  if (self.usesWindowCoordinates) {
    [encoder setVertexBytes:&coordinates length:sizeof(coordinates) atIndex:0];
  }
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

// The fresh Little panel shares AppKit's within-window popover material with
// the reference. Its wash and two borders are siblings of the effect view so
// they are not processed as vibrant content. Geometry is supplied by Gecko.
// Keep the shadow in Core Animation: its radius is not a CSS blur radius.
@interface ZenLittleShadowView : NSView
@property CALayer *shadowLayer;
@property NSVisualEffectView *panelMaterial;
@property NSView *panelDecoration;
@property CALayer *panelWash;
@property CALayer *outerBorder;
@property CALayer *innerBorder;
@property NSRect panelRect;
@property CGFloat panelRadius;
@property NSUInteger updates;
@property CALayer *rowsClip;
@property CALayer *selectedFill;
@property CALayer *hoverFill;
@property CALayer *scopeFill;
@property NSDictionary *fillRequest;
@property NSUInteger fillUpdates;
@property CGFloat fillScale;
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
  self.panelMaterial = [[NSVisualEffectView alloc] initWithFrame:NSZeroRect];
  self.panelMaterial.wantsLayer = YES;
  self.panelMaterial.material = NSVisualEffectMaterialPopover;
  self.panelMaterial.blendingMode = NSVisualEffectBlendingModeWithinWindow;
  self.panelMaterial.state = NSVisualEffectStateFollowsWindowActiveState;
  self.panelMaterial.emphasized = NO;
  self.panelMaterial.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  self.panelMaterial.layer.cornerCurve = kCACornerCurveContinuous;
  self.panelMaterial.layer.masksToBounds = YES;
  [self addSubview:self.panelMaterial];
  self.panelDecoration = [[NSView alloc] initWithFrame:NSZeroRect];
  self.panelDecoration.wantsLayer = YES;
  [self addSubview:self.panelDecoration];
  self.panelWash = CALayer.layer;
  self.panelWash.backgroundColor = [NSColor colorWithRed:0.065 green:0.065 blue:0.065 alpha:0.7].CGColor;
  self.outerBorder = CALayer.layer;
  self.outerBorder.borderColor = [NSColor.blackColor colorWithAlphaComponent:0.9].CGColor;
  self.innerBorder = CALayer.layer;
  self.innerBorder.borderColor = [NSColor.whiteColor colorWithAlphaComponent:0.23].CGColor;
  for (CALayer *layer in @[self.panelWash, self.outerBorder, self.innerBorder]) {
    layer.cornerCurve = kCACornerCurveContinuous;
    [self.panelDecoration.layer addSublayer:layer];
  }
  self.rowsClip = CALayer.layer;
  self.rowsClip.masksToBounds = YES;
  [self.panelDecoration.layer addSublayer:self.rowsClip];
  self.selectedFill = CALayer.layer;
  self.hoverFill = CALayer.layer;
  self.scopeFill = CALayer.layer;
  for (CALayer *layer in @[self.selectedFill, self.hoverFill, self.scopeFill]) {
    layer.hidden = YES;
    layer.cornerCurve = kCACornerCurveContinuous;
  }
  [self.rowsClip addSublayer:self.hoverFill];
  [self.rowsClip addSublayer:self.selectedFill];
  [self.panelDecoration.layer addSublayer:self.scopeFill];
  self.scopeFill.shadowOpacity = 1;
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

// The floating sidebar samples web content within its owning window. Its
// controls live in a transparent Gecko popup above this decorative surface.
// Keep it inside ChildView: Gecko relies on that being the last content child.
@interface ZenFloatingSidebarSurface : NSView
@property NSImageView *shadowImage;
@property NSVisualEffectView *material;
@property ZenThemeView *renderer;
@property uint32_t parentTicket;
@property CGFloat scale;
@end
@implementation ZenFloatingSidebarSurface
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (BOOL)isAccessibilityElement { return NO; }
- (NSArray *)accessibilityChildren { return @[]; }
- (BOOL)wantsUpdateLayer { return YES; }
- (BOOL)wantsDefaultClipping { return NO; }
- (void)updateLayer { self.layer.masksToBounds = NO; }
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
static void ClearFloatingSidebar(NSWindow *window) {
  ZenFloatingSidebarSurface *surface = objc_getAssociatedObject(window, &floatingSidebarKey);
  surface.renderer.disposed = YES;
  surface.renderer.delegate = nil;
  [surface removeFromSuperview];
  objc_setAssociatedObject(window, &floatingSidebarKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}
static void Clear(NSWindow *window) {
  ClearFloatingSidebar(window);
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
API int zen_sidebar_surface_version(void) { return 1; }

static NSView *SidebarChrome(NSWindow *window) {
  if (![NSStringFromClass(window.contentView.class) isEqual:@"ZenWindowMaterialView"]) return nil;
  for (NSView *view in window.contentView.subviews)
    if ([NSStringFromClass(view.class) isEqual:@"ChildView"]) return view;
  return nil;
}

static NSImage *SidebarMask(CGFloat radius) {
  NSImage *image = [NSImage imageWithSize:NSMakeSize(radius * 2 + 1, radius * 2 + 1)
    flipped:NO drawingHandler:^BOOL(NSRect rect) {
      [NSColor.blackColor set];
      [[NSBezierPath bezierPathWithRoundedRect:rect xRadius:radius yRadius:radius] fill];
      return YES;
    }];
  image.capInsets = NSEdgeInsetsMake(radius, radius, radius, radius);
  image.resizingMode = NSImageResizingModeStretch;
  return image;
}

static NSImage *SidebarShadow(void) {
  static NSImage *image;
  static BOOL attempted;
  if (!attempted) {
    attempted = YES;
    NSURL *root = [NSBundle.mainBundle.resourceURL URLByAppendingPathComponent:@"zen-native-theme"];
    NSNumber *symlink;
    [root getResourceValue:&symlink forKey:NSURLIsSymbolicLinkKey error:NULL];
    NSData *data = symlink.boolValue ? nil : Read(root, @"sidebar-shadow.tiff", 1048576);
    NSImage *candidate = data ? [[NSImage alloc] initWithData:data] : nil;
    if (NSEqualSizes(candidate.size, NSMakeSize(40, 40)) && candidate.representations.count <= 8) {
      image = candidate;
      image.capInsets = NSEdgeInsetsMake(19, 19, 20, 20);
      image.resizingMode = NSImageResizingModeTile;
    }
  }
  return image;
}

// Requests carry both the main theme ticket and a separate sidebar ticket.
// A late GPU completion can never activate a different Space or a closed host.
API int zen_sidebar_surface_apply(uint64_t handle, uint32_t parentTicket, uint32_t ticket,
    double x, double y, double width, double height, double viewportWidth, double viewportHeight) {
  NSWindow *window = FindWindow(handle);
  if (!window || !parentTicket || !ticket) return 1;
  @try {
    ZenThemeSurface *main = objc_getAssociatedObject(window, &surfaceKey);
    NSView *chrome = SidebarChrome(window);
    if (!main || !chrome || !resources.regionPipeline || !resources.themeAppearance ||
        main.superview != window.contentView || main.alphaValue != 1 ||
        main.renderer.disposed || main.renderer.ticket != parentTicket || main.renderer.status != 1 ||
        main.renderer.index == resources.littleIndex ||
        NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency ||
        NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast) {
      ClearFloatingSidebar(window); return 2;
    }
    if (!isfinite(x) || !isfinite(y) || !isfinite(width) || !isfinite(height) ||
        !isfinite(viewportWidth) || !isfinite(viewportHeight) ||
        width <= 0 || height <= 0 || width > 4096 || height > 16384 ||
        viewportWidth <= 0 || viewportHeight <= 0 || viewportWidth > 32768 || viewportHeight > 32768 ||
        x < -width || y < -height || x + width > viewportWidth + width ||
        y + height > viewportHeight + height) {
      ClearFloatingSidebar(window); return 3;
    }
    CGFloat sx = NSWidth(window.contentView.bounds) / viewportWidth;
    CGFloat sy = NSHeight(window.contentView.bounds) / viewportHeight;
    if (!isfinite(sx) || !isfinite(sy) || sx < 0.25 || sx > 4 || fabs(sx - sy) > 0.02) {
      ClearFloatingSidebar(window); return 3;
    }
    NSRect frame = NSMakeRect(x * sx, NSHeight(window.contentView.bounds) - (y + height) * sy,
      width * sx, height * sy);
    frame = [chrome convertRect:frame fromView:window.contentView];
    // Arc contentFillMode 1 normalizes this rectangle against the window's
    // content bounds after flipping to a top-left origin (0x101541fc8).
    vector_float4 coordinates = {x / viewportWidth, y / viewportHeight,
      (x + width) / viewportWidth, (y + height) / viewportHeight};
    ZenFloatingSidebarSurface *surface = objc_getAssociatedObject(window, &floatingSidebarKey);
    if (surface && surface.superview != chrome) { ClearFloatingSidebar(window); surface = nil; }
    CGFloat radius = 8;
    if (@available(macOS 26.0, *)) radius = 12;
    radius *= sx;
    BOOL changed = !surface || !NSEqualRects(surface.frame, frame) || surface.scale != sx ||
      surface.renderer.index != main.renderer.index || surface.renderer.status < 0 ||
      !simd_equal(surface.renderer.renderCoordinates, coordinates);
    if (!surface) {
      NSImage *shadow = SidebarShadow();
      if (!shadow) return 4;
      surface = [[ZenFloatingSidebarSurface alloc] initWithFrame:frame];
      // Arc adds the floating background beside its main background under the
      // same window view. Gecko's ChildView instead supplies VibrantLight.
      // Use the appearance already validated against this theme by the owner,
      // without changing the browser window, controls or webpage compositor.
      surface.appearance = resources.themeAppearance;
      surface.wantsLayer = YES;
      surface.clipsToBounds = NO;
      surface.layer.masksToBounds = NO;
      surface.layer.borderColor = [NSColor colorWithWhite:1 alpha:0.3].CGColor;
      surface.shadowImage = [NSImageView imageViewWithImage:shadow];
      surface.shadowImage.imageScaling = NSImageScaleAxesIndependently;
      surface.shadowImage.alphaValue = 0.2;
      surface.shadowImage.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
      [surface addSubview:surface.shadowImage];
      surface.material = [[NSVisualEffectView alloc] initWithFrame:surface.bounds];
      surface.material.material = NSVisualEffectMaterialPopover;
      surface.material.blendingMode = NSVisualEffectBlendingModeWithinWindow;
      surface.material.emphasized = YES;
      surface.material.state = NSVisualEffectStateFollowsWindowActiveState;
      surface.material.autoresizingMask = surface.shadowImage.autoresizingMask;
      [surface addSubview:surface.material];
      surface.renderer = [[ZenThemeView alloc] initWithFrame:surface.bounds resources:resources];
      if (!surface.renderer) return 5;
      surface.renderer.usesWindowCoordinates = YES;
      surface.renderer.layer.masksToBounds = YES;
      surface.renderer.autoresizingMask = surface.material.autoresizingMask;
      [surface addSubview:surface.renderer];
      surface.alphaValue = 0;
      [chrome addSubview:surface positioned:NSWindowAbove relativeTo:nil];
      objc_setAssociatedObject(window, &floatingSidebarKey, surface, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    surface.parentTicket = parentTicket;
    // Repeated geometry/theme requests can adopt a new ticket without a draw.
    // A pending command with a new ticket is resubmitted, ignoring its old completion.
    if (!changed && surface.renderer.status == 1) surface.renderer.ticket = ticket;
    if (changed || surface.renderer.ticket != ticket) {
      surface.frame = frame;
      surface.scale = sx;
      surface.layer.cornerRadius = radius;
      surface.layer.borderWidth = sx;
      surface.shadowImage.frame = NSInsetRect(surface.bounds, -10 * sx, -10 * sx);
      surface.material.maskImage = SidebarMask(radius);
      surface.renderer.layer.cornerRadius = radius;
      surface.layer.masksToBounds = NO;
      surface.needsDisplay = YES;
      surface.renderer.index = main.renderer.index;
      surface.renderer.renderCoordinates = coordinates;
      surface.renderer.ticket = ticket;
      surface.renderer.status = 0;
      [surface.renderer draw];
    }
    return 0;
  } @catch (NSException *exception) { ClearFloatingSidebar(window); return 6; }
}

API int zen_sidebar_surface_status(uint64_t handle, uint32_t parentTicket, uint32_t ticket) {
  NSWindow *window = FindWindow(handle);
  ZenThemeSurface *main = window ? objc_getAssociatedObject(window, &surfaceKey) : nil;
  ZenFloatingSidebarSurface *surface = window ? objc_getAssociatedObject(window, &floatingSidebarKey) : nil;
  if (!surface || !main || surface.superview != SidebarChrome(window) ||
      surface.renderer.disposed || surface.renderer.ticket != ticket || surface.parentTicket != parentTicket ||
      main.renderer.disposed || main.renderer.status != 1 || main.renderer.ticket != parentTicket ||
      main.renderer.index != surface.renderer.index ||
      main.superview != window.contentView || main.alphaValue != 1 ||
      NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency ||
      NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast) return -1;
  return surface.renderer.status;
}

API int zen_sidebar_surface_activate(uint64_t handle, uint32_t parentTicket, uint32_t ticket) {
  if (zen_sidebar_surface_status(handle, parentTicket, ticket) != 1) return 1;
  NSWindow *window = FindWindow(handle);
  ZenFloatingSidebarSurface *surface = objc_getAssociatedObject(window, &floatingSidebarKey);
  surface.alphaValue = 1;
  return 0;
}

API int zen_sidebar_surface_clear(uint64_t handle) {
  NSWindow *window = FindWindow(handle);
  if (!window) return 1;
  ClearFloatingSidebar(window);
  return 0;
}

API uint64_t zen_sidebar_surface_frames(uint64_t handle) {
  NSWindow *window = FindWindow(handle);
  ZenFloatingSidebarSurface *surface = window ? objc_getAssociatedObject(window, &floatingSidebarKey) : nil;
  return surface.renderer.frames;
}

API int zen_little_panel_version(void) { return 1; }
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
        ![resources.materials[surface.renderer.index] isEqual:@"dark"] ||
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
    view.panelMaterial.frame = rect;
    view.panelDecoration.frame = rect;
    view.panelMaterial.layer.cornerRadius = corner;
    NSRect local = NSMakeRect(0, 0, rect.size.width, rect.size.height);
    view.panelWash.frame = local;
    view.panelWash.cornerRadius = corner;
    view.outerBorder.frame = local;
    view.outerBorder.cornerRadius = corner;
    view.outerBorder.borderWidth = 1 / scale;
    view.innerBorder.frame = NSInsetRect(local, 1 / scale, 1 / scale);
    view.innerBorder.cornerRadius = MAX(0, corner - 1);
    view.innerBorder.borderWidth = 1;
    for (CALayer *layer in @[view.panelWash, view.outerBorder, view.innerBorder]) layer.contentsScale = scale;
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
// Native command fills retain their original color space. Gecko continues to
// own every text/control/hit target; these layers have no input or AX surface.
static void ClearCommandFills(ZenLittleShadowView *view) {
  if (!view) return;
  [CATransaction begin]; [CATransaction setDisableActions:YES];
  view.selectedFill.hidden = YES; view.hoverFill.hidden = YES; view.scopeFill.hidden = YES;
  if (view.fillRequest) ++view.fillUpdates;
  view.fillRequest = nil;
  [CATransaction commit];
}
static BOOL Numbers(id input, NSUInteger count) {
  if (![input isKindOfClass:NSArray.class] || [input count] != count) return NO;
  for (id value in input)
    if (![value isKindOfClass:NSNumber.class] || !isfinite([value doubleValue])) return NO;
  return YES;
}
static BOOL CommandRect(id input, NSRect *rect) {
  if (!Numbers(input, 4)) return NO;
  *rect = NSMakeRect([input[0] doubleValue], [input[1] doubleValue],
    [input[2] doubleValue], [input[3] doubleValue]);
  return fabs(rect->origin.x) <= 32768 && fabs(rect->origin.y) <= 32768 &&
    rect->size.width > 0 && rect->size.height > 0 &&
    rect->size.width <= 32768 && rect->size.height <= 32768;
}
static NSColor *CommandColor(id input) {
  if (![input isKindOfClass:NSDictionary.class] || !Numbers(input[@"rgba"], 4)) return nil;
  NSArray *rgba = input[@"rgba"];
  for (NSNumber *n in rgba) if (n.doubleValue < 0 || n.doubleValue > 1) return nil;
  CGFloat r = [rgba[0] doubleValue], g = [rgba[1] doubleValue],
    b = [rgba[2] doubleValue], a = [rgba[3] doubleValue];
  if ([input[@"space"] isEqual:@"display-p3"])
    return [NSColor colorWithDisplayP3Red:r green:g blue:b alpha:a];
  if ([input[@"space"] isEqual:@"srgb"])
    return [NSColor colorWithSRGBRed:r green:g blue:b alpha:a];
  return nil;
}

// Scope palettes adjust HSL lightness in the input's color space before the
// final extended-sRGB conversion. Converting P3 to sRGB first changes both
// the step count and the resulting selection color.
static BOOL SelectionComponents(NSColor *color, CGFloat rgba[4]) {
  NSColor *components = [NSColor colorWithCGColor:color.CGColor];
  if (!components || components.type != NSColorTypeComponentBased) return NO;
  [components getRed:&rgba[0] green:&rgba[1] blue:&rgba[2] alpha:&rgba[3]];
  for (int i = 0; i < 4; i++) if (!isfinite(rgba[i])) return NO;
  return YES;
}
static double SelectionLuminance(const CGFloat rgb[4]) {
  const double weights[3] = {0.2126, 0.7152, 0.0722};
  double result = 0;
  for (int i = 0; i < 3; i++) {
    double v = rgb[i];
    result += weights[i] * (v <= 0.03928 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4));
  }
  return result;
}
static double SelectionHue(double p, double q, double t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1.0 / 6) return p + (q - p) * 6 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3) return p + (q - p) * (2.0 / 3 - t) * 6;
  return p;
}
static NSColor *SelectionForeground(NSColor *color, double low, double high) {
  CGFloat rgba[4];
  if (!SelectionComponents(color, rgba)) return nil;
  double initial = SelectionLuminance(rgba);
  int direction = initial < low ? 1 : initial > high ? -1 : 0;
  for (int step = 0; step <= 100; step++) {
    double luminance = SelectionLuminance(rgba);
    if (!direction || (direction > 0 ? luminance >= low : luminance <= high))
      return [color colorUsingColorSpace:NSColorSpace.extendedSRGBColorSpace];
    double r = rgba[0], g = rgba[1], b = rgba[2];
    double lo = fmin(r, fmin(g, b)), hi = fmax(r, fmax(g, b));
    double lightness = (lo + hi) / 2, hue = 0, saturation = 0, delta = hi - lo;
    if (delta != 0) {
      saturation = delta / (lightness > 0.5 ? 2 - hi - lo : hi + lo);
      hue = (hi == r ? (g - b) / delta + (g < b ? 6 : 0) :
             hi == g ? (b - r) / delta + 2 : (r - g) / delta + 4) / 6;
    }
    lightness = fmax(0, fmin(1, lightness + direction * 0.01));
    if (saturation == 0) {
      rgba[0] = rgba[1] = rgba[2] = lightness;
    } else {
      double q = lightness < 0.5 ? lightness * (1 + saturation) :
        lightness + saturation - lightness * saturation;
      double p = 2 * lightness - q;
      rgba[0] = SelectionHue(p, q, hue + 1.0 / 3);
      rgba[1] = SelectionHue(p, q, hue);
      rgba[2] = SelectionHue(p, q, hue - 1.0 / 3);
    }
    color = [NSColor colorWithColorSpace:color.colorSpace components:rgba count:4];
    if (!SelectionComponents(color, rgba)) return nil;
  }
  return nil;
}
API int zen_command_selection_palette_version(void) { return 1; }
API int zen_command_selection_palette(const char *json, double *out, uint32_t count) {
  if (![NSThread isMainThread] || stopped || !json || !out || count != 8) return 1;
  NSUInteger length = strnlen(json, 513);
  if (length > 512) return 1;
  @try {
    id input = [NSJSONSerialization JSONObjectWithData:
      [NSData dataWithBytes:json length:length] options:0 error:NULL];
    NSColor *color = CommandColor(input);
    if (!color) return 2;
    NSColor *light = SelectionForeground(color, 0.85, 0.95);
    NSColor *dark = SelectionForeground(color, 0, 0.1);
    CGFloat foreground[4], background[4];
    if (!light || !dark || !SelectionComponents(light, foreground) ||
        !SelectionComponents(dark, background)) return 3;
    double values[8];
    for (int i = 0; i < 3; i++) {
      values[i] = foreground[i] * 0.5; // Dark subtitle over black.
      values[i + 4] = background[i] * 0.4 + 0.6; // Light subtitle over white.
      if (!isfinite(values[i]) || !isfinite(values[i + 4])) return 3;
    }
    values[3] = values[7] = 1;
    memcpy(out, values, sizeof(values));
    return 0;
  } @catch (NSException *exception) { return 3; }
}
API int zen_little_fills_version(void) { return 1; }
API int zen_little_fills_sync(uint64_t handle, uint32_t ticket, const char *json) {
  NSWindow *window = FindWindow(handle);
  ZenThemeSurface *surface = window ? objc_getAssociatedObject(window, &surfaceKey) : nil;
  if (!surface || surface.renderer.disposed || surface.renderer.ticket != ticket ||
      surface.superview != window.contentView) return 1;
  ZenLittleShadowView *view = surface.littleShadow;
  if (!json) { ClearCommandFills(view); return 0; }
  if (!view || surface.renderer.index != resources.littleIndex || surface.renderer.status != 1 ||
      ![resources.materials[surface.renderer.index] isEqual:@"dark"] || surface.alphaValue != 1 ||
      NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceTransparency ||
      NSWorkspace.sharedWorkspace.accessibilityDisplayShouldIncreaseContrast) {
    ClearCommandFills(view); return 2;
  }
  @try {
    NSUInteger length = strnlen(json, 4097);
    id request = length <= 4096 ? [NSJSONSerialization JSONObjectWithData:
      [NSData dataWithBytes:json length:length] options:0 error:NULL] : nil;
    NSRect clip;
    if (![request isKindOfClass:NSDictionary.class] || !Numbers(request[@"viewport"], 2) ||
        !CommandRect(request[@"clip"], &clip)) { ClearCommandFills(view); return 3; }
    double width = [request[@"viewport"][0] doubleValue], height = [request[@"viewport"][1] doubleValue];
    if (width <= 0 || height <= 0 || width > 32768 || height > 32768 ||
        clip.origin.x < 0 || clip.origin.y < 0 || NSMaxX(clip) > width + 1 || NSMaxY(clip) > height + 1) {
      ClearCommandFills(view); return 3;
    }
    CGFloat sx = surface.bounds.size.width / width, sy = surface.bounds.size.height / height;
    if (!isfinite(sx) || !isfinite(sy) || sx <= 0 || sy <= 0 || fabs(sx-sy) > .01) {
      ClearCommandFills(view); return 3;
    }
    NSArray *keys = @[@"selected", @"hover", @"pill"];
    NSRect rects[3]; NSColor *colors[3] = {nil, nil, nil};
    for (NSUInteger i = 0; i < 3; ++i) {
      id item = request[keys[i]];
      if (!item || item == NSNull.null) continue;
      if (![item isKindOfClass:NSDictionary.class] || !CommandRect(item[@"rect"], &rects[i]) ||
          !(colors[i] = CommandColor(item[@"color"]))) { ClearCommandFills(view); return 3; }
      if (i == 2 && (rects[i].origin.x < 0 || rects[i].origin.y < 0 ||
          NSMaxX(rects[i]) > width + 1 || NSMaxY(rects[i]) > height + 1)) {
        ClearCommandFills(view); return 3;
      }
    }
    if ([view.fillRequest isEqual:request] && view.fillScale == window.backingScaleFactor) return 0;
    [CATransaction begin]; [CATransaction setDisableActions:YES];
    // The decoration origin is the inner panel's bottom-left, in the
    // full-window unflipped coordinate system. The scroll clip is separate
    // so a partially scrolled row retains its original corner geometry.
    NSRect panel = view.panelRect;
    view.rowsClip.frame = NSMakeRect(clip.origin.x*sx-panel.origin.x,
      surface.bounds.size.height-NSMaxY(clip)*sy-panel.origin.y, clip.size.width*sx, clip.size.height*sy);
    NSArray<CALayer *> *layers = @[view.selectedFill, view.hoverFill, view.scopeFill];
    for (NSUInteger i = 0; i < 3; ++i) {
      CALayer *layer = layers[i]; layer.hidden = colors[i] == nil;
      if (!colors[i]) continue;
      NSRect rect = rects[i];
      NSPoint origin = i == 2 ? panel.origin : NSMakePoint(clip.origin.x*sx, surface.bounds.size.height-NSMaxY(clip)*sy);
      layer.frame = NSMakeRect(rect.origin.x*sx-origin.x,
        surface.bounds.size.height-NSMaxY(rect)*sy-origin.y, rect.size.width*sx, rect.size.height*sy);
      layer.contentsScale = window.backingScaleFactor;
      layer.backgroundColor = colors[i].CGColor;
      layer.cornerRadius = i == 2 ? layer.bounds.size.height / 2 : 6*sx;
      if (i == 2) {
        layer.shadowRadius = 8*sx;
        layer.shadowOffset = CGSizeMake(0, -1*sy);
        layer.shadowColor = [colors[i] colorWithAlphaComponent:.3].CGColor;
        CGFloat radius = floor(rect.size.height / 2)*sx;
        CGPathRef path = CGPathCreateWithRoundedRect(layer.bounds, radius, radius, NULL);
        layer.shadowPath = path; CGPathRelease(path);
      }
    }
    view.fillRequest = request; view.fillScale = window.backingScaleFactor; ++view.fillUpdates;
    [CATransaction commit];
    return 0;
  } @catch (NSException *exception) { ClearCommandFills(view); return 4; }
}
// Actual layer colors/geometry, for package lifecycle and idle validation.
API int zen_little_fills_geometry(uint64_t handle, double *values, int count) {
  NSWindow *window = FindWindow(handle);
  ZenThemeSurface *surface = window ? objc_getAssociatedObject(window, &surfaceKey) : nil;
  ZenLittleShadowView *view = surface.littleShadow;
  if (!view || !values || count != 34) return 1;
  memset(values, 0, sizeof(double)*34); values[0] = view.fillUpdates;
  NSArray<CALayer *> *layers = @[view.selectedFill, view.hoverFill, view.scopeFill];
  for (NSUInteger i = 0; i < 3; ++i) {
    CALayer *layer = layers[i]; double *v = values+1+i*11;
    if (layer.hidden) continue;
    NSRect r = [layer convertRect:layer.bounds toLayer:view.layer];
    v[0] = 1; v[1] = r.origin.x; v[2] = surface.bounds.size.height-NSMaxY(r);
    v[3] = r.size.width; v[4] = r.size.height;
    const CGFloat *rgba = CGColorGetComponents(layer.backgroundColor);
    if (CGColorGetNumberOfComponents(layer.backgroundColor) == 4)
      for (int j = 0; j < 4; ++j) v[5+j] = rgba[j];
    CFStringRef name = CGColorSpaceGetName(CGColorGetColorSpace(layer.backgroundColor));
    v[9] = name && CFEqual(name, kCGColorSpaceDisplayP3) ? 1 : 0;
    v[10] = layer.cornerRadius;
  }
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
