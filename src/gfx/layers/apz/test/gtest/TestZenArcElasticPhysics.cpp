/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "APZCBasicTester.h"
#include "InputUtils.h"

#ifndef MOZ_WIDGET_ANDROID

class ZenAPZArcElasticPhysics : public APZCBasicTester {
 protected:
  void SetUp() override {
    APZCBasicTester::SetUp();
    mOrigin = mcc->Time();
    Configure(1, 1000);
  }

  void Configure(float aScale, float aPageHeight) {
    mScale = aScale;
    auto& metrics = apzc->GetFrameMetrics();
    metrics.SetCompositionBounds(
        ParentLayerRect(0, 0, 100 * aScale, 100 * aScale));
    metrics.SetScrollableRect(CSSRect(0, 0, 100, aPageHeight));
    metrics.SetVisualScrollOffset(CSSPoint(0, 0));
    metrics.SetZoom(CSSToParentLayerScale(aScale));
    metrics.SetDevPixelsPerCSSPixel(CSSToLayoutDeviceScale(aScale));
    OverflowInfo overflow;
    overflow.mOverflowX = StyleOverflow::Auto;
    overflow.mOverflowY = StyleOverflow::Auto;
    apzc->GetScrollMetadata().SetOverflow(overflow);
  }

  void NativePan(PanGestureInput::PanGestureType aType, ScreenPoint aDelta) {
    PanGestureInput input(aType, mcc->Time(), ScreenPoint(50, 50) * mScale,
                          aDelta * mScale, MODIFIER_NONE);
    input.mHandledByAPZ = true;
    input.mNativePanDisplacement = aDelta;
    input.mNativeBackingScale = mScale;
    input.mNativeEventTimeUs =
        1000000 + int64_t((mcc->Time() - mOrigin).ToMicroseconds());
    apzc->ReceiveInputEvent(input);
  }

  void Finish() {
    NativePan(PanGestureInput::PANGESTURE_END, {});
    apzc->AdvanceAnimationsUntilEnd();
    EXPECT_FALSE(apzc->IsOverscrolled());
  }

  float mScale = 1;
  TimeStamp mOrigin;
};

TEST_F(ZenAPZArcElasticPhysics, ResistanceUsesLogicalDisplayPixels) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  for (float scale : {1.0f, 2.0f}) {
    Configure(scale, 1000);
    NativePan(PanGestureInput::PANGESTURE_START, {0, -20});
    EXPECT_FLOAT_EQ(-scale, apzc->GetOverscrollAmount().y);
    mcc->AdvanceByMillis(10);
    NativePan(PanGestureInput::PANGESTURE_PAN, {0, -400});
    EXPECT_FLOAT_EQ(-21 * scale, apzc->GetOverscrollAmount().y);
    EXPECT_EQ(CSSPoint(), apzc->GetFrameMetrics().GetVisualScrollOffset());
    Finish();
  }
}

TEST_F(ZenAPZArcElasticPhysics, SmallPullsAccumulateBeforeStretching) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  Configure(2, 100);
  NativePan(PanGestureInput::PANGESTURE_START, {0, 3});
  EXPECT_FALSE(apzc->IsOverscrolled());
  mcc->AdvanceByMillis(10);
  NativePan(PanGestureInput::PANGESTURE_PAN, {0, 3});
  EXPECT_FALSE(apzc->IsOverscrolled());
  mcc->AdvanceByMillis(10);
  NativePan(PanGestureInput::PANGESTURE_PAN, {0, 4});
  EXPECT_FLOAT_EQ(2, apzc->GetOverscrollAmount().y);
  Finish();
}

TEST_F(ZenAPZArcElasticPhysics, ReversalConsumesStretchBeforeMovingPage) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  NativePan(PanGestureInput::PANGESTURE_START, {0, -200});
  EXPECT_FLOAT_EQ(-10, apzc->GetOverscrollAmount().y);
  mcc->AdvanceByMillis(10);
  NativePan(PanGestureInput::PANGESTURE_PAN, {0, 4});
  EXPECT_FLOAT_EQ(-6, apzc->GetOverscrollAmount().y);
  EXPECT_EQ(CSSPoint(), apzc->GetFrameMetrics().GetVisualScrollOffset());
  mcc->AdvanceByMillis(10);
  NativePan(PanGestureInput::PANGESTURE_PAN, {0, 10});
  EXPECT_FALSE(apzc->IsOverscrolled());
  EXPECT_EQ(CSSPoint(0, 4), apzc->GetFrameMetrics().GetVisualScrollOffset());
  Finish();
}

TEST_F(ZenAPZArcElasticPhysics, ShortPageReturnUsesEventTimeAndZeroVelocity) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  Configure(2, 100);
  NativePan(PanGestureInput::PANGESTURE_START, {0, -200});
  mcc->AdvanceByMillis(10);
  NativePan(PanGestureInput::PANGESTURE_PAN, {0, -200});
  EXPECT_FLOAT_EQ(-40, apzc->GetOverscrollAmount().y);
  NativePan(PanGestureInput::PANGESTURE_END, {});
  mcc->AdvanceByMillis(80);
  apzc->AdvanceAnimations(mcc->GetSampleTime());
  EXPECT_FLOAT_EQ(-14, apzc->GetOverscrollAmount().y);
  mcc->AdvanceByMillis(160);
  apzc->AdvanceAnimations(mcc->GetSampleTime());
  EXPECT_FLOAT_EQ(-2, apzc->GetOverscrollAmount().y);
  mcc->AdvanceByMillis(80);
  apzc->AdvanceAnimations(mcc->GetSampleTime());
  EXPECT_FALSE(apzc->IsOverscrolled());
}

TEST_F(ZenAPZArcElasticPhysics, FirstMomentumEventKeepsPriorVelocity) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  apzc->GetFrameMetrics().SetVisualScrollOffset(CSSPoint(0, 100));
  NativePan(PanGestureInput::PANGESTURE_START, {0, 50});
  mcc->AdvanceByMillis(10);
  NativePan(PanGestureInput::PANGESTURE_PAN, {0, 50});
  NativePan(PanGestureInput::PANGESTURE_END, {});
  mcc->AdvanceBy(TimeDuration::FromMicroseconds(1));
  NativePan(PanGestureInput::PANGESTURE_MOMENTUMSTART, {0, 1000});
  EXPECT_FLOAT_EQ(15, apzc->GetOverscrollAmount().y);
  mcc->AdvanceByMillis(16);
  apzc->AdvanceAnimations(mcc->GetSampleTime());
  EXPECT_FLOAT_EQ(33, apzc->GetOverscrollAmount().y);
  apzc->AdvanceAnimationsUntilEnd();
  EXPECT_FALSE(apzc->IsOverscrolled());
}

TEST_F(ZenAPZArcElasticPhysics, ChromeHoldInterruptsReturnWithoutJumping) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  apzc->GetScrollMetadata().SetIsChromeDocument(true);
  NativePan(PanGestureInput::PANGESTURE_START, {0, -400});
  NativePan(PanGestureInput::PANGESTURE_END, {});
  mcc->AdvanceByMillis(40);
  apzc->AdvanceAnimations(mcc->GetSampleTime());
  const auto stretch = apzc->GetOverscrollAmount();
  NativePan(PanGestureInput::PANGESTURE_MAYSTART, {});
  mcc->AdvanceByMillis(200);
  apzc->AdvanceAnimations(mcc->GetSampleTime());
  EXPECT_EQ(stretch, apzc->GetOverscrollAmount());
  NativePan(PanGestureInput::PANGESTURE_CANCELLED, {});
  apzc->AdvanceAnimationsUntilEnd();
  EXPECT_FALSE(apzc->IsOverscrolled());
}

TEST_F(ZenAPZArcElasticPhysics, PageTouchDownKeepsReturnMoving) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  for (auto type : {PanGestureInput::PANGESTURE_MAYSTART,
                    PanGestureInput::PANGESTURE_START}) {
    NativePan(PanGestureInput::PANGESTURE_START, {0, -400});
    NativePan(PanGestureInput::PANGESTURE_END, {});
    mcc->AdvanceByMillis(40);
    apzc->AdvanceAnimations(mcc->GetSampleTime());
    const float before = apzc->GetOverscrollAmount().y;
    NativePan(type, {});
    mcc->AdvanceByMillis(40);
    apzc->AdvanceAnimations(mcc->GetSampleTime());
    EXPECT_GT(apzc->GetOverscrollAmount().y, before);
    NativePan(PanGestureInput::PANGESTURE_CANCELLED, {});
    apzc->AdvanceAnimationsUntilEnd();
    EXPECT_FALSE(apzc->IsOverscrolled());
  }
}

TEST_F(ZenAPZArcElasticPhysics, PageTouchDownWaitsForActualMovement) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  NativePan(PanGestureInput::PANGESTURE_START, {0, -400});
  NativePan(PanGestureInput::PANGESTURE_END, {});
  mcc->AdvanceByMillis(40);
  apzc->AdvanceAnimations(mcc->GetSampleTime());
  const float before = apzc->GetOverscrollAmount().y;
  NativePan(PanGestureInput::PANGESTURE_MAYSTART, {});
  NativePan(PanGestureInput::PANGESTURE_START, {});
  NativePan(PanGestureInput::PANGESTURE_PAN, {});
  mcc->AdvanceByMillis(40);
  apzc->AdvanceAnimations(mcc->GetSampleTime());
  EXPECT_GT(apzc->GetOverscrollAmount().y, before);
  NativePan(PanGestureInput::PANGESTURE_PAN, {0, 1});
  const auto held = apzc->GetOverscrollAmount();
  mcc->AdvanceByMillis(100);
  apzc->AdvanceAnimations(mcc->GetSampleTime());
  EXPECT_EQ(held, apzc->GetOverscrollAmount());
  Finish();
}

TEST_F(ZenAPZArcElasticPhysics, PageReleaseWithoutMovementKeepsReturnMoving) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  NativePan(PanGestureInput::PANGESTURE_START, {0, -400});
  NativePan(PanGestureInput::PANGESTURE_END, {});
  mcc->AdvanceByMillis(40);
  apzc->AdvanceAnimations(mcc->GetSampleTime());
  NativePan(PanGestureInput::PANGESTURE_START, {});
  NativePan(PanGestureInput::PANGESTURE_END, {});
  apzc->AdvanceAnimationsUntilEnd();
  EXPECT_FALSE(apzc->IsOverscrolled());
  // A following ordinary gesture must not retain the deferred state.
  NativePan(PanGestureInput::PANGESTURE_START, {0, 25});
  EXPECT_EQ(CSSPoint(0, 25), apzc->GetFrameMetrics().GetVisualScrollOffset());
  Finish();
}

TEST_F(ZenAPZArcElasticPhysics, OverscrollNoneRemainsStill) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  apzc->GetScrollMetadata().SetOverscrollBehavior(
      OverscrollBehaviorInfo::FromStyleConstants(
          StyleOverscrollBehavior::None, StyleOverscrollBehavior::None));
  NativePan(PanGestureInput::PANGESTURE_START, {0, -400});
  EXPECT_FALSE(apzc->IsOverscrolled());
  Finish();
}

TEST_F(ZenAPZArcElasticPhysics,
       VerticalScrollDoesNotStretchUnusedHorizontalAxis) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  SCOPED_GFX_PREF_INT("apz.axis_lock.mode", 0);
  NativePan(PanGestureInput::PANGESTURE_START, {40, 400});
  EXPECT_FALSE(apzc->IsOverscrolled());
  EXPECT_EQ(CSSPoint(0, 400), apzc->GetFrameMetrics().GetVisualScrollOffset());
  Finish();
}

#endif
