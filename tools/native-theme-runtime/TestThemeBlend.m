/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
#import <AppKit/AppKit.h>
#import <MetalKit/MetalKit.h>
#include <dlfcn.h>

@interface ZenWindowMaterialView : NSVisualEffectView @end
@implementation ZenWindowMaterialView @end
@interface ChildView : NSView @end
@implementation ChildView @end
static void Require(BOOL valid, const char *why) { if (!valid) { fprintf(stderr,"%s\n",why); exit(1); } }
static NSView *Find(NSView *view, NSString *name) {
  for (NSView *child in view.subviews) if ([NSStringFromClass(child.class) isEqual:name]) return child;
  return nil;
}
static void Tick(void) { [NSRunLoop.currentRunLoop runUntilDate:[NSDate dateWithTimeIntervalSinceNow:.02]]; }
static NSArray<NSNumber *> *Pixels(MTKView *renderer) {
  renderer.framebufferOnly = NO;
  id<CAMetalDrawable> drawable = renderer.currentDrawable;
  Require(drawable != nil, "owned test window has a Metal drawable");
  id<MTLTexture> texture = drawable.texture;
  [renderer draw];
  id queue = [[renderer valueForKey:@"resources"] valueForKey:@"queue"];
  const NSUInteger row = texture.width * 8;
  id<MTLBuffer> buffer = [renderer.device newBufferWithLength:row*texture.height options:MTLResourceStorageModeShared];
  id<MTLCommandBuffer> command = [queue commandBuffer];
  id<MTLBlitCommandEncoder> encoder = [command blitCommandEncoder];
  [encoder copyFromTexture:texture sourceSlice:0 sourceLevel:0 sourceOrigin:MTLOriginMake(0,0,0)
    sourceSize:MTLSizeMake(texture.width,texture.height,1) toBuffer:buffer destinationOffset:0
    destinationBytesPerRow:row destinationBytesPerImage:row*texture.height];
  [encoder endEncoding]; [command commit]; [command waitUntilCompleted];
  Require(command.status == MTLCommandBufferStatusCompleted, "read actual rendered floating-point pixels");
  const _Float16 *bytes = buffer.contents;
  NSMutableArray *result = [NSMutableArray array];
  for (NSUInteger y=1; y<=3; ++y) for (NSUInteger x=1; x<=3; ++x)
    for (NSUInteger c=0;c<4;++c) [result addObject:@((float)bytes[((texture.height*y/4)*texture.width+texture.width*x/4)*4+c])];
  return result;
}
int main(int argc, const char **argv) {
  @autoreleasepool {
    if (argc!=2) return 2;
    [NSApplication sharedApplication];
    void *lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);Require(lib!=NULL,"native library");
    int (*apply)(uint64_t,int,uint32_t)=dlsym(lib,"zen_theme_apply");
    int (*activate)(uint64_t,uint32_t)=dlsym(lib,"zen_theme_activate");
    int (*configure)(uint64_t,const char *)=dlsym(lib,"zen_theme_blend_configure");
    int (*progress)(uint64_t,double)=dlsym(lib,"zen_theme_blend_progress");
    int (*clear)(uint64_t)=dlsym(lib,"zen_theme_clear");
    Require(configure&&progress,"blend capability");
    NSWindow *window=[[NSWindow alloc]initWithContentRect:NSMakeRect(80,80,400,320)
      styleMask:NSWindowStyleMaskTitled backing:NSBackingStoreBuffered defer:NO];window.releasedWhenClosed=NO;
    window.title=@"Zen theme blend validation";
    ZenWindowMaterialView *content=[[ZenWindowMaterialView alloc]initWithFrame:NSMakeRect(0,0,400,320)];
    window.contentView=content;[content addSubview:[[ChildView alloc]initWithFrame:content.bounds]];
    [window makeKeyAndOrderFront:nil];
    uint64_t handle=(uintptr_t)(__bridge void *)window;
    Require(apply(handle,0,1)==0,"initial theme");
    NSView *surface=Find(content,@"ZenThemeSurface");MTKView *renderer=[surface valueForKey:@"renderer"];
    for(int i=0;i<100&&[[renderer valueForKey:@"status"]intValue]!=1;++i)Tick();
    Require(activate(handle,1)==0,"initial rendered frame");
    NSUInteger checks=0;double error=0;
    for(NSUInteger next=1;next<5;++next){
      NSString *request=[NSString stringWithFormat:@"[0,%lu]",next];
      Require(configure(handle,request.UTF8String)==0,"configure two validated themes");
      Require(progress(handle,0)==0,"first endpoint");NSArray *from=Pixels(renderer);
      Require(progress(handle,1)==0,"second endpoint");NSArray *to=Pixels(renderer);
      for(NSNumber *amount in @[@.25,@.5,@.75,@.25,@0]){
        Require(progress(handle,amount.doubleValue)==0,"forward and reversing progress");NSArray *actual=Pixels(renderer);
        for(NSUInteger i=0;i<actual.count;++i){
          double expected=[from[i]doubleValue]*(1-amount.doubleValue)+[to[i]doubleValue]*amount.doubleValue;
          double difference=fabs([actual[i]doubleValue]-expected);error=fmax(error,difference);
          Require(difference<.003,"GPU blend matches premultiplied endpoint interpolation");++checks;
        }
      }
    }
    Require(progress(handle,NAN)!=0&&progress(handle,2)!=0,"reject invalid progress");
    Require(configure(handle,"[-1,999]")!=0,"reject invalid endpoint");
    Require(configure(handle,NULL)==0&&![renderer valueForKey:@"blend"],"cancellation removes temporary blend");
    Require(surface.alphaValue==1,"background stays visible");
    clear(handle);[window close];
    printf("{\"passed\":true,\"gpuPixelChecks\":%lu,\"maximumError\":%.9g}\n",checks,error);
  }
  return 0;
}
