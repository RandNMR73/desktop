#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

"""Compile the actual Gecko routing function before/after the backport.

This isolates routing from the compositor. It is not a substitute for the
registered APZ gtests, an engine build, or physical trackpad verification.
Pass the unmodified Firefox 158.0.1 source file with --source.
"""

import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]
PATCH = ROOT / "src/gfx/layers/apz/src/OverscrollHandoffState-cpp.patch"
TEST = ROOT / "src/gfx/layers/apz/test/gtest/TestZenOverscrollHandoff.cpp"

PRELUDE = r"""
#include <cassert>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <vector>
#define MOZ_ASSERT assert
enum class ScrollDirection : uint8_t { eHorizontal=1, eVertical=2 };
struct ScrollDirections {
  uint8_t bits=0;
  constexpr ScrollDirections()=default;
  constexpr ScrollDirections(ScrollDirection a):bits(uint8_t(a)){}
  constexpr ScrollDirections(ScrollDirection a,ScrollDirection b):bits(uint8_t(a)|uint8_t(b)){}
  bool isEmpty() const {return !bits;}
  bool operator==(ScrollDirections b) const {return bits==b.bits;}
  ScrollDirections& operator+=(ScrollDirection d){bits|=uint8_t(d);return *this;}
  ScrollDirections& operator-=(ScrollDirection d){bits&=~uint8_t(d);return *this;}
  ScrollDirections& operator&=(ScrollDirections d){bits&=d.bits;return *this;}
  ScrollDirections operator&(ScrollDirections d) const {auto r=*this;return r&=d;}
};
constexpr ScrollDirections EitherScrollDirection(ScrollDirection::eVertical,ScrollDirection::eHorizontal);
enum class StyleOverscrollBehavior {Auto,Contain,Chain,None};
enum InputType {PANGESTURE_INPUT,WHEEL_INPUT};
struct ParentLayerPoint {float x=0,y=0;};
struct InputData {InputType mInputType=PANGESTURE_INPUT;ParentLayerPoint delta={0,10};};
namespace StaticPrefs {bool enabled=true;bool apz_overscroll_enabled(){return enabled;}}
template<class T> using RefPtr=T*;
template<class T,size_t N> struct AutoTArray:std::vector<T> {
  void AppendElement(T v){this->push_back(v);}size_t Length()const{return this->size();}
};
"""

SUPPORT = r"""
struct AsyncPanZoomController {
  FrameState x=ObAuto(kNoRange),y=ObAuto(kNoRange);bool root=false;
  bool CanScroll(const InputData& e)const {
    return (e.delta.x && x.mScrollability==kRoom)||(e.delta.y && y.mScrollability==kRoom);
  }
  ScrollDirections GetAllowedHandoffDirections()const {
    ScrollDirections d;
    if(x.mBehavior==StyleOverscrollBehavior::Auto||x.mBehavior==StyleOverscrollBehavior::Chain)d+=ScrollDirection::eHorizontal;
    if(y.mBehavior==StyleOverscrollBehavior::Auto||y.mBehavior==StyleOverscrollBehavior::Chain)d+=ScrollDirection::eVertical;
    return d;
  }
  ScrollDirections GetOverscrollableDirections()const {
    ScrollDirections d;
    if(x.mScrollability!=kNoRange&&(x.mBehavior==StyleOverscrollBehavior::Auto||x.mBehavior==StyleOverscrollBehavior::Contain))d+=ScrollDirection::eHorizontal;
    if(y.mScrollability!=kNoRange&&(y.mBehavior==StyleOverscrollBehavior::Auto||y.mBehavior==StyleOverscrollBehavior::Contain))d+=ScrollDirection::eVertical;
    return d;
  }
  ParentLayerPoint GetDeltaForEvent(const InputData& e)const{return e.delta;}
  bool IsRootContent()const{return root;}
  bool IsZero(float f)const{return std::abs(f)<0.01f;}
};
struct OverscrollHandoffChain {
  std::vector<AsyncPanZoomController*> mChain;
  enum class IncludeOverscroll:bool{No,Yes};
  size_t Length()const{return mChain.size();}
  RefPtr<AsyncPanZoomController> FindFirstScrollable(const InputData&,ScrollDirections*,IncludeOverscroll)const;
};
"""

MAIN = r"""
int main(){
  unsigned checks=0,failures=0;
  auto check=[&](bool ok){++checks;if(!ok)++failures;};
  for(const auto& row:kTestCases){
    AsyncPanZoomController inner{row.mInner,row.mInner},middle{row.mMiddle,row.mMiddle},root{row.mRoot,row.mRoot,true};
    OverscrollHandoffChain chain{{&inner,&middle,&root}};
    for(bool include:{false,true}){
      auto expected=include?row.mWithOverscroll:row.mWithoutOverscroll;
      auto wanted=expected.mTarget==ExpectedTarget::Inner?&inner:expected.mTarget==ExpectedTarget::Middle?&middle:expected.mTarget==ExpectedTarget::Root?&root:nullptr;
      ScrollDirections dirs;
      auto actual=chain.FindFirstScrollable({},&dirs,include?OverscrollHandoffChain::IncludeOverscroll::Yes:OverscrollHandoffChain::IncludeOverscroll::No);
      check(actual==wanted);check(dirs==expected.mDirections);
    }
  }
  // Chrome/sidebar root is not a root-content APZC. At a boundary the
  // scrollable sidebar must still be a target, including a new gesture.
  AsyncPanZoomController sidebar{ObNone(kNoRange),ObAuto(kAtEnd)},chromeRoot;
  OverscrollHandoffChain sidebarChain{{&sidebar,&chromeRoot}};
  ScrollDirections dirs;
  check(sidebarChain.FindFirstScrollable({},&dirs,OverscrollHandoffChain::IncludeOverscroll::Yes)==&sidebar);
  check(dirs==EitherScrollDirection);
  // A page cannot suppress an independently scrollable child's local effect.
  chromeRoot.y=ObNone(kAtEnd);chromeRoot.root=true;
  check(sidebarChain.FindFirstScrollable({},&dirs,OverscrollHandoffChain::IncludeOverscroll::Yes)==&sidebar);
  check(dirs==EitherScrollDirection);
  // Wheel input, zero-delta pan and the explicit swipe-probe opt-out must
  // retain their existing non-overscroll behavior.
  check(sidebarChain.FindFirstScrollable({WHEEL_INPUT,{0,10}},&dirs,OverscrollHandoffChain::IncludeOverscroll::Yes)==nullptr);
  check(dirs==EitherScrollDirection);
  check(sidebarChain.FindFirstScrollable({PANGESTURE_INPUT,{0,0}},&dirs,OverscrollHandoffChain::IncludeOverscroll::Yes)==nullptr);
  check(dirs==EitherScrollDirection);
  check(sidebarChain.FindFirstScrollable({},&dirs,OverscrollHandoffChain::IncludeOverscroll::No)==nullptr);
  check(dirs==EitherScrollDirection);
  StaticPrefs::enabled=false;
  check(sidebarChain.FindFirstScrollable({},&dirs,OverscrollHandoffChain::IncludeOverscroll::Yes)==nullptr);
  check(dirs==EitherScrollDirection);
  std::cout<<"{\"checks\":"<<checks<<",\"failures\":"<<failures<<"}\n";
}
"""


def function(source):
    start = source.index("RefPtr<AsyncPanZoomController> OverscrollHandoffChain::FindFirstScrollable(")
    end = source.index("\nstd::tuple<bool, const AsyncPanZoomController*>", start)
    return source[start:end]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()
    original = args.source.read_text()
    test = TEST.read_text()
    table = test[test.index("enum class Scrollability"):test.index("static const char* Describe")]
    with tempfile.TemporaryDirectory(prefix="zen-overscroll-routing-") as tmp:
        tmp = Path(tmp)
        source = tmp / "gfx/layers/apz/src/OverscrollHandoffState.cpp"
        source.parent.mkdir(parents=True)
        source.write_text(original)
        subprocess.run(["git", "apply", "--no-index", str(PATCH)], cwd=tmp, check=True)
        report = {}
        for name, text in [("before", original), ("after", source.read_text())]:
            program = tmp / f"{name}.cpp"
            program.write_text(PRELUDE + table + SUPPORT + function(text) + MAIN)
            binary = tmp / name
            subprocess.run([os.environ.get("CXX", "c++"), "-std=c++17", "-Wall", "-Wextra", "-Werror", str(program), "-o", str(binary)], check=True)
            report[name] = json.loads(subprocess.check_output([str(binary)], text=True))
        assert report["before"]["failures"] > 0, "baseline must reproduce the regression"
        assert report["after"]["failures"] == 0, report
        report["scope"] = "Compiled actual routing function; mock controller state. Full APZ gtests and physical trackpad validation remain separate."
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
