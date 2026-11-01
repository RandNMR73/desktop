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
// Floating chrome samples the same window field, including the grain origin.
// Keep the original entry point and fragment ABI compatible with older bundles.
vertex Vertex themeRegionVertex(uint index [[vertex_id]],
    constant float4 &region [[buffer(0)]]) {
  constexpr float2 xy[] = {{-1,1},{-1,-1},{1,1},{1,-1}};
  constexpr float2 uv[] = {{0,0},{0,1},{1,0},{1,1}};
  return {float4(xy[index],0,1), mix(region.xy, region.zw, uv[index])};
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
