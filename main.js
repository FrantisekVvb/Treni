const padWrap = document.getElementById("padWrap");
const stageEl = document.getElementById("stage");
const resetBtn = document.getElementById("resetBtn");
const flipBeamBtn = document.getElementById("flipBeamBtn");
const beamBtnEls = [...document.querySelectorAll("[data-beam-type]")];
const surfaceBtnEls = [...document.querySelectorAll("[data-surface-type]")];
const beamMassEl = document.getElementById("beamMassEl");

if (!padWrap) {
  throw new Error("Chybí základní prvky scény.");
}

/** N per pixel of pull drag at reference (dřevo, statický práh) */
const SPRING_K_WOOD = 0.045;
const WOOD_MASS_G = 600;
const WOOD_MASS_2KG_G = 2000;
/** Tíhové zrychlení: 10 N/kg (1 kg → 10 N) */
const GRAVITY = 10;
/** Dřevo–kov / kov–dřevo — stejný pár, stejné μ_k */
const MU_K_METAL_WOOD = 0.4;
const MU_K_METAL_STEEL = 0.1;
const MU_K_LEATHER_WOOD = 0.6;
const MU_K_LEATHER_STEEL = 0.18;
/** Koberec: stejné μ_k vůči dřevu i oceli */
const MU_K_CARPET = 1.5;
/** Dřevo–dřevo */
const MU_K_WOOD_WOOD = 0.3;
/** Led: stejné μ_k vůči dřevu i oceli */
const MU_K_ICE = 0.02;
/** Nad touto třecí silou se hranol nepohne */
const FRICTION_IMMOVEABLE_N = 20;
/** Jmenovitý rozsah siloměru (N) */
const SILOMER_RATED_N = 20;
/** Nad 20 N se pružina krátce přetáhne a přetrhne */
const SILOMER_BREAK_FORCE_N = 23;
/** Statické tření = kinematické × tento poměr (původní chování simulace) */
const MU_STATIC_OVER_KINETIC = 4 / 3;
const MAX_STRETCH_PX = 120;
const VIEWBOX_WIDTH = 954;
/** Posun po podložce: směr dlouhé osy horní stěny (Δy/|Δx| = 80/550). */
const SLIDE_Y_PER_X = 80 / 550;
/** Max posun hranolu v SVG jednotkách (viewBox šířka 954) */
const FLAT_MAX_BEAM_SLIDE_SVG = 220;
/** Edge konec: beam 450.701 → 286.451 (scene-edge-end-user) */
const EDGE_MAX_BEAM_SLIDE_SVG = 164.25;

function frictionFromMu(massG, muKinetic) {
  const normalN = (massG / 1000) * GRAVITY;
  const kineticN = muKinetic * normalN;
  return {
    staticN: kineticN * MU_STATIC_OVER_KINETIC,
    kineticN,
  };
}

const WOOD_REF_FRICTION = frictionFromMu(WOOD_MASS_G, MU_K_METAL_WOOD);

/** Prahové natažení pružiny v px — stejné pro oba materiály */
const STRETCH_STATIC = WOOD_REF_FRICTION.staticN / SPRING_K_WOOD;
const STRETCH_KINETIC = WOOD_REF_FRICTION.kineticN / SPRING_K_WOOD;
const SPRING_DRAG_FOLLOW = 0.34;
const SPRING_RELEASE_STIFFNESS = 0.24;
const SPRING_RELEASE_DAMPING = 0.76;
const SPRING_RECOIL_STIFFNESS = 0.03;
const SPRING_RECOIL_DAMPING = 0.91;
const SILOMER_BROKEN_MESSAGE = "Siloměr se přetrhl.";
/** Pouzdro + stupnice zůstanou na pozici z 20 N */
const SILOMER_HOUSING_PATH_INDICES = [0, 10, 11, 24, 46];
/** Červený ukazatel, tyč a háček u hranolu — po přetržení se nepohybují */
const SILOMER_HOOK_GAUGE_PATH_INDICES = [1, 2, 3, 4, 5, 6, 7, 8, 9];
/** Vinutí pružiny — po přetržení se vrátí z 20 N do klidu v pouzdře */
const SILOMER_COIL_PATH_INDICES = [
  12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
];
const SILOMER_ROD_PATH_INDEX = 3;

/** Hranol 20,3×5,2×9,4 cm = 1000 cm³; malá ocel = ¼ objemu, malé dřevo = ½ objemu */
const BEAM_VOLUME_FULL_CM3 = 1000;
const BEAM_VOLUME_SMALL_CM3 = BEAM_VOLUME_FULL_CM3 / 4;
const BEAM_VOLUME_WOOD_SMALL_CM3 = BEAM_VOLUME_FULL_CM3 / 2;
const BEAM_VOLUME_WOOD_2KG_CM3 =
  (WOOD_MASS_2KG_G * BEAM_VOLUME_FULL_CM3) / WOOD_MASS_G;
/** Hustota oceli: 8000 kg/m³ = 8 g/cm³ */
const STEEL_DENSITY_KG_M3 = 8000;
const STEEL_DENSITY_G_CM3 = STEEL_DENSITY_KG_M3 / 1000;

function woodMassG(volumeCm3) {
  return (WOOD_MASS_G * volumeCm3) / BEAM_VOLUME_FULL_CM3;
}

function steelMassG(volumeCm3) {
  return STEEL_DENSITY_G_CM3 * volumeCm3;
}

function beamMassG(type, volumeCm3) {
  return type.startsWith("steel") ? steelMassG(volumeCm3) : woodMassG(volumeCm3);
}

/** Střed spodní hrany hranolu ve flat/edge scéně (bod na podložce) */
const FLAT_BEAM_SCALE_ORIGIN = { x: 460, y: 132 };
const EDGE_BEAM_SCALE_ORIGIN = { x: 428.4755, y: 189.113 };
/** Konec háčku hranolu — bod připojení siloměru (siloměr vlevo) */
const FLAT_HOOK_ATTACH = { x: 399.75, y: 84.25 };
const FLAT_HOOK_SILOMER = { x: 373.25, y: 90.75 };
const EDGE_HOOK_ATTACH = { x: 425.75, y: 122.771 };
const EDGE_HOOK_SILOMER = { x: 399.25, y: 129.271 };

const SURFACE_VARIANTS = {
  metal: {
    label: "Kov",
    stageLabel: "kovová podložka",
    padLabel: "Kovová podložka",
    muKinetic: { wood: MU_K_METAL_WOOD, steel: MU_K_METAL_STEEL },
    padFills: [
      "url(#paint0_linear_2095_869)",
      "url(#paint1_linear_2095_869)",
      "url(#paint2_linear_2095_869)",
      "url(#paint3_linear_2095_869)",
    ],
    padStroke: "#2F363E",
  },
  leather: {
    label: "Kůže",
    stageLabel: "kožená podložka",
    padLabel: "Kožená podložka",
    muKinetic: { wood: MU_K_LEATHER_WOOD, steel: MU_K_LEATHER_STEEL },
    padFills: [
      "url(#leatherPad0)",
      "url(#leatherPad1)",
      "url(#leatherPad2)",
      "url(#leatherPad3)",
    ],
    padStroke: "#3A2418",
  },
  carpet: {
    label: "Koberec",
    stageLabel: "kobercová podložka",
    padLabel: "Kobercová podložka",
    muKinetic: { wood: MU_K_CARPET, steel: MU_K_CARPET },
    padFills: [
      "url(#carpetPad0)",
      "url(#carpetPad1)",
      "url(#carpetPad2)",
      "url(#carpetPad3)",
    ],
    padStroke: "#2F3D2A",
  },
  wood: {
    label: "Dřevo",
    stageLabel: "dřevěná podložka",
    padLabel: "Dřevěná podložka",
    muKinetic: { wood: MU_K_WOOD_WOOD, steel: MU_K_METAL_WOOD },
    padFills: [
      "url(#woodPad0)",
      "url(#woodPad1)",
      "url(#woodPad2)",
      "url(#woodPad3)",
    ],
    padStroke: "#5C3D1E",
  },
  ice: {
    label: "Led",
    stageLabel: "ledová podložka",
    padLabel: "Ledová podložka",
    muKinetic: { wood: MU_K_ICE, steel: MU_K_ICE },
    padFills: [
      "url(#icePad0)",
      "url(#icePad1)",
      "url(#icePad2)",
      "url(#icePad3)",
    ],
    padStroke: "#6A8FA8",
  },
};

const SURFACE_TYPES = ["metal", "leather", "carpet", "wood", "ice"];

const BEAM_VARIANTS = {
  wood: {
    bodyFlat: "url(#beamWoodFlat)",
    bodyEdge: "url(#beamWoodEdge)",
    wire: "#6B3F1C",
    hook: "#2A1A0E",
    volumeCm3: BEAM_VOLUME_FULL_CM3,
    label: "Dřevěný hranol",
    stageLabel: "dřevěným hranolem",
  },
  wood2kg: {
    bodyFlat: "url(#beamWoodFlat)",
    bodyEdge: "url(#beamWoodEdge)",
    wire: "#6B3F1C",
    hook: "#2A1A0E",
    volumeCm3: BEAM_VOLUME_WOOD_2KG_CM3,
    label: "Dřevěný hranol 2 kg",
    stageLabel: "dřevěným hranolem 2 kg",
  },
  woodSmall: {
    bodyFlat: "url(#beamWoodFlat)",
    bodyEdge: "url(#beamWoodEdge)",
    wire: "#6B3F1C",
    hook: "#2A1A0E",
    volumeCm3: BEAM_VOLUME_WOOD_SMALL_CM3,
    label: "Malý dřevěný hranol",
    stageLabel: "malým dřevěným hranolem",
  },
  steel: {
    bodyFlat: "url(#beamSteelFlat)",
    bodyEdge: "url(#beamSteelEdge)",
    wire: "#3A424A",
    hook: "#1F2429",
    volumeCm3: BEAM_VOLUME_FULL_CM3,
    label: "Ocelový hranol",
    stageLabel: "ocelovým hranolem",
  },
  steelSmall: {
    bodyFlat: "url(#beamSteelFlat)",
    bodyEdge: "url(#beamSteelEdge)",
    wire: "#3A424A",
    hook: "#1F2429",
    volumeCm3: BEAM_VOLUME_SMALL_CM3,
    label: "Malý ocelový hranol",
    stageLabel: "malým ocelovým hranolem",
  },
};

const BEAM_TYPES = ["wood", "wood2kg", "woodSmall", "steel", "steelSmall"];

let beamEl = null;
let beamFlatEl = null;
let beamEdgeEl = null;
let beamHookFlatEl = null;
let beamHookEdgeEl = null;
let flatSceneEl = null;
let edgeSceneEl = null;
let silomerFlatEl = null;
let silomerEdgeEl = null;
let forceReadoutEl = null;
let forceReadoutEdgeEl = null;
let silomerHitEl = null;
let silomerEdgeHitEl = null;
let morphData = null;
let morphPathEls = [];
let morphPathEdgeEls = [];
let silomerMorphFlatEl = null;
let silomerMorphEdgeEl = null;
let silomerBrokenFlatEl = null;
let silomerBrokenEdgeEl = null;
let beamHookBrokenFlatEl = null;
let beamHookBrokenEdgeEl = null;

let beamSlidePx = 0;
let stretchPx = 0;
let stretchVisualPx = 0;
let stretchVisualVelocity = 0;
let springBroken = false;
let springRecoilT = 0;
let springRecoilVelocity = 0;
let sliding = false;
let dragging = false;
let pointerId = null;
let grabClientX = 0;
let grabStretch = 0;
let grabBeam = 0;
let maxTravelPx = 0;
let beamOnEdge = false;
let beamType = "wood";
let surfaceType = "metal";
let flatHookSilomerPoint = FLAT_HOOK_SILOMER;
let edgeHookSilomerPoint = EDGE_HOOK_SILOMER;

function hookSilomerPointFromMorph(frameKey) {
  const nums = morphData.paths[3][frameKey][0];
  return {
    x: nums[nums.length - 2],
    y: nums[nums.length - 1],
  };
}

function activeBeamVariant() {
  const variant = BEAM_VARIANTS[beamType];
  return {
    ...variant,
    massG: beamMassG(beamType, variant.volumeCm3),
  };
}

function activeSurfaceVariant() {
  return SURFACE_VARIANTS[surfaceType];
}

function beamMuKinetic() {
  const surface = activeSurfaceVariant();
  const key = beamType.startsWith("wood") ? "wood" : "steel";
  return surface.muKinetic[key];
}

function volumeLinearScale(volumeCm3) {
  return Math.cbrt(volumeCm3 / BEAM_VOLUME_FULL_CM3);
}

function beamFrictionForces() {
  return frictionFromMu(activeBeamVariant().massG, beamMuKinetic());
}

/** Třecí síla příliš velká → hranol se nepohne, pružina max. 20 N */
function beamIsImmobile() {
  return beamFrictionForces().kineticN > FRICTION_IMMOVEABLE_N;
}

function springK() {
  if (beamIsImmobile()) {
    return SILOMER_RATED_N / MAX_STRETCH_PX;
  }
  return beamFrictionForces().staticN / STRETCH_STATIC;
}

/** Natažení odpovídající jmenovitým 20 N */
function maxGaugeStretchPx() {
  const k = springK();
  if (k <= 0) return MAX_STRETCH_PX;
  return Math.min(MAX_STRETCH_PX, SILOMER_RATED_N / k);
}

/** Natažení těsně před přetržením (≈23 N) */
function breakStretchPx() {
  const k = springK();
  if (k <= 0) return maxGaugeStretchPx();
  return maxGaugeStretchPx() + (SILOMER_BREAK_FORCE_N - SILOMER_RATED_N) / k;
}

function forceFromStretch(px) {
  return Math.max(0, px * springK());
}

function morphForceFromStretch(stretchPxValue) {
  const maxStretch = maxGaugeStretchPx();
  const force = forceFromStretch(stretchPxValue);
  if (!beamIsImmobile() || springBroken) {
    return Math.min(SILOMER_RATED_N, force);
  }
  if (stretchPxValue <= maxStretch) {
    return Math.min(SILOMER_RATED_N, force);
  }
  const overPx = stretchPxValue - maxStretch;
  const overMaxPx = breakStretchPx() - maxStretch;
  if (overMaxPx <= 0) return SILOMER_RATED_N;
  const overN =
    (SILOMER_BREAK_FORCE_N - SILOMER_RATED_N) *
    Math.min(1, overPx / overMaxPx);
  return SILOMER_RATED_N + overN;
}

function morphForceFromDisplay(displayForceN) {
  return Math.max(0, displayForceN);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatBeamMass(grams) {
  const kg = grams / 1000;
  return `${kg.toLocaleString("cs-CZ", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} kg`;
}

function formatBeamVolume(cm3) {
  return `${Math.round(cm3).toLocaleString("cs-CZ")} cm³`;
}

function formatForce(newtons) {
  if (newtons < 0.05) return "0 N";
  return `${newtons.toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} N`;
}

function rebuildPath(structure, nums) {
  let numIndex = 0;
  let out = "";

  for (const token of structure) {
    if (token == null) {
      const value = nums[numIndex++];
      out += `${value} `;
    } else {
      out += `${token}`;
      if (token !== "Z" && token !== "z") out += " ";
    }
  }

  return out.trim();
}

function lerpNums(a, b, t) {
  const out = new Array(a.length);
  for (let i = 0; i < a.length; i++) {
    out[i] = a[i] + (b[i] - a[i]) * t;
  }
  return out;
}

function morphSegmentForForce(force, forces) {
  const safeForce = Math.max(force, forces[0]);
  let segment = forces.length - 2;

  if (safeForce <= forces[forces.length - 1]) {
    segment = 0;
    while (segment < forces.length - 2 && safeForce > forces[segment + 1]) {
      segment += 1;
    }
  }

  const f0 = forces[segment];
  const f1 = forces[segment + 1];
  const t = f1 === f0 ? 0 : (safeForce - f0) / (f1 - f0);
  return { segment, t };
}

function morphNumsForPath(pathItem, frameKey, segment, t) {
  const frameSet = pathItem[frameKey];
  return lerpNums(frameSet[segment], frameSet[segment + 1], t);
}

function morphNumsForForce(pathItem, frameKey, force, forces) {
  const frameSet = pathItem[frameKey];
  const last = forces.length - 1;
  if (force <= forces[last]) {
    const { segment, t } = morphSegmentForForce(force, forces);
    return morphNumsForPath(pathItem, frameKey, segment, t);
  }

  const span = forces[last] - forces[last - 1];
  const extraT = span === 0 ? 0 : (force - forces[last]) / span;
  const lastFrame = frameSet[last];
  const prevFrame = frameSet[last - 1];
  return lastFrame.map(
    (value, index) => value + (lastFrame[index] - prevFrame[index]) * extraT
  );
}

function applySpringMorphToSet(pathEls, frameKey, force) {
  if (!morphData || !pathEls.length) return;

  const forces = morphData.forces;

  for (let i = 0; i < morphData.paths.length; i++) {
    const nums = morphNumsForForce(morphData.paths[i], frameKey, force, forces);

    pathEls[i].setAttribute(
      "d",
      rebuildPath(morphData.paths[i].structure, nums)
    );
  }
}

function applySpringMorph(force) {
  applySpringMorphToSet(morphPathEls, "frames", force);
  applySpringMorphToSet(morphPathEdgeEls, "edgeFrames", force);
}

function housingAnchorDelta(frameKey) {
  const pathItem = morphData.paths[0];
  const rest = pathItem[frameKey][0];
  const maxIdx = morphData.forces.length - 1;
  const maxFrame = pathItem[frameKey][maxIdx];
  return {
    dx: maxFrame[0] - rest[0],
    dy: maxFrame[1] - rest[1],
  };
}

function restSpringAtHousingNums(pathItem, frameKey) {
  const rest = pathItem[frameKey][0];
  const { dx, dy } = housingAnchorDelta(frameKey);
  return rest.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
}

function morphNumsForSpringRecoil(pathIndex, pathItem, frameKey) {
  const maxIdx = morphData.forces.length - 1;
  const brokenKey = frameKey === "frames" ? "brokenFlat" : "brokenEdge";
  const maxFrame = pathItem[frameKey][maxIdx];

  if (SILOMER_HOUSING_PATH_INDICES.includes(pathIndex)) {
    return maxFrame;
  }

  if (SILOMER_HOOK_GAUGE_PATH_INDICES.includes(pathIndex)) {
    return pathItem[brokenKey];
  }

  if (SILOMER_COIL_PATH_INDICES.includes(pathIndex)) {
    return lerpNums(
      maxFrame,
      restSpringAtHousingNums(pathItem, frameKey),
      springRecoilT
    );
  }

  return maxFrame;
}

function applySpringRecoilMorphToSet(pathEls, frameKey) {
  if (!morphData || !pathEls.length) return;

  for (let i = 0; i < morphData.paths.length; i++) {
    const pathItem = morphData.paths[i];
    const nums = morphNumsForSpringRecoil(i, pathItem, frameKey);
    pathEls[i].setAttribute(
      "d",
      rebuildPath(pathItem.structure, nums)
    );
  }
}

function applySpringRecoilMorph() {
  applySpringRecoilMorphToSet(morphPathEls, "frames");
  applySpringRecoilMorphToSet(morphPathEdgeEls, "edgeFrames");
}

function hookPointFromMorphRod(frameKey, force) {
  const pathItem = morphData.paths[SILOMER_ROD_PATH_INDEX];
  const nums = springBroken
    ? morphNumsForSpringRecoil(SILOMER_ROD_PATH_INDEX, pathItem, frameKey)
    : morphNumsForForce(pathItem, frameKey, force, morphData.forces);

  return {
    x: nums[nums.length - 2],
    y: nums[nums.length - 1],
  };
}

function updateBeamHooksFromSpringMorph(force) {
  if (!morphData) return;

  const variant = activeBeamVariant();
  const scale = volumeLinearScale(variant.volumeCm3);
  const flatOffset = silomerOffsetForScale(
    scale,
    FLAT_BEAM_SCALE_ORIGIN,
    FLAT_HOOK_ATTACH
  );
  const edgeOffset = silomerOffsetForScale(
    scale,
    EDGE_BEAM_SCALE_ORIGIN,
    EDGE_HOOK_ATTACH
  );
  const flatEnd = hookPointFromMorphRod("frames", force);
  const edgeEnd = hookPointFromMorphRod("edgeFrames", force);

  applyBeamHook(
    beamHookFlatEl,
    scale,
    FLAT_BEAM_SCALE_ORIGIN,
    flatEnd,
    FLAT_HOOK_ATTACH,
    flatOffset
  );
  applyBeamHook(
    beamHookEdgeEl,
    scale,
    EDGE_BEAM_SCALE_ORIGIN,
    edgeEnd,
    EDGE_HOOK_ATTACH,
    edgeOffset
  );
}

function stepSpringRecoil() {
  if (!springBroken || springRecoilT >= 1) return;

  const displacement = 1 - springRecoilT;
  springRecoilVelocity =
    springRecoilVelocity * SPRING_RECOIL_DAMPING +
    displacement * SPRING_RECOIL_STIFFNESS;
  springRecoilT += springRecoilVelocity;

  if (springRecoilT >= 1 - 0.001) {
    springRecoilT = 1;
    springRecoilVelocity = 0;
  }
}

function stepSpringVisual() {
  if (dragging) {
    stretchVisualPx += (stretchPx - stretchVisualPx) * SPRING_DRAG_FOLLOW;
    stretchVisualVelocity = 0;
    return;
  }

  const displacement = stretchPx - stretchVisualPx;
  stretchVisualVelocity =
    stretchVisualVelocity * SPRING_RELEASE_DAMPING +
    displacement * SPRING_RELEASE_STIFFNESS;
  stretchVisualPx += stretchVisualVelocity;

  if (
    stretchPx === 0 &&
    Math.abs(stretchVisualPx) < 0.08 &&
    Math.abs(stretchVisualVelocity) < 0.08
  ) {
    stretchVisualPx = 0;
    stretchVisualVelocity = 0;
  }
}

function applyBeamMaterialToRoot(root, material, bodyFill) {
  if (!root) return;

  for (const el of root.querySelectorAll(".beam-body")) {
    el.setAttribute("fill", bodyFill);
  }
  for (const el of root.querySelectorAll(".beam-wire")) {
    el.setAttribute("stroke", material.wire);
  }
  for (const el of root.querySelectorAll(".beam-hook")) {
    el.setAttribute("stroke", material.hook);
  }
  for (const el of root.querySelectorAll(".beam-hook-broken")) {
    el.setAttribute("stroke", material.hook);
  }
}

function applyBeamScaleToRoot(root, scale, origin) {
  if (!root) return;

  if (Math.abs(scale - 1) < 0.001) {
    root.removeAttribute("transform");
    return;
  }

  root.setAttribute(
    "transform",
    `translate(${origin.x} ${origin.y}) scale(${scale}) translate(${-origin.x} ${-origin.y})`
  );
}

function scaledPoint(point, scale, origin) {
  return {
    x: origin.x + scale * (point.x - origin.x),
    y: origin.y + scale * (point.y - origin.y),
  };
}

function silomerOffsetForScale(scale, origin, hookAttach) {
  if (Math.abs(scale - 1) < 0.001) return { x: 0, y: 0 };

  const attached = scaledPoint(hookAttach, scale, origin);
  return {
    x: attached.x - hookAttach.x,
    y: attached.y - hookAttach.y,
  };
}

function unscalePoint(point, scale, origin) {
  return {
    x: origin.x + (point.x - origin.x) / scale,
    y: origin.y + (point.y - origin.y) / scale,
  };
}

function applySilomerOffset(silomerEl, offset) {
  if (!silomerEl) return;

  if (Math.abs(offset.x) < 0.001 && Math.abs(offset.y) < 0.001) {
    silomerEl.removeAttribute("transform");
    return;
  }

  silomerEl.setAttribute("transform", `translate(${offset.x} ${offset.y})`);
}

function applyForceReadout(forceLabel, brokenMessage) {
  for (const readoutEl of [forceReadoutEl, forceReadoutEdgeEl]) {
    if (!readoutEl) continue;
    readoutEl.textContent = forceLabel;
    readoutEl.setAttribute("font-size", brokenMessage ? "9" : "14");
  }
}

function applyBeamHook(root, scale, origin, silomerEnd, beamEnd, silomerOffset) {
  const hookEl = root?.querySelector(".beam-hook");
  if (!hookEl) return;

  const from = {
    x: silomerEnd.x + silomerOffset.x,
    y: silomerEnd.y + silomerOffset.y,
  };
  const to =
    Math.abs(scale - 1) < 0.001
      ? beamEnd
      : scaledPoint(beamEnd, scale, origin);

  hookEl.setAttribute(
    "d",
    `M${from.x} ${from.y}L${to.x} ${to.y}`
  );
}

function updateBeamButtons() {
  for (const btn of beamBtnEls) {
    const type = btn.dataset.beamType;
    btn.setAttribute("aria-pressed", String(type === beamType));
  }
}

function updateSurfaceButtons() {
  for (const btn of surfaceBtnEls) {
    const type = btn.dataset.surfaceType;
    btn.setAttribute("aria-pressed", String(type === surfaceType));
  }
}

function applySurface() {
  const surface = activeSurfaceVariant();
  const variant = activeBeamVariant();

  if (padEl) {
    padEl.setAttribute("aria-label", surface.padLabel);
    const paths = padEl.querySelectorAll(":scope > path");
    paths.forEach((path, index) => {
      path.setAttribute("fill", surface.padFills[index] ?? surface.padFills[1]);
      path.setAttribute("stroke", surface.padStroke);
    });
  }

  if (stageEl) {
    stageEl.setAttribute(
      "aria-label",
      `${surface.stageLabel} s ${variant.stageLabel}`
    );
  }

  updateSurfaceButtons();
}

function applyBeamMaterial() {
  const variant = activeBeamVariant();
  const scale = volumeLinearScale(variant.volumeCm3);
  const flatOffset = silomerOffsetForScale(
    scale,
    FLAT_BEAM_SCALE_ORIGIN,
    FLAT_HOOK_ATTACH
  );
  const edgeOffset = silomerOffsetForScale(
    scale,
    EDGE_BEAM_SCALE_ORIGIN,
    EDGE_HOOK_ATTACH
  );

  applyBeamMaterialToRoot(beamFlatEl, variant, variant.bodyFlat);
  applyBeamMaterialToRoot(beamEdgeEl, variant, variant.bodyEdge);
  applyBeamMaterialToRoot(beamHookFlatEl, variant, variant.bodyFlat);
  applyBeamMaterialToRoot(beamHookEdgeEl, variant, variant.bodyEdge);

  applyBeamScaleToRoot(beamFlatEl, scale, FLAT_BEAM_SCALE_ORIGIN);
  applyBeamScaleToRoot(beamEdgeEl, scale, EDGE_BEAM_SCALE_ORIGIN);

  applySilomerOffset(silomerFlatEl, flatOffset);
  applySilomerOffset(silomerEdgeEl, edgeOffset);

  applyBeamHook(
    beamHookFlatEl,
    scale,
    FLAT_BEAM_SCALE_ORIGIN,
    flatHookSilomerPoint,
    FLAT_HOOK_ATTACH,
    flatOffset
  );
  applyBeamHook(
    beamHookEdgeEl,
    scale,
    EDGE_BEAM_SCALE_ORIGIN,
    edgeHookSilomerPoint,
    EDGE_HOOK_ATTACH,
    edgeOffset
  );

  if (beamMassEl) {
    beamMassEl.textContent =
      `Hmotnost: ${formatBeamMass(variant.massG)} · Objem: ${formatBeamVolume(variant.volumeCm3)}`;
  }

  updateBeamButtons();
  applySurface();
}

function applyBeamOrientation() {
  const showEdge = beamOnEdge;

  if (flatSceneEl) flatSceneEl.style.display = showEdge ? "none" : "inline";
  if (edgeSceneEl) edgeSceneEl.style.display = showEdge ? "inline" : "none";

  if (flipBeamBtn) {
    flipBeamBtn.textContent = showEdge ? "Na plochu" : "Na boční hranu";
    flipBeamBtn.setAttribute("aria-pressed", String(showEdge));
  }
}

function setSpringBrokenVisual() {
  if (silomerMorphFlatEl) silomerMorphFlatEl.style.display = "";
  if (silomerMorphEdgeEl) silomerMorphEdgeEl.style.display = "";
  if (silomerBrokenFlatEl) silomerBrokenFlatEl.style.display = "none";
  if (silomerBrokenEdgeEl) silomerBrokenEdgeEl.style.display = "none";
  if (beamHookBrokenFlatEl) beamHookBrokenFlatEl.style.display = "none";
  if (beamHookBrokenEdgeEl) beamHookBrokenEdgeEl.style.display = "none";
}

function renderScene() {
  const beamOffset = slideOffset(beamSlidePx);
  const maxStretch = maxGaugeStretchPx();
  const displayForce = springBroken
    ? SILOMER_RATED_N * (1 - springRecoilT)
    : Math.min(
        SILOMER_BREAK_FORCE_N,
        forceFromStretch(stretchVisualPx)
      );
  const morphForce = springBroken
    ? SILOMER_RATED_N
    : morphForceFromStretch(dragging ? stretchPx : stretchVisualPx);

  if (beamEl) {
    beamEl.setAttribute(
      "transform",
      `translate(${beamOffset.x} ${beamOffset.y})`
    );
  }

  applyBeamOrientation();
  applyBeamMaterial();
  setSpringBrokenVisual();

  if (springBroken) {
    applySpringRecoilMorph();
  } else {
    applySpringMorph(morphForce);
  }
  updateBeamHooksFromSpringMorph(morphForce);

  const showBrokenMessage = springBroken && springRecoilT >= 0.999;
  const forceLabel = showBrokenMessage
    ? SILOMER_BROKEN_MESSAGE
    : formatForce(displayForce);
  applyForceReadout(forceLabel, showBrokenMessage);

  for (const hitEl of [silomerHitEl, silomerEdgeHitEl]) {
    if (!hitEl) continue;
    const { staticN } = beamFrictionForces();
    const ariaMax = beamIsImmobile()
      ? SILOMER_BREAK_FORCE_N
      : Math.min(staticN, SILOMER_RATED_N);
    hitEl.setAttribute("aria-valuemax", String(Math.ceil(ariaMax)));
    hitEl.setAttribute(
      "aria-valuenow",
      String(Math.round(displayForce * 10) / 10)
    );
    hitEl.setAttribute(
      "aria-valuetext",
      springBroken
        ? springRecoilT < 0.999
          ? "Pružina se vrací"
          : SILOMER_BROKEN_MESSAGE
        : `${forceLabel.replace(" N", "")} newtonů`
    );
    hitEl.style.cursor = springBroken ? "not-allowed" : "grab";
  }
}

function animationLoop() {
  stepSpringVisual();
  stepSpringRecoil();
  renderScene();
  requestAnimationFrame(animationLoop);
}

function applyVisuals() {
  renderScene();
}

function pxToSvg(px) {
  return px * (VIEWBOX_WIDTH / padWrap.clientWidth);
}

function svgToPx(svg) {
  return svg * (padWrap.clientWidth / VIEWBOX_WIDTH);
}

function maxBeamSlidePx() {
  return svgToPx(beamOnEdge ? EDGE_MAX_BEAM_SLIDE_SVG : FLAT_MAX_BEAM_SLIDE_SVG);
}

function slideOffset(px) {
  const svgPx = pxToSvg(px);
  // Po hraně/ploše podložky: doleva a dolů (isometrie), ať kvádr i siloměr zůstávají na podložce.
  return {
    x: -svgPx,
    y: svgPx * SLIDE_Y_PER_X,
  };
}

function applyPull(handleTravelPx) {
  const travel = Math.max(0, handleTravelPx);
  const maxStretch = maxGaugeStretchPx();

  if (beamIsImmobile()) {
    sliding = false;
    if (springBroken) {
      stretchPx = maxStretch;
      beamSlidePx = grabBeam;
      applyVisuals();
      return;
    }

    const breakStretch = breakStretchPx();
    stretchPx = clamp(grabStretch + travel, 0, breakStretch);
    if (stretchPx >= breakStretch - 0.05) {
      springBroken = true;
      springRecoilT = 0;
      springRecoilVelocity = 0;
      stretchPx = maxStretch;
      stretchVisualPx = maxStretch;
      stretchVisualVelocity = 0;
    }
    beamSlidePx = grabBeam;
    applyVisuals();
    return;
  }

  if (!sliding) {
    if (grabStretch + travel < STRETCH_STATIC) {
      stretchPx = clamp(grabStretch + travel, 0, maxStretch);
      beamSlidePx = grabBeam;
    } else {
      sliding = true;
      const overTravel = grabStretch + travel - STRETCH_STATIC;
      stretchPx = clamp(STRETCH_STATIC, 0, maxStretch);
      beamSlidePx = clamp(grabBeam + overTravel, 0, maxBeamSlidePx());
    }
  } else {
    const stretchGain = Math.max(0, STRETCH_KINETIC - grabStretch);
    const beamTravel = Math.max(0, travel - stretchGain);
    stretchPx = clamp(STRETCH_KINETIC, 0, maxStretch);
    beamSlidePx = clamp(grabBeam + beamTravel, 0, maxBeamSlidePx());
  }

  applyVisuals();
}

function resetScene() {
  if (dragging) endDrag();

  sliding = false;
  springBroken = false;
  springRecoilT = 0;
  springRecoilVelocity = 0;
  stretchPx = 0;
  stretchVisualPx = 0;
  stretchVisualVelocity = 0;
  beamSlidePx = 0;
  maxTravelPx = 0;
  applyVisuals();
}

function endDrag() {
  if (!dragging) return;

  dragging = false;
  pointerId = null;
  sliding = false;
  if (springBroken) {
    stretchPx = maxGaugeStretchPx();
    stretchVisualPx = maxGaugeStretchPx();
    stretchVisualVelocity = 0;
  } else {
    stretchPx = 0;
  }
  maxTravelPx = 0;
  silomerHitEl?.classList.remove("is-dragging");
  silomerEdgeHitEl?.classList.remove("is-dragging");
  applyVisuals();
}

function activeSilomerHit() {
  return beamOnEdge ? silomerEdgeHitEl : silomerHitEl;
}

function ensurePointerCapture() {
  const hitEl = activeSilomerHit();
  if (!dragging || !hitEl || pointerId == null) return;
  if (hitEl.hasPointerCapture(pointerId)) return;

  try {
    hitEl.setPointerCapture(pointerId);
  } catch {
    // Some browsers refuse capture while the target is moving.
  }
}

function handlePointerEnd(event) {
  if (!dragging || event.pointerId !== pointerId) return;
  endDrag();
}

function beginDrag(event) {
  if (springBroken) return;

  dragging = true;
  pointerId = event.pointerId;
  grabClientX = event.clientX;
  grabStretch = stretchPx;
  grabBeam = beamSlidePx;
  maxTravelPx = 0;
  sliding = false;
  for (const hitEl of [silomerHitEl, silomerEdgeHitEl]) {
    hitEl?.classList.add("is-dragging");
  }
  ensurePointerCapture();
}

function bindSilomerHit(hitEl) {
  if (!hitEl) return;

  hitEl.setAttribute("role", "slider");
  hitEl.setAttribute("tabindex", "0");
  hitEl.setAttribute("aria-valuemin", "0");

  hitEl.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    if (dragging && event.pointerId === pointerId) return;

    if (dragging) {
      endDrag();
    }

    beginDrag(event);
    event.preventDefault();
  });

  hitEl.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    ensurePointerCapture();
    const travel = Math.max(0, grabClientX - event.clientX);
    maxTravelPx = Math.max(maxTravelPx, travel);
    applyPull(maxTravelPx);
  });

  hitEl.addEventListener("pointerup", handlePointerEnd);
  hitEl.addEventListener("pointercancel", handlePointerEnd);
  hitEl.addEventListener("lostpointercapture", (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    ensurePointerCapture();
  });

  hitEl.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 18 : 8;
    if (event.key === "ArrowLeft") {
      grabStretch = stretchPx;
      grabBeam = beamSlidePx;
      applyPull(step);
      event.preventDefault();
    } else if (event.key === "Home" || event.key === "Escape") {
      resetScene();
      event.preventDefault();
    }
  });
}

function bindSilomerEvents() {
  window.addEventListener("pointerup", handlePointerEnd, true);
  window.addEventListener("pointercancel", handlePointerEnd, true);
  window.addEventListener("blur", () => {
    if (dragging) endDrag();
  });

  bindSilomerHit(silomerHitEl);
  bindSilomerHit(silomerEdgeHitEl);
}

function selectBeamType(type) {
  if (!BEAM_TYPES.includes(type) || beamType === type) return;
  beamType = type;
  resetScene();
  applyBeamMaterial();
}

function toggleBeamOrientation() {
  beamOnEdge = !beamOnEdge;
  resetScene();
}

function selectSurfaceType(type) {
  if (!SURFACE_TYPES.includes(type) || surfaceType === type) return;
  surfaceType = type;
  resetScene();
  applyBeamMaterial();
}

function bindSurfaceButtons() {
  for (const btn of surfaceBtnEls) {
    btn.addEventListener("click", () => {
      selectSurfaceType(btn.dataset.surfaceType);
    });
  }
}

function bindBeamButtons() {
  for (const btn of beamBtnEls) {
    btn.addEventListener("click", () => {
      selectBeamType(btn.dataset.beamType);
    });
  }
}

function bindFlipButton() {
  if (!flipBeamBtn) return;
  flipBeamBtn.addEventListener("click", toggleBeamOrientation);
}

function bindResetButton() {
  if (!resetBtn) return;
  resetBtn.addEventListener("click", resetScene);
}

async function init() {
  const assetVersion = "20260720-silomer-broken-message";
  const [sceneResponse, morphResponse] = await Promise.all([
    fetch(`assets/scene.svg?v=${assetVersion}`, { cache: "no-store" }),
    fetch(`assets/spring-morph.json?v=${assetVersion}`, { cache: "no-store" }),
  ]);

  if (!sceneResponse.ok) throw new Error("Nepodařilo se načíst scénu.");
  if (!morphResponse.ok) throw new Error("Nepodařilo se načíst morph data.");

  padWrap.innerHTML = await sceneResponse.text();
  morphData = await morphResponse.json();
  flatHookSilomerPoint = hookSilomerPointFromMorph("frames");
  edgeHookSilomerPoint = hookSilomerPointFromMorph("edgeFrames");

  padEl = padWrap.querySelector("#pad");
  beamEl = padWrap.querySelector("#beam");
  beamFlatEl = padWrap.querySelector("#beamFlat");
  beamEdgeEl = padWrap.querySelector("#beamEdge");
  beamHookFlatEl = padWrap.querySelector("#beamHookFlat");
  beamHookEdgeEl = padWrap.querySelector("#beamHookEdge");
  flatSceneEl = padWrap.querySelector("#flatScene");
  edgeSceneEl = padWrap.querySelector("#edgeScene");
  silomerFlatEl = padWrap.querySelector("#silomerFlat");
  silomerEdgeEl = padWrap.querySelector("#silomerEdge");
  silomerMorphFlatEl = padWrap.querySelector("#silomerMorph");
  silomerMorphEdgeEl = padWrap.querySelector("#silomerMorphEdge");
  silomerBrokenFlatEl = padWrap.querySelector("#silomerBroken");
  silomerBrokenEdgeEl = padWrap.querySelector("#silomerBrokenEdge");
  beamHookBrokenFlatEl = beamHookFlatEl?.querySelector(".beam-hook-broken");
  beamHookBrokenEdgeEl = beamHookEdgeEl?.querySelector(".beam-hook-broken");
  forceReadoutEl = padWrap.querySelector("#forceReadout");
  forceReadoutEdgeEl = padWrap.querySelector("#forceReadoutEdge");
  silomerHitEl = padWrap.querySelector("#silomer");
  silomerEdgeHitEl = padWrap.querySelector("#silomerEdgeHit");
  morphPathEls = morphData.paths.map((_, index) =>
    silomerFlatEl.querySelector(`#springPath${index}`)
  );
  morphPathEdgeEls = morphData.paths.map((_, index) =>
    silomerEdgeEl.querySelector(`#springPathEdge${index}`)
  );

  if (
    !padEl ||
    !beamEl ||
    !beamFlatEl ||
    !beamEdgeEl ||
    !beamHookFlatEl ||
    !beamHookEdgeEl ||
    !flatSceneEl ||
    !edgeSceneEl ||
    !silomerFlatEl ||
    !silomerEdgeEl ||
    !silomerMorphFlatEl ||
    !silomerMorphEdgeEl ||
    !forceReadoutEl ||
    !forceReadoutEdgeEl ||
    !silomerHitEl ||
    !silomerEdgeHitEl ||
    morphPathEls.some((el) => !el) ||
    morphPathEdgeEls.some((el) => !el)
  ) {
    throw new Error("Scéna nemá očekávané vrstvy.");
  }

  bindSilomerEvents();
  bindSurfaceButtons();
  bindBeamButtons();
  bindFlipButton();
  bindResetButton();
  applyBeamOrientation();
  applyBeamMaterial();
  renderScene();
  requestAnimationFrame(animationLoop);
}

init();
