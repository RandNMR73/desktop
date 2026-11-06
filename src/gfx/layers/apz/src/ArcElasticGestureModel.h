// Copyright 2014 The Chromium Authors
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are
// met:
//
//    * Redistributions of source code must retain the above copyright
// notice, this list of conditions and the following disclaimer.
//    * Redistributions in binary form must reproduce the above
// copyright notice, this list of conditions and the following disclaimer
// in the documentation and/or other materials provided with the
// distribution.
//    * Neither the name of Google LLC nor the names of its
// contributors may be used to endorse or promote products derived from
// this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
// A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
// OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
// DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
// THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
// (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
// OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

/*
 * Copyright (C) 2011 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
 */

#ifndef mozilla_layers_ArcElasticGestureModel_h
#define mozilla_layers_ArcElasticGestureModel_h

#include "ArcElasticInputModel.h"
#include "ArcElasticReturnModel.h"

#include <algorithm>
#include <cmath>
#include <cstdint>

namespace mozilla::layers {

class ArcElasticGestureModel {
 public:
  struct Vector {
    float x = 0;
    float y = 0;
    bool IsZero() const { return x == 0 && y == 0; }
    bool operator==(const Vector&) const = default;
  };

  struct Bounds {
    Vector offset;
    Vector maximum;
    bool userScrollableX = true;
    bool userScrollableY = true;
    bool overscrollable = true;
  };

  struct Behavior {
    bool x = true;
    bool y = true;
  };

  enum class State { Inactive, Active, Momentum, Returning };

  void Begin(bool aMomentum) {
    mReceivedOverscroll = false;
    mBehavior = {};
    if (aMomentum) {
      if (mState == State::Inactive) {
        mState = State::Momentum;
      }
    } else {
      mVelocity = {};
      mLastTime = 0;
      mState = State::Active;
      mPending = {};
    }
  }

  void Update(Vector aEventDelta, Vector aUnusedDelta, int64_t aTime,
              bool aMomentum, const Bounds& aBounds, Behavior aBehavior,
              bool aSelectAxisFromEvent = true) {
    if (mState == State::Inactive || mState == State::Returning) {
      return;
    }
    if (!mReceivedOverscroll && !aUnusedDelta.IsZero()) {
      mBehavior = aBehavior;
      mReceivedOverscroll = true;
    }
    if (!aMomentum || mInMomentum) {
      const Vector delta = Constrain(aEventDelta, aBounds);
      mVelocity = {ArcElasticInputModel::Velocity(delta.x, aTime - mLastTime),
                   ArcElasticInputModel::Velocity(delta.y, aTime - mLastTime)};
      mLastTime = aTime;
    }
    mInMomentum = aMomentum;
    Accumulate(aEventDelta, aUnusedDelta, aBounds, aSelectAxisFromEvent);
    if (aMomentum && !mStretch.IsZero()) {
      StartReturn(aTime, aBounds);
    }
  }

  void End(int64_t aTime, const Bounds& aBounds) {
    if (mState == State::Inactive || mState == State::Returning) {
      return;
    }
    if (mStretch.IsZero()) {
      SetInactive();
    } else {
      StartReturn(aTime, aBounds);
    }
  }

  bool Sample(int64_t aTime) {
    if (mState == State::Inactive) {
      Reset();
      return false;
    }
    if (mState != State::Returning) {
      return false;
    }
    const int64_t elapsed = std::max<int64_t>(0, aTime - mReturnTime);
    mStretch = {float(ArcElasticReturnModel::Position(
                    mInitialStretch.x, mInitialVelocity.x, elapsed)),
                float(ArcElasticReturnModel::Position(
                    mInitialStretch.y, mInitialVelocity.y, elapsed))};
    if (mStretch.IsZero()) {
      Reset();
      return false;
    }
    RestoreForce();
    return true;
  }

  // Returns the scroll correction to apply after normal scrolling or layout.
  Vector Reconcile(const Bounds& aBounds) {
    Vector correction;
    const auto reconcile = [](float stretch, float offset, float maximum) {
      if (stretch < 0 && offset > 0) {
        return std::min(-stretch, offset);
      }
      if (stretch > 0 && offset < maximum) {
        return std::max(-stretch, offset - maximum);
      }
      return 0.0f;
    };
    correction.x = reconcile(mStretch.x, aBounds.offset.x, aBounds.maximum.x);
    correction.y = reconcile(mStretch.y, aBounds.offset.y, aBounds.maximum.y);
    if (!correction.IsZero()) {
      mStretch.x += correction.x;
      mStretch.y += correction.y;
      if (mState == State::Active) {
        RestoreForce();
      }
    }
    return {-correction.x, -correction.y};
  }

  void Reset() { *this = ArcElasticGestureModel(); }

  // A native chrome animation can move between ordinary scrolling and stretch.
  // Keep drag resistance in sync so a new gesture starts at the displayed point.
  void RestoreStretch(Vector aStretch) {
    mStretch = aStretch;
    RestoreForce();
  }

  State GetState() const { return mState; }
  Vector Stretch() const { return mStretch; }
  Vector Force() const { return mForce; }
  Vector Pending() const { return mPending; }
  Vector Velocity() const { return mVelocity; }
  Vector InitialVelocity() const { return mInitialVelocity; }

 private:
  static Vector Constrain(Vector aDelta, const Bounds& aBounds) {
    return {aBounds.userScrollableX ? aDelta.x : 0,
            aBounds.userScrollableY ? aDelta.y : 0};
  }

  static bool Pinned(float aDelta, float aOffset, float aMaximum) {
    return (aDelta < 0 && aOffset <= 0) || (aDelta > 0 && aOffset >= aMaximum);
  }

  void Accumulate(Vector aEventDelta, Vector aUnusedDelta,
                  const Bounds& aBounds, bool aSelectAxisFromEvent) {
    Vector delta = Constrain(aUnusedDelta, aBounds);
    if (!aBounds.overscrollable || delta.IsZero()) {
      return;
    }
    delta.x += mPending.x;
    delta.y += mPending.y;
    mPending = {};
    const Vector selection = aSelectAxisFromEvent ? aEventDelta : aUnusedDelta;
    if (std::abs(selection.y) >= std::abs(selection.x)) {
      delta.x = 0;
    } else {
      delta.y = 0;
    }
    if (!mBehavior.x || !Pinned(delta.x, aBounds.offset.x, aBounds.maximum.x)) {
      delta.x = 0;
    }
    if (!mBehavior.y || !Pinned(delta.y, aBounds.offset.y, aBounds.maximum.y)) {
      delta.y = 0;
    }
    if (mStretch.x == 0 && std::abs(delta.x) < 10) {
      mPending.x = delta.x;
      delta.x = 0;
    }
    if (mStretch.y == 0 && std::abs(delta.y) < 10) {
      mPending.y = delta.y;
      delta.y = 0;
    }
    if (delta.IsZero()) {
      return;
    }
    mForce.x += delta.x;
    mForce.y += delta.y;
    mStretch = {float(ArcElasticInputModel::StretchForForce(mForce.x)),
                float(ArcElasticInputModel::StretchForForce(mForce.y))};
  }

  void RestoreForce() {
    mForce = {float(ArcElasticInputModel::ForceForStretch(mStretch.x)),
              float(ArcElasticInputModel::ForceForStretch(mStretch.y))};
  }

  void SetInactive() {
    mState = State::Inactive;
    mForce = {};
  }

  void StartReturn(int64_t aTime, const Bounds& aBounds) {
    mState = State::Returning;
    mReturnTime = aTime;
    mInitialStretch = mStretch;
    mInitialVelocity = mVelocity;
    if (std::abs(mInitialVelocity.y) >= std::abs(mInitialVelocity.x)) {
      mInitialVelocity.x = 0;
    }
    if (aBounds.maximum.x <= 0) {
      mInitialVelocity.x = 0;
    }
    if (aBounds.maximum.y <= 0) {
      mInitialVelocity.y = 0;
    }
  }

  State mState = State::Inactive;
  Vector mStretch;
  Vector mPending;
  Vector mForce;
  Vector mVelocity;
  Vector mInitialStretch;
  Vector mInitialVelocity;
  int64_t mLastTime = 0;
  int64_t mReturnTime = 0;
  Behavior mBehavior;
  bool mReceivedOverscroll = false;
  bool mInMomentum = false;
};

}  // namespace mozilla::layers

#endif
