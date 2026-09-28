(function () {
  "use strict";
  /* ---------- DOM / canvases ---------- */
  const c2d = document.getElementById("c");
  const ctx = c2d && c2d.getContext("2d");
  const glCanvas = document.getElementById("gl");
  const hud = document.getElementById("hud");
  const txtEl = document.getElementById("txt");
  if (!c2d || !ctx || !glCanvas || !hud || !txtEl) return;
  const txtL = txtEl.querySelector(".l"),
    txtM = txtEl.querySelector(".m"),
    txtR = txtEl.querySelector(".r");
  if (!txtL || !txtM || !txtR) return;

  let gl = null,
    glOK = false;
  try {
    gl =
      glCanvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
      }) || glCanvas.getContext("experimental-webgl");
    glOK = !!gl;
  } catch (e) {
    glOK = false;
  }

  const NUM_BARS = 140;
  let W = 0,
    H = 0,
    DPR = Math.min(window.devicePixelRatio || 1, 2);
  let GW = 0,
    GH = 0;

  function resize() {
    W = innerWidth;
    H = innerHeight;
    c2d.width = W * DPR;
    c2d.height = H * DPR;
    c2d.style.width = W + "px";
    c2d.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    glCanvas.width = Math.round(W * DPR);
    glCanvas.height = Math.round(H * DPR);
    glCanvas.style.width = W + "px";
    glCanvas.style.height = H + "px";
    GW = glCanvas.width;
    GH = glCanvas.height;
    if (glOK) {
      gl.viewport(0, 0, GW, GH);
      rebuildFBOs();
    }
  }
  addEventListener("resize", resize);

  /* ---------- config (Lively-editable) ---------- */
  let accent = "#00f3ff",
    accent2 = "#ff007f",
    barColor = "#00f3ff",
    textColor = "#ffffff",
    sensitivity = 1.0;
  let userText = "Any Text",
    showText = true,
    enableGlitch = true,
    debugMode = false;

  function hex2rgb(h) {
    if (typeof h !== "string") h = "#00f3ff";
    h = h.replace("#", "").trim();
    if (h.length === 3)
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return [0, 0.953, 1];
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function rgba(h, a) {
    const r = hex2rgb(h).map((v) => Math.round(v * 255));
    return "rgba(" + r[0] + "," + r[1] + "," + r[2] + "," + a + ")";
  }

  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--accent2", accent2);
  document.documentElement.style.setProperty("--txtColor", textColor);

  /* ---------- AUDIO DSP: log remap, multi-band split, AGC, beat detection ---------- */
  const LOW_END = Math.round(NUM_BARS * 0.16),
    MID_END = Math.round(NUM_BARS * 0.55);
  let bars = new Float32Array(NUM_BARS);
  let bandPeak = new Float32Array(NUM_BARS).fill(0.25);
  let lastAudioTime = 0,
    hasAudio = false,
    audioLevel = 0;
  const IDLE_TIMEOUT = 900,
    SILENCE_THRESH = 0.015,
    SMOOTH = 0.25,
    AGC_DECAY = 0.985,
    AGC_RISE = 0.18;
  let rawPeak = 0,
    lastRawTime = 0;

  let bandRaw = [0, 0, 0],
    bandSm = [0, 0, 0],
    bandPk = [0.2, 0.2, 0.2],
    bandAvg = [0, 0, 0];
  let kick = 0,
    snare = 0,
    hat = 0;
  const BEAT_COOLDOWN = [130, 90, 60];
  let lastBeatT = [0, 0, 0];

  function logBinIndex(i, n, len) {
    return Math.min(len - 1, Math.floor(Math.pow(i / n, 2.1) * len));
  }

  window.livelyAudioListener = function (audioArray) {
    if (!audioArray || !audioArray.length) return;

    const n = audioArray.length;
    let peak = 0;
    const bsum = [0, 0, 0],
      bcount = [0, 0, 0];

    const isSilent = audioArray.every((v) => Math.abs(v) <= SILENCE_THRESH);

    for (let i = 0; i < NUM_BARS; i++) {
      let target = 0;

      if (!isSilent) {
        const idx = logBinIndex(i, NUM_BARS, n);
        let v = Math.abs(audioArray[idx] || 0);
        const boost = 1.0 + (i / NUM_BARS) * 2.2;
        v = v * boost;

        if (v > bandPeak[i]) bandPeak[i] += (v - bandPeak[i]) * AGC_RISE;
        else bandPeak[i] *= AGC_DECAY;
        bandPeak[i] = Math.max(bandPeak[i], 0.05);

        const norm = v / bandPeak[i];
        target = Math.min(1, norm * sensitivity);
        if (v > peak) peak = v;

        const b = i < LOW_END ? 0 : i < MID_END ? 1 : 2;
        bsum[b] += v;
        bcount[b]++;
      } else {
        bandPeak[i] *= AGC_DECAY;
      }

      // Smoothly animate down to 0
      bars[i] += (target - bars[i]) * SMOOTH;
      if (bars[i] < 0.005) bars[i] = 0;
    }

    for (let b = 0; b < 3; b++) {
      const raw = !isSilent && bcount[b] ? bsum[b] / bcount[b] : 0;
      bandRaw[b] = raw;
      if (raw > bandPk[b]) bandPk[b] += (raw - bandPk[b]) * 0.22;
      else bandPk[b] *= 0.985;
      bandPk[b] = Math.max(bandPk[b], 0.03);
      const norm = isSilent
        ? 0
        : Math.min(1.4, (raw / bandPk[b]) * sensitivity);
      bandSm[b] += (norm - bandSm[b]) * 0.2;
      bandAvg[b] += (bandSm[b] - bandAvg[b]) * 0.06;
    }

    rawPeak = peak;
    lastRawTime = performance.now();

    if (peak > SILENCE_THRESH) {
      lastAudioTime = performance.now();
      hasAudio = true;
    } else if (isSilent && bars.every((b) => b === 0)) {
      hasAudio = false;
    }

    const t = performance.now();
    if (!isSilent) {
      if (
        bandSm[0] > bandAvg[0] * 1.55 + 0.06 &&
        t - lastBeatT[0] > BEAT_COOLDOWN[0]
      ) {
        kick = 1;
        lastBeatT[0] = t;
      }
      if (
        bandSm[1] > bandAvg[1] * 1.5 + 0.06 &&
        t - lastBeatT[1] > BEAT_COOLDOWN[1]
      ) {
        snare = 1;
        lastBeatT[1] = t;
      }
      if (
        bandSm[2] > bandAvg[2] * 1.45 + 0.05 &&
        t - lastBeatT[2] > BEAT_COOLDOWN[2]
      ) {
        hat = 1;
        lastBeatT[2] = t;
      }
    }
  };

  window.livelyPropertyListener = function (name, val) {
    if (name === "userText") {
      userText = (val || "").toString().slice(0, 30);
      txtM.textContent = txtL.textContent = txtR.textContent = userText;
    } else if (name === "accentColor") {
      if (typeof val === "string" && val) {
        accent = val;
        document.documentElement.style.setProperty("--accent", accent);
      }
    } else if (name === "accent2Color") {
      if (typeof val === "string" && val) {
        accent2 = val;
        document.documentElement.style.setProperty("--accent2", accent2);
      }
    } else if (name === "barColor") {
      if (typeof val === "string" && val) barColor = val;
    } else if (name === "textColor") {
      if (typeof val === "string" && val) {
        textColor = val;
        document.documentElement.style.setProperty("--txtColor", textColor);
      }
    } else if (name === "sensitivity") {
      const s = parseFloat(val);
      sensitivity = Number.isFinite(s) ? Math.min(3, Math.max(0.2, s)) : 1.0;
    } else if (name === "debugMode") {
      debugMode = val === true || val === "true";
      hud.classList.toggle("on", debugMode);
    } else if (name === "showText") {
      showText = val === true || val === "true";
      txtEl.style.display = showText ? "block" : "none";
    } else if (name === "enableGlitch")
      enableGlitch = val === true || val === "true";
  };
  txtM.textContent = txtL.textContent = txtR.textContent = userText;

  /* ---------- mouse ---------- */
  let mx = 0,
    my = 0,
    tmx = 0,
    tmy = 0,
    mpx = -9999,
    mpy = -9999,
    tmpx = -9999,
    tmpy = -9999;
  addEventListener("mousemove", (e) => {
    if (!W || !H) return;
    tmx = (e.clientX / W) * 2 - 1;
    tmy = (e.clientY / H) * 2 - 1;
    tmpx = e.clientX;
    tmpy = e.clientY;
  });
  addEventListener("mouseleave", () => {
    tmx = 0;
    tmy = 0;
    tmpx = -9999;
    tmpy = -9999;
  });

  function updateAudioGate() {
    const active = hasAudio && performance.now() - lastAudioTime < IDLE_TIMEOUT;
    audioLevel += ((active ? 1 : 0) - audioLevel) * 0.12;
    if (audioLevel < 0.001) audioLevel = 0;
    if (!active) {
      for (let i = 0; i < NUM_BARS; i++) bars[i] *= 0.85;
      for (let b = 0; b < 3; b++) bandSm[b] *= 0.85;

      // Clear trail persistence buffers when inactive so bars don't leave residual bottom pixels
      if (glOK && fbo.trailA && fbo.trailB) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.trailA.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.trailB.fbo);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    }
    kick *= 0.82;
    snare *= 0.8;
    hat *= 0.75;
  }

  /* ---------- decorative canvas2d background layer (kept from base project) ---------- */
  const STAR_COUNT = 140;
  const stars = [];
  for (let i = 0; i < STAR_COUNT; i++)
    stars.push({
      x: Math.random(),
      y: Math.random(),
      r: 0.4 + Math.random() * 1.1,
      tw: Math.random() * 6.283,
      ts: 0.5 + Math.random() * 1.2,
    });
  function drawStars(t) {
    ctx.save();
    // audio reactivity here is strictly a soft opacity/glow bloom — never position or scale
    const audioGlow = Math.min(0.35, bandSm[0] * 0.3);
    for (const s of stars) {
      const twinkle = 0.35 + 0.4 * Math.abs(Math.sin(t * 0.0006 * s.ts + s.tw));
      const a = Math.min(1, twinkle + audioGlow);
      ctx.globalAlpha = a;
      ctx.fillStyle = "#dff6ff";
      ctx.shadowBlur = 2 + audioGlow * 6;
      ctx.shadowColor = "#dff6ff";
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, 6.283);
      ctx.fill();
    }
    ctx.restore();
  }

  const SUN = { x: 0.83, y: 0.2, r: 22 };
  const PLANETS = [
    { a: 46, b: 30, speed: 0.00016, phase: 0, r: 3.2, color: "#9fb7ff" },
    { a: 68, b: 44, speed: 0.00011, phase: 2.1, r: 4.2, color: "#8be3ff" },
    { a: 92, b: 60, speed: 0.00008, phase: 4.0, r: 3.6, color: "#ffb37a" },
    {
      a: 118,
      b: 78,
      speed: 0.00006,
      phase: 1.2,
      r: 5.2,
      color: "#ff9fd6",
      ring: true,
    },
    { a: 146, b: 98, speed: 0.000045, phase: 5.4, r: 3.0, color: "#c9a8ff" },
  ];
  // orbitTime is an isolated, uniform accumulator (advanced by raw dt only — see
  // main loop) so the solar system's rotation is completely deterministic and
  // silky-smooth regardless of audio volume, beats, or frame-rate jitter.
  function drawSolarSystem(orbitTime) {
    ctx.save();
    const sx = SUN.x * W,
      sy = SUN.y * H;
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    for (const p of PLANETS) {
      ctx.beginPath();
      ctx.ellipse(sx, sy, p.a, p.b, 0, 0, 6.283);
      ctx.stroke();
    }
    const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, SUN.r * 5.5);
    gr.addColorStop(0, "rgba(255,214,140,0.55)");
    gr.addColorStop(0.4, "rgba(255,170,90,0.18)");
    gr.addColorStop(1, "rgba(255,170,90,0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(sx, sy, SUN.r * 5.5, 0, 6.283);
    ctx.fill();
    ctx.fillStyle = "#fff3d6";
    ctx.shadowBlur = 18;
    ctx.shadowColor = "#ffcf8a";
    ctx.beginPath();
    ctx.arc(sx, sy, SUN.r, 0, 6.283);
    ctx.fill();
    for (const p of PLANETS) {
      const ang = p.phase + orbitTime * p.speed; // no audio term — position/scale never distorted by music
      const px = sx + Math.cos(ang) * p.a,
        py = sy + Math.sin(ang) * p.b;
      ctx.shadowBlur = 8;
      ctx.shadowColor = p.color;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.95;
      ctx.beginPath();
      ctx.arc(px, py, p.r, 0, 6.283);
      ctx.fill();
      if (p.ring) {
        ctx.save();
        ctx.translate(px, py);
        ctx.rotate(-0.5);
        ctx.globalAlpha = 0.7;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r * 2.1, p.r * 0.7, 0, 0, 6.283);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  const PCOUNT = 70,
    LINK_DIST = 140,
    MOUSE_DIST = 170;
  const particles = [];
  for (let i = 0; i < PCOUNT; i++)
    particles.push({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00018,
      vy: (Math.random() - 0.5) * 0.00018,
      r: 1 + Math.random() * 1.6,
    });
  function updateParticles(dt) {
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < 0 || p.x > 1) p.vx *= -1;
      if (p.y < 0 || p.y > 1) p.vy *= -1;
      p.x = Math.min(1, Math.max(0, p.x));
      p.y = Math.min(1, Math.max(0, p.y));
      const px = p.x * W,
        py = p.y * H,
        dx = px - mpx,
        dy = py - mpy,
        d = Math.hypot(dx, dy);
      if (d < 120 && d > 0.01) {
        const f = (1 - d / 120) * 0.6;
        p.x += (dx / d) * f * (dt / 1000);
        p.y += (dy / d) * f * (dt / 1000);
      }
    }
  }
  function drawParticles() {
    ctx.save();
    const pts = particles.map((p) => ({ x: p.x * W, y: p.y * H, r: p.r }));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        const dx = pts[i].x - pts[j].x,
          dy = pts[i].y - pts[j].y,
          d = Math.hypot(dx, dy);
        if (d < LINK_DIST) {
          ctx.globalAlpha = (1 - d / LINK_DIST) * 0.22;
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(pts[j].x, pts[j].y);
          ctx.stroke();
        }
      }
      if (mpx > -9000) {
        const dx = pts[i].x - mpx,
          dy = pts[i].y - mpy,
          d = Math.hypot(dx, dy);
        if (d < MOUSE_DIST) {
          ctx.globalAlpha = (1 - d / MOUSE_DIST) * 0.45;
          ctx.strokeStyle = accent2;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(pts[i].x, pts[i].y);
          ctx.lineTo(mpx, mpy);
          ctx.stroke();
        }
      }
    }
    for (const p of pts) {
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = accent;
      ctx.shadowBlur = 6;
      ctx.shadowColor = accent;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, 6.283);
      ctx.fill();
    }
    ctx.restore();
  }

  function bg() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#05010a");
    g.addColorStop(0.55, "#0a0416");
    g.addColorStop(1, "#140226");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const gx = W / 2 + mx * W * 0.3,
      gy = H * 0.38 + my * H * 0.15;
    const rg = ctx.createRadialGradient(
      gx,
      gy,
      0,
      gx,
      gy,
      Math.max(W, H) * 0.45,
    );
    const ar = hex2rgb(accent);
    rg.addColorStop(
      0,
      "rgba(" +
        Math.round(ar[0] * 255) +
        "," +
        Math.round(ar[1] * 255) +
        "," +
        Math.round(ar[2] * 255) +
        "," +
        (0.05 + bandSm[0] * 0.06) +
        ")",
    );
    rg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1;
    const gs = 64,
      ox = mx * 10,
      oy = my * 10;
    for (let x = -gs; x < W + gs; x += gs) {
      ctx.beginPath();
      ctx.moveTo(x + ox, 0);
      ctx.lineTo(x + ox, H);
      ctx.stroke();
    }
    for (let y = -gs; y < H + gs; y += gs) {
      ctx.beginPath();
      ctx.moveTo(0, y + oy);
      ctx.lineTo(W, y + oy);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* legacy 2D bar fallback — used only if WebGL is unavailable */
  function spectrumBars2D() {
    if (audioLevel <= 0.002) return;
    ctx.save();
    ctx.globalAlpha = audioLevel;
    const bw = W / NUM_BARS,
      barW = Math.max(1, bw * 0.42);
    const grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, rgba(barColor, 0.05));
    grad.addColorStop(0.55, rgba(barColor, 0.4));
    grad.addColorStop(1, rgba(barColor, 0.9));
    for (let i = 0; i < NUM_BARS; i++) {
      const h = bars[i] * H;
      if (h < 1.2) continue;
      const x = i * bw + (bw - barW) / 2,
        y = H - h;
      ctx.fillStyle = grad;
      ctx.shadowBlur = 10;
      ctx.shadowColor = barColor;
      ctx.fillRect(x, y, barW, h);
    }
    ctx.restore();
  }

  /* ---------- premium text overlay (HTML/CSS: reactive scale/glow + RGB-split glitch) ---------- */
  let glitchUntil = 0,
    nextGlitch = performance.now() + 4000 + Math.random() * 4000;
  function updateText(t) {
    if (!showText) return;
    const scale = 1.0 + Math.min(0.03, kick * 0.03); // gentle 1.00 -> 1.03 pulse on kick detection only
    const glow = 8 + bandSm[0] * 26;
    txtEl.style.transform =
      "translate(-50%,-50%) translate(" +
      mx * 6 +
      "px," +
      my * 4 +
      "px) scale(" +
      scale +
      ")";
    document.documentElement.style.setProperty(
      "--glow",
      glow.toFixed(1) + "px",
    );
    if (enableGlitch) {
      if (t > nextGlitch) {
        glitchUntil = t + 90 + Math.random() * 55;
        nextGlitch = t + 4000 + Math.random() * 4000;
      } // <150ms burst, every 4-8s
      txtEl.classList.toggle("glitch", t < glitchUntil);
    } else txtEl.classList.remove("glitch");
  }

  function drawDebugHUD(t) {
    if (!debugMode) return;
    const flashOn =
      rawPeak > SILENCE_THRESH && performance.now() - lastRawTime < 50;
    hud.innerHTML =
      '<div style="position:absolute;left:16px;top:16px;width:28px;height:28px;background:' +
      (flashOn ? "#fff" : "#222") +
      ';border:2px solid #00f3ff"></div>' +
      '<div style="position:absolute;left:16px;top:52px;font:700 12px monospace;color:#fff;text-shadow:0 0 3px #000">' +
      "RAW " +
      rawPeak.toFixed(4) +
      "<br>LOW " +
      bandSm[0].toFixed(2) +
      " MID " +
      bandSm[1].toFixed(2) +
      " HIGH " +
      bandSm[2].toFixed(2) +
      "<br>KICK " +
      kick.toFixed(2) +
      " SNARE " +
      snare.toFixed(2) +
      " HAT " +
      hat.toFixed(2) +
      "<br>t=" +
      Math.round(t) +
      "ms</div>";
  }

  /* =========================================================
     WEBGL LAYER — GPU bars, multi-pass bloom, trail feedback,
     parallax dust field. Renders transparently over the canvas2d
     background layer above.
     ========================================================= */
  let prog = {},
    quadBuf,
    barBuf,
    barData,
    dustBuf,
    dustData;
  let fbo = {};
  const DUST_N = 140;
  const dustParticles = [];

  function compile(src, type) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(log || "shader compile failed");
    }
    return s;
  }
  function link(vsSrc, fsSrc) {
    const vs = compile(vsSrc, gl.VERTEX_SHADER);
    const fs = compile(fsSrc, gl.FRAGMENT_SHADER);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error(log || "program link failed");
    }
    return p;
  }
  function makeTex(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      w,
      h,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
  function makeFBO(w, h) {
    const tex = makeTex(w, h);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo: f, tex: tex, w: w, h: h };
  }
  function deleteFBO(f) {
    if (!f) return;
    gl.deleteFramebuffer(f.fbo);
    gl.deleteTexture(f.tex);
  }

  function initGL() {
    const VS_BAR =
      "attribute vec2 aPos;attribute float aGrad;attribute float aGlow;varying float vGrad;varying float vGlow;void main(){vGrad=aGrad;vGlow=aGlow;gl_Position=vec4(aPos,0.0,1.0);}";
    const FS_BAR =
      "precision mediump float;varying float vGrad;varying float vGlow;uniform vec3 uColor;void main(){float a=mix(0.05,1.0,vGrad);vec3 col=uColor*(0.55+1.8*vGlow);gl_FragColor=vec4(col*a,a);}";
    const VS_Q =
      "attribute vec2 aPos;varying vec2 vUv;void main(){vUv=aPos*0.5+0.5;gl_Position=vec4(aPos,0.0,1.0);}";
    const FS_TRAIL =
      "precision mediump float;varying vec2 vUv;uniform sampler2D uCur;uniform sampler2D uPrev;void main(){vec4 c=texture2D(uCur,vUv);vec4 p=texture2D(uPrev,vUv);vec3 tr=max(c.rgb,p.rgb*0.85-0.018);float a=clamp(max(c.a,p.a*0.85-0.018),0.0,1.0);gl_FragColor=vec4(clamp(tr,0.0,4.0),a);}";
    const FS_BRIGHT =
      "precision mediump float;varying vec2 vUv;uniform sampler2D uTex;uniform float uThresh;void main(){vec4 c=texture2D(uTex,vUv);float lum=dot(c.rgb,vec3(0.299,0.587,0.114));float m=smoothstep(uThresh,uThresh+0.5,lum);gl_FragColor=vec4(c.rgb*m,c.a*m);}";
    const FS_BLUR =
      "precision mediump float;varying vec2 vUv;uniform sampler2D uTex;uniform vec2 uDir;void main(){vec4 s=texture2D(uTex,vUv)*0.227027;s+=texture2D(uTex,vUv+uDir*1.3846153846)*0.3162162;s+=texture2D(uTex,vUv-uDir*1.3846153846)*0.3162162;s+=texture2D(uTex,vUv+uDir*3.2307692308)*0.0702702;s+=texture2D(uTex,vUv-uDir*3.2307692308)*0.0702702;gl_FragColor=s;}";
    const FS_BLOOM =
      "precision mediump float;varying vec2 vUv;uniform sampler2D uTex;uniform float uInt;void main(){vec3 c=texture2D(uTex,vUv).rgb*uInt;c=c/(1.0+c);gl_FragColor=vec4(c,max(c.r,max(c.g,c.b)));}";
    const VS_DUST =
      "attribute vec2 aPos;attribute float aSize;attribute float aAlpha;varying float vA;void main(){vA=aAlpha;gl_Position=vec4(aPos,0.0,1.0);gl_PointSize=aSize;}";
    const FS_DUST =
      "precision mediump float;varying float vA;uniform vec3 uColor;void main(){vec2 d=gl_PointCoord-0.5;float r=length(d);float a=smoothstep(0.5,0.0,r)*vA;gl_FragColor=vec4(uColor*a,a);}";

    prog.bar = link(VS_BAR, FS_BAR);
    prog.trail = link(VS_Q, FS_TRAIL);
    prog.bright = link(VS_Q, FS_BRIGHT);
    prog.blur = link(VS_Q, FS_BLUR);
    prog.bloom = link(VS_Q, FS_BLOOM);
    prog.dust = link(VS_DUST, FS_DUST);

    quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );

    barData = new Float32Array(NUM_BARS * 6 * 4); // bar quad only, 6 verts each, 4 floats/vert
    barBuf = gl.createBuffer();

    dustData = new Float32Array(DUST_N * 4);
    dustBuf = gl.createBuffer();
    for (let i = 0; i < DUST_N; i++)
      dustParticles.push({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        depth: 0.3 + Math.random() * 0.9,
        vx: (Math.random() - 0.5) * 0.00004,
        vy: (Math.random() - 0.5) * 0.00004,
        ph: Math.random() * 6.283,
      });
  }

  function rebuildFBOs() {
    if (!glOK) return;
    ["bars", "trailA", "trailB", "bright", "blurA", "blurB"].forEach((k) =>
      deleteFBO(fbo[k]),
    );
    const w = GW,
      h = GH,
      hw = Math.max(1, w >> 1),
      hh = Math.max(1, h >> 1);
    fbo.bars = makeFBO(w, h);
    fbo.trailA = makeFBO(w, h);
    fbo.trailB = makeFBO(w, h);
    fbo.bright = makeFBO(hw, hh);
    fbo.blurA = makeFBO(hw, hh);
    fbo.blurB = makeFBO(hw, hh);
  }

  function drawQuad(program) {
    gl.useProgram(program);
    const loc = gl.getAttribLocation(program, "aPos");
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function buildBarGeometry() {
    const bw = 2 / NUM_BARS,
      barW = bw * 0.62;
    let o = 0;
    for (let i = 0; i < NUM_BARS; i++) {
      const h = Math.min(1, bars[i]) * 2.0;

      // Stop generating vertex data if height is below visual threshold
      if (h < 0.02 || bars[i] <= 0) {
        // Zero out the 6 vertices (24 floats) for this bar so nothing renders
        for (let k = 0; k < 24; k++) barData[o++] = 0;
        continue;
      }
      const x0 = -1 + i * bw + (bw - barW) / 2,
        x1 = x0 + barW;
      const y0 = -1,
        y1 = -1 + h;
      const glow = Math.min(1.6, bars[i] * 1.3);
      const v = [
        x0,
        y0,
        0,
        glow,
        x1,
        y0,
        0,
        glow,
        x0,
        y1,
        1,
        glow,
        x0,
        y1,
        1,
        glow,
        x1,
        y0,
        0,
        glow,
        x1,
        y1,
        1,
        glow,
      ];
      for (let k = 0; k < v.length; k++) barData[o++] = v[k];
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, barBuf);
    gl.bufferData(gl.ARRAY_BUFFER, barData, gl.DYNAMIC_DRAW);
  }

  function drawBars(colorHex) {
    const p = prog.bar;
    gl.useProgram(p);
    const aPos = gl.getAttribLocation(p, "aPos"),
      aGrad = gl.getAttribLocation(p, "aGrad"),
      aGlow = gl.getAttribLocation(p, "aGlow");
    gl.bindBuffer(gl.ARRAY_BUFFER, barBuf);
    const stride = 16;
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(aGrad);
    gl.vertexAttribPointer(aGrad, 1, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(aGlow);
    gl.vertexAttribPointer(aGlow, 1, gl.FLOAT, false, stride, 12);
    const col = hex2rgb(colorHex);
    gl.uniform3f(gl.getUniformLocation(p, "uColor"), col[0], col[1], col[2]);
    gl.drawArrays(gl.TRIANGLES, 0, NUM_BARS * 6);
  }

  function updateDust(dt) {
    const bass = bandSm[0];
    for (let i = 0; i < DUST_N; i++) {
      const d = dustParticles[i];
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.ph += dt * 0.0006;
      if (d.x < -1.1) d.x = 1.1;
      if (d.x > 1.1) d.x = -1.1;
      if (d.y < -1.1) d.y = 1.1;
      if (d.y > 1.1) d.y = -1.1;
      const px = d.x + mx * 0.12 * d.depth,
        py = d.y + my * 0.08 * d.depth;
      const o = i * 4;
      dustData[o] = px;
      dustData[o + 1] = py;
      dustData[o + 2] = (1.2 + d.depth * 2.2) * (1 + bass * 1.4) * DPR;
      dustData[o + 3] =
        (0.15 + 0.35 * d.depth) *
        (0.4 + bass * 0.8) *
        (0.6 + 0.4 * Math.sin(d.ph));
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
    gl.bufferData(gl.ARRAY_BUFFER, dustData, gl.DYNAMIC_DRAW);
  }
  function drawDust() {
    const p = prog.dust;
    gl.useProgram(p);
    const aPos = gl.getAttribLocation(p, "aPos"),
      aSize = gl.getAttribLocation(p, "aSize"),
      aAlpha = gl.getAttribLocation(p, "aAlpha");
    gl.bindBuffer(gl.ARRAY_BUFFER, dustBuf);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aSize);
    gl.vertexAttribPointer(aSize, 1, gl.FLOAT, false, 16, 8);
    gl.enableVertexAttribArray(aAlpha);
    gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, 16, 12);
    const col = hex2rgb(accent2);
    gl.uniform3f(gl.getUniformLocation(p, "uColor"), col[0], col[1], col[2]);
    gl.drawArrays(gl.POINTS, 0, DUST_N);
  }

  function renderGL(dt) {
    if (!fbo.bars || !fbo.trailA || !fbo.trailB) return;
    buildBarGeometry();

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.bars.fbo);
    gl.viewport(0, 0, fbo.bars.w, fbo.bars.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    drawBars(barColor);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.trailB.fbo);
    gl.viewport(0, 0, fbo.trailB.w, fbo.trailB.h);
    gl.disable(gl.BLEND);
    gl.useProgram(prog.trail);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fbo.bars.tex);
    gl.uniform1i(gl.getUniformLocation(prog.trail, "uCur"), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, fbo.trailA.tex);
    gl.uniform1i(gl.getUniformLocation(prog.trail, "uPrev"), 1);
    drawQuad(prog.trail);
    const tmp = fbo.trailA;
    fbo.trailA = fbo.trailB;
    fbo.trailB = tmp;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.bright.fbo);
    gl.viewport(0, 0, fbo.bright.w, fbo.bright.h);
    gl.useProgram(prog.bright);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fbo.trailA.tex);
    gl.uniform1i(gl.getUniformLocation(prog.bright, "uTex"), 0);
    gl.uniform1f(gl.getUniformLocation(prog.bright, "uThresh"), 0.35);
    drawQuad(prog.bright);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.blurA.fbo);
    gl.viewport(0, 0, fbo.blurA.w, fbo.blurA.h);
    gl.useProgram(prog.blur);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fbo.bright.tex);
    gl.uniform1i(gl.getUniformLocation(prog.blur, "uTex"), 0);
    gl.uniform2f(gl.getUniformLocation(prog.blur, "uDir"), 1 / fbo.blurA.w, 0);
    drawQuad(prog.blur);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.blurB.fbo);
    gl.viewport(0, 0, fbo.blurB.w, fbo.blurB.h);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fbo.blurA.tex);
    gl.uniform1i(gl.getUniformLocation(prog.blur, "uTex"), 0);
    gl.uniform2f(gl.getUniformLocation(prog.blur, "uDir"), 0, 1 / fbo.blurB.h);
    drawQuad(prog.blur);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, GW, GH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    updateDust(dt);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    drawDust();
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    drawBars(barColor);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(prog.bloom);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fbo.blurB.tex);
    gl.uniform1i(gl.getUniformLocation(prog.bloom, "uTex"), 0);
    gl.uniform1f(gl.getUniformLocation(prog.bloom, "uInt"), 1.4 + kick * 1.2);
    drawQuad(prog.bloom);
  }

  function enableGL() {
    try {
      initGL();
      glOK = true;
      resize();
    } catch (e) {
      glOK = false;
    }
  }
  if (glOK) enableGL();
  else resize();
  if (glCanvas) {
    glCanvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      glOK = false;
    });
    glCanvas.addEventListener("webglcontextrestored", () => {
      gl = glCanvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
      });
      if (gl) enableGL();
    });
  }

  /* ---------- main loop ---------- */
  let last = performance.now();
  let orbitTime = 0;
  let raf = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
  });
  function loop(t) {
    if (document.hidden) {
      raf = 0;
      return;
    }
    const dt = Math.min(48, t - last);
    last = t;
    orbitTime += dt;
    mx += (tmx - mx) * 0.06;
    my += (tmy - my) * 0.06;
    mpx += (tmpx - mpx) * 0.12;
    mpy += (tmpy - mpy) * 0.12;
    updateAudioGate();
    updateParticles(dt);
    bg();
    drawStars(t);
    drawSolarSystem(orbitTime);
    drawParticles();
    if (!glOK) spectrumBars2D();
    updateText(t);
    drawDebugHUD(t);
    if (glOK) renderGL(dt);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
})();

/* Robust viewport sync: some browsers (e.g. after a tab-share/info bar
   disappears) don't fire a window "resize" event, leaving a stale height. */
(function () {
  let lw = innerWidth, lh = innerHeight;
  const sync = () => {
    if (innerWidth !== lw || innerHeight !== lh) {
      lw = innerWidth; lh = innerHeight;
      dispatchEvent(new Event("resize"));
    }
  };
  setInterval(sync, 200);
  if (window.visualViewport) visualViewport.addEventListener("resize", sync);
  if (window.ResizeObserver) new ResizeObserver(sync).observe(document.documentElement);
  document.addEventListener("fullscreenchange", () => setTimeout(sync, 50));
})();
