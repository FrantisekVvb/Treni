const padWrap = document.getElementById("padWrap");
const stageEl = document.getElementById("stage");
const resetBtn = document.getElementById("resetBtn");
const flipBeamBtn = document.getElementById("flipBeamBtn");
const beamSizeBtnEls = [...document.querySelectorAll(".scene-btn--size[data-beam-type]")];
const surfaceBtnEls = [...document.querySelectorAll("[data-surface-type]")];
const beamMassEl = document.getElementById("beamMassEl");
const muEditorToggleBtn = document.getElementById("muEditorToggleBtn");
const muEditorEl = document.getElementById("muEditor");
const muPairLabelEl = document.getElementById("muPairLabel");
const muInputEl = document.getElementById("muInput");
const muOkBtn = document.getElementById("muOkBtn");
const muFeedbackEl = document.getElementById("muFeedback");
const mathKeypadEl = document.getElementById("mathKeypad");

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
/** Guma: stejné μ_k vůči dřevu i oceli */
const MU_K_RUBBER = 1;
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
const SILOMER_HANDLE_PATH_INDEX = 11;
const SILOMER_ROD_PATH_INDEX = 3;

/** Hranol 20,3×5,2×9,4 cm = 1000 cm³; malá ocel = ¼ objemu, malé dřevo = ½ objemu */
const BEAM_DIM_LONG_CM = 20.3;
const BEAM_DIM_MID_CM = 9.4;
const BEAM_DIM_SHORT_CM = 5.2;
const BEAM_FRICTION_AREA_FLAT_CM2 = BEAM_DIM_LONG_CM * BEAM_DIM_MID_CM;
const BEAM_FRICTION_AREA_EDGE_CM2 = BEAM_DIM_LONG_CM * BEAM_DIM_SHORT_CM;
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
/** Střed delší spodní hrany hranolu — počátek šipky tíhy */
const FLAT_BEAM_WEIGHT_ANCHOR = { x: 555.25, y: 116.9998 };
const EDGE_BEAM_WEIGHT_ANCHOR = { x: 546.628, y: 174.113 };
/** Konec háčku hranolu — bod připojení siloměru (siloměr vlevo) */
const FLAT_HOOK_ATTACH = { x: 399.75, y: 84.25 };
const FLAT_HOOK_SILOMER = { x: 373.25, y: 90.75 };
const EDGE_HOOK_ATTACH = { x: 425.75, y: 122.771 };
const EDGE_HOOK_SILOMER = { x: 399.25, y: 129.271 };
const WEIGHT_ARROW_SHAFT_TOP = 0;
/** Původní Figma délka těla při 3 N — šablona hrotu/popisku je k ní navázaná */
const WEIGHT_ARROW_FIGMA_SHAFT_LENGTH = 29;
/** Délky šipek zkráceny o 1/3 oproti Figmě */
const WEIGHT_ARROW_LENGTH_FACTOR = 2 / 3;
const WEIGHT_ARROW_SHAFT_BOTTOM =
  WEIGHT_ARROW_FIGMA_SHAFT_LENGTH * WEIGHT_ARROW_LENGTH_FACTOR;
const WEIGHT_ARROW_LABEL_X = 29 + 18;
const WEIGHT_ARROW_LABEL_Y =
  24.5 + (WEIGHT_ARROW_SHAFT_BOTTOM - WEIGHT_ARROW_FIGMA_SHAFT_LENGTH);
const WEIGHT_ARROW_SHAFT_X = 0;
const WEIGHT_ARROW_SHAFT_HALF_WIDTH = 1.5;
const WEIGHT_ARROW_FIGMA_REF_LENGTH = WEIGHT_ARROW_SHAFT_BOTTOM;
const BEAM_WEIGHT_ARROW_REF_N = 3;
const WEIGHT_ARROW_BASE_LENGTH = WEIGHT_ARROW_FIGMA_REF_LENGTH;
const WEIGHT_ARROW_LABEL_PX = 26;
const WEIGHT_ARROW_LABEL_FONT =
  "Fenomen Sans, ui-sans-serif, system-ui, sans-serif";
const WEIGHT_ARROW_COLOR = "#FF5F5F";
/** Malý dřevěný hranol — pevná geometrie z Figmy (bez scale transform) */
const WOOD_SMALL_FLAT_BEAM_WEIGHT_ANCHOR = { x: 534.5, y: 120.5 };
const WOOD_SMALL_BEAM_FLAT_BODY =
  "M611.2 108.189L460 132L376.066 97.8709V55.2095L526.671 31.3984L611.2 65.5276V108.189Z";
const WOOD_SMALL_BEAM_FLAT_WIRE =
  "M460 132L611.2 108.189V65.5276L526.671 31.3984L376.066 55.2095V97.8709L460 132ZM376.066 55.2095L460 89.3386M611.2 65.5276L460 89.3386M460 132V89.3386";
const WOOD_SMALL_BEAM_FLAT_WIRE_WIDTH = 1.19055;
const FULL_BEAM_FLAT_BODY =
  "M 650.5 102 L 460 131.9996 L 354.25 89 V 35.25 L 544 5.25 L 650.5 48.25 V 102 Z";
const FULL_BEAM_FLAT_WIRE =
  "M 354.25 35.25 L 544 5.25 L 650.5 48.25 V 102 L 460 131.9996 L 354.25 89 V 35.25 Z M 460 131.9996 V 78.25 M 460 78.25 L 650.5 48.25 M 460 78.25 L 354.25 35.25";
const FULL_BEAM_FLAT_WIRE_WIDTH = 1.5;

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
  rubber: {
    label: "Guma",
    stageLabel: "gumová podložka",
    padLabel: "Gumová podložka",
    muKinetic: { wood: MU_K_RUBBER, steel: MU_K_RUBBER },
    padFills: [
      "url(#rubberPad0)",
      "url(#rubberPad1)",
      "url(#rubberPad2)",
      "url(#rubberPad3)",
    ],
    padStroke: "#2A2A2A",
  },
};

const SURFACE_TYPES = ["metal", "leather", "carpet", "wood", "ice", "rubber"];

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
let muEditorOpen = false;
let silomerHintFlatEl = null;
let silomerHintEdgeEl = null;
let silomerBrokenBannerEl = null;
let silomerHintDismissed = false;
let weightDisplayTemplate = "";

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

function beamMaterialKey() {
  return beamType.startsWith("wood") ? "wood" : "steel";
}

function beamMaterialLabel() {
  return beamMaterialKey() === "wood" ? "Dřevo" : "Ocel";
}

function defaultMuKinetic() {
  const surface = activeSurfaceVariant();
  return surface.muKinetic[beamMaterialKey()];
}

function muPairLabelText() {
  const surface = activeSurfaceVariant();
  return `${beamMaterialLabel()} – ${surface.label.toLowerCase()}`;
}

function beamMuKinetic() {
  return defaultMuKinetic();
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

function formatBeamWeight(grams) {
  const weightN = (grams / 1000) * GRAVITY;
  return formatForce(weightN);
}

function formatBeamVolume(cm3) {
  return `${Math.round(cm3).toLocaleString("cs-CZ")} cm³`;
}

function beamFrictionAreaCm2() {
  const baseArea = beamOnEdge
    ? BEAM_FRICTION_AREA_EDGE_CM2
    : BEAM_FRICTION_AREA_FLAT_CM2;
  const scale = volumeLinearScale(activeBeamVariant().volumeCm3);
  return baseArea * scale * scale;
}

function formatBeamFrictionArea(areaCm2) {
  return `${Math.round(areaCm2).toLocaleString("cs-CZ")} cm²`;
}

function formatWeightLabel(weightN) {
  return formatForce(weightN);
}

function getWeightArrowExtension(heightUnits) {
  return WEIGHT_ARROW_BASE_LENGTH * Math.max(0, heightUnits - 1);
}

/** Celková délka těla šipky — u 80 N zkrácena o 5 % */
function resolveWeightArrowExtension(heightUnits, weightN) {
  const extension = getWeightArrowExtension(heightUnits);
  if (Math.abs(weightN - 80) >= 0.05) return extension;

  const totalLength = WEIGHT_ARROW_SHAFT_BOTTOM + extension;
  return totalLength * 0.95 - WEIGHT_ARROW_SHAFT_BOTTOM;
}

function buildWeightArrowShaftPath(extension) {
  const shaftBottom = WEIGHT_ARROW_SHAFT_BOTTOM + extension;
  const x = WEIGHT_ARROW_SHAFT_X;
  const w = WEIGHT_ARROW_SHAFT_HALF_WIDTH;
  return `M${x} ${WEIGHT_ARROW_SHAFT_TOP}H${x - w}V${shaftBottom}H${x}H${x + w}V${WEIGHT_ARROW_SHAFT_TOP}H${x}Z`;
}

function flatBeamWeightAnchor(variant) {
  if (beamType === "woodSmall") {
    return WOOD_SMALL_FLAT_BEAM_WEIGHT_ANCHOR;
  }
  const scale = volumeLinearScale(variant.volumeCm3);
  return scaledPoint(FLAT_BEAM_WEIGHT_ANCHOR, scale, FLAT_BEAM_SCALE_ORIGIN);
}

function edgeBeamWeightAnchor(variant) {
  const scale = volumeLinearScale(variant.volumeCm3);
  return scaledPoint(EDGE_BEAM_WEIGHT_ANCHOR, scale, EDGE_BEAM_SCALE_ORIGIN);
}

function usesWoodSmallFlatGeometry() {
  return beamType === "woodSmall";
}

function applyBeamFlatGeometry(variant) {
  if (!beamFlatEl) return;

  const body = beamFlatEl.querySelector(".beam-body");
  const wire = beamFlatEl.querySelector(".beam-wire");
  if (!body || !wire) return;

  if (usesWoodSmallFlatGeometry()) {
    body.setAttribute("d", WOOD_SMALL_BEAM_FLAT_BODY);
    wire.setAttribute("d", WOOD_SMALL_BEAM_FLAT_WIRE);
    wire.setAttribute("stroke-width", String(WOOD_SMALL_BEAM_FLAT_WIRE_WIDTH));
    return;
  }

  body.setAttribute("d", FULL_BEAM_FLAT_BODY);
  wire.setAttribute("d", FULL_BEAM_FLAT_WIRE);
  wire.setAttribute("stroke-width", String(FULL_BEAM_FLAT_WIRE_WIDTH));
}

function ensureBeamWeightArrow(root) {
  let group = root.querySelector(".beam-weight-arrow");
  if (!group) {
    group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "beam-weight-arrow");
    group.setAttribute("pointer-events", "none");
    group.setAttribute("aria-hidden", "true");
    root.appendChild(group);
  }
  return group;
}

function renderBeamWeightArrow(group, anchor, weightN, heightUnits) {
  if (!weightDisplayTemplate) return;

  const extension = resolveWeightArrowExtension(heightUnits, weightN);
  group.setAttribute(
    "transform",
    `translate(${anchor.x} ${anchor.y}) translate(${-WEIGHT_ARROW_SHAFT_X} ${-WEIGHT_ARROW_SHAFT_TOP})`
  );

  const wrapper = document.createElement("div");
  wrapper.innerHTML = weightDisplayTemplate.trim();
  const templateSvg = wrapper.firstElementChild;
  if (!templateSvg) return;

  while (group.firstChild) {
    group.removeChild(group.firstChild);
  }

  for (const child of templateSvg.children) {
    group.appendChild(document.importNode(child, true));
  }

  const shaft = group.querySelector(".weight-display__arrow-shaft");
  const head = group.querySelector(".weight-display__arrow-head");

  if (shaft) {
    shaft.setAttribute("d", buildWeightArrowShaftPath(extension));
    shaft.setAttribute("fill", WEIGHT_ARROW_COLOR);
  }

  if (head) {
    head.setAttribute("fill", WEIGHT_ARROW_COLOR);
    const headOffsetY =
      WEIGHT_ARROW_SHAFT_BOTTOM - WEIGHT_ARROW_FIGMA_SHAFT_LENGTH + extension;
    if (headOffsetY !== 0) {
      head.setAttribute("transform", `translate(0 ${headOffsetY})`);
    } else {
      head.removeAttribute("transform");
    }
  }

  group.querySelector(".weight-display__label-text")?.remove();
  group.querySelector(".weight-display__label-path")?.remove();

  const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
  text.setAttribute("x", String(WEIGHT_ARROW_LABEL_X));
  text.setAttribute("y", String(WEIGHT_ARROW_LABEL_Y + extension));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "middle");
  text.setAttribute("class", "weight-display__label-text");
  text.setAttribute("fill", WEIGHT_ARROW_COLOR);
  text.setAttribute("font-family", WEIGHT_ARROW_LABEL_FONT);
  text.setAttribute("font-weight", "600");
  text.setAttribute("font-size", String(WEIGHT_ARROW_LABEL_PX));
  text.textContent = formatWeightLabel(weightN);
  group.appendChild(text);
}

function beamWeightHeightUnits(weightN) {
  if (BEAM_WEIGHT_ARROW_REF_N <= 0) return 1;
  return Math.max(0.35, weightN / BEAM_WEIGHT_ARROW_REF_N);
}

function updateBeamWeightArrows() {
  const variant = activeBeamVariant();
  const weightN = (variant.massG / 1000) * GRAVITY;
  const heightUnits = beamWeightHeightUnits(weightN);

  if (flatSceneEl) {
    renderBeamWeightArrow(
      ensureBeamWeightArrow(flatSceneEl),
      flatBeamWeightAnchor(variant),
      weightN,
      heightUnits
    );
  }

  if (edgeSceneEl) {
    renderBeamWeightArrow(
      ensureBeamWeightArrow(edgeSceneEl),
      edgeBeamWeightAnchor(variant),
      weightN,
      heightUnits
    );
  }
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

/** Vizuální zvětšení žlutého kolečka siloměru (path 11). */
const SILOMER_HANDLE_VISUAL_SCALE = 1.55;

function syncSilomerHandleHit(handlePathEl, hitEl) {
  if (!handlePathEl || !hitEl) return;
  handlePathEl.removeAttribute("transform");
  const box = handlePathEl.getBBox();
  if (box.width === 0 && box.height === 0) return;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  handlePathEl.setAttribute(
    "transform",
    `translate(${cx} ${cy}) scale(${SILOMER_HANDLE_VISUAL_SCALE}) translate(${-cx} ${-cy})`
  );
  const r =
    (Math.max(box.width, box.height) / 2) * SILOMER_HANDLE_VISUAL_SCALE + 10;
  hitEl.setAttribute("cx", String(cx));
  hitEl.setAttribute("cy", String(cy));
  hitEl.setAttribute("r", String(r));
  return { cx, cy, r };
}

function createSilomerHandleHint(parent) {
  const ns = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(ns, "g");
  g.setAttribute("class", "silomer-handle-hint");
  g.setAttribute("pointer-events", "none");
  g.setAttribute("aria-hidden", "true");

  const motion = document.createElementNS(ns, "g");
  motion.setAttribute("class", "silomer-handle-hint__motion");

  const shaft = document.createElementNS(ns, "line");
  shaft.setAttribute("x1", "-46");
  shaft.setAttribute("y1", "0");
  shaft.setAttribute("x2", "-8");
  shaft.setAttribute("y2", "0");
  shaft.setAttribute("stroke", "#F19100");
  shaft.setAttribute("stroke-width", "3.2");
  shaft.setAttribute("stroke-linecap", "round");

  const head = document.createElementNS(ns, "path");
  head.setAttribute("d", "M-8 -10 L8 0 L-8 10 Z");
  head.setAttribute("fill", "#F19100");

  motion.appendChild(shaft);
  motion.appendChild(head);
  g.appendChild(motion);
  parent.appendChild(g);
  return g;
}

function createSilomerBrokenBanner() {
  const banner = document.createElement("div");
  banner.id = "silomerBrokenBanner";
  banner.className = "silomer-broken-banner";
  banner.hidden = true;
  banner.setAttribute("role", "alert");
  banner.setAttribute("aria-live", "assertive");
  banner.textContent = SILOMER_BROKEN_MESSAGE;
  padWrap.appendChild(banner);
  return banner;
}

function dismissSilomerHandleHint() {
  if (silomerHintDismissed) return;
  silomerHintDismissed = true;
  silomerHintFlatEl?.setAttribute("display", "none");
  silomerHintEdgeEl?.setAttribute("display", "none");
}

function syncSilomerHandleHint(hitEl, hintEl) {
  if (!hintEl) return;
  if (silomerHintDismissed || springBroken || !hitEl) {
    hintEl.setAttribute("display", "none");
    return;
  }
  const cx = Number(hitEl.getAttribute("cx"));
  const cy = Number(hitEl.getAttribute("cy"));
  const r = Number(hitEl.getAttribute("r"));
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
  hintEl.setAttribute("transform", `translate(${cx - r - 10} ${cy})`);
  hintEl.removeAttribute("display");
}

function updateSilomerHandleHints() {
  if (silomerHintDismissed) return;
  const showFlat = !beamOnEdge;
  const showEdge = beamOnEdge;
  if (silomerHintFlatEl) {
    silomerHintFlatEl.setAttribute("display", showFlat ? "" : "none");
  }
  if (silomerHintEdgeEl) {
    silomerHintEdgeEl.setAttribute("display", showEdge ? "" : "none");
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
    readoutEl.textContent = brokenMessage ? "" : forceLabel;
    readoutEl.setAttribute("font-size", "14");
    readoutEl.setAttribute("fill", "#171923");
    readoutEl.setAttribute("opacity", brokenMessage ? "0" : "1");
  }

  if (silomerBrokenBannerEl) {
    silomerBrokenBannerEl.hidden = !brokenMessage;
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
  for (const btn of beamSizeBtnEls) {
    btn.setAttribute("aria-pressed", String(btn.dataset.beamType === beamType));
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

  applyBeamFlatGeometry(variant);
  applyBeamMaterialToRoot(beamFlatEl, variant, variant.bodyFlat);
  applyBeamMaterialToRoot(beamEdgeEl, variant, variant.bodyEdge);
  applyBeamMaterialToRoot(beamHookFlatEl, variant, variant.bodyFlat);
  applyBeamMaterialToRoot(beamHookEdgeEl, variant, variant.bodyEdge);

  const flatScale = usesWoodSmallFlatGeometry() ? 1 : scale;
  applyBeamScaleToRoot(beamFlatEl, flatScale, FLAT_BEAM_SCALE_ORIGIN);
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
    beamMassEl.innerHTML = `<p class="scene-meta__line">Tíha = ${formatBeamWeight(variant.massG)}</p><p class="scene-meta__line">Objem = ${formatBeamVolume(variant.volumeCm3)}</p><p class="scene-meta__line">Velikost třecí plochy = ${formatBeamFrictionArea(beamFrictionAreaCm2())}</p>`;
  }

  updateBeamButtons();
  applySurface();
  updateBeamWeightArrows();
}

function applyBeamOrientation() {
  const showEdge = beamOnEdge;

  if (flatSceneEl) flatSceneEl.style.display = showEdge ? "none" : "inline";
  if (edgeSceneEl) edgeSceneEl.style.display = showEdge ? "inline" : "none";

  if (flipBeamBtn) {
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

  syncSilomerHandleHit(
    morphPathEls[SILOMER_HANDLE_PATH_INDEX],
    silomerHitEl
  );
  syncSilomerHandleHit(
    morphPathEdgeEls[SILOMER_HANDLE_PATH_INDEX],
    silomerEdgeHitEl
  );
  syncSilomerHandleHint(silomerHitEl, silomerHintFlatEl);
  syncSilomerHandleHint(silomerEdgeHitEl, silomerHintEdgeEl);
  updateSilomerHandleHints();
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

  dismissSilomerHandleHint();
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
      dismissSilomerHandleHint();
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
  refreshMuEditorIfOpen();
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
  refreshMuEditorIfOpen();
}

function bindSurfaceButtons() {
  for (const btn of surfaceBtnEls) {
    btn.addEventListener("click", () => {
      selectSurfaceType(btn.dataset.surfaceType);
    });
  }
}

function bindBeamButtons() {
  for (const btn of beamSizeBtnEls) {
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

function parseNumberInput(value) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function clearMuFeedback() {
  if (!muFeedbackEl) return;
  muFeedbackEl.hidden = true;
  muFeedbackEl.textContent = "";
  muFeedbackEl.classList.remove("is-success", "is-error");
}

function showMuFeedback(message, kind) {
  if (!muFeedbackEl) return;
  muFeedbackEl.hidden = false;
  muFeedbackEl.textContent = message;
  muFeedbackEl.classList.toggle("is-success", kind === "success");
  muFeedbackEl.classList.toggle("is-error", kind === "error");
}

function syncMuEditorContent() {
  if (!muPairLabelEl || !muInputEl) return;
  muPairLabelEl.textContent = muPairLabelText();
  muInputEl.value = "";
  clearMuFeedback();
}

function setMuEditorOpen(open) {
  muEditorOpen = open;
  if (muEditorToggleBtn) {
    muEditorToggleBtn.setAttribute("aria-pressed", String(open));
    muEditorToggleBtn.setAttribute("aria-expanded", String(open));
  }
  if (muEditorEl) {
    muEditorEl.hidden = !open;
  }
  if (open) {
    syncMuEditorContent();
    muInputEl?.focus();
  } else {
    clearMuFeedback();
  }
}

function toggleMuEditor() {
  setMuEditorOpen(!muEditorOpen);
}

function insertIntoMuInput(text) {
  if (!muInputEl) return;

  if (text === "," || text === ".") {
    if (muInputEl.value.includes(",") || muInputEl.value.includes(".")) return;
  }

  clearMuFeedback();
  muInputEl.value += text;
  muInputEl.focus();
}

function deleteFromMuInput() {
  if (!muInputEl) return;

  clearMuFeedback();
  muInputEl.value = muInputEl.value.slice(0, -1);
  muInputEl.focus();
}

function verifyMuInput() {
  if (!muInputEl) return;

  const value = parseNumberInput(muInputEl.value);
  if (value === null) {
    showMuFeedback("Zadej číslo.", "error");
    return;
  }

  if (value < 0) {
    showMuFeedback("Koeficient musí být nezáporný.", "error");
    return;
  }

  const correct = defaultMuKinetic();
  const roundedInput = Math.round(value * 100) / 100;
  const roundedCorrect = Math.round(correct * 100) / 100;
  if (Math.abs(roundedInput - roundedCorrect) < 0.015) {
    showMuFeedback("Správně!", "success");
    return;
  }

  showMuFeedback("To není správně. Zkus to znovu.", "error");
}

function onMathKeypadClick(event) {
  if (!mathKeypadEl || !muEditorOpen) return;

  const keyBtn = event.target.closest("[data-key]");
  if (!keyBtn || !mathKeypadEl.contains(keyBtn)) return;

  const key = keyBtn.getAttribute("data-key");
  if (!key) return;

  if (key === "backspace") {
    deleteFromMuInput();
    return;
  }

  insertIntoMuInput(key);
}

function bindMuEditor() {
  if (!muEditorToggleBtn || !muEditorEl || !muInputEl || !muOkBtn || !mathKeypadEl) return;

  muEditorToggleBtn.addEventListener("click", toggleMuEditor);
  muOkBtn.addEventListener("click", verifyMuInput);
  muInputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      verifyMuInput();
    }
  });
  mathKeypadEl.addEventListener("click", onMathKeypadClick);
}

function refreshMuEditorIfOpen() {
  if (!muEditorOpen) return;
  syncMuEditorContent();
}

async function init() {
  const assetVersion = "20260721-weight-arrow-80n-shorter";
  const [sceneResponse, morphResponse, weightResponse] = await Promise.all([
    fetch(`assets/scene.svg?v=${assetVersion}`, { cache: "no-store" }),
    fetch(`assets/spring-morph.json?v=${assetVersion}`, { cache: "no-store" }),
    fetch(`assets/weight-display.svg?v=${assetVersion}`, { cache: "no-store" }),
  ]);

  if (!sceneResponse.ok) throw new Error("Nepodařilo se načíst scénu.");
  if (!morphResponse.ok) throw new Error("Nepodařilo se načíst morph data.");
  if (!weightResponse.ok) throw new Error("Nepodařilo se načíst šablonu tíhy.");

  weightDisplayTemplate = await weightResponse.text();

  padWrap.innerHTML = await sceneResponse.text();
  morphData = await morphResponse.json();
  silomerBrokenBannerEl = createSilomerBrokenBanner();
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
  silomerHintFlatEl = createSilomerHandleHint(silomerFlatEl);
  silomerHintEdgeEl = createSilomerHandleHint(silomerEdgeEl);

  beamFlatEl?.querySelector(".beam-weight-arrow")?.remove();
  beamEdgeEl?.querySelector(".beam-weight-arrow")?.remove();

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
  bindMuEditor();
  applyBeamOrientation();
  applyBeamMaterial();
  renderScene();
  requestAnimationFrame(animationLoop);
}

init();
