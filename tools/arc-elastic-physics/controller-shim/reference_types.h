#pragma once
#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdint>
#include <limits>
#include <map>
#include <memory>
#include <utility>

#define DCHECK(a) assert(a)
#define DCHECK_NE(a, b) assert((a) != (b))
#define PLATFORM_EXPORT
#define FRIEND_TEST_ALL_PREFIXES(a, b)
#define BUILDFLAG(a) a
#define IS_ANDROID 0
#define IS_WIN 0
template<class T> using raw_ptr = T*;

namespace base {
template<class K, class V> using flat_map = std::map<K, V>;
template<class C, class P> void EraseIf(C& c, P p) { std::erase_if(c, p); }
class TimeDelta {
 public:
  explicit TimeDelta(int64_t value = 0) : value_(value) {}
  double InSecondsF() const { return value_ / 1000000.0; }
  auto operator<=>(const TimeDelta&) const = default;
 private:
  int64_t value_;
};
class TimeTicks {
 public:
  explicit TimeTicks(int64_t value = 0) : value_(value) {}
  TimeDelta operator-(TimeTicks other) const { return TimeDelta(value_ - other.value_); }
 private:
  int64_t value_;
};
}

namespace gfx {
class Vector2d {
 public:
  Vector2d(int x = 0, int y = 0) : x_(x), y_(y) {}
  int x() const { return x_; }
  int y() const { return y_; }
 private:
  int x_, y_;
};
class Vector2dF {
 public:
  Vector2dF(float x = 0, float y = 0) : x_(x), y_(y) {}
  Vector2dF(Vector2d v) : x_(v.x()), y_(v.y()) {}
  float x() const { return x_; }
  float y() const { return y_; }
  void set_x(float x) { x_ = x; }
  void set_y(float y) { y_ = y; }
  bool IsZero() const { return x_ == 0 && y_ == 0; }
  Vector2dF operator+(Vector2dF v) const { return {x_ + v.x_, y_ + v.y_}; }
  Vector2dF operator-() const { return {-x_, -y_}; }
  Vector2dF& operator+=(Vector2dF v) { x_ += v.x_; y_ += v.y_; return *this; }
 private:
  float x_, y_;
};
using PointF = Vector2dF;
struct Size {};
inline Vector2dF ScaleVector2d(Vector2dF v, float f) { return {v.x() * f, v.y() * f}; }
inline int Rounded(float v) {
  const float r = std::floor(v + 0.5f);
  if (std::isnan(r)) return 0;
  if (r >= float(std::numeric_limits<int>::max())) return std::numeric_limits<int>::max();
  if (r <= float(std::numeric_limits<int>::min())) return std::numeric_limits<int>::min();
  return int(r);
}
inline Vector2d ToRoundedVector2d(Vector2dF v) { return {Rounded(v.x()), Rounded(v.y())}; }
}

namespace cc {
using ElementId = uint64_t;
struct OverscrollBehavior {
  bool x = true, y = true;
  bool HasXLocalBorderEffects() const { return x; }
  bool HasYLocalBorderEffects() const { return y; }
};
class ScrollElasticityHelper {
 public:
  virtual ~ScrollElasticityHelper() = default;
  virtual gfx::Vector2dF ConstrainOverscrollDelta(ElementId, const gfx::Vector2dF&) const = 0;
  virtual bool IsUserOverscrollable(ElementId) const = 0;
  virtual gfx::Vector2dF StretchAmount(ElementId) const = 0;
  virtual gfx::Size ScrollBounds(ElementId) const = 0;
  virtual void SetStretchAmount(ElementId, const gfx::Vector2dF&) = 0;
  virtual gfx::PointF ScrollOffset(ElementId) const = 0;
  virtual gfx::PointF MaxScrollOffset(ElementId) const = 0;
  virtual void ScrollBy(ElementId, const gfx::Vector2dF&) = 0;
  virtual void RequestOneBeginFrame() = 0;
  virtual void AnimationFinished(ElementId) = 0;
};
struct InputHandlerScrollResult {
  gfx::Vector2dF unused_scroll_delta;
  OverscrollBehavior overscroll_behavior;
};
}
namespace ui { enum class ScrollGranularity { kScrollByPrecisePixel }; }
namespace blink {
struct WebInputEvent {
  enum class Type { kGestureScrollBegin, kGestureScrollUpdate, kGestureScrollEnd };
};
struct WebGestureEvent {
  enum class InertialPhaseState { kMomentum, kNonMomentum };
  WebInputEvent::Type type = WebInputEvent::Type::kGestureScrollBegin;
  base::TimeTicks timestamp;
  struct {
    struct {
      bool synthetic = false;
      InertialPhaseState inertial_phase = InertialPhaseState::kNonMomentum;
      ui::ScrollGranularity delta_hint_units = ui::ScrollGranularity::kScrollByPrecisePixel;
    } scroll_begin;
    struct {
      float delta_x = 0, delta_y = 0;
      InertialPhaseState inertial_phase = InertialPhaseState::kNonMomentum;
    } scroll_update;
    struct { bool synthetic = false; } scroll_end;
  } data;
  base::TimeTicks TimeStamp() const { return timestamp; }
  WebInputEvent::Type GetType() const { return type; }
};
struct RuntimeEnabledFeatures {
  static inline bool useEventDelta = true;
  static bool ElasticOverscrollUseEventDeltaForAxisSelectionEnabled() { return useEventDelta; }
};
}
