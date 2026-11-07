#!/usr/bin/env python3
"""Compile the patched Gecko swipe event loop against small widget/scheduler fakes.

Pass the patched Gecko source root. This executes the actual ProcessEvent and
consumer-config methods, not a reimplementation of their release decisions.
It does not replace a full Gecko build or a headed native-input test.
"""
import argparse
from pathlib import Path
import subprocess
import tempfile


def function(source, signature):
    start = source.index(signature)
    brace = source.index('{', start)
    depth = 1
    end = brace + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[start:end]


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('engine', type=Path)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[2]
tracker = (args.engine / 'widget/SwipeTracker.cpp').read_text()
overrides = (repo / 'src/zen/spaces/nsZenSwipeOverrides.cpp').read_text()
methods = [function(tracker, signature) for signature in (
    'double SwipeTracker::SwipeSuccessTargetValue()',
    'double SwipeTracker::SuccessThreshold()',
    'double SwipeTracker::ClampToAllowedRange(',
    'bool SwipeTracker::ComputeSwipeSuccess()',
    'nsEventStatus SwipeTracker::ProcessEvent(',
    'void SwipeTracker::CancelSwipe(',
)] + [function(overrides, signature) for signature in (
    'bool SwipeTracker::HasConsumerThreshold()',
    'double SwipeTracker::SuccessVelocityContribution()',
    'void SwipeTracker::ReadConsumerSwipeConfig(',
)]

shim = r'''
#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <functional>
#include <iostream>
#include <optional>
#include <vector>
namespace mozilla {
enum EventMessage { eSwipeGestureStart, eSwipeGestureUpdate, eSwipeGesture, eSwipeGestureEnd };
enum nsEventStatus { nsEventStatus_eIgnore, nsEventStatus_eConsumeNoDefault };
struct TimeStamp {
  double seconds = 0;
  TimeStamp operator-(TimeStamp other) const { return {seconds-other.seconds}; }
  double ToSeconds() const { return seconds; }
};
struct PanGestureInput {
  enum Type { PANGESTURE_MAYSTART, PANGESTURE_START, PANGESTURE_PAN, PANGESTURE_END } mType;
  enum Delta { PANDELTA_PIXEL, PANDELTA_PAGE } mDeltaType = PANDELTA_PIXEL;
  struct { double x = 0, y = 0; } mPanDisplacement;
  TimeStamp mTimeStamp;
};
struct WidgetSimpleGestureEvent {
  EventMessage mMessage;
  bool mSwipeConsumerHandlesRelease = false;
  double mSwipeSuccessThreshold = 0, mSwipeSuccessVelocityContribution = -1;
  double mSwipeProgressOffset = 0;
};
struct nsIWidget { double GetDefaultScaleInternal() { return 1; } };
template<class T> using nsCOMPtr = T*;
template<class T> T* do_QueryReferent(T* value) { return value; }
template<class T> struct RefPtr {
  T* ptr; RefPtr(T* value):ptr(value) {} T* operator->() const { return ptr; }
};
template<class T> struct Maybe {
  std::optional<T> value;
  bool isSome() const { return value.has_value(); }
  T valueOr(T fallback) const { return value.value_or(fallback); }
  Maybe& operator=(T next) { value=next; return *this; }
};
template<class T> T Some(T value) { return value; }
namespace dom { struct SimpleGestureEvent_Binding {
  static constexpr uint32_t DIRECTION_RIGHT=8, DIRECTION_LEFT=4;
}; }
namespace StaticPrefs {
double widget_swipe_velocity_twitch_tolerance() { return .0000001; }
double widget_swipe_success_velocity_contribution() { return .5; }
double widget_swipe_page_size() { return 1; }
double widget_swipe_pixel_size() { return 550; }
}
constexpr double kSwipeSuccessThreshold=.25;
std::vector<std::function<void()>> tasks;
template<class F> F NS_NewRunnableFunction(const char*, F body) { return body; }
template<class F> void NS_DispatchToMainThread(F body) { tasks.push_back(body); }
class SwipeTracker {
 public:
  nsIWidget widget;
  nsIWidget* mWidget=&widget;
  uint32_t mAllowedDirections=12, mSwipeDirection=4;
  bool mConsumerHandlesRelease=false;
  Maybe<double> mConsumerThreshold, mConsumerVelocityContribution;
  double mGestureAmount=0, mCurrentVelocity=0;
  bool mDeltaTypeIsPage=false, mEventsAreControllingSwipe=true;
  bool mEventsHaveStartedNewGesture=false, mLastComputedSwipeSuccess=false;
  TimeStamp mLastEventTimeStamp;
  struct Sent { EventMessage type; double delta, time; };
  std::vector<Sent> sent;
  std::function<void(WidgetSimpleGestureEvent&)> onEvent;
  int returns=0, finished=0, unregisters=0;
  bool SwipingInAllowedDirection() const { return mAllowedDirections & mSwipeDirection; }
  double SwipeSuccessTargetValue() const;
  double SuccessThreshold() const;
  double SuccessVelocityContribution() const;
  bool HasConsumerThreshold() const;
  void ReadConsumerSwipeConfig(const WidgetSimpleGestureEvent&);
  double ClampToAllowedRange(double) const;
  bool ComputeSwipeSuccess() const;
  nsEventStatus ProcessEvent(const PanGestureInput&, bool first=false);
  void CancelSwipe(const TimeStamp&);
  void StartAnimating(double, double) { returns++; }
  void UnregisterFromRefreshDriver() { unregisters++; }
  void SwipeFinished(const TimeStamp& time) { finished++; SendSwipeEvent(eSwipeGestureEnd,0,0,time); }
  void SendSwipeEvent(EventMessage type,uint32_t,double delta,const TimeStamp& time) {
    sent.push_back({type,delta,time.seconds});
    WidgetSimpleGestureEvent event{type};
    if(onEvent) onEvent(event);
    ReadConsumerSwipeConfig(event);
  }
  nsEventStatus pan(PanGestureInput::Type type,double delta,double time,bool first=false) {
    PanGestureInput event{}; event.mType=type; event.mPanDisplacement.x=-delta*550;
    event.mTimeStamp={time}; return ProcessEvent(event,first);
  }
  void start(bool owned,double amount) {
    onEvent=[owned](auto& event) { event.mSwipeConsumerHandlesRelease=owned; };
    SendSwipeEvent(eSwipeGestureStart,0,0,{0});
    pan(PanGestureInput::PANGESTURE_START,amount,0,true);
  }
};
'''
checks = r'''
void flush() { auto queued=std::move(tasks); tasks.clear(); for(auto& task:queued) task(); }
int count(const SwipeTracker& t,EventMessage type) {
  return std::count_if(t.sent.begin(),t.sent.end(),[type](auto e){return e.type==type;});
}
void close(double a,double b) { assert(std::abs(a-b)<1e-12); }
int mainChecks() {
  {
    SwipeTracker t; t.start(false,.1); t.pan(PanGestureInput::PANGESTURE_END,0,.1);
    assert(t.returns==1 && count(t,eSwipeGesture)==0 && tasks.empty());
    assert(count(t,eSwipeGestureUpdate)==2);
  }
  {
    SwipeTracker t; t.start(false,.5); t.pan(PanGestureInput::PANGESTURE_END,0,.1);
    assert(t.returns==0 && count(t,eSwipeGesture)==1 && t.finished==0);
    close(t.sent.back().delta,0); assert(count(t,eSwipeGestureUpdate)==2);
    flush(); assert(t.finished==1);
  }
  for(double amount:{-.3,0.,.001,.1,.5,1.4}) {
    SwipeTracker t; t.start(true,amount);
    t.pan(PanGestureInput::PANGESTURE_END,0,.08);
    assert(t.returns==0 && count(t,eSwipeGesture)==1 && t.finished==0);
    close(t.sent.back().delta,amount); close(t.sent.back().time,.08);
    assert(count(t,eSwipeGestureUpdate)==1 && tasks.size()==1);
    flush(); assert(t.finished==1 && count(t,eSwipeGestureEnd)==1);
    assert(t.pan(PanGestureInput::PANGESTURE_MAYSTART,0,.1)==nsEventStatus_eIgnore);
  }
  {
    SwipeTracker t; t.start(true,.1); t.pan(PanGestureInput::PANGESTURE_PAN,-.3,.03);
    t.pan(PanGestureInput::PANGESTURE_END,0,.04);
    close(t.sent.back().delta,-.2); assert(t.returns==0); flush();
  }
  {
    SwipeTracker t; t.start(true,.1);
    // End carries the release clock only, even if the platform supplies delta.
    t.pan(PanGestureInput::PANGESTURE_END,.2,.05);
    close(t.sent.back().delta,.1); assert(count(t,eSwipeGestureUpdate)==1); flush();
  }
  {
    SwipeTracker t; t.start(true,.1);
    t.onEvent=[](auto& event) {
      event.mSwipeConsumerHandlesRelease=false;
      event.mSwipeSuccessThreshold=.8; event.mSwipeSuccessVelocityContribution=0;
    };
    t.pan(PanGestureInput::PANGESTURE_PAN,.1,.02);
    t.pan(PanGestureInput::PANGESTURE_END,0,.03);
    assert(!t.mConsumerHandlesRelease && t.returns==1 && count(t,eSwipeGesture)==0);
  }
  {
    SwipeTracker t; t.start(true,.2); t.CancelSwipe({.04});
    assert(count(t,eSwipeGesture)==0 && count(t,eSwipeGestureEnd)==1 && tasks.empty());
  }
  for(double sign:{-1.,1.}) {
    SwipeTracker t; t.start(true,.6*sign);
    t.onEvent=[sign](auto& event) {
      event.mSwipeConsumerHandlesRelease=false;
      event.mSwipeProgressOffset=-.55*sign;
      event.mSwipeSuccessThreshold=.8; event.mSwipeSuccessVelocityContribution=0;
    };
    t.pan(PanGestureInput::PANGESTURE_PAN,0,.02);
    close(t.mGestureAmount,.05*sign);
    // An offset only applies when ownership changes. A duplicate config or
    // later return sample must not keep translating the native origin.
    t.pan(PanGestureInput::PANGESTURE_PAN,.02*sign,.03);
    close(t.mGestureAmount,.07*sign);
    t.pan(PanGestureInput::PANGESTURE_END,0,.04);
    assert(t.returns==1 && count(t,eSwipeGesture)==0);
    close(t.mGestureAmount,.07*sign);
  }
  {
    SwipeTracker t; t.start(true,.1);
    t.onEvent=[](auto& event) {
      event.mSwipeConsumerHandlesRelease=false;
      event.mSwipeProgressOffset=-1;
      event.mSwipeSuccessThreshold=.8; event.mSwipeSuccessVelocityContribution=0;
    };
    t.pan(PanGestureInput::PANGESTURE_PAN,0,.02);
    close(t.mGestureAmount,-.9);
    t.pan(PanGestureInput::PANGESTURE_END,0,.03);
    assert(t.returns==0 && count(t,eSwipeGesture)==1);
    assert(t.mSwipeDirection==dom::SimpleGestureEvent_Binding::DIRECTION_RIGHT);
    flush();
  }
  std::cout << "15 native release cases passed\n";
  return 0;
}
}
int main() { return mozilla::mainChecks(); }
'''
with tempfile.TemporaryDirectory(prefix='zen-swipe-release-') as temporary:
    directory = Path(temporary)
    source = directory / 'release.cpp'
    source.write_text(shim + '\n'.join(methods) + checks)
    executable = directory / 'release'
    subprocess.run(['c++', '-std=c++17', '-Wall', '-Wextra', '-Werror', str(source),
                    '-o', str(executable)], check=True)
    subprocess.run([str(executable)], check=True)
