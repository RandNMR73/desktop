// Owned process only: compare the real native ABI with independently sampled
// Swift Foundation outputs, including the 25-hour day at the LA DST boundary.
#import <Foundation/Foundation.h>
#include <dlfcn.h>
#include <math.h>
static NSUInteger checks;
static void Check(BOOL ok, NSString *message) {
  checks++;
  if (!ok) { fprintf(stderr,"%s\n",message.UTF8String); exit(1); }
}
int main(int argc,const char *argv[]) {
  @autoreleasepool {
    Check(argc==3,@"library and reference JSON required");
    void *library=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);Check(library!=NULL,@"library loads");
    int (*format)(double,double,double,double,char *,uint32_t)=dlsym(library,"zen_downloads_transfer_text");
    Check(format!=NULL,@"transfer formatter ABI exists");
    NSDictionary *reference=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:@(argv[2])] options:0 error:nil];
    Check(reference!=nil,@"reference reads");
    [NSTimeZone setDefaultTimeZone:[NSTimeZone timeZoneWithName:reference[@"timezone"]]];
    double now=[reference[@"date"] doubleValue]*1000;
    for(NSDictionary *row in reference[@"transfers"]) {
      double total=[row[@"total"] isKindOfClass:NSNumber.class]?[row[@"total"] doubleValue]:-1;
      double remaining=[row[@"remaining"] isKindOfClass:NSNumber.class]?[row[@"remaining"] doubleValue]:-1;
      char out[1024];memset(out,'X',sizeof(out));
      int size=format([row[@"current"] doubleValue],total,remaining,now,out,sizeof(out));
      Check(size>=0&&[@(out) isEqual:row[@"output"]],[NSString stringWithFormat:@"reference mismatch %@ -> %s",row,out]);
      Check(size==(int)strlen(out),@"UTF8 byte length agrees with terminator");
    }
    char out[1024]; memset(out,'X',sizeof(out));
    Check(format(1200000,3600000,65,now,out,1)==-1&&out[0]=='X',@"short buffer unchanged");
    Check(format(0,-1,-1,now,out,1)==0&&out[0]==0,@"empty output fits one-byte buffer");
    Check(format(1,100,10,now,NULL,1024)==-1,@"null output rejected");
    Check(format(NAN,100,10,now,out,sizeof(out))==-1,@"NaN bytes rejected");
    Check(format(1,INFINITY,10,now,out,sizeof(out))==-1,@"infinite total rejected");
    Check(format(1,100,INFINITY,now,out,sizeof(out))==-1,@"infinite remaining rejected");
    Check(format(1,100,10,NAN,out,sizeof(out))==-1,@"invalid reference rejected");
    Check(format(1e20,100,10,now,out,sizeof(out))==-1,@"out-of-range byte count rejected");
    printf("{\"checks\":%lu,\"failures\":[]}\n",checks);
  }
  return 0;
}
