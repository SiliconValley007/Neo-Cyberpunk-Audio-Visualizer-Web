(() => {
  const gear = document.getElementById("gearBtn");
  const panel = document.getElementById("settingsPanel");
  const KEY = "neoAudioWP.settings";

  const defaults = {
    userText: "Any Text",
    showText: true,
    accentColor: "#00f3ff",
    accent2Color: "#ff007f",
    barColor: "#00f3ff",
    textColor: "#ffffff",
    enableGlitch: true,
    debugMode: false,
    sensitivity: 1.0,
  };

  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch (e) {}
  const cfg = Object.assign({}, defaults, saved);

  function apply(name, val) {
    if (typeof window.livelyPropertyListener === "function") {
      window.livelyPropertyListener(name, val);
    }
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(cfg));
    } catch (e) {}
  }

  panel.innerHTML = `
    <label>Display Text
      <input type="text" id="p_userText" maxlength="30" value="${cfg.userText}">
    </label>
    <label class="row"><input type="checkbox" id="p_showText" ${cfg.showText ? "checked" : ""}> Show Text</label>
    <label>Accent Color <input type="color" id="p_accentColor" value="${cfg.accentColor}"></label>
    <label>Accent 2 Color <input type="color" id="p_accent2Color" value="${cfg.accent2Color}"></label>
    <label>Bar Color <input type="color" id="p_barColor" value="${cfg.barColor}"></label>
    <label>Text Color <input type="color" id="p_textColor" value="${cfg.textColor}"></label>
    <label class="row"><input type="checkbox" id="p_enableGlitch" ${cfg.enableGlitch ? "checked" : ""}> Text Glitch</label>
    <label class="row"><input type="checkbox" id="p_debugMode" ${cfg.debugMode ? "checked" : ""}> Debug HUD</label>
    <label>Sensitivity <input type="range" id="p_sensitivity" min="0.2" max="3" step="0.1" value="${cfg.sensitivity}"></label>
    <button id="p_reset">Reset</button>
  `;

  function bind(id, name, evt, getVal) {
    const el = panel.querySelector(id);
    el.addEventListener(evt, () => {
      const v = getVal(el);
      cfg[name] = v;
      apply(name, v);
      save();
    });
  }
  bind("#p_userText", "userText", "input", (el) => el.value);
  bind("#p_showText", "showText", "change", (el) => el.checked);
  bind("#p_accentColor", "accentColor", "input", (el) => el.value);
  bind("#p_accent2Color", "accent2Color", "input", (el) => el.value);
  bind("#p_barColor", "barColor", "input", (el) => el.value);
  bind("#p_textColor", "textColor", "input", (el) => el.value);
  bind("#p_enableGlitch", "enableGlitch", "change", (el) => el.checked);
  bind("#p_debugMode", "debugMode", "change", (el) => el.checked);
  bind("#p_sensitivity", "sensitivity", "input", (el) => parseFloat(el.value));

  panel.querySelector("#p_reset").addEventListener("click", () => {
    Object.assign(cfg, defaults);
    localStorage.removeItem(KEY);
    location.reload();
  });

  function applyAll() {
    Object.keys(cfg).forEach((k) => apply(k, cfg[k]));
  }
  // main.js runs its own init synchronously before this script executes,
  // so applying now overrides its defaults with saved/custom values.
  applyAll();

  gear.addEventListener("click", () => panel.classList.toggle("open"));
  document.addEventListener("click", (e) => {
    if (!panel.contains(e.target) && e.target !== gear)
      panel.classList.remove("open");
  });
})();
