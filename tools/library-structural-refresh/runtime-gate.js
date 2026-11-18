const [expected] = arguments;
const executable = Services.dirsvc.get("XREExeF", Ci.nsIFile).path;
const profile = Services.dirsvc.get("ProfD", Ci.nsIFile).path;
const headless = Cc["@mozilla.org/gfx/info;1"].getService(Ci.nsIGfxInfo).isHeadless;
if (executable !== expected.executable || profile !== expected.profile || !headless) {
  throw new Error(`Unexpected runtime identity: ${JSON.stringify({ executable, profile, headless })}`);
}
function sha256(bytes) {
  const hash = Cc["@mozilla.org/security/hash;1"].createInstance(Ci.nsICryptoHash);
  hash.init(Ci.nsICryptoHash.SHA256);
  hash.update(bytes, bytes.length);
  return Array.from(hash.finish(false), c => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}
const modules = [];
for (const item of expected.modules) {
  const response = await w.fetch(item.uri);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256(bytes);
  if (actual !== item.sha256) throw new Error(`Runtime module hash mismatch: ${item.uri}`);
  modules.push({uri:item.uri, sha256:actual, bytes:bytes.length});
}
const nativePath = PathUtils.join(PathUtils.parent(executable), "libzen-native-theme.dylib");
const nativeSHA256 = sha256(await IOUtils.read(nativePath));
if (nativeSHA256 !== expected.nativeSHA256) throw new Error("Runtime native library hash mismatch");
if (await IOUtils.exists(expected.updaterPath)) throw new Error("Candidate is enrolled in the updater");
return {ok:true, executable, profile, headless, modules, nativePath, nativeSHA256,
  version:Services.appinfo.version, buildID:Services.appinfo.appBuildID,
  XPCOMABI:Services.appinfo.XPCOMABI};
