/* Modified median cut, adapted from ColorThiefSwift (MIT).
 * Copyright (c) 2019 Kazuki Ohara <kazuki.ohara@gmail.com>
 * https://github.com/yamoridon/ColorThiefSwift
 * Reference revision: ac04a95acca965f8030a01293c31621b2a812c39.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

#include <stdint.h>
#include <stdlib.h>

typedef struct {
  int low[3], high[3];
  int64_t count, volume;
} ZenColorBox;

static int zen_color_index(int r, int g, int b) { return (r << 10) | (g << 5) | b; }

static void zen_color_box_count(ZenColorBox *box, const int *histogram) {
  box->count = 0;
  box->volume = 1;
  for (int axis = 0; axis < 3; axis++) box->volume *= box->high[axis] - box->low[axis] + 1;
  for (int r = box->low[0]; r <= box->high[0]; r++)
    for (int g = box->low[1]; g <= box->high[1]; g++)
      for (int b = box->low[2]; b <= box->high[2]; b++)
        box->count += histogram[zen_color_index(r, g, b)];
}

static int zen_color_box_less(ZenColorBox a, ZenColorBox b, int product) {
  if (!product) return a.count < b.count;
  if (a.count == b.count) return a.volume < b.volume;
  return a.count * a.volume < b.count * b.volume;
}

static void zen_color_sort(ZenColorBox *boxes, int length, int product) {
  // Swift's stable sort preserves insertion order when the priorities tie.
  for (int i = 1; i < length; i++) {
    ZenColorBox value = boxes[i];
    int j = i;
    while (j > 0 && zen_color_box_less(value, boxes[j - 1], product)) {
      boxes[j] = boxes[j - 1];
      j--;
    }
    boxes[j] = value;
  }
}

static int zen_color_split(ZenColorBox box, ZenColorBox *first, ZenColorBox *second,
                           const int *histogram) {
  *first = box;
  if (box.count <= 1) return 1;
  int axis = 0;
  for (int i = 1; i < 3; i++)
    if (box.high[i] - box.low[i] > box.high[axis] - box.low[axis]) axis = i;
  int partial[32], ahead[32], slices[32] = {0};
  for (int i = 0; i < 32; i++) partial[i] = ahead[i] = -1;
  for (int r = box.low[0]; r <= box.high[0]; r++)
    for (int g = box.low[1]; g <= box.high[1]; g++)
      for (int b = box.low[2]; b <= box.high[2]; b++) {
        int channels[] = {r, g, b};
        slices[channels[axis]] += histogram[zen_color_index(r, g, b)];
      }
  int total = 0, low = box.low[axis], high = box.high[axis];
  for (int i = low; i <= high; i++) partial[i] = total += slices[i];
  for (int i = low; i <= high; i++) ahead[i] = total - partial[i];
  for (int i = low; i <= high; i++) {
    if (partial[i] <= total / 2) continue;
    int left = i - low, right = high - i;
    int cut = left <= right ? MIN(high - 1, i + right / 2)
      : MAX(low, (int)((double)(i - 1) - (double)left / 2));
    while (cut < 0 || (cut < 32 && partial[cut] <= 0)) cut++;
    if (cut >= 32) return 1;
    while (ahead[cut] == 0 && cut > 0 && partial[cut - 1] > 0) cut--;
    *second = box;
    first->high[axis] = cut;
    second->low[axis] = cut + 1;
    zen_color_box_count(first, histogram);
    zen_color_box_count(second, histogram);
    return 2;
  }
  return 1;
}

static void zen_color_iterate(ZenColorBox *boxes, int *length, int target, int product,
                             const int *histogram) {
  for (int iteration = 0; iteration < 1000; iteration++) {
    if (boxes[*length - 1].count) {
      ZenColorBox first, second;
      int count = zen_color_split(boxes[*length - 1], &first, &second, histogram);
      boxes[*length - 1] = first;
      if (count == 2) boxes[(*length)++] = second;
      zen_color_sort(boxes, *length, product);
      if (*length >= target) return;
    } else {
      zen_color_sort(boxes, *length, product);
    }
  }
}

static void zen_color_average(ZenColorBox box, const int *histogram, uint8_t *rgb) {
  int64_t sums[3] = {0};
  for (int r = box.low[0]; r <= box.high[0]; r++)
    for (int g = box.low[1]; g <= box.high[1]; g++)
      for (int b = box.low[2]; b <= box.high[2]; b++) {
        int count = histogram[zen_color_index(r, g, b)];
        sums[0] += count * (r * 8 + 4);
        sums[1] += count * (g * 8 + 4);
        sums[2] += count * (b * 8 + 4);
      }
  for (int i = 0; i < 3; i++) rgb[i] = box.count ? sums[i] / box.count
    : MIN(255, 4 * (box.low[i] + box.high[i] + 1));
}

// Arc's site-search path samples every tenth ABGR pixel and quantizes to five
// colors. Returning all colors also makes the independent reference testable.
static int zen_site_search_quantize(const uint8_t *abgr, size_t pixels, uint8_t colors[5][3]) {
  if (!abgr || !pixels || pixels > 1024 * 1024) return 0;
  int *histogram = calloc(32768, sizeof(int));
  if (!histogram) return 0;
  ZenColorBox boxes[5] = {{{31, 31, 31}, {0, 0, 0}, 0, 0}};
  int sampled = 0;
  for (size_t i = 0; i < pixels; i += 10) {
    const uint8_t *pixel = abgr + i * 4;
    if (pixel[0] < 125 || (pixel[1] > 250 && pixel[2] > 250 && pixel[3] > 250)) continue;
    int channels[] = {pixel[3] >> 3, pixel[2] >> 3, pixel[1] >> 3};
    for (int axis = 0; axis < 3; axis++) {
      boxes[0].low[axis] = MIN(boxes[0].low[axis], channels[axis]);
      boxes[0].high[axis] = MAX(boxes[0].high[axis], channels[axis]);
    }
    histogram[zen_color_index(channels[0], channels[1], channels[2])]++;
    sampled++;
  }
  if (!sampled) { free(histogram); return 0; }
  zen_color_box_count(boxes, histogram);
  int length = 1;
  zen_color_iterate(boxes, &length, 4, 0, histogram);
  zen_color_sort(boxes, length, 1);
  zen_color_iterate(boxes, &length, 5, 1, histogram);
  for (int i = 0; i < length; i++) zen_color_average(boxes[length - i - 1], histogram, colors[i]);
  free(histogram);
  return length;
}
