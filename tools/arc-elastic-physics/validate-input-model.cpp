#include "ArcElasticInputModel.h"
#include "third_party/blink/renderer/platform/widget/input/elastic_overscroll_controller_exponential.h"
#include <bit>
#include <cstdio>
#include <cstdlib>
#include <random>

using mozilla::layers::ArcElasticInputModel;

static float BinaryVelocity(float delta, int64_t micros) {
  const double million = 1000000.0;
  const double upper = 0.09999999776482583;
  const double lower = std::bit_cast<double>(UINT64_C(0x3690000000000000));
  float result;
  asm volatile(
      "scvtf d2, %[micros]\n"
      "fdiv d2, d2, %d[million]\n"
      "fcmp d2, %d[upper]\n"
      "fccmp d2, %d[lower], #4, lt\n"
      "b.le 1f\n"
      "fcvt s2, d2\n"
      "fdiv %s[result], %s[delta], s2\n"
      "b 2f\n"
      "1: fmov %s[result], wzr\n"
      "2:\n"
      : [result] "=&w"(result)
      : [delta] "w"(delta), [micros] "r"(micros), [million] "w"(million),
        [upper] "w"(upper), [lower] "w"(lower)
      : "v2", "cc");
  return result;
}

int main() {
  blink::ElasticOverscrollControllerExponential reference(nullptr);
  blink::OverscrollEntry entry{};
  unsigned checks = 0;
  auto require = [&](bool condition, const char* reason) {
    if (!condition) {
      std::fprintf(stderr, "Failed: %s\n", reason);
      std::exit(1);
    }
    ++checks;
  };
  auto force = [&](float value) {
    const gfx::Vector2dF input(value, value);
    require(ArcElasticInputModel::StretchForForce(value) ==
                reference.StretchAmountForAccumulatedOverscroll(entry, input).x(),
            "accumulated force differs from unchanged upstream controller");
    require(ArcElasticInputModel::ForceForStretch(value) ==
                reference.AccumulatedOverscrollForStretchAmount(entry, input).x(),
            "inverse stretch differs from unchanged upstream controller");
  };
  auto velocity = [&](float value, int64_t time) {
    require(std::bit_cast<uint32_t>(ArcElasticInputModel::Velocity(value, time)) ==
                std::bit_cast<uint32_t>(BinaryVelocity(value, time)),
            "velocity differs from the installed Arc instruction sequence");
  };
  for (float value : {-1000000.f, -1000.f, -30.f, -10.f, -1.f, -0.f, 0.f,
                      1.f, 9.999f, 10.f, 10.001f, 30.f, 1000.f, 1000000.f}) {
    force(value);
    for (int64_t time : {-1000000, -1, 0, 1, 8333, 16667, 99999, 100000, 100001, 1000000}) {
      velocity(value, time);
    }
  }
  std::mt19937 generator(381742);
  std::uniform_real_distribution<float> values(-100000, 100000);
  std::uniform_int_distribution<int64_t> times(-20000, 140000);
  for (int i = 0; i < 100000; ++i) {
    force(values(generator));
    velocity(values(generator), times(generator));
  }
  ArcElasticInputModel::AxisState axis;
  require(axis.AddConstrainedDelta(4) == 0 && axis.Pending() == 4, "first subthreshold delta");
  require(axis.AddConstrainedDelta(0) == 0 && axis.Pending() == 4, "zero delta keeps pending force");
  require(axis.AddConstrainedDelta(4) == 0 && axis.Pending() == 8, "second subthreshold delta");
  require(axis.AddConstrainedDelta(4) == 1 && axis.Force() == 12 && axis.Pending() == 0, "threshold crossed");
  require(axis.AddConstrainedDelta(400) == 21 && axis.Force() == 412, "Arc does not use Gecko's eight-pixel event cap");
  axis.Restore(3);
  require(axis.Force() == 60 && axis.Stretch() == 3, "restore force during animation or reconciliation");
  require(axis.AddConstrainedDelta(20) == 4, "resume from restored stretch");
  axis.Reset();
  require(axis.Force() == 0 && axis.Pending() == 0 && axis.Stretch() == 0, "reset");
  require(axis.AddConstrainedDelta(-10) == 0 && axis.Force() == -10, "negative half tie rounds toward positive infinity");
  require(axis.AddConstrainedDelta(-4) == 0 && axis.Pending() == -4, "pending negative motion after a zero stretch");
  require(axis.AddConstrainedDelta(-6) == -1 && axis.Force() == -20, "negative threshold accumulation");
  std::printf("{\"passed\":true,\"checks\":%u,\"resistanceReference\":\"unchanged pinned Chromium exponential controller\",\"velocityReference\":\"installed Arc arm64 instruction sequence\",\"engineIntegrated\":false,\"physicalTrackpadVerified\":false}\n", checks);
}
