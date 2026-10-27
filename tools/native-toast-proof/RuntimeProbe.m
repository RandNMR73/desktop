/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Isolated visual diagnostic. It never reads a browser profile, and Share
// receives only the loopback fixture URL. Cancel the picker during tests.
#import <AppKit/AppKit.h>
#import "../native-theme-runtime/ZenNativeToast.h"
@interface Probe : NSObject <NSApplicationDelegate>
@property NSWindow *window;
@property NSArray *themes;
@property NSInteger index;
@end
@implementation Probe
- (void)applicationDidFinishLaunching:(NSNotification *)note {
  NSData *data = [NSData dataWithContentsOfURL:[NSBundle.mainBundle URLForResource:@"themes" withExtension:@"json"]];
  self.themes = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL][@"themes"];
  if (![self.themes isKindOfClass:NSArray.class] || self.themes.count != 5) {
    fprintf(stderr, "Expected the five-Space native test palette in themes.json\n");
    exit(2);
  }
  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(400,300,720,420) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
  self.window.title = @"Native copy notification — isolated probe";
  self.window.backgroundColor = NSColor.blackColor;
  NSArray *labels = @[@"Main Space",@"APT",@"Stanford",@"Exploration",@"Exploration 2",@"Copy URL",@"Copy Without Share",@"Timed Copy",@"Clear",@"Diagnostics"];
  for (NSUInteger i=0;i<labels.count;++i) {
    NSButton *b=[NSButton buttonWithTitle:labels[i] target:self action:@selector(choose:)];
    b.tag=i; b.frame=NSMakeRect(20+(i%5)*138,20+(i/5)*44,132,32);[self.window.contentView addSubview:b];
  }
  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:YES];
}
- (void)choose:(NSButton *)button {
  if(button.tag==9){button.title=[NSString stringWithFormat:@"Status: %d",ZenCopyToastStatus(self.window)];return;}
  if(button.tag<5)self.index=button.tag;
  if(button.tag==8){ZenCloseCopyToast(self.window);return;}
  NSDictionary *request=@{@"label":@"Copied Current URL",@"url":button.tag==6?(id)NSNull.null:@"http://127.0.0.1:62979/",@"height":@(NSHeight(self.window.contentView.bounds)),@"timeout":@2000,@"hold":@(button.tag!=7)};
  int result=ZenShowCopyToast(self.window,self.themes[self.index][@"toastPalette"],request);
  NSLog(@"Notification result %d",result);
}
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)app {return YES;}
@end
int main() {@autoreleasepool {
 [NSApplication sharedApplication];[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
 NSMenu *menu=[NSMenu new],*appMenu=[NSMenu new];NSMenuItem *item=[NSMenuItem new];[menu addItem:item];item.submenu=appMenu;
 [appMenu addItemWithTitle:@"Quit Probe" action:@selector(terminate:) keyEquivalent:@"q"];NSApp.mainMenu=menu;
 Probe *probe=[Probe new];NSApp.delegate=probe;[NSApp run];
}return 0;}
