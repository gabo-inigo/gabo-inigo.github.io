(function () {
  "use strict";

  const ROCK = {
    base: ["#7a7672", "#524f4c", "#353332"],
    mid: "#54504c",
    dark: "#2a2826",
    light: "#c4bdb4",
    altered: ["#948a80", "#746c62", "#504a44"],
    speckleLight: "#e8e4dc",
    speckleDark: "#252322",
    mica: "#b0a89c",
    stain: "#9a7658",
    physicalWeight: 0.95,
    chemicalWeight: 0.95,
    biologicalWeight: 0.95,
    moss: "#3d5c38",
    lichen: "#7a8f52",
    hardness: 0.55,
    rust: "#a06848",
  };

  const LIGHT_DIR = -Math.PI * 0.68;

  const FRAME_MS_ESTIMATE = 17;
  const YEAR_SPAN = 3500;
  /** Play from 0 → yearSpan takes this many real seconds (all modes). */
  const PLAY_REAL_SECONDS = 120;
  const PLAY_YEARS_PER_SECOND = YEAR_SPAN / PLAY_REAL_SECONDS;

  /** Per simulated year (Play or slider). Physical cracks use year-synced drive; sediment uses yearDelta. */
  const WEATHER_PER_YEAR = {
    crackGrow: 1.35,
    sediment: 0.35,
  };

  const SIM = {
    yearSpan: YEAR_SPAN,
    playYearsPerSecond: PLAY_YEARS_PER_SECOND,
    playYearsPerMs: PLAY_YEARS_PER_SECOND / 1000,
    weatheringRate: 1,
    erosionMul: 0.95,
    crackGrow: WEATHER_PER_YEAR.crackGrow,
    sedimentPerYear: WEATHER_PER_YEAR.sediment,
    /** One Play second of weathering (branch checks, slider catch-up). */
    playYearBatch: PLAY_YEARS_PER_SECOND,
    maxWeatherYearsPerFrame: Math.max(
      PLAY_YEARS_PER_SECOND * (FRAME_MS_ESTIMATE / 1000) * 2.5,
      PLAY_YEARS_PER_SECOND * 2
    ),
  };

  function playYearsElapsedMs(ms) {
    return ms * SIM.playYearsPerMs;
  }

  const BLURBS = {
    physical:
      "Set mechanical agents, then move elapsed time or press Play. Water in fractures freezes and widens joints; wind strips loose grains.",
    chemical:
      "Water and acids dissolve minerals and cement—the rock shrinks, pits widen, and the surface bleaches to clays (advance time or Play to start). No frost-style fractures here.",
    biological:
      "One plant takes hold in a joint; roots wedge the fracture wider as moisture and organic acids work the rock (advance time or Play).",
  };

  const root = document.getElementById("simulation");
  const canvas = document.getElementById("weatherCanvas");
  if (!root || !canvas) return;

  const ctx = canvas.getContext("2d");
  let granitePattern = null;

  const form = root.querySelector(".controls");
  const hud = root.querySelector(".hud");
  const blurb = document.getElementById("sim-blurb");

  const ui = {
    rainfallPhys: form.querySelector('[name="rainfallPhys"]'),
    rainfallChem: form.querySelector('[name="rainfallChem"]'),
    temperature: form.querySelector('[name="temperature"]'),
    temperatureChem: form.querySelector('[name="temperatureChem"]'),
    wind: form.querySelector('[name="wind"]'),
    acidity: form.querySelector('[name="acidity"]'),
    timeYears: form.querySelector('[name="timeYears"]'),
    rainOutPhys: form.querySelector('[data-out="rain-phys"]'),
    rainOutChem: form.querySelector('[data-out="rain-chem"]'),
    tempOut: form.querySelector('[data-out="temp"]'),
    tempOutChem: form.querySelector('[data-out="temp-chem"]'),
    windOut: form.querySelector('[data-out="wind"]'),
    acidOut: form.querySelector('[data-out="acid"]'),
    timeOut: form.querySelector('[data-out="time"]'),
    playPause: form.querySelector('[data-action="play"]'),
    resetSim: form.querySelector('[data-action="reset"]'),
    weatheringIndex: hud.querySelector('[data-hud="index"]'),
    dominantProcess: hud.querySelector('[data-hud="process"]'),
    indexBar: hud.querySelector('[data-hud="bar"]'),
    indexLabel: hud.querySelector('[data-hud="index-label"]'),
    processLabel: hud.querySelector('[data-hud="process-label"]'),
    agentsPhysical: form.querySelector('[data-agents="physical"]'),
    agentsChemical: form.querySelector('[data-agents="chemical"]'),
    agentsBiological: form.querySelector('[data-agents="biological"]'),
    moistureBio: form.querySelector('[name="moistureBio"]'),
    rootPressure: form.querySelector('[name="roots"]'),
    lichenLevel: form.querySelector('[name="lichen"]'),
    moistureBioOut: form.querySelector('[data-out="moisture-bio"]'),
    rootsOut: form.querySelector('[data-out="roots"]'),
    lichenOut: form.querySelector('[data-out="lichen"]'),
  };

  const state = {
    weatheringType: "physical",
    rainfall: 35,
    temperature: 55,
    wind: 45,
    acidity: 40,
    roots: 50,
    lichen: 45,
    plant: null,
    years: 0,
    playing: false,
    lastTick: 0,
    particles: [],
    cracks: [],
    pits: [],
    patternSeed: null,
    seed: Math.random() * 1000,
    /** Years already applied to crack/pit state (stays in sync with state.years). */
    appliedYears: 0,
  };

  function isPhysical() {
    return state.weatheringType === "physical";
  }

  function isChemical() {
    return state.weatheringType === "chemical";
  }

  function isBiological() {
    return state.weatheringType === "biological";
  }

  /** Weathering only applies after time has started (slider or Play). */
  function simulationRunning() {
    return state.years > 0 || state.playing;
  }

  function getControls() {
    const typeEl = form.querySelector('input[name="weatheringType"]:checked');
    const type = typeEl ? typeEl.value : "physical";
    if (type === "physical") {
      return {
        weatheringType: type,
        rainfall: Number(ui.rainfallPhys.value),
        temperature: Number(ui.temperature.value),
        wind: Number(ui.wind.value),
        acidity: 0,
        roots: state.roots,
        lichen: state.lichen,
        years: Number(ui.timeYears.value),
      };
    }
    if (type === "chemical") {
      return {
        weatheringType: type,
        rainfall: Number(ui.rainfallChem.value),
        temperature: Number(ui.temperatureChem.value),
        wind: 0,
        acidity: Number(ui.acidity.value),
        roots: state.roots,
        lichen: state.lichen,
        years: Number(ui.timeYears.value),
      };
    }
    const lichenVal = Number(ui.lichenLevel?.value ?? 45);
    return {
      weatheringType: type,
      rainfall: Number(ui.moistureBio?.value ?? 60),
      temperature: 0,
      wind: 0,
      acidity: lichenVal * 0.42,
      roots: Number(ui.rootPressure?.value ?? 50),
      lichen: lichenVal,
      years: Number(ui.timeYears.value),
    };
  }

  /** Slider scrub: jump plant/crack state to the selected year (not only during Play). */
  function applyElapsedYearsFromControls() {
    if (state.playing) return;
    const years = Math.max(0, Math.min(SIM.yearSpan, Number(ui.timeYears.value)));
    state.years = years;
    state.appliedYears = Math.min(state.appliedYears, years);
    if (years <= 0) {
      initCracks();
      initPits();
      initPlant();
      state.particles = [];
      state.appliedYears = 0;
      return;
    }
    if (isPhysical()) syncPhysicalCracksToYears();
    else if (isChemical()) syncChemicalPitsToYears();
    else syncBiologicalToYears();
  }

  function syncOutputs() {
    const c = getControls();
    ui.rainOutPhys.textContent = ui.rainfallPhys.value;
    ui.rainOutChem.textContent = ui.rainfallChem.value;
    ui.tempOut.textContent = ui.temperature.value;
    ui.tempOutChem.textContent = ui.temperatureChem.value;
    ui.windOut.textContent = ui.wind.value;
    ui.acidOut.textContent = ui.acidity.value;
    if (ui.moistureBioOut) ui.moistureBioOut.textContent = ui.moistureBio.value;
    if (ui.rootsOut) ui.rootsOut.textContent = ui.rootPressure.value;
    if (ui.lichenOut) ui.lichenOut.textContent = ui.lichenLevel.value;
    const displayYears = state.playing ? Math.round(state.years) : c.years;
    ui.timeOut.textContent = displayYears.toLocaleString();
    if (state.playing) {
      const { years: _y, ...rest } = c;
      Object.assign(state, rest);
    } else {
      Object.assign(state, c);
    }
  }

  function applyModeChrome() {
    const physical = isPhysical();
    const chemical = isChemical();
    const biological = isBiological();
    root.classList.toggle("simulation--physical", physical);
    root.classList.toggle("simulation--chemical", chemical);
    root.classList.toggle("simulation--biological", biological);
    ui.agentsPhysical.hidden = !physical;
    ui.agentsPhysical.classList.toggle("is-hidden", !physical);
    ui.agentsChemical.hidden = !chemical;
    ui.agentsChemical.classList.toggle("is-hidden", !chemical);
    ui.agentsBiological.hidden = !biological;
    ui.agentsBiological.classList.toggle("is-hidden", !biological);
    if (blurb) blurb.textContent = BLURBS[state.weatheringType];
    ui.indexLabel.textContent = biological
      ? "Plant growth"
      : physical
        ? "Breakdown index"
        : "Alteration index";
    ui.processLabel.textContent = biological
      ? "Plant stage"
      : physical
        ? "Active process"
        : "Active reaction";
    ui.indexBar.classList.remove(
      "hud-bar-fill--physical",
      "hud-bar-fill--chemical",
      "hud-bar-fill--biological"
    );
    ui.indexBar.classList.add(
      physical
        ? "hud-bar-fill--physical"
        : chemical
          ? "hud-bar-fill--chemical"
          : "hud-bar-fill--biological"
    );
  }

  function agents() {
    const rain = state.rainfall / 100;
    const temp = state.temperature / 100;
    const wind = state.wind / 100;
    const acid = state.acidity / 100;
    const roots = (state.roots || 0) / 100;
    const lichen = (state.lichen || 0) / 100;

    return {
      rain,
      temp,
      wind,
      acid,
      roots,
      lichen,
      frostWedging: rain * temp * (0.55 + temp * 0.55),
      abrasion: wind * (0.55 + rain * 0.25),
      hydraulic: rain * (0.35 + wind * 0.15),
      dissolution: rain * acid * (0.45 + temp * 0.35),
      hydrolysis: rain * (0.4 + temp * 0.35) * (0.35 + acid * 0.45),
      oxidation: rain * temp * (0.25 + acid * 0.2),
      rootWedging: rain * roots * (0.55 + roots * 0.55) * (0.42 + rain * 0.48),
      lichenAcid: rain * lichen * (0.5 + lichen * 0.5),
      bioColony: rain * (0.38 + lichen * 0.48) * (0.35 + roots * 0.32 + rain * 0.28),
    };
  }

  function rates() {
    const a = agents();
    const t = state.years / SIM.yearSpan;
    const soft = 0.45 + 0.55 * (1 - ROCK.hardness);

    const frost = a.frostWedging * 0.38 + a.abrasion * 0.28 + a.hydraulic * 0.14;
    const physical = ROCK.physicalWeight * frost * soft;
    const chem =
      a.dissolution * 0.4 + a.hydrolysis * 0.35 + a.oxidation * 0.25;
    const chemical = ROCK.chemicalWeight * chem * soft;
    const bio =
      a.rootWedging * 0.38 + a.lichenAcid * 0.34 + a.bioColony * 0.28;
    const biological = ROCK.biologicalWeight * bio * soft;

    const active = isPhysical()
      ? physical
      : isChemical()
        ? chemical
        : biological;
    let intensity = 0;
    if (simulationRunning() && state.years > 0) {
      const timeFactor = 0.16 + Math.pow(Math.min(1, t), 0.52) * 0.84;
      intensity = Math.min(1, active * 3.4 * timeFactor);
    }

    return {
      physical,
      chemical,
      biological,
      intensity,
      active,
      mechanisms: a,
    };
  }

  function crackProgress() {
    if (!state.cracks.length) return 0;
    const avg =
      state.cracks.reduce((sum, crack) => sum + crack.length, 0) / state.cracks.length;
    return Math.min(1, Math.max(0, (avg - 0.17) / 0.5));
  }

  function pitProgress() {
    if (!state.pits.length) return 0;
    const avg = state.pits.reduce((sum, pit) => sum + pit.depth, 0) / state.pits.length;
    return Math.min(1, avg * 1.15);
  }

  /**
   * Chemical mode: 0→1 over elapsed years on yearSpan (agent strength = reaction rate).
   * Rock pits, color, and erosion are synced from this each frame — not accumulated.
   */
  function chemicalAlterationDrive() {
    if (!isChemical() || state.years <= 0) return 0;
    const { active } = rates();
    const years = Math.min(SIM.yearSpan, state.years);
    const t = Math.min(1, years / SIM.yearSpan);
    const curve = 0.64 + Math.min(0.9, active * 2.2) * 0.14;
    return Math.pow(t, curve);
  }

  function biologicalAlterationDrive() {
    if (!isBiological() || state.years <= 0) return 0;
    const { active } = rates();
    const years = Math.min(SIM.yearSpan, state.years);
    const t = Math.min(1, years / SIM.yearSpan);
    const curve = 0.58 + Math.min(0.9, active * 2.1) * 0.14;
    return Math.pow(t, curve);
  }

  /** HUD + rock readout: timeline plus year-synced crack/pit state. */
  function visualWeatherIntensity() {
    if (!simulationRunning() || state.years <= 0) return 0;
    const { intensity, active } = rates();
    const t = Math.min(1, state.years / SIM.yearSpan);
    if (isPhysical()) {
      const timeline = active * (0.12 + t * 0.55);
      const structural = crackProgress();
      return Math.min(1, Math.max(intensity, timeline * 0.85 + structural * 0.72));
    }
    if (isBiological()) {
      const drive = biologicalAlterationDrive();
      const timeline = t * (0.42 + active * 1.15);
      const colony = Math.min(1, drive * (0.48 + active * 1.05));
      const structural = crackProgress();
      const plant = plantProgress();
      const blended = colony * 0.3 + structural * 0.38 + plant * 0.62;
      return Math.min(1, Math.max(blended, timeline * 0.72));
    }
    const drive = chemicalAlterationDrive();
    const reaction = Math.min(1, drive * (0.48 + active * 1.05));
    const structural = pitProgress();
    return Math.min(1, reaction * 0.42 + structural * 0.58);
  }

  function pseudoRandom(n) {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  function crackLimits(kind) {
    switch (kind) {
      case "bedding":
        return { maxLength: 0.9, maxAperture: 9 };
      case "joint":
        return { maxLength: 0.88, maxAperture: 8.5 };
      case "micro":
        return { maxLength: 0.52, maxAperture: 5 };
      case "branch":
        return { maxLength: 0.7, maxAperture: 7 };
      default:
        return { maxLength: 0.85, maxAperture: 8 };
    }
  }

  function newCrackRecord(fields) {
    const limits = crackLimits(fields.kind);
    const length = fields.length;
    const aperture = fields.aperture;
    return {
      branchSpawned: false,
      spawnYear: 0,
      baseLength: length,
      baseAperture: aperture,
      maxLength: limits.maxLength,
      maxAperture: limits.maxAperture,
      ...fields,
      length,
      aperture,
    };
  }

  /** Drive 0→1 from elapsed years on this fracture; reaches 1 only near max year (agent strength scales rate). */
  function crackDriveFor(crack) {
    const { active } = rates();
    const wedging = active * (isBiological() ? 1.45 : 1);
    const years = Math.min(SIM.yearSpan, state.years);
    const ageYears = Math.max(0, years - (crack.spawnYear || 0));
    const lifeSpan = Math.max(1, SIM.yearSpan - (crack.spawnYear || 0));
    const t = Math.min(1, ageYears / lifeSpan);
    const curve = 0.64 + Math.min(0.9, wedging * 2.2) * 0.14;
    return Math.pow(t, curve);
  }

  function syncCracksToYears() {
    const m = agents();
    state.cracks.forEach((crack) => {
      const drive = crackDriveFor(crack);
      const baseL = crack.baseLength;
      const baseA = crack.baseAperture;
      crack.length = baseL + (crack.maxLength - baseL) * drive;
      crack.aperture = baseA + (crack.maxAperture - baseA) * drive;
      const moisture =
        isBiological() ? m.rain * (0.45 + m.roots * 0.35) : m.rain * 0.53;
      crack.waterFill = Math.min(1, 0.12 + drive * (0.35 + moisture));
    });

    state.cracks.forEach((crack) => {
      if (crack.branchSpawned || crack.kind === "micro" || crack.kind === "branch") return;
      const branchYear =
        (0.07 + pseudoRandom(state.seed + crack.originU * 211) * 0.09) * SIM.yearSpan;
      if (state.years >= branchYear) trySpawnBranch(crack);
    });
  }

  function syncPhysicalCracksToYears() {
    syncCracksToYears();
  }

  function plantProgress() {
    if (!state.plant) return 0;
    return Math.min(1, state.plant.growth || 0);
  }

  function initPlant() {
    const crackIdx =
      state.cracks.findIndex((c) => c.kind === "joint") >= 0
        ? state.cracks.findIndex((c) => c.kind === "joint")
        : 1;
    const crack = state.cracks[crackIdx] || state.cracks[0];
    state.plant = {
      growth: 0,
      crackIndex: crackIdx,
      anchorU: crack?.originU ?? 0.42,
      anchorV: crack?.originV ?? 0.28,
      angle: crack?.angle ?? Math.PI * 0.48,
    };
  }

  function syncBiologicalToYears() {
    const m = agents();
    syncCracksToYears();
    if (!state.plant) initPlant();
    const drive = biologicalAlterationDrive();
    const nurture = m.rootWedging * 0.42 + m.bioColony * 0.35 + m.lichenAcid * 0.23;
    const t = Math.min(1, state.years / SIM.yearSpan);
    state.plant.growth = Math.min(1, drive * (0.55 + nurture * 1.35) * (0.25 + t * 0.75));
  }

  function pitDriveFor(pit) {
    const global = chemicalAlterationDrive();
    const { active } = rates();
    const bias = 0.5 + pseudoRandom(state.seed + pit.u * 97 + pit.v * 53) * 0.5;
    return Math.min(1, global * bias * (0.82 + active * 0.28));
  }

  function syncChemicalPitsToYears() {
    const m = agents();
    const chemicalLoad = m.dissolution + m.hydrolysis * 0.65 + m.oxidation * 0.25;
    state.pits.forEach((pit) => {
      const drive = pitDriveFor(pit);
      const baseR = pit.baseRadius != null ? pit.baseRadius : pit.radius;
      pit.baseRadius = baseR;
      pit.depth = Math.min(1, drive * (0.62 + chemicalLoad * 1.85));
      pit.radius = Math.min(0.14, baseR + drive * (0.06 + chemicalLoad * 0.085));
    });
  }

  /** Natural fracture sets — joints propagate from these roots (realistic structure). */
  function initCracks() {
    state.cracks = [];
    const j = (pseudoRandom(state.seed + 7) - 0.5) * 0.05;

    state.cracks.push(
      newCrackRecord({
        kind: "bedding",
        originU: 0.12 + j,
        originV: 0.54 + j * 0.3,
        angle: 0.08 + j,
        length: 0.26,
        aperture: 0.9,
        waterFill: 0.25,
      })
    );

    state.cracks.push(
      newCrackRecord({
        kind: "joint",
        originU: 0.38 + j * 0.5,
        originV: 0.22,
        angle: Math.PI * 0.54 + j * 0.4,
        length: 0.2,
        aperture: 0.75,
        waterFill: 0.18,
      })
    );

    state.cracks.push(
      newCrackRecord({
        kind: "joint",
        originU: 0.58 - j,
        originV: 0.28,
        angle: Math.PI * 0.47,
        length: 0.16,
        aperture: 0.65,
        waterFill: 0.14,
      })
    );

    state.cracks.push(
      newCrackRecord({
        kind: "micro",
        originU: 0.72,
        originV: 0.38,
        angle: Math.PI * 0.35,
        length: 0.1,
        aperture: 0.45,
        waterFill: 0.1,
        branchSpawned: true,
      })
    );
  }

  function initPits() {
    state.pits = [];
    for (let i = 0; i < 14; i++) {
      const baseRadius = 0.035 + pseudoRandom(i) * 0.055;
      state.pits.push({
        u: 0.22 + pseudoRandom(state.seed + i * 11) * 0.58,
        v: 0.28 + pseudoRandom(state.seed + i * 13) * 0.52,
        depth: 0,
        radius: baseRadius,
        baseRadius,
      });
    }
  }

  function getRockSize(erosion) {
    const shrinkRate = isPhysical() ? 0.17 : isBiological() ? 0.22 : 0.42;
    const shrink = Math.max(0.52, 1 - erosion * shrinkRate);
    const w = 328 * shrink;
    const h = w * 0.84;
    return { w, h, rx: w * 0.5, ry: h * 0.5 };
  }

  function buildGranitePattern(seed) {
    const tile = document.createElement("canvas");
    tile.width = tile.height = 96;
    const g = tile.getContext("2d");
    g.fillStyle = "#5e5a56";
    g.fillRect(0, 0, 96, 96);
    for (let i = 0; i < 900; i++) {
      const x = pseudoRandom(seed + i * 1.1) * 96;
      const y = pseudoRandom(seed + i * 2.3) * 96;
      const t = pseudoRandom(seed + i * 3.7);
      if (t > 0.93) g.fillStyle = "#e6e0d6";
      else if (t > 0.86) g.fillStyle = "#bdb5a8";
      else if (t < 0.1) g.fillStyle = "#2a2826";
      else if (t < 0.2) g.fillStyle = "#9a8a78";
      else g.fillStyle = "#6e6a66";
      const s = 0.6 + pseudoRandom(i) * 2.4;
      g.fillRect(x, y, s, s * 0.85);
    }
    return ctx.createPattern(tile, "repeat");
  }

  function uvToLocal(u, v, w, h) {
    return { x: -w / 2 + u * w, y: -h / 2 + v * h };
  }

  function sampleJointPath(crack, w, h) {
    const origin = uvToLocal(crack.originU, crack.originV, w, h);
    const reach = crack.length * Math.min(w, h) * 0.56;
    const steps = 14;
    const pts = [];
    const jSeed = state.seed + crack.originU * 79 + crack.originV * 91;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wave =
        Math.sin(t * Math.PI * 2.2 + jSeed) * 1.1 * t +
        (pseudoRandom(jSeed + i * 3.1) - 0.5) * 1.4 * t;
      const px = origin.x + Math.cos(crack.angle) * reach * t - Math.sin(crack.angle) * wave;
      const py = origin.y + Math.sin(crack.angle) * reach * t + Math.cos(crack.angle) * wave * 0.55;
      pts.push({ x: px, y: py, t });
    }
    return pts;
  }

  function tangentAt(pts, i) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const m = Math.hypot(dx, dy) || 1;
    return { nx: -dy / m, ny: dx / m, tx: dx / m, ty: dy / m };
  }

  function traceSmoothPathOpen(pts) {
    if (pts.length < 2) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 2) {
      ctx.lineTo(pts[1].x, pts[1].y);
      return;
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    const n = pts.length - 1;
    ctx.quadraticCurveTo(pts[n - 1].x, pts[n - 1].y, pts[n].x, pts[n].y);
  }

  /** Tapered hairline-to-groove strokes — reads as natural joints on stone. */
  function drawJointFissure(crack, w, h, intensity) {
    if (intensity <= 0) return;

    const a = agents();
    const activity = crack.waterFill * a.frostWedging;
    const structural = Math.min(
      1,
      (crack.length - 0.1) * 1.25 + crack.aperture * 0.07 + activity * 0.35
    );
    const open = Math.min(
      1,
      Math.max(intensity * 0.65, structural * 0.82) + crack.aperture * 0.04
    );

    if (open < 0.05 && crack.kind === "micro") return;

    const pts = sampleJointPath(crack, w, h);
    const base =
      crack.kind === "bedding" ? 1.1 : crack.kind === "micro" ? 0.55 : 0.85;
    const maxW = base + crack.aperture * 0.18 + open * 2.2;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalCompositeOperation = "multiply";

    const shadowPts = pts.map((p) => ({ x: p.x + 1.2, y: p.y + 1.8, t: p.t }));
    ctx.save();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = maxW + 1.5;
    ctx.filter = "blur(1.5px)";
    ctx.beginPath();
    traceSmoothPathOpen(shadowPts);
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < pts.length - 1; i++) {
      const tMid = (pts[i].t + pts[i + 1].t) / 2;
      const segW = Math.max(0.45, maxW * (1.02 - tMid * 0.88));
      const { nx, ny } = tangentAt(pts, i);

      ctx.strokeStyle = `rgba(12, 11, 10, ${0.85 + open * 0.1})`;
      ctx.lineWidth = segW;
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
      ctx.stroke();

      ctx.strokeStyle = `rgba(55, 50, 46, ${0.25 + open * 0.35})`;
      ctx.lineWidth = Math.max(0.35, segW * 0.22);
      ctx.beginPath();
      ctx.moveTo(pts[i].x + nx * segW * 0.28, pts[i].y + ny * segW * 0.28);
      ctx.lineTo(pts[i + 1].x + nx * segW * 0.28, pts[i + 1].y + ny * segW * 0.28);
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
    const lip = maxW * 0.22;
    ctx.strokeStyle = `rgba(220, 212, 198, ${0.22 + open * 0.38})`;
    ctx.lineWidth = Math.max(0.5, lip);
    ctx.beginPath();
    const lipPts = pts.map((p, idx) => {
      const { nx, ny } = tangentAt(pts, idx);
      return { x: p.x - nx * maxW * 0.32, y: p.y - ny * maxW * 0.32 };
    });
    traceSmoothPathOpen(lipPts);
    ctx.stroke();

    if (crack.kind === "bedding" && crack.length > 0.4 && open > 0.25) {
      const i = Math.floor(pts.length * 0.44);
      const p = pts[i];
      const notch = maxW * 1.8;
      ctx.fillStyle = `rgba(10, 9, 8, ${0.35 + open * 0.3})`;
      ctx.beginPath();
      ctx.moveTo(p.x - notch, p.y);
      ctx.lineTo(p.x + notch * 0.25, p.y);
      ctx.lineTo(p.x + notch * 0.25, p.y + notch * 0.55);
      ctx.lineTo(p.x - notch, p.y + notch * 0.35);
      ctx.closePath();
      ctx.fill();
    }

    if (isPhysical() && crack.waterFill > 0.45 && a.temp > 0.3) {
      ctx.strokeStyle = `rgba(185, 210, 228, ${crack.waterFill * a.temp * 0.18})`;
      ctx.lineWidth = Math.max(0.4, maxW * 0.12);
      ctx.beginPath();
      traceSmoothPathOpen(pts.slice(0, Math.min(4, pts.length)));
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawAllJoints(w, h, intensity) {
    const ordered = [...state.cracks].sort((a, b) => {
      const rank = { micro: 0, joint: 1, bedding: 2, branch: 1 };
      return (rank[a.kind] || 1) - (rank[b.kind] || 1);
    });
    ordered.forEach((crack) => drawJointFissure(crack, w, h, intensity));
  }

  /** Soft karst / leaching patches — no joint-style fractures. */
  function drawChemicalLeachingPatches(rx, ry, intensity, m) {
    if (intensity < 0.06) return;
    const patches = 10 + Math.floor(intensity * 18);
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < patches; i++) {
      const a = pseudoRandom(state.seed + i * 19) * Math.PI * 2;
      const r = 0.12 + pseudoRandom(state.seed + i * 7) * 0.55;
      const p = rockPointAt(a, rx * r, ry * r, intensity * 0.35);
      const bleed = (0.35 + pseudoRandom(i) * 0.65) * (18 + intensity * 42) * (0.7 + m.dissolution * 0.5);
      const clay = m.hydrolysis > 0.22;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, bleed);
      g.addColorStop(0, clay ? "rgba(82, 78, 58, 0.42)" : "rgba(70, 88, 72, 0.32)");
      g.addColorStop(0.55, clay ? "rgba(95, 88, 68, 0.18)" : "rgba(58, 72, 62, 0.14)");
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(
        p.x,
        p.y,
        bleed * (0.85 + pseudoRandom(i * 3) * 0.35),
        bleed * (0.55 + pseudoRandom(i * 5) * 0.4),
        a * 0.3,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.restore();
  }

  /** Rounded scallops where acid runoff undercuts the boulder — mass loss, not cracking. */
  function drawChemicalEdgeUndercut(rx, ry, erosion, intensity, m) {
    if (intensity < 0.08) return;
    const bites = 7 + Math.floor(intensity * 14);
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < bites; i++) {
      const a = -Math.PI * 0.15 + (i / bites) * Math.PI * 1.35 + pseudoRandom(state.seed + i * 41) * 0.2;
      const p = rockPointAt(a, rx, ry, erosion);
      const bite = (4 + pseudoRandom(i) * 10) * (0.35 + intensity * 0.85) * (0.6 + m.dissolution * 0.5);
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y + bite * 0.4, bite * 1.8);
      g.addColorStop(0, "rgba(18, 20, 17, 0.55)");
      g.addColorStop(0.5, "rgba(45, 52, 44, 0.22)");
      g.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, bite, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawChemicalPits(rw, rh, intensity, m) {
    state.pits.forEach((pit) => {
      if (pit.depth < 0.04) return;
      const px = -rw / 2 + pit.u * rw;
      const py = -rh / 2 + pit.v * rh;
      const pr = pit.radius * rw * (0.7 + pit.depth * 1.15);

      if (m.oxidation > 0.18) {
        const or = pr * (1.35 + m.oxidation * 0.4);
        const og = ctx.createRadialGradient(px, py, pr * 0.3, px, py, or);
        og.addColorStop(0, `rgba(160, 96, 68, ${0.15 + pit.depth * m.oxidation * 0.35})`);
        og.addColorStop(1, "rgba(160, 96, 68, 0)");
        ctx.fillStyle = og;
        ctx.beginPath();
        ctx.arc(px, py, or, 0, Math.PI * 2);
        ctx.fill();
      }

      const g = ctx.createRadialGradient(px, py, 0, px, py, pr);
      g.addColorStop(0, `rgba(8, 10, 9, ${0.75 + pit.depth * 0.28})`);
      g.addColorStop(0.45, `rgba(32, 38, 34, ${0.35 * pit.depth})`);
      g.addColorStop(0.78, `rgba(70, 88, 72, ${0.18 * pit.depth * (0.5 + m.hydrolysis)})`);
      g.addColorStop(1, "rgba(35, 40, 36, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function drawChemicalAcidSheen(rx, ry, erosion, intensity, m) {
    if (intensity < 0.06) return;
    const acid = state.acidity / 100;
    ctx.globalAlpha = (0.08 + acid * 0.2) * intensity;
    const sg = ctx.createRadialGradient(-rx * 0.15, -ry * 0.35, 0, 0, ry * 0.1, rx * 0.95);
    sg.addColorStop(0, lerpColor("#a8c4a8", "#7a9a88", m.hydrolysis));
    sg.addColorStop(0.55, "rgba(90, 120, 100, 0.35)");
    sg.addColorStop(1, "rgba(90, 120, 100, 0)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    traceRockPath(rx, ry, erosion);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  /** Single plant rooted in one joint — growth 0→1 from elapsed years. */
  function drawRockPlant(w, h, growth, m) {
    if (growth < 0.02 || !state.plant) return;
    const crack = state.cracks[state.plant.crackIndex];
    if (!crack) return;

    const pts = sampleJointPath(crack, w, h);
    const mount = pts[Math.floor(pts.length * 0.35)] || pts[0];
    const outward = crack.angle - Math.PI * 0.42;
    const stemLen = (28 + growth * 95) * (0.85 + m.roots * 0.25);
    const topX = mount.x + Math.cos(outward) * stemLen * 0.55;
    const topY = mount.y + Math.sin(outward) * stemLen - stemLen * 0.55;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const rootAlpha = 0.35 + growth * m.roots * 0.55;
    ctx.strokeStyle = `rgba(62, 78, 48, ${rootAlpha})`;
    ctx.lineWidth = 1.4 + growth * m.roots * 3.2;
    ctx.beginPath();
    ctx.moveTo(mount.x, mount.y);
    const rootTip = pts[Math.min(pts.length - 1, Math.floor(pts.length * 0.72))];
    ctx.quadraticCurveTo(
      mount.x + Math.cos(crack.angle) * 12,
      mount.y + Math.sin(crack.angle) * 10,
      rootTip.x,
      rootTip.y
    );
    ctx.stroke();
    if (growth > 0.25) {
      ctx.beginPath();
      ctx.moveTo(mount.x, mount.y);
      const branchTip = pts[Math.floor(pts.length * 0.5)];
      ctx.quadraticCurveTo(mount.x - 6, mount.y + 8, branchTip.x * 0.92, branchTip.y * 0.92);
      ctx.stroke();
    }

    ctx.strokeStyle = `rgba(52, 78, 44, ${0.55 + growth * 0.4})`;
    ctx.lineWidth = 2.2 + growth * 2.8;
    ctx.beginPath();
    ctx.moveTo(mount.x, mount.y);
    ctx.quadraticCurveTo(
      mount.x + Math.cos(outward) * stemLen * 0.35,
      mount.y + Math.sin(outward) * stemLen * 0.25 - stemLen * 0.35,
      topX,
      topY
    );
    ctx.stroke();

    const leafCount = 1 + Math.floor(growth * 5);
    for (let i = 0; i < leafCount; i++) {
      const t = (i + 1) / (leafCount + 1);
      const lx = mount.x + (topX - mount.x) * t;
      const ly = mount.y + (topY - mount.y) * t;
      const leafW = (10 + growth * 16) * (0.85 + (1 - t) * 0.25);
      const tilt = outward + (i % 2 === 0 ? 0.55 : -0.55);
      ctx.fillStyle = `rgba(58, 98, 52, ${0.5 + growth * 0.45})`;
      ctx.beginPath();
      ctx.ellipse(lx + Math.cos(tilt) * leafW * 0.45, ly + Math.sin(tilt) * 4, leafW, 5.5, tilt, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(lx - Math.cos(tilt) * leafW * 0.4, ly - 2, leafW * 0.85, 5, -tilt, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawWeatheringOnRock(w, h, intensity, rx, ry, erosion, m) {
    const crackMode = isPhysical() || isBiological();
    const drawIntensity = crackMode
      ? Math.max(intensity, visualWeatherIntensity() * 0.45)
      : intensity;
    if (drawIntensity <= 0) return;
    if (isPhysical()) {
      drawAllJoints(w, h, drawIntensity);
    } else if (isBiological()) {
      const crack = state.plant ? state.cracks[state.plant.crackIndex] : null;
      state.cracks.forEach((c) => {
        const emphasis = crack && c === crack ? drawIntensity : drawIntensity * 0.35;
        drawJointFissure(c, w, h, emphasis);
      });
      drawRockPlant(w, h, plantProgress(), m);
    } else {
      drawChemicalLeachingPatches(rx, ry, drawIntensity, m);
      drawChemicalAcidSheen(rx, ry, erosion, drawIntensity, m);
      drawChemicalPits(w, h, drawIntensity, m);
      drawChemicalEdgeUndercut(rx, ry, erosion, drawIntensity, m);
    }
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function lerpColor(hexA, hexB, t) {
    const a = hexToRgb(hexA);
    const b = hexToRgb(hexB);
    return `rgb(${Math.round(a.r + (b.r - a.r) * t)},${Math.round(a.g + (b.g - a.g) * t)},${Math.round(a.b + (b.b - a.b) * t)})`;
  }

  function rockPointAt(angle, rx, ry, erosion) {
    const facetN = 9;
    const step = (Math.PI * 2) / facetN;
    const snapped = Math.floor(angle / step + 0.5) * step;
    const facetAmp = 0.1 + pseudoRandom(state.seed + Math.floor(snapped * 40)) * 0.11;
    const chipped = Math.sin(snapped * 5 + state.seed) * 0.04;
    const fine = (pseudoRandom(state.seed + Math.floor(angle * 28)) - 0.5) * 0.035;
    const edgeEat = isPhysical()
      ? erosion * 0.1
      : isBiological()
        ? erosion * 0.16
        : erosion * 0.28;
    let wobble = 1 - edgeEat - facetAmp - chipped - fine;

    const sx = Math.cos(angle);
    const sy = Math.sin(angle);
    const wideBase = sy > 0.2 ? 1 + sy * 0.16 : 1;
    const peak = sy < -0.35 ? 0.84 + sy * 0.12 : 1;

    return {
      x: sx * rx * wobble * wideBase,
      y: sy * ry * wobble * peak,
    };
  }

  function traceRockPath(rx, ry, erosion) {
    const steps = 72;
    for (let i = 0; i <= steps; i++) {
      const angle = (i / steps) * Math.PI * 2;
      const p = rockPointAt(angle, rx, ry, erosion);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }

  function facetShade(angle, mix) {
    const ndotl = Math.cos(angle - LIGHT_DIR) * 0.5 + 0.5;
    const lit = 0.18 + ndotl * 0.82;
    const base = lerpColor(ROCK.mid, ROCK.altered[0], mix * 0.7);
    let shaded = lerpColor(ROCK.dark, base, lit);
    if (Math.cos(angle) > 0.35) {
      shaded = lerpColor(shaded, ROCK.stain, 0.12 + Math.cos(angle) * 0.18);
    }
    return lerpColor(shaded, ROCK.light, ndotl * 0.32);
  }

  function drawRockOxidationStain(rx, ry, erosion, mix) {
    const og = ctx.createLinearGradient(-rx, -ry * 0.3, rx, ry * 0.2);
    og.addColorStop(0, "rgba(90, 78, 68, 0)");
    og.addColorStop(0.45, "rgba(100, 85, 72, 0.04)");
    og.addColorStop(0.72, `rgba(148, 112, 82, ${0.22 + mix * 0.18})`);
    og.addColorStop(1, `rgba(122, 90, 65, ${0.38 + mix * 0.22})`);
    ctx.fillStyle = og;
    ctx.beginPath();
    traceRockPath(rx, ry, erosion);
    ctx.fill();
  }

  function drawRockFacetedSurface(rx, ry, erosion, mix) {
    const segments = 11;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const mid = (a0 + a1) / 2;
      const p0 = rockPointAt(a0, rx, ry, erosion);
      const p1 = rockPointAt(a1, rx, ry, erosion);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.closePath();
      ctx.fillStyle = facetShade(mid, mix);
      ctx.fill();
    }
  }

  function drawRockChippedEdges(rx, ry, erosion) {
    const facets = 9;
    const step = (Math.PI * 2) / facets;
    ctx.fillStyle = "rgba(20, 18, 16, 0.35)";
    for (let i = 0; i < facets; i++) {
      const a = i * step + step * 0.5;
      const p = rockPointAt(a, rx, ry, erosion);
      const chip = 2 + pseudoRandom(state.seed + i) * 4;
      ctx.beginPath();
      ctx.arc(p.x, p.y, chip, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function trySpawnBranch(crack) {
    if (crack.branchSpawned) return;
    const tipU = crack.originU + Math.cos(crack.angle) * crack.length * 0.52;
    const tipV = crack.originV + Math.sin(crack.angle) * crack.length * 0.48;
    crack.branchSpawned = true;
    const sign = pseudoRandom(state.seed + crack.originU * 137) > 0.5 ? 1 : -1;
    const baseLength = 0.08;
    const baseAperture = Math.min(crack.aperture * 0.55, 4.2);
    state.cracks.push(
      newCrackRecord({
        kind: "branch",
        originU: Math.min(0.92, Math.max(0.06, tipU)),
        originV: Math.min(0.88, Math.max(0.1, tipV)),
        angle: crack.angle + sign * (Math.PI / 3.1),
        length: baseLength,
        aperture: baseAperture,
        waterFill: crack.waterFill * 0.75,
        spawnYear: state.years,
        baseLength,
        baseAperture,
        branchSpawned: true,
      })
    );
  }

  function drawRockGrain(rx, ry, erosion, mix) {
    const grains = 180;
    for (let i = 0; i < grains; i++) {
      const a = pseudoRandom(state.seed + i * 1.7) * Math.PI * 2;
      const pr = rockPointAt(a, rx, ry, erosion);
      const dist = pseudoRandom(state.seed + i * 2.3);
      const gx = pr.x * (0.15 + dist * 0.82);
      const gy = pr.y * (0.15 + dist * 0.82);
      const tone = pseudoRandom(state.seed + i * 5.1);
      let color;
      if (tone > 0.92) color = ROCK.speckleLight;
      else if (tone > 0.82) color = ROCK.mica;
      else if (tone < 0.12) color = ROCK.speckleDark;
      else color = lerpColor(ROCK.base[1], ROCK.altered[1], mix * 0.4);
      const size = 0.6 + pseudoRandom(i * 9) * 2.2;
      ctx.globalAlpha = 0.12 + pseudoRandom(i) * 0.35;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(gx, gy, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawRockVeins(rx, ry, erosion) {
    ctx.lineCap = "round";
    const veins = 6 + Math.floor(pseudoRandom(state.seed + 99) * 4);
    for (let v = 0; v < veins; v++) {
      const a = pseudoRandom(state.seed + v * 17) * Math.PI * 2;
      const startR = 0.08 + pseudoRandom(v) * 0.15;
      const endR = 0.55 + pseudoRandom(v * 3) * 0.45;
      const p0 = rockPointAt(a, rx * startR, ry * startR, erosion * 0.3);
      const p1 = rockPointAt(a + 0.08, rx * endR, ry * endR, erosion);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.quadraticCurveTo(p0.x * 0.6, p0.y * 0.6, p1.x, p1.y);
      ctx.strokeStyle = `rgba(35, 32, 30, ${0.15 + pseudoRandom(v) * 0.2})`;
      ctx.lineWidth = 0.6 + pseudoRandom(v * 2) * 1.4;
      ctx.stroke();
    }
  }

  function drawRockHighlight(rx, ry) {
    const hx = -rx * 0.38;
    const hy = -ry * 0.42;
    const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, rx * 0.55);
    hg.addColorStop(0, "rgba(255, 248, 240, 0.22)");
    hg.addColorStop(0.45, "rgba(255, 248, 240, 0.06)");
    hg.addColorStop(1, "rgba(255, 248, 240, 0)");
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.ellipse(hx, hy, rx * 0.48, ry * 0.38, -0.35, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRockBaseMoss(rx, ry, erosion) {
    const mg = ctx.createLinearGradient(0, ry * 0.2, 0, ry * 0.95);
    mg.addColorStop(0, "rgba(40, 50, 38, 0)");
    mg.addColorStop(0.55, "rgba(40, 50, 38, 0.08)");
    mg.addColorStop(1, "rgba(30, 38, 28, 0.35)");
    ctx.fillStyle = mg;
    ctx.beginPath();
    traceRockPath(rx, ry, erosion);
    ctx.fill();
  }

  function drawContactShadow(cx, cy, rx, ry) {
    ctx.save();
    ctx.translate(cx, cy + ry * 0.88);
    ctx.scale(1, 0.18);
    const sg = ctx.createRadialGradient(0, 0, rx * 0.1, 0, 0, rx * 1.25);
    sg.addColorStop(0, "rgba(0, 0, 0, 0.5)");
    sg.addColorStop(0.55, "rgba(0, 0, 0, 0.25)");
    sg.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(0, 0, rx * 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function spawnSediment(yearDelta) {
    if (yearDelta <= 0) return;
    const { intensity, active } = rates();
    const physical = isPhysical();
    const biological = isBiological();
    const weather = physical
      ? intensity
      : biological
        ? biologicalAlterationDrive() * (0.32 + active * 0.62)
        : chemicalAlterationDrive() * (0.35 + active * 0.75);
    if (weather < 0.04) return;
    const w = canvas.width;
    const h = canvas.height;
    const groundY = h * 0.78;
    const sedimentMul = physical ? 1 : biological ? 0.55 : 0.7;
    const count = Math.floor(weather * yearDelta * SIM.sedimentPerYear * sedimentMul);
    for (let i = 0; i < count; i++) {
      state.particles.push({
        x: w * (0.3 + pseudoRandom(state.years + state.particles.length) * 0.4),
        y: h * 0.55 - 60 - pseudoRandom(state.seed + i) * 50,
        vx: (pseudoRandom(i) - 0.5) * (physical ? 1.4 : biological ? 0.7 : 0.5),
        vy: 0.4 + pseudoRandom(i) * 1.1,
        size: physical
          ? 2 + pseudoRandom(i * 3) * 4
          : biological
            ? 1.2 + pseudoRandom(i * 2) * 2.8
            : 1 + pseudoRandom(i) * 2.5,
        settled: false,
        settleY: groundY + pseudoRandom(i) * 24,
        tone: pseudoRandom(i),
        organic: biological && pseudoRandom(i * 19) > 0.55,
      });
    }
    if (state.particles.length > 350) state.particles = state.particles.slice(-350);
  }

  function applyWeatheringYears(yearDelta) {
    if (yearDelta <= 0 || !simulationRunning() || state.years <= 0) return;
    spawnSediment(yearDelta);
  }

  function consumeYearDelta() {
    let delta = Math.max(0, state.years - state.appliedYears);
    if (delta <= 0) return;
    const chunk = Math.min(delta, SIM.maxWeatherYearsPerFrame);
    applyWeatheringYears(chunk);
    state.appliedYears += chunk;
  }

  function updateDynamics() {
    consumeYearDelta();
    if (state.years > 0) {
      if (isPhysical()) syncPhysicalCracksToYears();
      else if (isChemical()) syncChemicalPitsToYears();
      else syncBiologicalToYears();
    }

    state.particles.forEach((p) => {
      if (p.settled) return;
      p.vy += 0.06;
      p.x += p.vx + (isPhysical() ? state.wind * 0.003 : 0);
      p.y += p.vy;
      if (p.y >= p.settleY) {
        p.y = p.settleY;
        p.settled = true;
      }
    });
  }

  function drawSky(w, h) {
    const grad = ctx.createLinearGradient(0, 0, 0, h * 0.75);
    if (isPhysical()) {
      grad.addColorStop(0, "#1e2838");
      grad.addColorStop(0.5, "#2d3a34");
      grad.addColorStop(1, "#3d4a3f");
    } else if (isBiological()) {
      grad.addColorStop(0, "#1a2830");
      grad.addColorStop(0.45, "#243832");
      grad.addColorStop(1, "#324a38");
    } else {
      grad.addColorStop(0, "#1a2a28");
      grad.addColorStop(0.45, "#243530");
      grad.addColorStop(1, "#354438");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const cloudOpacity =
      0.06 +
      (state.rainfall / 100) *
        (isPhysical() ? 0.12 : isBiological() ? 0.18 : 0.22);
    ctx.fillStyle = isPhysical()
      ? "rgba(120, 140, 160, 0.2)"
      : isBiological()
        ? "rgba(88, 130, 108, 0.22)"
        : "rgba(74, 124, 143, 0.22)";
    for (let i = 0; i < 4; i++) {
      const cx = ((i * 0.22 + state.years * 0.00002) % 1) * w;
      const cy = h * (0.1 + i * 0.05);
      ctx.globalAlpha = cloudOpacity;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 85 + i * 18, 26, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawGround(w, h) {
    const groundY = h * 0.78;
    const grad = ctx.createLinearGradient(0, groundY - 40, 0, h);
    grad.addColorStop(
      0,
      isPhysical() ? "#4a4238" : isBiological() ? "#3e4838" : "#424838"
    );
    grad.addColorStop(
      0.08,
      isPhysical() ? "#3a3228" : isBiological() ? "#2e382c" : "#323828"
    );
    grad.addColorStop(1, "#241f1a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, groundY, w, h - groundY);

    for (let i = 0; i < 120; i++) {
      const gx = pseudoRandom(state.seed + i * 4.1) * w;
      const gy = groundY + 6 + pseudoRandom(i * 2.7) * (h - groundY - 10);
      ctx.fillStyle = `rgba(0, 0, 0, ${0.04 + pseudoRandom(i) * 0.06})`;
      ctx.fillRect(gx, gy, 1 + pseudoRandom(i) * 3, 1);
    }

    ctx.fillStyle = "rgba(75, 95, 58, 0.35)";
    ctx.fillRect(0, groundY - 4, w, 12);

    if (isChemical() && visualWeatherIntensity() > 0.12) {
      ctx.fillStyle = `rgba(90, 140, 110, ${0.08 + (state.acidity / 100) * 0.15})`;
      ctx.fillRect(0, groundY + 4, w, 20);
    }
  }

  function drawRain(w, h) {
    if (state.rainfall < 10) return;
    const intensity = state.rainfall / 100;
    const physical = isPhysical();
    const biological = isBiological();
    ctx.strokeStyle = physical
      ? `rgba(160, 180, 200, ${0.12 + intensity * 0.25})`
      : biological
        ? `rgba(120, 175, 140, ${0.14 + intensity * 0.32})`
        : `rgba(100, 160, 140, ${0.18 + intensity * 0.4})`;
    const lines = Math.floor(
      30 + intensity * (physical ? 90 : biological ? 110 : 140)
    );
    for (let i = 0; i < lines; i++) {
      const x = pseudoRandom(state.years + i + 100) * w;
      const y = pseudoRandom(i * 7) * h * 0.5 + ((Date.now() / 8 + i * 17) % (h * 0.55));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - (physical ? 6 : biological ? 4 : 3), y + 14);
      ctx.stroke();
    }
  }

  function drawWind(w, h) {
    if (!isPhysical() || state.wind < 15) return;
    const strength = state.wind / 100;
    ctx.strokeStyle = `rgba(200, 210, 220, ${0.08 + strength * 0.2})`;
    for (let i = 0; i < 12 + strength * 20; i++) {
      const y = h * (0.2 + pseudoRandom(i) * 0.45);
      const x0 = ((Date.now() / 40 + i * 80) % (w + 120)) - 60;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x0 + 40 + strength * 60, y - 3);
      ctx.stroke();
    }
  }

  function drawBoulder(w, h) {
    const { mechanisms: m } = rates();
    const intensity = visualWeatherIntensity();
    const physical = isPhysical();
    const biological = isBiological();
    const cx = w * 0.5;
    const cy = h * 0.52;
    const t = Math.min(1, state.years / SIM.yearSpan);
    const erosion = physical
      ? Math.min(0.92, intensity * SIM.erosionMul * 0.58 + t * 0.08)
      : biological
        ? Math.min(0.92, intensity * SIM.erosionMul * 0.72 + t * 0.05)
        : Math.min(0.92, intensity * SIM.erosionMul * 0.9);
    const mix = intensity * (physical ? 0.35 : biological ? 0.52 : 0.88);
    const { w: rw, h: rh, rx, ry } = getRockSize(erosion);

    drawContactShadow(cx, cy, rx, ry);

    ctx.save();
    ctx.translate(cx, cy);

    ctx.beginPath();
    traceRockPath(rx, ry, erosion);
    ctx.fillStyle = ROCK.dark;
    ctx.shadowColor = "rgba(0, 0, 0, 0.42)";
    ctx.shadowBlur = 26;
    ctx.shadowOffsetX = 7;
    ctx.shadowOffsetY = 16;
    ctx.fill();
    ctx.shadowColor = "transparent";

    if (state.patternSeed !== state.seed) {
      granitePattern = buildGranitePattern(state.seed);
      state.patternSeed = state.seed;
    }

    ctx.save();
    ctx.beginPath();
    traceRockPath(rx, ry, erosion);
    ctx.clip();
    drawRockFacetedSurface(rx, ry, erosion, mix);
    ctx.globalAlpha = 0.48;
    ctx.fillStyle = granitePattern;
    ctx.fillRect(-rx, -ry, rw, rh);
    ctx.globalAlpha = 1;
    drawRockGrain(rx, ry, erosion, mix);
    drawRockVeins(rx, ry, erosion);
    drawRockOxidationStain(rx, ry, erosion, mix);

    if (isChemical() && intensity > 0.1) {
      ctx.globalAlpha = 0.22 * intensity;
      ctx.fillStyle = lerpColor(ROCK.altered[1], "#8a9a7a", m?.hydrolysis || 0.4);
      ctx.beginPath();
      traceRockPath(rx, ry, erosion);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    drawRockBaseMoss(rx, ry, erosion);
    drawRockHighlight(rx, ry);
    drawWeatheringOnRock(rw, rh, intensity, rx, ry, erosion, m);

    ctx.restore();

    if (physical) drawRockChippedEdges(rx, ry, erosion);

    if (physical && state.temperature > 30 && intensity > 0.08) {
      const frost = (state.temperature / 100) * intensity;
      ctx.fillStyle = `rgba(210, 230, 255, ${0.15 + frost * 0.35})`;
      for (let s = 0; s < 5; s++) {
        const pt = uvToLocal(
          0.15 + pseudoRandom(state.seed + s) * 0.7,
          0.2 + pseudoRandom(state.seed + s * 2) * 0.35,
          rw,
          rh
        );
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2 + frost * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function drawParticles() {
    state.particles.forEach((p) => {
      ctx.globalAlpha = p.settled ? 0.88 : 0.65;
      if (isPhysical()) {
        ctx.fillStyle = lerpColor(ROCK.base[1], ROCK.mid, 0.3);
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size * 0.85);
      } else if (p.organic) {
        ctx.fillStyle = p.tone > 0.5 ? "#4a6a42" : "#3a5238";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 1.1, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = p.tone > 0.5 ? "#6a9478" : ROCK.altered[1];
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
  }

  function updateHud() {
    const { mechanisms: m } = rates();
    const intensity = visualWeatherIntensity();
    const pct = Math.round(intensity * 100);
    ui.weatheringIndex.textContent = pct + "%";
    ui.indexBar.style.width = pct + "%";

    let label = "Ready — advance time or press Play";
    if (!simulationRunning()) {
      ui.dominantProcess.textContent = label;
      return;
    }
    label = "Intact — natural joints present";
    if (isPhysical()) {
      const ranked = [
        ["Frost wedging (ice expansion in fractures)", m.frostWedging],
        ["Abrasion (wind-blown sediment)", m.abrasion],
        ["Hydraulic stress / runoff", m.hydraulic],
      ].sort((a, b) => b[1] - a[1]);
      if (intensity > 0.08) label = ranked[0][0];
      if (intensity > 0.55) label = "Joint propagation & block loosening";
    } else if (isBiological()) {
      const grow = plantProgress();
      label = "Empty joint — seed not germinated";
      if (grow > 0.06) label = "Seedling in fracture";
      if (grow > 0.22) label = "Root wedging";
      if (grow > 0.45) label = "Plant growth & joint widening";
      if (grow > 0.72) label = "Mature plant — deep root wedging";
    } else {
      label = "Unweathered surface";
      if (intensity > 0.1) label = "Surface leaching";
      if (intensity > 0.28) {
        label = state.acidity > 40 ? "Acid hydrolysis" : "Dissolution & oxidation";
      }
      if (intensity > 0.52) label = "Advanced chemical alteration";
      if (intensity > 0.72) label = "Deep pitting & clay formation";
    }
    ui.dominantProcess.textContent = label;
  }

  function render() {
    const w = canvas.width;
    const h = canvas.height;
    drawSky(w, h);
    drawWind(w, h);
    drawRain(w, h);
    drawGround(w, h);
    drawBoulder(w, h);
    drawParticles();
    updateHud();
  }

  function tick(timestamp) {
    if (state.playing) {
      const dt = state.lastTick ? timestamp - state.lastTick : 16;
      state.lastTick = timestamp;
      state.years = Math.min(SIM.yearSpan, state.years + playYearsElapsedMs(dt));
      ui.timeYears.value = String(Math.round(state.years));
      syncOutputs();
    } else {
      state.lastTick = 0;
    }
    updateDynamics();
    render();
    requestAnimationFrame(tick);
  }

  function resetSimulation() {
    state.seed = Math.random() * 1000;
    state.patternSeed = null;
    state.particles = [];
    state.years = 0;
    state.appliedYears = 0;
    ui.timeYears.value = "0";
    initCracks();
    initPits();
    initPlant();
    syncOutputs();
    applyModeChrome();
    render();
  }

  function fitCanvas() {
    const wrap = canvas.parentElement;
    const ratio = canvas.width / canvas.height;
    canvas.style.width = wrap.clientWidth + "px";
    canvas.style.height = wrap.clientWidth / ratio + "px";
  }

  form.addEventListener("input", (ev) => {
    const t = ev.target;
    if (t.name === "weatheringType") {
      syncOutputs();
      applyModeChrome();
      resetSimulation();
      return;
    }
    syncOutputs();
    if (t.name === "timeYears") {
      applyElapsedYearsFromControls();
    } else if (Number(ui.timeYears.value) === 0) {
      initCracks();
      initPits();
      initPlant();
      state.particles = [];
      state.appliedYears = 0;
    } else if (isBiological() && state.years > 0) {
      syncBiologicalToYears();
    }
  });

  ui.playPause.addEventListener("click", () => {
    state.playing = !state.playing;
    ui.playPause.setAttribute("aria-pressed", String(state.playing));
    ui.playPause.querySelector(".play-label").textContent = state.playing ? "Pause" : "Play";
  });

  ui.resetSim.addEventListener("click", resetSimulation);
  window.addEventListener("resize", fitCanvas);
  window.addEventListener("orientationchange", () => {
    requestAnimationFrame(fitCanvas);
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", fitCanvas);
  }

  initCracks();
  initPits();
  initPlant();
  syncOutputs();
  applyModeChrome();
  fitCanvas();
  requestAnimationFrame(tick);
})();
