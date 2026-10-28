browser.browserAction.onClicked.addListener((tab) => {
  browser.browserAction.setTitle({
    tabId: tab.id,
    title: "Clicked " + tab.url,
  });
  browser.browserAction.setBadgeText({ tabId: tab.id, text: "1" });
});
