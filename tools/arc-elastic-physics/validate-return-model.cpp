
#include "ArcElasticReturnModel.h"
#include "third_party/blink/renderer/platform/widget/input/elastic_overscroll_controller_exponential.h"
#include <cstdio>
#include <cstdlib>
#include <random>
using mozilla::layers::ArcElasticReturnModel;
int main() {
 blink::ElasticOverscrollControllerExponential reference(nullptr);
 unsigned checks=0;
 auto check=[&](float position,float velocity,int64_t microseconds) {
  blink::OverscrollEntry entry{{position,position},{velocity,velocity}};
  auto expected=reference.StretchAmountForTimeDelta(entry,base::TimeDelta(microseconds)).x();
  auto actual=ArcElasticReturnModel::Position(position,velocity,microseconds);
  if(expected!=actual) {
   std::fprintf(stderr,"Mismatch p=%.9g v=%.9g us=%lld expected=%d actual=%d\n",position,velocity,(long long)microseconds,expected,actual);std::exit(1);
  }
  checks++;
 };
 for(float position:{-1000.f,-50.f,-2.5f,-1.5f,-.5f,0.f,.5f,1.5f,2.5f,50.f,1000.f})
  for(float velocity:{-10000.f,-1000.f,-16.f,0.f,16.f,1000.f,10000.f})
   for(int64_t micros=0;micros<=2000000;micros+=8333)check(position,velocity,micros);
 std::mt19937 generator(593491);
 std::uniform_real_distribution<float> positions(-2000,2000),velocities(-10000,10000);
 std::uniform_int_distribution<int64_t> times(0,3000000);
 for(int i=0;i<100000;i++)check(positions(generator),velocities(generator),times(generator));
 struct Golden { float position,velocity;int64_t time;int expected; };
 for(auto c:{Golden{50,0,100000,14},Golden{50,0,200000,4},Golden{50,0,300000,1},Golden{50,0,400000,0},Golden{-.5f,0,0,0},Golden{-1.5f,0,0,-1},Golden{.5f,0,0,1},Golden{1.5f,0,0,2}}) {
  if(ArcElasticReturnModel::Position(c.position,c.velocity,c.time)!=c.expected)return 2;
  checks++;
 }
 std::printf("{\"passed\":true,\"checks\":%u,\"reference\":\"unchanged pinned Chromium exponential controller with vector/time dependency shims\",\"binaryFormulaAndRoundingConfirmed\":true,\"engineIntegrated\":false,\"physicalTrackpadVerified\":false}\n",checks);
}
