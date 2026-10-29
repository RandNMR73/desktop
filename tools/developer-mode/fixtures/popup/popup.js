browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  document.querySelector("#owner").textContent =
    tab.url || "No activeTab permission";
});
