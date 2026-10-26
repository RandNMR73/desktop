import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../../src/zen/live-folders/providers/GithubLiveFolder.sys.mjs", import.meta.url), "utf8")
  .replace(/^import .*;$/m, "").replace("export class nsGithubLiveFolderProvider", "globalThis.Provider = class nsGithubLiveFolderProvider");
const context = vm.createContext({ URL, console, Services: { prefs: { getBoolPref: () => false } },
  nsZenLiveFolderProvider: class {
    constructor({ id, state, manager }) { this.id = id; this.state = { ...state }; this.manager = manager; }
    onOptionTrigger() {}
    refresh() { this.refreshes = (this.refreshes || 0) + 1; }
    requestSave() { this.saves = (this.saves || 0) + 1; }
  },
});
// The local Node 20 runner predates Set.union; Gecko implements it.
vm.runInContext("Set.prototype.union ??= function(other) { return new Set([...this, ...other]); };", context);
vm.runInContext(source, context);
const plain = x => JSON.parse(JSON.stringify(x));
const empty = JSON.stringify({ payload: { pullsDashboardSurfaceContentRoute: { results: [] } } });
function fixture(options, state = {}) {
  const p = new context.Provider({ id: "test", manager: {}, state: { type: "pull-requests", arcCompatible: true, isJsonApi: true, options, ...state } });
  p.requests = [];
  p.fetch = async url => { p.requests.push(url); return { status: 200, text: empty }; };
  return p;
}

test("Arc defaults expose exactly the three independently selected filters", () => {
  const p = fixture();
  assert.deepEqual(plain(p.options).map(x => [x.key, x.checked]), [["authorMe", true], ["reviewRequested", true], ["teamReviewRequested", true]]);
  assert.equal(p.state.options.assignedMe, false);
  assert.deepEqual(plain(p.serialize()).state.options.repoExcludes, []);
});

for (let mask = 0; mask < 8; mask++) {
  test(`Arc filter combination ${mask} fetches only the selected categories`, async () => {
    const p = fixture({ authorMe: !!(mask & 1), reviewRequested: !!(mask & 2), teamReviewRequested: !!(mask & 4) });
    const result = await p.fetchItems();
    if (!mask) {
      assert.equal(result, "zen-live-folder-github-no-filter");
      assert.equal(p.requests.length, 0); return;
    }
    assert.deepEqual(plain(result), []);
    assert.equal(p.requests.length, 1);
    const query = new URL(p.requests[0]).searchParams.get("q");
    for (const [bit, filter] of [[1,"author:@me"],[2,"user-review-requested:@me"],[4,"team-review-requested-user:@me"]]) {
      assert.equal(query.includes(filter), !!(mask & bit));
    }
    assert.equal(query.includes("assignee:"), false);
    assert.equal(query.includes("draft:false"), false);
  });
}

test("each filter toggles and serializes without changing the other two", () => {
  for (const key of ["authorMe", "reviewRequested", "teamReviewRequested"]) {
    const p = fixture();
    p.onOptionTrigger({ getAttribute: name => name === "option-key" ? key : null, hasAttribute: () => false });
    assert.equal(p.refreshes, 1); assert.equal(p.saves, 1);
    const restored = fixture(undefined, plain(p.serialize()).state);
    for (const option of restored.options) assert.equal(option.checked, option.key !== key);
  }
});

test("hidden repositories survive import and stay in the request", async () => {
  const p = fixture({ repoExcludes: ["example/hidden"] });
  await p.fetchItems();
  assert.ok(new URL(p.requests[0]).searchParams.get("q").includes("-repo:example/hidden"));
  assert.deepEqual(plain(p.serialize()).state.options.repoExcludes, ["example/hidden"]);
});

test("an unrecognized JSON dashboard is an error, never an empty success", async () => {
  const p = fixture();
  p.fetch = async () => ({ status: 200, text: JSON.stringify({ payload: {} }) });
  assert.equal(await p.fetchItems(), "zen-live-folder-failed-fetch");
});

test("login and organization SSO redirects preserve authentication failure", async () => {
  for (const path of ["/login", "/session", "/orgs/example/sso"]) {
    const p = fixture();
    p.fetch = async () => ({ status: 200, text: empty, url: "https://github.com" + path });
    assert.equal(await p.fetchItems(), "zen-live-folder-github-no-auth");
  }
});

test("legacy GitHub folders keep their existing filter vocabulary", () => {
  const p = fixture({ assignedMe: true }, { arcCompatible: false });
  assert.equal(p.arcCompatible, false);
  assert.ok(p.options.some(x => x.key === "assignedMe"));
  assert.ok(p.options.some(x => x.key === "repoExclude"));
});
