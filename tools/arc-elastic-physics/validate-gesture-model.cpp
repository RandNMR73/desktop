#include "ArcElasticGestureModel.h"
#include "third_party/blink/renderer/platform/widget/input/elastic_overscroll_controller_exponential.h"

#include <cstdlib>
#include <iostream>
#include <random>
#include <string>

using Model = mozilla::layers::ArcElasticGestureModel;
using Vector = Model::Vector;

class Helper : public cc::ScrollElasticityHelper {
 public:
  Model::Bounds bounds;
  gfx::Vector2dF stretch;
  gfx::Vector2dF ConstrainOverscrollDelta(cc::ElementId,
                                         const gfx::Vector2dF& v) const override {
    return {bounds.userScrollableX ? v.x() : 0,
            bounds.userScrollableY ? v.y() : 0};
  }
  bool IsUserOverscrollable(cc::ElementId) const override { return bounds.overscrollable; }
  gfx::Vector2dF StretchAmount(cc::ElementId) const override { return stretch; }
  gfx::Size ScrollBounds(cc::ElementId) const override { return {}; }
  void SetStretchAmount(cc::ElementId, const gfx::Vector2dF& v) override { stretch = v; }
  gfx::PointF ScrollOffset(cc::ElementId) const override { return {bounds.offset.x, bounds.offset.y}; }
  gfx::PointF MaxScrollOffset(cc::ElementId) const override { return {bounds.maximum.x, bounds.maximum.y}; }
  void ScrollBy(cc::ElementId, const gfx::Vector2dF& v) override {
    bounds.offset.x += v.x();
    bounds.offset.y += v.y();
  }
  void RequestOneBeginFrame() override {}
  void AnimationFinished(cc::ElementId) override {}
};

class Fixture {
 public:
  Helper helper;
  Model model;
  blink::ElasticOverscrollControllerExponential oracle{&helper};
  int64_t time = 1000000;
  uint64_t checks = 0;
  std::string context;

  void CheckVector(Vector actual, gfx::Vector2dF expected, const char* field) {
    ++checks;
    if (actual.x != expected.x() || actual.y != expected.y()) {
      std::cerr << context << " " << field << " at " << time << ": actual "
                << actual.x << "," << actual.y << " expected "
                << expected.x() << "," << expected.y() << "\n";
      std::exit(1);
    }
  }
  void Check() {
    CheckVector(model.Stretch(), helper.stretch, "stretch");
    const auto* entry = oracle.GetEntry(1);
    int state = entry ? int(entry->state) : 0;
    ++checks;
    if (int(model.GetState()) != state) {
      std::cerr << context << " state " << int(model.GetState()) << " != " << state << "\n";
      std::exit(1);
    }
    if (entry) {
      CheckVector(model.Force(), entry->stretch_scroll_force, "force");
      CheckVector(model.Pending(), entry->pending_overscroll_delta, "pending");
      CheckVector(model.Velocity(), entry->scroll_velocity, "velocity");
      if (state == 3) {
        CheckVector(model.InitialVelocity(), entry->momentum_animation_initial_velocity, "initial velocity");
      }
    }
  }
  void Begin(bool momentum = false) {
    blink::WebGestureEvent event;
    event.data.scroll_begin.inertial_phase = momentum
        ? blink::WebGestureEvent::InertialPhaseState::kMomentum
        : blink::WebGestureEvent::InertialPhaseState::kNonMomentum;
    oracle.ObserveGestureEventAndResult(1, event, {});
    model.Begin(momentum);
    Check();
  }
  void Update(Vector eventDelta, Vector unusedDelta, bool momentum = false,
              Model::Behavior behavior = {}, bool eventAxis = true) {
    blink::RuntimeEnabledFeatures::useEventDelta = eventAxis;
    blink::WebGestureEvent event;
    event.type = blink::WebInputEvent::Type::kGestureScrollUpdate;
    event.timestamp = base::TimeTicks(time);
    event.data.scroll_update.delta_x = -eventDelta.x;
    event.data.scroll_update.delta_y = -eventDelta.y;
    event.data.scroll_update.inertial_phase = momentum
        ? blink::WebGestureEvent::InertialPhaseState::kMomentum
        : blink::WebGestureEvent::InertialPhaseState::kNonMomentum;
    cc::InputHandlerScrollResult result;
    result.unused_scroll_delta = {unusedDelta.x, unusedDelta.y};
    result.overscroll_behavior = {behavior.x, behavior.y};
    oracle.ObserveGestureEventAndResult(1, event, result);
    model.Update(eventDelta, unusedDelta, time, momentum, helper.bounds, behavior, eventAxis);
    Check();
  }
  void End() {
    blink::WebGestureEvent event;
    event.type = blink::WebInputEvent::Type::kGestureScrollEnd;
    event.timestamp = base::TimeTicks(time);
    oracle.ObserveGestureEventAndResult(1, event, {});
    model.End(time, helper.bounds);
    Check();
  }
  void Sample() {
    oracle.Animate(base::TimeTicks(time));
    model.Sample(time);
    Check();
  }
  void Reconcile() {
    const auto old = helper.bounds;
    const Vector correction = model.Reconcile(old);
    oracle.ReconcileStretchAndScroll();
    CheckVector({old.offset.x + correction.x, old.offset.y + correction.y},
                helper.ScrollOffset(1), "reconcile offset");
    Check();
  }
};

int main() {
  uint64_t checks = 0;
  for (float maximum : {0.0f, 2000.0f}) {
    for (float direction : {-1.0f, 1.0f}) {
      Fixture f;
      f.context = "drag, release, catch, reverse";
      f.helper.bounds.maximum = {0, maximum};
      f.helper.bounds.offset = {0, direction < 0 ? 0 : maximum};
      f.Begin();
      for (float delta : {3.0f, 3.0f, 4.0f, 20.0f, 90.0f, 400.0f}) {
        f.time += 8000;
        f.Update({0, delta * direction}, {0, delta * direction});
      }
      f.time += 8000;
      f.End();
      f.time += 40000;
      f.Sample();
      f.Begin();
      f.helper.bounds.offset.y -= direction * 5;
      f.Reconcile();
      f.time += 8000;
      f.Update({0, -10 * direction}, {});
      f.End();
      for (int frame = 0; frame != 120; ++frame) {
        f.time += 16667;
        f.Sample();
      }
      checks += f.checks;
    }
  }

  std::mt19937 random(0x415243);
  const int64_t intervals[] = {0, 1, 500, 8000, 16667, 99999, 100000, 200000};
  const float deltas[] = {-400, -40, -10, -9.5f, -1, 0, 1, 9.5f, 10, 40, 400};
  for (int sequence = 0; sequence != 2000; ++sequence) {
    Fixture f;
    f.helper.bounds.maximum = {sequence % 3 ? 800.0f : 0, sequence % 2 ? 1600.0f : 0};
    f.helper.bounds.offset = {sequence % 5 ? 0 : f.helper.bounds.maximum.x,
                              sequence % 7 ? 0 : f.helper.bounds.maximum.y};
    f.helper.bounds.userScrollableX = sequence % 11 != 0;
    f.helper.bounds.userScrollableY = sequence % 13 != 0;
    f.helper.bounds.overscrollable = sequence % 17 != 0;
    for (int step = 0; step != 256; ++step) {
      f.context = "sequence " + std::to_string(sequence) + " step " + std::to_string(step);
      f.time += intervals[random() % std::size(intervals)];
      const int operation = random() % 20;
      if (operation == 0) {
        f.Begin();
      } else if (operation == 1) {
        f.Begin(true);
      } else if (operation == 2) {
        f.End();
      } else if (operation <= 5) {
        f.Sample();
      } else if (operation == 6) {
        f.helper.bounds.offset.x = float(random() % 801);
        f.helper.bounds.offset.y = float(random() % 1601);
        f.Reconcile();
      } else {
        Vector delta{deltas[random() % std::size(deltas)], deltas[random() % std::size(deltas)]};
        Vector unused = delta;
        if (random() % 3 == 0) unused.x = 0;
        if (random() % 3 == 0) unused.y = 0;
        f.Update(delta, unused, sequence % 3 == 0,
                 {sequence % 19 != 0, sequence % 23 != 0}, sequence % 2 == 0);
      }
    }
    checks += f.checks;
  }
  std::cout << "{\"passed\":true,\"checks\":" << checks
            << ",\"seededSequences\":2000,\"eventsPerSequence\":256,"
               "\"oracle\":\"unchanged pinned Chromium controller and exponential implementation\","
               "\"engineIntegrated\":false,\"physicalTrackpadVerified\":false}\n";
}
