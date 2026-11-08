/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>
#include <dlfcn.h>

@interface ZenWindowMaterialView : NSVisualEffectView @end
@implementation ZenWindowMaterialView @end
@interface ChildView : NSView @end
@implementation ChildView @end

static void Require(BOOL value, const char *message) {
  if (!value) { fprintf(stderr, "%s\n", message); exit(1); }
}
static NSView *Find(NSView *parent, NSString *name) {
  for (NSView *view in parent.subviews)
    if ([NSStringFromClass(view.class) isEqualToString:name]) return view;
  return nil;
}
static void RequireFloatingMaterial(NSView *surface, NSView *main) {
  NSVisualEffectView *material = [surface valueForKey:@"material"];
  Require(material.material == NSVisualEffectMaterialPopover &&
    material.blendingMode == NSVisualEffectBlendingModeWithinWindow &&
    material.emphasized && material.state == NSVisualEffectStateFollowsWindowActiveState,
    "floating background lost its within-window popover material");
  NSAppearance *appearance = [[main valueForKey:@"renderer"] valueForKey:@"themeAppearance"];
  // AppKit resolves a visual-effect child's effective appearance to its
  // vibrant variant. Compare the light/dark family, not the literal name.
  NSArray *families = @[NSAppearanceNameAqua, NSAppearanceNameDarkAqua];
  Require(material.appearance == nil &&
    [surface.appearance.name isEqualToString:appearance.name] &&
    [[material.effectiveAppearance bestMatchFromAppearancesWithNames:families]
      isEqualToString:[appearance bestMatchFromAppearancesWithNames:families]],
    "floating material must inherit the Space appearance");
}

int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc != 2) return 2;
    [NSApplication sharedApplication];
    void *library = dlopen(argv[1], RTLD_NOW | RTLD_LOCAL);
    Require(library != NULL, "load renderer");
    int (*apply)(uint64_t,int,uint32_t) = dlsym(library,"zen_theme_apply");
    int (*activate)(uint64_t,uint32_t) = dlsym(library,"zen_theme_activate");
    int (*sidebar)(uint64_t,uint32_t,uint32_t,double,double,double,double,double,double) = dlsym(library,"zen_sidebar_surface_apply");
    int (*show)(uint64_t,uint32_t,uint32_t) = dlsym(library,"zen_sidebar_surface_activate");
    int (*clear)(uint64_t) = dlsym(library,"zen_theme_clear");
    NSWindow *window = [[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,800,600)
      styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
    window.releasedWhenClosed = NO;
    ZenWindowMaterialView *content = [[ZenWindowMaterialView alloc] initWithFrame:NSMakeRect(0,0,800,600)];
    window.contentView = content;
    ChildView *chrome = [[ChildView alloc] initWithFrame:content.bounds];
    [content addSubview:chrome];
    uint64_t handle = (uintptr_t)(__bridge void *)window;
    Require(apply(handle,0,1) == 0, "first theme");
    NSView *main = Find(content,@"ZenThemeSurface");
    Require(main != nil, "main surface");
    // Hidden windows have no drawable. Complete the render gate explicitly;
    // the real compiled lifecycle and view ownership still run unchanged.
    [[main valueForKey:@"renderer"] setValue:@1 forKey:@"status"];
    Require(activate(handle,1) == 0, "activate first theme");
    Require(sidebar(handle,1,1,5,5,220,590,800,600) == 0, "first sidebar");
    NSView *floating = Find(chrome,@"ZenFloatingSidebarSurface");
    Require(floating != nil, "floating surface");
    [[floating valueForKey:@"renderer"] setValue:@1 forKey:@"status"];
    Require(show(handle,1,1) == 0, "show sidebar");
    RequireFloatingMaterial(floating, main);
    NSUInteger checks = 0;
    for (NSNumber *transition in @[@(-1),@0,@1]) {
      uint32_t ticket = (uint32_t)checks + 2;
      [floating setValue:transition forKey:@"transitionState"];
      [floating setValue:@2 forKey:@"transitionKind"];
      Require(apply(handle,(int)(ticket % 5),ticket) == 0, "next Space request");
      Require(Find(chrome,@"ZenFloatingSidebarSurface") == floating && floating.alphaValue == 1,
        "Space change removed the visible sidebar background");
      int pending = sidebar(handle,ticket,ticket,5,5,220,590,800,600);
      Require(Find(chrome,@"ZenFloatingSidebarSurface") == floating && floating.alphaValue == 1,
        "pending main frame removed the visible sidebar background");
      Require(pending == 1, "wait for main frame");
      [[main valueForKey:@"renderer"] setValue:@1 forKey:@"status"];
      Require(activate(handle,ticket) == 0, "activate next Space");
      Require(sidebar(handle,ticket,ticket,5,5,220,590,800,600) == 0, "update same floating surface");
      Require(Find(chrome,@"ZenFloatingSidebarSurface") == floating && floating.alphaValue == 1,
        "replacement crop lost continuity");
      [[floating valueForKey:@"renderer"] setValue:@1 forKey:@"status"];
      Require(show(handle,ticket,ticket) == 0, "activate replacement crop");
      RequireFloatingMaterial(floating, main);
      ++checks;
    }
    Require(clear(handle) == 0 && !Find(chrome,@"ZenFloatingSidebarSurface"), "teardown still clears");
    printf("{\"cases\":%lu,\"retainsSurface\":true,\"floatingMaterial\":true,\"inheritsSpaceAppearance\":true,\"hiddenWindow\":true,\"renderCompletionStubbed\":true}\n",checks);
    [window close];
  }
  return 0;
}
