// Async chrome-context body. Writes the system clipboard; use only synthetic images.
const { copyPNGToClipboard } = ChromeUtils.importESModule(
  "resource:///modules/ZenImageClipboard.sys.mjs",
);
const { BrowserUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/BrowserUtils.sys.mjs",
);
if (
  !Services.prefs.getBoolPref("zen.developer-mode.fixture-tests", false) ||
  !w.captureBenchmarkPNG
)
  throw new Error(
    "Use a disposable fixture profile and set w.captureBenchmarkPNG to a synthetic PNG path",
  );
const bytes = await IOUtils.read(w.captureBenchmarkPNG);
const buffer = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
);
const settle = () =>
  new Promise((r) => w.requestAnimationFrame(() => w.requestAnimationFrame(r)));
const report = { bytes: bytes.length, runs: [] };
for (const path of [
  "gecko",
  "candidate",
  "candidate",
  "gecko",
  "gecko",
  "candidate",
]) {
  const intervals = [];
  let previous = w.performance.now();
  const timer = w.setInterval(() => {
    const now = w.performance.now();
    intervals.push(now - previous);
    previous = now;
  }, 16);
  try {
    await settle();
    const start = w.performance.now();
    if (path === "candidate") {
      if (!(await copyPNGToClipboard(buffer)))
        throw new Error("Candidate copy rejected");
    } else BrowserUtils.copyImageToClipboard(buffer);
    const copyMs = w.performance.now() - start;
    await settle();
    await new Promise((r) => w.setTimeout(r, 48));
    w.clearInterval(timer);
    report.runs.push({
      path,
      copyMs,
      maxIntervalMs: Math.max(...intervals),
      timerTicks: intervals.length,
    });
  } finally {
    w.clearInterval(timer);
  }
}
if (w.captureEvidenceDir)
  await IOUtils.writeJSON(
    w.captureEvidenceDir + "/clipboard-benchmark.json",
    report,
  );
return report;
