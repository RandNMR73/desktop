/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#import <ImageIO/ImageIO.h>
#import "MetalThemeView.h"

// Isolated rendering proof. Does not read or modify browser profiles.
@interface ThemeView : NSView
@property NSArray *themes;
@property NSArray *images;
@property NSArray *floatImages;
@property CALayer *field;
@property CAReplicatorLayer *grainX;
@property CAReplicatorLayer *grainY;
@property CALayer *grainTile;
@property NSInteger selectedTheme;
@property BOOL useFloat;
- (void)selectTheme:(NSInteger)index;
@end

static id ReadImage(NSString *name) {
  NSURL *url = [[NSBundle mainBundle] URLForResource:name withExtension:@"png"];
  CGImageSourceRef source = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
  if (!source) abort();
  CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, (__bridge CFDictionaryRef)@{(id)kCGImageSourceShouldCache: @YES});
  CFRelease(source);
  if (!image) abort();
  return CFBridgingRelease(image);
}

static id ReadFloatImage(NSString *name, size_t width, size_t height) {
  NSURL *url = [[NSBundle mainBundle] URLForResource:name withExtension:@"rgba32f"];
  NSData *data = [NSData dataWithContentsOfURL:url];
  if (data.length != width * height * 16) abort();
  CGDataProviderRef provider = CGDataProviderCreateWithCFData((__bridge CFDataRef)data);
  CGColorSpaceRef space = CGColorSpaceCreateWithName(kCGColorSpaceExtendedSRGB);
  CGImageRef image = CGImageCreate(width, height, 32, 128, width * 16, space,
      kCGBitmapFloatComponents | kCGBitmapByteOrder32Little | kCGImageAlphaPremultipliedLast,
      provider, NULL, YES, kCGRenderingIntentDefault);
  CGColorSpaceRelease(space); CGDataProviderRelease(provider);
  if (!image) abort();
  return CFBridgingRelease(image);
}

@implementation ThemeView
- (BOOL)isFlipped { return YES; }
- (instancetype)initWithFrame:(NSRect)frame {
  self = [super initWithFrame:frame];
  if (!self) return nil;
  self.wantsLayer = YES;
  self.layer.geometryFlipped = YES;
  self.layer.masksToBounds = YES;
  NSData *data = [NSData dataWithContentsOfURL:[[NSBundle mainBundle] URLForResource:@"themes" withExtension:@"json"]];
  self.themes = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
  NSMutableArray *images = [NSMutableArray array];
  for (NSUInteger i = 0; i < self.themes.count; ++i) [images addObject:ReadImage([NSString stringWithFormat:@"theme-%lu", i])];
  self.images = images;
  NSMutableArray *floats = [NSMutableArray array];
  for (NSUInteger i = 0; i < self.themes.count; ++i) {
    [floats addObject:ReadFloatImage([NSString stringWithFormat:@"theme-%lu", i],
        [self.themes[i][@"width"] unsignedLongValue], [self.themes[i][@"height"] unsignedLongValue])];
  }
  self.floatImages = floats;
  self.field = [CALayer layer];
  self.field.anchorPoint = CGPointZero;
  self.field.contentsGravity = kCAGravityResize;
  self.field.minificationFilter = kCAFilterLinear;
  self.field.magnificationFilter = kCAFilterLinear;
  [self.layer addSublayer:self.field];
  self.grainTile = [CALayer layer];
  self.grainTile.contents = ReadImage(@"grain");
  self.grainTile.contentsGravity = kCAGravityResize;
  self.grainX = [CAReplicatorLayer layer];
  [self.grainX addSublayer:self.grainTile];
  self.grainY = [CAReplicatorLayer layer];
  [self.grainY addSublayer:self.grainX];
  self.grainY.compositingFilter = @"multiplyBlendMode";
  [self.layer addSublayer:self.grainY];
  [self selectTheme:0];
  return self;
}
- (void)selectTheme:(NSInteger)index {
  self.selectedTheme = index;
  [CATransaction begin]; [CATransaction setDisableActions:YES];
  self.field.contentsFormat = self.useFloat ? kCAContentsFormatRGBA16Float : kCAContentsFormatRGBA8Uint;
  self.field.contents = self.useFloat ? self.floatImages[index] : self.images[index];
  self.grainY.opacity = [self.themes[index][@"grain"] floatValue];
  [CATransaction commit];
  self.needsLayout = YES;
}
- (void)layout {
  [super layout];
  CGFloat w = self.bounds.size.width, h = self.bounds.size.height;
  if (w <= 0 || h <= 0) return;
  CGFloat k = h / w;
  CGFloat p = k <= 1 ? (1 - 0.5*k + 0.5*k*k)/(1+k*k) : (0.5*k+0.5)/(1+k*k);
  [CATransaction begin]; [CATransaction setDisableActions:YES];
  self.field.bounds = CGRectMake(0, 0, w, h);
  self.field.position = CGPointZero;
  BOOL gradient = [self.themes[self.selectedTheme][@"gradient"] boolValue];
  self.field.affineTransform = gradient ? CGAffineTransformMake(1/p, 0, (p-1)/(p*k), 1, 0, 0) : CGAffineTransformIdentity;
  CGFloat tile = self.window.backingScaleFactor >= 2 ? 100 : 200;
  self.grainTile.frame = CGRectMake(0, 0, tile, tile);
  self.grainX.frame = CGRectMake(0, 0, w, h);
  self.grainX.instanceCount = (NSInteger)ceil(w / tile);
  self.grainX.instanceTransform = CATransform3DMakeTranslation(tile, 0, 0);
  self.grainY.frame = CGRectMake(0, 0, w, h);
  self.grainY.instanceCount = (NSInteger)ceil(h / tile);
  self.grainY.instanceTransform = CATransform3DMakeTranslation(0, tile, 0);
  [CATransaction commit];
}
@end

@interface ProofDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate>
@property NSWindow *window;
@property ThemeView *theme;
@property NSTextField *label;
@property NSVisualEffectView *material;
@property MetalThemeView *metalTheme;
@end

@implementation ProofDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)notification {
  NSMenu *bar = [[NSMenu alloc] init];
  NSMenuItem *item = [[NSMenuItem alloc] init]; [bar addItem:item];
  NSMenu *appMenu = [[NSMenu alloc] init];
  [appMenu addItemWithTitle:@"Quit Arc Color Proof" action:@selector(terminate:) keyEquivalent:@"q"];
  item.submenu = appMenu; NSApp.mainMenu = bar;
  NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, 1710, 984)
      styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable | NSWindowStyleMaskFullSizeContentView
      backing:NSBackingStoreBuffered defer:NO];
  self.window.delegate = self;
  self.window.title = @"Arc Color Proof — Main Space";
  self.window.titlebarAppearsTransparent = YES;
  self.window.titleVisibility = NSWindowTitleHidden;
  self.window.opaque = NO;
  self.window.backgroundColor = [NSColor clearColor];
  NSRect screen = [NSScreen mainScreen].visibleFrame;
  [self.window setFrame:NSMakeRect(NSMinX(screen), NSMaxY(screen)-984, MIN(1710, screen.size.width), 984) display:NO];
  NSVisualEffectView *material = [[NSVisualEffectView alloc] initWithFrame:self.window.contentView.bounds];
  self.material = material;
  material.appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
  material.material = NSVisualEffectMaterialLight;
  material.blendingMode = NSVisualEffectBlendingModeBehindWindow;
  material.state = NSVisualEffectStateActive;
  material.emphasized = NO;
  self.window.contentView = material;
  self.theme = [[ThemeView alloc] initWithFrame:material.bounds];
  self.theme.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [material addSubview:self.theme];
  self.metalTheme = [[MetalThemeView alloc] initWithFrame:material.bounds];
  self.metalTheme.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  self.theme.hidden = YES;
  self.metalTheme.hidden = NO;
  [material addSubview:self.metalTheme];
  CGFloat x = 20;
  for (NSUInteger i = 0; i < self.theme.themes.count; ++i) {
    NSButton *button = [NSButton buttonWithTitle:self.theme.themes[i][@"title"] target:self action:@selector(changeTheme:)];
    button.tag = (NSInteger)i;
    button.frame = NSMakeRect(x, 20, i == 4 ? 140 : 115, 30);
    button.autoresizingMask = NSViewMaxXMargin | NSViewMaxYMargin;
    [material addSubview:button]; x += button.frame.size.width + 10;
  }
  self.label = [NSTextField labelWithString:@"Native theme rendering proof • Main Space"];
  self.label.frame = NSMakeRect(20, 65, 650, 25);
  self.label.autoresizingMask = NSViewMaxXMargin | NSViewMaxYMargin;
  [material addSubview:self.label];
  NSButton *hud = [NSButton buttonWithTitle:@"HUD material" target:self action:@selector(changeMaterial:)];
  hud.tag = NSVisualEffectMaterialHUDWindow;
  hud.frame = NSMakeRect(700, 20, 130, 30);
  [material addSubview:hud];
  NSButton *appearance = [NSButton buttonWithTitle:@"Appearance material" target:self action:@selector(changeMaterial:)];
  appearance.tag = NSVisualEffectMaterialAppearanceBased;
  appearance.frame = NSMakeRect(840, 20, 165, 30);
  [material addSubview:appearance];
  NSButton *light = [NSButton buttonWithTitle:@"Light material" target:self action:@selector(changeMaterial:)];
  light.tag = NSVisualEffectMaterialLight;
  light.frame = NSMakeRect(700, 60, 130, 30);
  [material addSubview:light];
  NSButton *emphasized = [NSButton checkboxWithTitle:@"Emphasized" target:self action:@selector(changeEmphasis:)];
  emphasized.frame = NSMakeRect(1020, 20, 150, 30);
  [material addSubview:emphasized];
  NSButton *floats = [NSButton checkboxWithTitle:@"Extended sRGB float" target:self action:@selector(changePrecision:)];
  floats.frame = NSMakeRect(1190, 20, 200, 30);
  [material addSubview:floats];
  NSButton *metal = [NSButton checkboxWithTitle:@"Metal composition" target:self action:@selector(changeRenderer:)];
  metal.frame = NSMakeRect(1400, 20, 190, 30);
  metal.state = NSControlStateValueOn;
  [material addSubview:metal];
  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
}
- (void)changeTheme:(NSButton *)sender {
  [self.theme selectTheme:sender.tag];
  [self.metalTheme selectTheme:sender.tag];
  NSString *name = self.theme.themes[sender.tag][@"title"];
  self.window.title = [@"Arc Color Proof — " stringByAppendingString:name];
  self.label.stringValue = [@"Native theme rendering proof • " stringByAppendingString:name];
}
- (void)changeMaterial:(NSButton *)sender { self.material.material = sender.tag; }
- (void)changeEmphasis:(NSButton *)sender { self.material.emphasized = sender.state == NSControlStateValueOn; }
- (void)changePrecision:(NSButton *)sender {
  self.theme.useFloat = sender.state == NSControlStateValueOn;
  [self.theme selectTheme:self.theme.selectedTheme];
}
- (void)changeRenderer:(NSButton *)sender {
  BOOL metal = sender.state == NSControlStateValueOn;
  self.theme.hidden = metal;
  self.metalTheme.hidden = !metal;
  if (metal) [self.metalTheme draw];
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    ProofDelegate *delegate = [ProofDelegate new];
    NSApp.delegate = delegate;
    [NSApp run];
  }
  return 0;
}
