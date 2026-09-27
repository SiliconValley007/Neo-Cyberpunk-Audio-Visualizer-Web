(() => {
  const btn = document.getElementById("audioBtn");
  let audioCtx, analyser, stream, raf;

  const NUM_BANDS = 300; // pre-shaped bands fed to the visualizer
  const F_MIN = 30,
    F_MAX = 15000;

  function setBtn(on) {
    btn.classList.toggle("on", on);
    btn.title = on ? "Audio ON — click to switch tab" : "Share Tab Audio";
  }

  function feedSilence() {
    if (typeof window.livelyAudioListener === "function") {
      window.livelyAudioListener(new Float32Array(64));
    }
  }

  function stop() {
    cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (audioCtx) audioCtx.close();
    stream = audioCtx = analyser = null;
    setBtn(false);
    feedSilence();
  }

  async function start() {
    stop();
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
      });
    } catch (e) {
      return;
    }
    const audioTracks = stream.getAudioTracks();
    stream.getVideoTracks().forEach((t) => t.stop());
    if (!audioTracks.length) {
      alert("That source has no audio. Pick a tab and tick 'Share tab audio'.");
      stop();
      return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.35;
    analyser.minDecibels = -100;
    analyser.maxDecibels = -25;
    src.connect(analyser);

    const sampleRate = audioCtx.sampleRate;
    const binHz = sampleRate / analyser.fftSize;
    const raw = new Uint8Array(analyser.frequencyBinCount);
    const bands = new Float32Array(NUM_BANDS);

    // Precompute [loBin, hiBin] per band on a log-frequency scale.
    const ranges = [];
    for (let j = 0; j < NUM_BANDS; j++) {
      const fLo = F_MIN * Math.pow(F_MAX / F_MIN, j / NUM_BANDS);
      const fHi = F_MIN * Math.pow(F_MAX / F_MIN, (j + 1) / NUM_BANDS);
      let lo = Math.max(1, Math.floor(fLo / binHz));
      let hi = Math.max(lo, Math.ceil(fHi / binHz));
      hi = Math.min(hi, raw.length - 1);
      ranges.push([lo, hi]);
    }

    audioTracks[0].addEventListener("ended", stop);

    function loop() {
      analyser.getByteFrequencyData(raw);
      for (let j = 0; j < NUM_BANDS; j++) {
        const [lo, hi] = ranges[j];
        let m = 0;
        for (let k = lo; k <= hi; k++) if (raw[k] > m) m = raw[k];
        let v = m / 255;
        // Compensate the natural high-frequency rolloff of music so the
        // whole width stays lively, then mild gamma lift for low levels.
        v = Math.min(1, v * (1 + (j / NUM_BANDS) * 3.2));
        v = Math.pow(v, 0.8);
        bands[j] = v;
      }
      window.livelyAudioListener(bands);
      raf = requestAnimationFrame(loop);
    }
    setBtn(true);
    loop();
  }

  btn.addEventListener("click", start);
  feedSilence();
})();
