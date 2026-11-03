/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_layers_ArcElasticInputModel_h
#define mozilla_layers_ArcElasticInputModel_h

#include <cmath>
#include <cstdint>
#include <limits>

namespace mozilla::layers {

class ArcElasticInputModel {
 public:
  static int32_t StretchForForce(float aForce) {
    return Round(aForce * (1.0f / 20.0f));
  }

  static int32_t ForceForStretch(float aStretch) {
    return Round(aStretch * 20.0f);
  }

  static float Velocity(float aConstrainedDelta, int64_t aElapsedMicroseconds) {
    if (aElapsedMicroseconds <= 0 || aElapsedMicroseconds >= 100000) {
      return 0;
    }
    const float seconds = float(double(aElapsedMicroseconds) / 1000000.0);
    return aConstrainedDelta / seconds;
  }

  class AxisState {
   public:
    int32_t AddConstrainedDelta(float aDelta) {
      if (aDelta == 0) {
        return mStretch;
      }
      const float adjusted = aDelta + mPending;
      mPending = 0;
      if (mStretch == 0 && std::abs(adjusted) < 10.0f) {
        mPending = adjusted;
        return mStretch;
      }
      mForce += adjusted;
      mStretch = StretchForForce(mForce);
      return mStretch;
    }

    void Restore(float aStretch) {
      mStretch = Round(aStretch);
      mForce = float(ForceForStretch(aStretch));
    }

    void Reset() {
      mPending = 0;
      mForce = 0;
      mStretch = 0;
    }

    float Pending() const { return mPending; }
    float Force() const { return mForce; }
    int32_t Stretch() const { return mStretch; }

   private:
    float mPending = 0;
    float mForce = 0;
    int32_t mStretch = 0;
  };

 private:
  static int32_t Round(float aValue) {
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
