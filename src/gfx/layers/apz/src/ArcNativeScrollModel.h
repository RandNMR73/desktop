/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#ifndef mozilla_layers_ArcNativeScrollModel_h
#define mozilla_layers_ArcNativeScrollModel_h

#include <algorithm>
#include <cmath>
#include <limits>

namespace mozilla::layers {

// Native macOS sidebar primitives. Web content continues to use the Chromium
// models. The independent AppKit oracle in tools/arc-elastic-physics validates
// these operations; no private AppKit APIs are needed by this implementation.
class ArcNativeVelocityFilter {
 public:
  explicit ArcNativeVelocityFilter(double aMaximum = 0)
      : mMaximum(aMaximum) {}

  void Reset() {
    mLastTimestamp = std::numeric_limits<double>::max();
    mFiltered = std::numeric_limits<double>::quiet_NaN();
  }

  void Add(double aDelta, double aTimestamp) {
    const double elapsed = aTimestamp - mLastTimestamp;
    if (elapsed > 0.2) {
      Reset();
    } else if (elapsed > 0) {
      if (aDelta != 0 && std::signbit(aDelta) != std::signbit(mFiltered)) {
        Reset();
      }
      // Very closely spaced events do not advance the filter's clock. This
      // lets their following sample retain a meaningful velocity interval.
      if (elapsed < 0.002) {
        return;
      }
      const double velocity = aDelta / elapsed;
      mFiltered = std::isnan(mFiltered)
                      ? velocity
                      : std::fma(0.8, velocity, mFiltered * (1.0 - 0.8));
    }
    mLastTimestamp = aTimestamp;
  }

  bool ResetIfOutOfDate(double aTimestamp) {
    if (aTimestamp - mLastTimestamp > 0.2) {
      Reset();
      return true;
    }
    return false;
  }

  double Velocity() const {
    const double velocity = std::isnan(mFiltered) ? 0 : mFiltered;
    return mMaximum == 0 ? velocity
                         : std::clamp(velocity, -mMaximum, mMaximum);
  }

 private:
  double mMaximum;
  double mLastTimestamp = std::numeric_limits<double>::max();
  double mFiltered = std::numeric_limits<double>::quiet_NaN();
};

class ArcNativeRubberbandModel {
 public:
  // Logical display pixels, pixels/second, and seconds. This is the native
  // rubberband branch, not the free-scrolling portion of native momentum.
  // The caller must handle an inward release that crosses into the scrollable
  // range, sample at the display prediction time, and align to backing pixels.
  static double Position(double aPosition, double aVelocity, double aSeconds) {
    return NativeDelta(aPosition, -aVelocity, aSeconds);
  }

  // AppKit searches the rubberband stop interval in [0, 1.5] seconds using a
  // half-point tolerance and a 10ms bracket. It returns the lower bracket;
  // solving the exponential analytically produces a different last frame.
  // Its stopping estimate uses the signed origin and velocity directly.
  static double StopTime(double aPosition, double aVelocity) {
    double low = 0;
    double high = 1.5;
    while (high - low > 0.01) {
      const double middle = low + (high - low) * 0.5;
      if (std::abs(NativeDelta(aPosition, aVelocity, middle)) < 0.5) {
        high = middle;
      } else {
        low = middle;
      }
    }
    return low;
  }

 private:
  static double NativeDelta(double aPosition, double aVelocity, double aSeconds) {
    const double velocity = std::clamp(aVelocity, -20000.0, 20000.0);
    const double decay = std::exp(-aSeconds * 20.0 / 1.6);
    return decay * std::fma(-velocity * aSeconds, 0.31, aPosition);
  }
};

// Single-axis native momentum, including inward releases and reaching an edge
// during free scrolling. Coordinates are logical display pixels. This models
// the unrounded calculator; the caller owns display-time prediction, backing
// pixel alignment, and stopping at Duration(). It is not a two-axis controller.
class ArcNativeMomentumModel {
 public:
  ArcNativeMomentumModel(double aOrigin, double aVelocity, double aMinimum,
                         double aMaximum)
      : mOrigin(aOrigin) {
    mUnconstrainedDestination =
        std::fma(std::copysign(1.0, aVelocity),
                 mDeceleration *
                     std::pow(std::abs(aVelocity) / (4 * mDeceleration),
                              4.0 / 3.0),
                 mOrigin);
    CacheDisplacement();
    mDestination = mUnconstrainedDestination;
    const double constrained =
        std::clamp(mDestination, aMinimum, aMaximum);
    const double destinationStretch = mDestination - constrained;
    if (std::abs(destinationStretch) >= 0.5) {
      mDestination = constrained;
      mBounceOrigin = mOrigin - std::clamp(mOrigin, aMinimum, aMaximum);
      if (mBounceOrigin == 0) {
        mBounceStart =
            mFreeDuration -
            std::pow((mDisplacement - std::abs(mDestination - mOrigin)) /
                         mDeceleration,
                     0.25);
        mBounceVelocity =
            std::copysign(4 * mDeceleration *
                              std::pow(mFreeDuration - mBounceStart, 3),
                          aVelocity);
      } else {
        mBounceStart = 0;
        mBounceVelocity = aVelocity;
        mUnconstrainedDestination = mDestination;
        CacheDisplacement();
      }
      mDuration = mBounceStart + ArcNativeRubberbandModel::StopTime(
                                    mBounceOrigin, mBounceVelocity);
    } else {
      mDuration = mFreeDuration;
      // Native default momentum shortens very long, unobstructed flings by
      // choosing their two-second position and recalculating deceleration.
      if (mFreeDuration > 2) {
        mDestination = Position(2);
        mUnconstrainedDestination = mDestination;
        const double distance = std::abs(mDestination - mOrigin);
        mDeceleration =
            std::pow(std::abs(aVelocity) / (4 * std::pow(distance, 0.75)), 4);
        CacheDisplacement();
        mDuration = mFreeDuration;
      }
    }
  }

  double Position(double aSeconds) const {
    if (mBounceStart >= 0 && aSeconds >= mBounceStart) {
      return mDestination + ArcNativeRubberbandModel::Position(
                                mBounceOrigin, mBounceVelocity,
                                aSeconds - mBounceStart);
    }
    if (mDisplacement == 0) {
      return mDestination;
    }
    const double fraction =
        (mDisplacement - mDeceleration *
                             std::pow(std::max(mFreeDuration - aSeconds, 0.0),
                                      4)) /
        mDisplacement;
    // Keep the separate multiply/add used by the native calculator.
    const double delta = fraction * (mUnconstrainedDestination - mOrigin);
    return mOrigin + delta;
  }

  double Destination() const { return mDestination; }
  double Duration() const { return mDuration; }
  double BounceStart() const { return mBounceStart; }

 private:
  void CacheDisplacement() {
    mDisplacement = std::abs(mUnconstrainedDestination - mOrigin);
    mFreeDuration = std::pow(mDisplacement / mDeceleration, 0.25);
  }

  double mOrigin;
  double mDestination = 0;
  double mUnconstrainedDestination = 0;
  double mDeceleration = 1000;
  double mDisplacement = 0;
  double mFreeDuration = 0;
  double mDuration = 0;
  double mBounceStart = -1;
  double mBounceOrigin = 0;
  double mBounceVelocity = 0;
};

}  // namespace mozilla::layers

#endif
