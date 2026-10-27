/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#import <MetalKit/MetalKit.h>
#import <QuartzCore/CAMetalLayer.h>
#import <simd/simd.h>

@interface MetalThemeView : MTKView <MTKViewDelegate>
@property NSArray *themes;
@property NSArray<id<MTLTexture>> *fields;
@property id<MTLTexture> grainTexture;
@property id<MTLCommandQueue> queue;
@property id<MTLRenderPipelineState> pipeline;
@property NSInteger selectedTheme;
@property (readonly) NSUInteger submittedFrames;
- (void)selectTheme:(NSInteger)index;
@end
