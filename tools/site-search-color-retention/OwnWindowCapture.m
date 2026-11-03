#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
static NSMutableDictionary *results;
static NSData *serialized;
static NSString *root;
__attribute__((visibility("default"))) void zen_test_popup_capture_start(const char *outputDirectory) {
  root=[NSString stringWithUTF8String:outputDirectory];
  results=[@{@"pending":@YES}mutableCopy];
  NSMutableDictionary *ids=[NSMutableDictionary dictionary];
  for(NSWindow *w in NSApp.windows)if(w.visible){
    if([NSStringFromClass(w.class)isEqualToString:@"PopupWindow"]&&w.frame.size.width>500)ids[@(w.windowNumber)]=@"popup";
    if(w.mainWindow)ids[@(w.windowNumber)]=@"main";
  }
  [SCShareableContent getCurrentProcessShareableContentWithCompletionHandler:^(SCShareableContent *content,NSError *error){
    if(error){@synchronized(results){results[@"error"]=error.description;results[@"pending"]=@NO;}return;}
    dispatch_group_t group=dispatch_group_create();
    for(SCWindow *w in content.windows){
      NSString *kind=ids[@(w.windowID)];if(!kind||w.owningApplication.processID!=getpid())continue;
      for(NSNumber *children in ([kind isEqual:@"main"]?@[@YES,@NO]:@[@YES])) {
      NSString *captureKind=children.boolValue?kind:[kind stringByAppendingString:@"-no-children"];
      SCContentFilter *filter=[[SCContentFilter alloc]initWithDesktopIndependentWindow:w];
      SCStreamConfiguration *config=[SCStreamConfiguration new];
      config.width=llround(w.frame.size.width*2);config.height=llround(w.frame.size.height*2);
      config.showsCursor=NO;config.ignoreShadowsSingleWindow=YES;config.includeChildWindows=children.boolValue;
      dispatch_group_enter(group);
      [SCScreenshotManager captureImageWithFilter:filter configuration:config completionHandler:^(CGImageRef image,NSError *failure){
        NSString *path=[root stringByAppendingPathComponent:[captureKind stringByAppendingString:@"-sck.png"]];
        BOOL saved=NO;
        if(image){NSBitmapImageRep *rep=[[NSBitmapImageRep alloc]initWithCGImage:image];
          saved=[[rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}]writeToFile:path atomically:YES];}
        @synchronized(results){results[captureKind]=@{@"id":@(w.windowID),@"includeChildWindows":children,@"onScreen":@(w.onScreen),@"saved":@(saved),@"path":path,@"error":failure.description?:@""};}
        dispatch_group_leave(group);
      }];
      }
    }
    dispatch_group_notify(group,dispatch_get_main_queue(),^{@synchronized(results){results[@"pending"]=@NO;}});
  }];
}
__attribute__((visibility("default"))) const char *zen_test_popup_capture_state(void) {
  @synchronized(results){NSData *json=[NSJSONSerialization dataWithJSONObject:results?:@{} options:0 error:NULL];
    NSMutableData *terminated=[json mutableCopy];[terminated appendBytes:"\0" length:1];serialized=terminated;return serialized.bytes;}
}
