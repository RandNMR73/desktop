/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_layers_ArcElasticReturnModel_h
#define mozilla_layers_ArcElasticReturnModel_h

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <limits>

namespace mozilla::layers {

// Scalar return-curve prototype. Coordinates are logical display pixels and
// velocity is logical pixels/second. The caller owns gesture routing, backing
// scale conversion, velocity sampling, and stopping/cancelling the animation.
//
// Arc 1.171.0's arm64 return function and rounding helper were inspected read
// only; see confirmed-arc-return-physics.json. Keep the float intermediate
// operations: simplifying this to a double exponential changes quantization.
class ArcElasticReturnModel {
 public:
  static int32_t Position(float aInitialPosition, float aInitialVelocity,
                          int64_t aElapsedMicroseconds) {
    const double seconds =
        std::max<int64_t>(aElapsedMicroseconds, 0) / 1000000.0;
    const float decay =
        std::exp(static_cast<float>(-seconds * 20.0 / double(1.6f)));
    const float velocityTime = static_cast<float>(seconds * double(0.31f));
    const float displacement = aInitialVelocity * velocityTime;
    const float unattenuatedPosition = aInitialPosition + displacement;
    return Round(unattenuatedPosition * decay);
  }

 private:
  static int32_t Round(float aValue) {
    // Blink rounds half ties toward +infinity, including negative positions.
    // std::round instead rounds negative half ties away from zero.
    const float rounded = std::floor(aValue + 0.5f);
    if (std::isnan(rounded)) {
      return 0;
    }
    if (rounded >= float(std::numeric_limits<int32_t>::max())) {
      return std::numeric_limits<int32_t>::max();
    }
    if (rounded <= float(std::numeric_limits<int32_t>::min())) {
      return std::numeric_limits<int32_t>::min();
    }
    return static_cast<int32_t>(rounded);
  }
};

}  // namespace mozilla::layers

#endif
