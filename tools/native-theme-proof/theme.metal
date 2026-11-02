/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

#include <metal_stdlib>
using namespace metal;
struct Vertex { float4 position [[position]]; float2 uv; };
struct Parameters { float axis; float grain; float2 repeats; };
vertex Vertex themeVertex(uint index [[vertex_id]]) {
  constexpr float2 xy[] = {{-1,1},{-1,-1},{1,1},{1,-1}};
  constexpr float2 uv[] = {{0,0},{0,1},{1,0},{1,1}};
  return {float4(xy[index],0,1),uv[index]};
}
fragment float4 themeFragment(Vertex input [[stage_in]],
    texture2d<float> field [[texture(0)]], texture2d<float> grain [[texture(1)]],
    constant Parameters &p [[buffer(0)]]) {
  constexpr sampler fieldSampler(coord::normalized, address::clamp_to_edge, filter::linear);
  constexpr sampler grainSampler(coord::normalized, address::repeat, filter::linear);
  float t = p.axis * input.uv.x + (1-p.axis) * input.uv.y;
  float4 base = field.sample(fieldSampler, float2(t,input.uv.y));
  if (p.grain <= 0) return base;
  float3 noise = grain.sample(grainSampler,input.uv*p.repeats).rgb;
  float4 over = float4(noise,1)*p.grain;
  // Multiply two premultiplied layers before compositing on native material.
  return over*(1-base.a+base)+(1-over.a)*base;
}

struct DynamicThemeParameters { float4 base0, base1, overlay, settings; };
float3 themeLinearFromOKLab(float3 lab) {
  float3 lms = float3(lab.x + .3963377774*lab.y + .2158037573*lab.z,
    lab.x - .1055613458*lab.y - .0638541728*lab.z,
    lab.x - .0894841775*lab.y - 1.2914855480*lab.z);
  lms = lms*lms*lms;
  return float3(4.0767416621*lms.x - 3.3077115913*lms.y + .2309699292*lms.z,
    -1.2684380046*lms.x + 2.6097574011*lms.y - .3413193965*lms.z,
    -.0041960863*lms.x - .7034186147*lms.y + 1.7076147010*lms.z);
}
float3 themeEncode(float3 linear) {
  float3 a = abs(linear);
  return sign(linear) * select(1.055*pow(a, float3(1./2.4))-.055, a*12.92, a <= .0031308);
}
fragment float4 themeDynamicFragment(Vertex input [[stage_in]], texture2d<float> grain [[texture(1)]],
    constant Parameters &p [[buffer(0)]], constant DynamicThemeParameters &d [[buffer(1)]]) {
  float t = p.axis*input.uv.x + (1-p.axis)*input.uv.y;
  float3 rgb = themeLinearFromOKLab(mix(d.base0.xyz, d.base1.xyz, clamp(t*4/3, 0., 1.)));
  float alpha = d.settings.x;
  if (d.settings.w > 0) {
    float overlayAlpha = input.uv.y * d.settings.x;
    float combined = overlayAlpha + (1-overlayAlpha)*alpha;
    rgb = (themeLinearFromOKLab(d.overlay.xyz)*overlayAlpha + rgb*alpha*(1-overlayAlpha))/combined;
    alpha = combined;
  }
  float3 encoded = themeEncode(rgb);
  float under = d.settings.y*(1-alpha);
  float4 base = float4(d.settings.z*under + encoded*alpha, under+alpha);
  if (p.grain <= 0) return base;
  constexpr sampler grainSampler(coord::normalized, address::repeat, filter::linear);
  float4 over = float4(grain.sample(grainSampler,input.uv*p.repeats).rgb,1)*p.grain;
  return over*(1-base.a+base)+(1-over.a)*base;
}
