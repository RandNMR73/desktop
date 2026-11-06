/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const UPDATE_HOVER_DELAY = 300;

// Arc 1.171.0 UpdateAvailableBanner: the hoveredSubject debounces 300ms
// (0x1025bbc1c). Entry uses response .35/damping .7; exit is immediate
// with response .2/damping .9 (0x1025bcee4, 0x1025bcde8).
export class UpdateBannerMotion {
  constructor(clock, spring, render, expanded) {
    Object.assign(this, { clock, spring, render, expanded });
    this.hovered = this.focused = this.open = false;
    this.value = 0;
  }
  hover(value) {
    this.hovered = value;
    this.clock.clearTimeout(this.timer);
    if (!value) this.setOpen(this.focused);
    else this.timer = this.clock.setTimeout(() => this.setOpen(this.hovered || this.focused), UPDATE_HOVER_DELAY);
  }
  focus(value) {
    this.focused = value;
    if (value) this.setOpen(true);
    else if (!this.hovered) this.setOpen(false);
  }
  setOpen(value) {
    if (this.open === value) return;
    this.open = value;
    this.expanded(value);
    this.clock.cancelAnimationFrame(this.frame);
    if (this.clock.reducedMotion()) {
      this.spring.active = false;
      this.spring.target = this.spring.base = Number(value);
      this.value = Number(value);
      this.render(this.value, false);
      return;
    }
    this.spring.stiffness = (2 * Math.PI / (value ? .35 : .2)) ** 2;
    this.spring.damping = 2 * Math.sqrt(this.spring.stiffness) * (value ? .7 : .9);
    this.spring.write(Number(value), this.clock.now() / 1000);
    const tick = () => {
      this.value = this.spring.sample(this.clock.now() / 1000);
      this.render(this.value, this.spring.active);
      this.frame = this.spring.active ? this.clock.requestAnimationFrame(tick) : null;
    };
    tick();
  }
  reset() {
    this.clock.clearTimeout(this.timer);
    this.clock.cancelAnimationFrame(this.frame);
    this.hovered = this.focused = this.open = false;
    this.spring.active = false;
    this.spring.target = this.spring.base = this.value = 0;
    this.expanded(false);
    this.render(0, false);
  }
}
