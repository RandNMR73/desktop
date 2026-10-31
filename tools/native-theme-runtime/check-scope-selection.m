#import <AppKit/AppKit.h>
#import <dlfcn.h>
#import <math.h>
#import <pthread.h>
typedef int (*Palette)(const char *,double *,uint32_t);
static Palette palette;
static void *offMain(void *ignored) {
  (void)ignored;double values[8]={-7,-7,-7,-7,-7,-7,-7,-7};
  int result=palette("{\"space\":\"srgb\",\"rgba\":[1,0,0,1]}",values,8);
  assert(result!=0&&values[0]==-7);return NULL;
}
int main(int argc,char **argv) { @autoreleasepool {
 assert(argc==3);
 void *handle=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);assert(handle);
 int (*version)(void)=dlsym(handle,"zen_command_selection_palette_version");
 palette=dlsym(handle,"zen_command_selection_palette");assert(palette&&version&&version()==1);
 NSData *data=[NSData dataWithContentsOfFile:@(argv[2])];
 NSArray *fixtures=[NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];assert(fixtures.count==6);
 double worst=0;int checks=0;
 for(NSDictionary *fixture in fixtures) {
  NSDictionary *input=@{@"space":fixture[@"space"],@"rgba":fixture[@"rgba"]};
  NSData *encoded=[NSJSONSerialization dataWithJSONObject:input options:0 error:NULL];
  NSString *json=[[NSString alloc]initWithData:encoded encoding:NSUTF8StringEncoding];
  double values[8];assert(palette(json.UTF8String,values,8)==0);
  NSArray *expected=[fixture[@"dark"] arrayByAddingObjectsFromArray:fixture[@"light"]];
  for(int i=0;i<8;i++) { double error=fabs(values[i]-[expected[i]doubleValue]);worst=fmax(worst,error);assert(error<1e-9);checks++; }
 }
 for(NSString *input in @[@"{}",@"[]",@"null",@"invalid",@"{\"space\":\"xyz\",\"rgba\":[1,0,0,1]}",@"{\"space\":\"srgb\",\"rgba\":[2,0,0,1]}",[@"x" stringByPaddingToLength:513 withString:@"x" startingAtIndex:0]]) {
  double values[8]={-7,-7,-7,-7,-7,-7,-7,-7};assert(palette(input.UTF8String,values,8)!=0);
  for(int i=0;i<8;i++)assert(values[i]==-7);checks++;
 }
 double values[8]={-7,-7,-7,-7,-7,-7,-7,-7};
 assert(palette(NULL,values,8)!=0);assert(palette("{}",NULL,8)!=0);assert(palette("{}",values,7)!=0);assert(values[0]==-7);checks+=3;
 pthread_t thread;assert(pthread_create(&thread,NULL,offMain,NULL)==0);assert(pthread_join(thread,NULL)==0);checks++;
 printf("{\"pass\":true,\"checks\":%d,\"max_component_error\":%.17g}\n",checks,worst);
 // Objective-C classes remain registered until process exit; do not dlclose.
 return 0;
}}
