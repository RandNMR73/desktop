// Independent macOS reference check. AppKit objects live only in this test
// executable; this tool never attaches to or changes either browser.
#import <AppKit/AppKit.h>
#include "ArcNativeScrollModel.h"
#include <cmath>
#include <cstdlib>
#include <iostream>
#include <random>

@interface NSObject (NativeScrollReference)
- (void)addDelta:(double)delta withTimestamp:(double)timestamp;
- (double)filteredVelocity;
- (void)setMaxAllowedVelocity:(double)velocity;
- (BOOL)resetIfOutOfDate:(double)timestamp;
- (void)reset;
- (instancetype)initWithInitialOrigin:(CGPoint)origin initialVelocity:(CGPoint)velocity documentFrame:(CGRect)document constrainedClippingOrigin:(CGPoint)constrained clippingSize:(CGSize)size tolerance:(CGSize)tolerance decelerationRate:(double)deceleration shouldRoundCalculations:(BOOL)round;
- (CGPoint)positionAfterDuration:(double)seconds;
- (double)durationUntilStop;
- (CGPoint)destinationOrigin;
@end

using namespace mozilla::layers;
static uint64_t checks = 0;
static double worstError = 0;
static void Check(double actual, double expected, const char* context) {
  ++checks;
  const double error = std::abs(actual - expected);
  worstError = std::max(worstError, error);
  if (!std::isfinite(actual) || error > 1e-10 * std::max(1.0, std::abs(expected))) {
    std::cerr << context << ": " << actual << " != " << expected << '\n';
    std::exit(1);
  }
}

int main() {
  @autoreleasepool {
    Class filterClass = NSClassFromString(@"_NS1DVelocityFilter");
    Class calculatorClass = NSClassFromString(@"_NSScrollingMomentumCatesCalculator");
    if (!filterClass || !calculatorClass) {
      std::cerr << "Native reference classes are unavailable on this macOS version\n";
      return 2;
    }
    std::mt19937 random(0x415243);
    const double deltas[] = {-500, -20, -1, -0.0, 0, 1, 20, 500};
    const double intervals[] = {-0.01, 0, 0.001, 0.001999, 0.002, 0.008,
                                0.016667, 0.199999, 0.2, 0.200001, 0.5};
    {
      id native = [[filterClass alloc] init];
      ArcNativeVelocityFilter model;
      for (double timestamp : {1.0, 1.01, 1.02}) {
        model.Add(1000, timestamp);
        [native addDelta:1000 withTimestamp:timestamp];
        Check(model.Velocity(), [native filteredVelocity], "default velocity limit");
      }
    }
    for (double maximum : {0.0, 20000.0}) {
      for (int sequence = 0; sequence < 100; ++sequence) {
        id native = [[filterClass alloc] init];
        [native setMaxAllowedVelocity:maximum];
        ArcNativeVelocityFilter model(maximum);
        double timestamp = 1000;
        for (int step = 0; step < 500; ++step) {
          timestamp += intervals[random() % std::size(intervals)];
          if (random() % 7 == 0) {
            const bool actual = model.ResetIfOutOfDate(timestamp);
            const bool expected = [native resetIfOutOfDate:timestamp];
            Check(actual, expected, "stale velocity reset");
          } else if (random() % 19 == 0) {
            model.Reset();
            [native reset];
          } else {
            double delta = deltas[random() % std::size(deltas)];
            model.Add(delta, timestamp);
            [native addDelta:delta withTimestamp:timestamp];
          }
          Check(model.Velocity(), [native filteredVelocity], "velocity");
        }
      }
    }
    const uint64_t velocityChecks = checks;
    for (double position : {-80., -40., -20., -5., -1., 1., 5., 20., 40., 80.}) {
      for (double velocity : {-40000., -20000., -5000., -1250., 0., 1250., 5000., 20000., 40000.}) {
        // Inward releases also enter native free-scrolling momentum; that
        // separate controller branch is deliberately not claimed by this test.
        if (position * velocity < 0) continue;
        const double edge = position > 0 ? 2270 : 0;
        id native = [[calculatorClass alloc]
            initWithInitialOrigin:CGPointMake(0, edge + position)
            initialVelocity:CGPointMake(0, velocity)
            documentFrame:CGRectMake(0, 0, 400, 3000)
            constrainedClippingOrigin:CGPointMake(0, edge)
            clippingSize:CGSizeMake(400, 730)
            tolerance:CGSizeMake(0.5, 0.5) decelerationRate:0
            shouldRoundCalculations:NO];
        Check(ArcNativeRubberbandModel::StopTime(position, velocity),
              [native durationUntilStop], "return stop");
        for (int us = 0; us <= 1000000; us += 1000) {
          const double seconds = us / 1e6;
          const CGPoint expected = [native positionAfterDuration:seconds];
          Check(ArcNativeRubberbandModel::Position(position, velocity, seconds),
                expected.y - edge, "return position");
        }
      }
    }
    const uint64_t returnChecks = checks - velocityChecks;
    // Exercise the complete single-axis calculator against the OS, including
    // inward releases, starting inside the range, crossing either edge, tiny
    // ranges, and long unobstructed flings that trigger duration limiting.
    for (double minimum : {-19.25, 0.0, 43.5}) {
      for (double range : {0.0, 0.25, 1.0, 2270.0, 1e6}) {
        const double maximum = minimum + range;
        for (double origin : {minimum - 80, minimum - 0.25, minimum,
                              minimum + range * 0.25, maximum,
                              maximum + 0.25, maximum + 80}) {
          for (double velocity : {-80000., -40000., -20000., -5000.,
                                  -1250., -1., 0., 1., 1250., 5000.,
                                  20000., 40000., 80000.}) {
            id native = [[calculatorClass alloc]
                initWithInitialOrigin:CGPointMake(0, origin)
                initialVelocity:CGPointMake(0, velocity)
                documentFrame:CGRectMake(0, minimum, 400, range + 730)
                constrainedClippingOrigin:CGPointMake(
                    0, std::clamp(origin, minimum, maximum))
                clippingSize:CGSizeMake(400, 730)
                tolerance:CGSizeMake(0.5, 0.5) decelerationRate:0
                shouldRoundCalculations:NO];
            ArcNativeMomentumModel model(origin, velocity, minimum, maximum);
            Check(model.Destination(), [native destinationOrigin].y,
                  "momentum destination");
            Check(model.Duration(), [native durationUntilStop],
                  "momentum duration");
            for (int ms = 0; ms <= 3000; ms += 10) {
              const double seconds = ms / 1000.0;
              Check(model.Position(seconds),
                    [native positionAfterDuration:seconds].y,
                    "momentum position");
            }
          }
        }
      }
    }
    std::cout << "{\"passed\":true,\"velocityChecks\":" << velocityChecks
              << ",\"returnChecks\":" << returnChecks
              << ",\"momentumChecks\":" << checks - velocityChecks - returnChecks
              << ",\"maximumAbsoluteError\":" << worstError
              << ",\"standaloneOnly\":true,\"browserTestsRun\":false}\n";
  }
}
