const paints = [
  ["stroke", "color(display-p3 1 0.30196078431372547 0)"],
  ["stroke", "rgb(237 51 179)"],
  ["stroke", "color(display-p3 1 0.30196078431372547 0 / 0.6)"],
  ["stroke", "rgb(31 63 223 / 0.6)"],
  ["overlap", "color(display-p3 0 1 0)", "color(display-p3 0 0 1)"],
  ["overlap", "rgb(237 51 179 / 0.6)", "rgb(31 63 223 / 0.7)"],
  ["huge", "color(display-p3 1 0.30196078431372547 0)"],
  ["huge", "rgb(31 63 223 / 0.6)"],
];
for (const [kind, paint, fill] of paints) {
  const row = document.createElement("div");
  row.className = "row";
  for (const opacity of [0, 1 / 255, 0.25, 128 / 255, 0.75, 1]) {
    const tile = document.createElement("div");
    tile.className = `tile glyph ${kind}${opacity === 1 ? " opaque" : ""}`;
    tile.dataset.paintPath = `${kind}: ${paint}, opacity: ${opacity}`;
    tile.style.setProperty("--paint", paint);
    tile.style.setProperty("--fill", fill || paint);
    tile.style.setProperty("--target-opacity", opacity);
    tile.textContent = "X";
    row.appendChild(tile);
  }
  document.body.appendChild(row);
}
if (document.documentElement.classList.contains("repaint")) {
  addEventListener("TestRendered", () => {
    document.documentElement.classList.add("done");
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.documentElement.classList.remove("reftest-wait");
    }));
  }, { once: true });
}
