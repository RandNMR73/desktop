/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "APZCBasicTester.h"
#include "APZCTreeManagerTester.h"
#include "InputUtils.h"
#include "apz/src/OverscrollHandoffState.h"

#ifndef MOZ_WIDGET_ANDROID

class ZenAPZZeroRangeOverscroll : public APZCBasicTester {
 protected:
  void SetUp() override {
    APZCBasicTester::SetUp();
    auto& metrics = apzc->GetFrameMetrics();
    metrics.SetCompositionBounds(ParentLayerRect(0, 0, 100, 100));
    metrics.SetScrollableRect(CSSRect(0, 0, 100, 100));
    metrics.SetVisualScrollOffset(CSSPoint(0, 0));
    apzc->GetScrollMetadata().SetLineScrollAmount(LayoutDeviceIntSize(5, 10));
    apzc->GetScrollMetadata().SetPageScrollAmount(LayoutDeviceIntSize(50, 100));
    SetOverflow(StyleOverflow::Auto);
  }

  void SetOverflow(StyleOverflow aOverflow) {
    OverflowInfo overflow;
    overflow.mOverflowX = aOverflow;
    overflow.mOverflowY = aOverflow;
    apzc->GetScrollMetadata().SetOverflow(overflow);
  }

  void BeginPan(ScreenPoint aDelta) {
    PanGesture(PanGestureInput::PANGESTURE_START, apzc, ScreenIntPoint(50, 50),
               aDelta, mcc->Time());
  }

  void EndPanAndRecover() {
    PanGesture(PanGestureInput::PANGESTURE_END, apzc, ScreenIntPoint(50, 50),
               ScreenPoint(0, 0), mcc->Time());
    apzc->AdvanceAnimationsUntilEnd();
    EXPECT_FALSE(apzc->IsOverscrolled());
    EXPECT_EQ(CSSPoint(0, 0), apzc->GetFrameMetrics().GetVisualScrollOffset());
  }
};

TEST_F(ZenAPZZeroRangeOverscroll, VerticalBothBoundaries) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  EXPECT_FALSE(apzc->CanScroll(ParentLayerPoint(0, -80)));
  BeginPan(ScreenPoint(0, -80));
  EXPECT_LT(apzc->GetOverscrollAmount().y, 0);
  EXPECT_NE(
      0, apzc->GetOverscrollTransform(AsyncPanZoomController::eForEventHandling)
             ._42);
  EndPanAndRecover();
  BeginPan(ScreenPoint(0, 80));
  EXPECT_GT(apzc->GetOverscrollAmount().y, 0);
  EndPanAndRecover();
}

TEST_F(ZenAPZZeroRangeOverscroll, HorizontalBothBoundaries) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  BeginPan(ScreenPoint(-80, 0));
  EXPECT_LT(apzc->GetOverscrollAmount().x, 0);
  EXPECT_NE(
      0, apzc->GetOverscrollTransform(AsyncPanZoomController::eForEventHandling)
             ._41);
  EndPanAndRecover();
  BeginPan(ScreenPoint(80, 0));
  EXPECT_GT(apzc->GetOverscrollAmount().x, 0);
  EndPanAndRecover();
}

TEST_F(ZenAPZZeroRangeOverscroll, OverflowAutoChromeList) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  apzc->GetFrameMetrics().SetIsRootContent(false);
  BeginPan(ScreenPoint(0, -80));
  EXPECT_TRUE(apzc->IsOverscrolled());
  EndPanAndRecover();
}

TEST_F(ZenAPZZeroRangeOverscroll, VisibleChromeRootStaysStill) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  apzc->GetFrameMetrics().SetIsRootContent(false);
  SetOverflow(StyleOverflow::Visible);
  BeginPan(ScreenPoint(0, -80));
  EXPECT_FALSE(apzc->IsOverscrolled());
  EndPanAndRecover();
}

TEST_F(ZenAPZZeroRangeOverscroll, VisiblePageRootCanBounce) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  SetOverflow(StyleOverflow::Visible);
  BeginPan(ScreenPoint(0, -80));
  EXPECT_TRUE(apzc->IsOverscrolled());
  EndPanAndRecover();
}

TEST_F(ZenAPZZeroRangeOverscroll, HiddenOverflowStaysStill) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  SetOverflow(StyleOverflow::Hidden);
  BeginPan(ScreenPoint(0, -80));
  EXPECT_FALSE(apzc->IsOverscrolled());
  EndPanAndRecover();
}

TEST_F(ZenAPZZeroRangeOverscroll, ClippedOverflowStaysStill) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  SetOverflow(StyleOverflow::Clip);
  BeginPan(ScreenPoint(0, -80));
  EXPECT_FALSE(apzc->IsOverscrolled());
  EndPanAndRecover();
}

TEST_F(ZenAPZZeroRangeOverscroll, OverscrollNoneStaysStill) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  apzc->GetScrollMetadata().SetOverscrollBehavior(
      OverscrollBehaviorInfo::FromStyleConstants(
          StyleOverscrollBehavior::None, StyleOverscrollBehavior::None));
  BeginPan(ScreenPoint(0, -80));
  EXPECT_FALSE(apzc->IsOverscrolled());
  EndPanAndRecover();
}

TEST_F(ZenAPZZeroRangeOverscroll, FeatureDisabledPreservesOriginalBehavior) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", false);
  BeginPan(ScreenPoint(0, -80));
  EXPECT_FALSE(apzc->IsOverscrolled());
  EndPanAndRecover();
}

TEST_F(ZenAPZZeroRangeOverscroll, OverscrollDisabledStaysStill) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", false);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  BeginPan(ScreenPoint(0, -80));
  EXPECT_FALSE(apzc->IsOverscrolled());
  EndPanAndRecover();
}

TEST_F(ZenAPZZeroRangeOverscroll, MouseWheelDoesNotBounce) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  Wheel(apzc, ScreenIntPoint(50, 50), ScreenPoint(0, -80), mcc->Time());
  EXPECT_FALSE(apzc->IsOverscrolled());
}

TEST_F(ZenAPZZeroRangeOverscroll, PanReversalClearsPreviousEdge) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  BeginPan(ScreenPoint(0, -80));
  EXPECT_LT(apzc->GetOverscrollAmount().y, 0);
  mcc->AdvanceByMillis(16);
  PanGesture(PanGestureInput::PANGESTURE_PAN, apzc, ScreenIntPoint(50, 50),
             ScreenPoint(0, 80), mcc->Time());
  EXPECT_GT(apzc->GetOverscrollAmount().y, 0);
  EndPanAndRecover();
}

TEST_F(ZenAPZZeroRangeOverscroll, ZeroSizeViewportStaysStill) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  apzc->GetFrameMetrics().SetCompositionBounds(ParentLayerRect());
  apzc->GetFrameMetrics().SetScrollableRect(CSSRect());
  EXPECT_TRUE(apzc->GetOverscrollableDirections().isEmpty());
}

class ZenAPZZeroRangeHandoff : public APZCTreeManagerTester {
 protected:
  UniquePtr<ScopedLayerTreeRegistration> registration;
  TestAsyncPanZoomController* mInner = nullptr;
  TestAsyncPanZoomController* mRoot = nullptr;

  void CreateChain() {
    LayerIntRect rects[] = {LayerIntRect(0, 0, 100, 100),
                            LayerIntRect(0, 0, 100, 100)};
    CreateScrollData("x(x)", rects);
    SetScrollableFrameMetrics(root, ScrollableLayerGuid::START_SCROLL_ID,
                              CSSRect(0, 0, 100, 100));
    SetScrollableFrameMetrics(layers[1],
                              ScrollableLayerGuid::START_SCROLL_ID + 1,
                              CSSRect(0, 0, 100, 100));
    SetScrollHandoff(layers[1], root);
    registration =
        std::make_unique<ScopedLayerTreeRegistration>(LayersId{0}, mcc);
    UpdateHitTestingTree();
    mRoot = ApzcOf(root);
    mInner = ApzcOf(layers[1]);
    mRoot->GetFrameMetrics().SetIsRootContent(true);
    for (auto* controller : {mRoot, mInner}) {
      OverflowInfo overflow;
      overflow.mOverflowX = StyleOverflow::Auto;
      overflow.mOverflowY = StyleOverflow::Auto;
      controller->GetScrollMetadata().SetOverflow(overflow);
    }
  }

  void SetInnerBehavior(StyleOverscrollBehavior aBehavior) {
    mInner->GetScrollMetadata().SetOverscrollBehavior(
        OverscrollBehaviorInfo::FromStyleConstants(aBehavior, aBehavior));
  }

  RefPtr<AsyncPanZoomController> Target(
      OverscrollHandoffChain::IncludeOverscroll aInclude =
          OverscrollHandoffChain::IncludeOverscroll::Yes) {
    PanGestureInput input(PanGestureInput::PANGESTURE_PAN, mcc->Time(),
                          ScreenPoint(50, 50), ScreenPoint(0, 10),
                          MODIFIER_NONE);
    ScrollDirections directions;
    return mInner->BuildOverscrollHandoffChain()->FindFirstScrollable(
        input, &directions, aInclude);
  }
};

TEST_F(ZenAPZZeroRangeHandoff, EmptyPageRootReceivesBoundaryGesture) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  CreateChain();
  EXPECT_EQ(mRoot, Target().get());
}

TEST_F(ZenAPZZeroRangeHandoff, ScrollableParentMovesBeforeChildBounces) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  CreateChain();
  mRoot->GetFrameMetrics().SetScrollableRect(CSSRect(0, 0, 100, 200));
  EXPECT_EQ(mRoot, Target().get());
}

TEST_F(ZenAPZZeroRangeHandoff, ContainmentKeepsBounceOnEmptyChild) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  CreateChain();
  SetInnerBehavior(StyleOverscrollBehavior::Contain);
  EXPECT_EQ(mInner, Target().get());
}

TEST_F(ZenAPZZeroRangeHandoff, NoneBlocksBounceAndParentHandoff) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  CreateChain();
  SetInnerBehavior(StyleOverscrollBehavior::None);
  EXPECT_EQ(nullptr, Target().get());
}

TEST_F(ZenAPZZeroRangeHandoff, HistorySwipeQueryStillHasNoScrollableTarget) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  CreateChain();
  EXPECT_EQ(nullptr,
            Target(OverscrollHandoffChain::IncludeOverscroll::No).get());
}

TEST_F(ZenAPZZeroRangeHandoff, EmptySidebarBouncesWithoutMovingChromeRoot) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  CreateChain();
  mRoot->GetFrameMetrics().SetIsRootContent(false);
  OverflowInfo overflow;
  overflow.mOverflowX = StyleOverflow::Visible;
  overflow.mOverflowY = StyleOverflow::Visible;
  mRoot->GetScrollMetadata().SetOverflow(overflow);
  EXPECT_TRUE(mRoot->GetOverscrollableDirections().isEmpty());
  EXPECT_EQ(mInner, Target().get());
}

TEST_F(ZenAPZZeroRangeHandoff, PageTouchDownDoesNotFreezeReturningAncestor) {
  SCOPED_GFX_PREF_BOOL("apz.overscroll.enabled", true);
  SCOPED_GFX_PREF_BOOL("apz.overscroll.zero_range.enabled", true);
  CreateChain();
  const TimeStamp origin = mcc->Time();
  const auto nativePan = [&](PanGestureInput::PanGestureType aType,
                             ScreenPoint aDelta) {
    PanGestureInput input(aType, mcc->Time(), ScreenPoint(50, 50), aDelta,
                          MODIFIER_NONE);
    input.mHandledByAPZ = true;
    input.mNativePanDisplacement = aDelta;
    input.mNativeBackingScale = 1;
    input.mNativeEventTimeUs =
        1000000 + int64_t((mcc->Time() - origin).ToMicroseconds());
    mInner->ReceiveInputEvent(input);
  };
  nativePan(PanGestureInput::PANGESTURE_START, {0, -400});
  nativePan(PanGestureInput::PANGESTURE_END, {});
  mcc->AdvanceByMillis(40);
  mRoot->AdvanceAnimations(mcc->GetSampleTime());
  ASSERT_TRUE(mRoot->IsOverscrolled());
  ASSERT_FALSE(mInner->IsOverscrolled());
  const float before = mRoot->GetOverscrollAmount().y;
  nativePan(PanGestureInput::PANGESTURE_MAYSTART, {});
  mcc->AdvanceByMillis(40);
  mRoot->AdvanceAnimations(mcc->GetSampleTime());
  EXPECT_GT(mRoot->GetOverscrollAmount().y, before);
  nativePan(PanGestureInput::PANGESTURE_CANCELLED, {});
  mRoot->AdvanceAnimationsUntilEnd();
  EXPECT_FALSE(mRoot->IsOverscrolled());
}

#endif
