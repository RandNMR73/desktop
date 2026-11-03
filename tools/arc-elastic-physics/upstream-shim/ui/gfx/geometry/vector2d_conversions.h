
#pragma once
#include <cmath>
#include <limits>
namespace gfx {
inline int FloorClamp(float v) {
 double n=std::floor(v);
 if(std::isnan(n))return 0;
 return static_cast<int>(std::clamp(n,double(std::numeric_limits<int>::min()),double(std::numeric_limits<int>::max())));
}
inline Vector2d ToRoundedVector2d(Vector2dF v) { return {FloorClamp(v.x()+.5f),FloorClamp(v.y()+.5f)}; }
}
