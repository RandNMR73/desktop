
#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
namespace cc { class ScrollElasticityHelper {}; }
namespace base {
class TimeDelta {
 public:
  explicit TimeDelta(int64_t micros):micros_(micros){}
  double InSecondsF() const { return micros_/1000000.0; }
 private: int64_t micros_;
};
}
namespace gfx {
class Vector2d {
 public:
  Vector2d(int a,int b):x_(a),y_(b){}
  int x() const{return x_;} int y() const{return y_;}
 private:int x_,y_;
};
class Vector2dF {
 public:
  Vector2dF(float a=0,float b=0):x_(a),y_(b){}
  float x() const{return x_;} float y() const{return y_;}
 private:float x_,y_;
};
inline Vector2dF operator+(Vector2dF a,Vector2dF b) { return {a.x()+b.x(),a.y()+b.y()}; }
inline Vector2dF ScaleVector2d(Vector2dF a,float f) { return {a.x()*f,a.y()*f}; }
}
namespace blink {
struct OverscrollEntry { gfx::Vector2dF momentum_animation_initial_stretch, momentum_animation_initial_velocity; };
class ElasticOverscrollController { public: explicit ElasticOverscrollController(cc::ScrollElasticityHelper*){} };
class ElasticOverscrollControllerExponential:public ElasticOverscrollController {
 public:
  explicit ElasticOverscrollControllerExponential(cc::ScrollElasticityHelper*);
  void DidEnterMomentumAnimatedState(OverscrollEntry&);
  gfx::Vector2d StretchAmountForTimeDelta(const OverscrollEntry&,const base::TimeDelta&) const;
  gfx::Vector2d StretchAmountForAccumulatedOverscroll(const OverscrollEntry&,const gfx::Vector2dF&) const;
  gfx::Vector2d AccumulatedOverscrollForStretchAmount(const OverscrollEntry&,const gfx::Vector2dF&) const;
};
}
