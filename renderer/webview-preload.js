// Runs in every webview frame before page scripts. Overrides JS-level
// fingerprinting surfaces so they match the spoofed Chrome UA.
const { webFrame } = require("electron");

webFrame.executeJavaScript(`(() => {
  const V = "146";
  const FULL = "146.0.7390.65";
  const brands = [
    { brand: "Chromium", version: V },
    { brand: "Not-A.Brand", version: "24" },
    { brand: "Google Chrome", version: V }
  ];
  const fullList = [
    { brand: "Chromium", version: FULL },
    { brand: "Not-A.Brand", version: "24.0.0.0" },
    { brand: "Google Chrome", version: FULL }
  ];
  const uaData = {
    brands, mobile: false, platform: "Windows",
    getHighEntropyValues(h) {
      const o = { brands, mobile: false, platform: "Windows" };
      if (h.includes("platformVersion")) o.platformVersion = "15.0.0";
      if (h.includes("architecture")) o.architecture = "x86";
      if (h.includes("bitness")) o.bitness = "64";
      if (h.includes("model")) o.model = "";
      if (h.includes("uaFullVersion")) o.uaFullVersion = FULL;
      if (h.includes("fullVersionList")) o.fullVersionList = fullList;
      if (h.includes("wow64")) o.wow64 = false;
      if (h.includes("formFactor")) o.formFactor = ["Desktop"];
      return Promise.resolve(o);
    },
    toJSON() { return { brands, mobile: false, platform: "Windows" }; }
  };
  const def = (prop, val) => {
    try { Object.defineProperty(Navigator.prototype, prop, { get: () => val, configurable: true }); } catch {}
  };
  def("userAgentData", uaData);
  def("platform", "Win32");
  def("languages", Object.freeze(["en-US", "en"]));
  def("language", "en-US");
  def("webdriver", false);
})();`).catch(() => { });
