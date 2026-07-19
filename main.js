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
const GRAVITY = 9.81;
const MU_K_METAL_WOOD = 0.4;
const MU_K_METAL_STEEL = 0.1;
const MU_K_RUBBER_WOOD = 1;
const MU_K_RUBBER_STEEL = 0.8;
/** Statické tření = kinematické × tento poměr (původní chování simulace) */
const MU_STATIC_OVER_KINETIC = 4 / 3;
const MAX_STRETCH_PX = 120;
const MAX_BEAM_SLIDE_PX = 180;
const VIEWBOX_WIDTH = 763;

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

/** Hranol 20,3×5,2×9,4 cm = 1000 cm³; malá ocel = ¼ objemu */
const BEAM_VOLUME_FULL_CM3 = 1000;
const BEAM_VOLUME_SMALL_CM3 = BEAM_VOLUME_FULL_CM3 / 4;
const STEEL_DENSITY_G_CM3 = 7850 / BEAM_VOLUME_FULL_CM3;

/** Střed spodní hrany hranolu ve flat/edge scéně (bod na podložce) */
const FLAT_BEAM_SCALE_ORIGIN = { x: 260.125, y: 143.378 };
const EDGE_BEAM_SCALE_ORIGIN = { x: 257.153, y: 189.113 };
/** Konec háčku hranolu — bod připojení siloměru */
const FLAT_HOOK_ATTACH = { x: 395, y: 56.1284 };
const FLAT_HOOK_SILOMER = { x: 421.5, y: 49.6284 };
const EDGE_HOOK_ATTACH = { x: 371.5, y: 72.7715 };
const EDGE_HOOK_SILOMER = { x: 398, y: 66.2715 };

const SURFACE_VARIANTS = {
  metal: {
    label: "Kov",
    stageLabel: "kovová podložka",
    padLabel: "Kovová podložka",
    muKinetic: { wood: MU_K_METAL_WOOD, steel: MU_K_METAL_STEEL },
    padFills: [
      "url(#paint0_linear_2093_787)",
      "url(#paint1_linear_2093_787)",
      "url(#paint2_linear_2093_787)",
      "url(#paint3_linear_2093_787)",
    ],
    padStroke: "#3E4650",
  },
  rubber: {
    label: "Guma",
    stageLabel: "gumová podložka",
    padLabel: "Gumová podložka",
    muKinetic: { wood: MU_K_RUBBER_WOOD, steel: MU_K_RUBBER_STEEL },
    padFills: ["#454545", "#2E2E2E", "#383838", "#383838"],
    padStroke: "#1A1A1A",
  },
};

const SURFACE_TYPES = ["metal", "rubber"];

const BEAM_VARIANTS = {
  wood: {
    body: "#F1A558",
    wire: "#5C3A18",
    hook: "black",
    volumeCm3: BEAM_VOLUME_FULL_CM3,
    massG: WOOD_MASS_G,
    label: "Dřevěný hranol",
    stageLabel: "dřevěným hranolem",
  },
  steel: {
    body: "#A8B0BA",
    wire: "#3E4650",
    hook: "#2F3439",
    volumeCm3: BEAM_VOLUME_FULL_CM3,
    massG: 7850,
    label: "Ocelový hranol",
    stageLabel: "ocelovým hranolem",
  },
  steelSmall: {
    body: "#A8B0BA",
    wire: "#3E4650",
    hook: "#2F3439",
    volumeCm3: BEAM_VOLUME_SMALL_CM3,
    massG: STEEL_DENSITY_G_CM3 * BEAM_VOLUME_SMALL_CM3,
    label: "Malý ocelový hranol",
    stageLabel: "malým ocelovým hranolem",
  },
};

const BEAM_TYPES = ["wood", "steel", "steelSmall"];

let beamEl = null;
let beamFlatEl = null;
let beamEdgeEl = null;
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

let beamSlidePx = 0;
let stretchPx = 0;
let stretchVisualPx = 0;
let stretchVisualVelocity = 0;
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
let padEl = null;

function activeBeamVariant() {
  return BEAM_VARIANTS[beamType];
}

function activeSurfaceVariant() {
  return SURFACE_VARIANTS[surfaceType];
}

function beamMuKinetic() {
  const surface = activeSurfaceVariant();
  const key = beamType === "wood" ? "wood" : "steel";
  return surface.muKinetic[key];
}

function volumeLinearScale(volumeCm3) {
  return Math.cbrt(volumeCm3 / BEAM_VOLUME_FULL_CM3);
}

function beamFrictionForces() {
  return frictionFromMu(activeBeamVariant().massG, beamMuKinetic());
}

function springK() {
  return beamFrictionForces().staticN / STRETCH_STATIC;
}

function morphForceFromDisplay(displayForceN) {
  return Math.max(0, displayForceN);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatBeamMass(grams) {
  if (grams >= 1000) {
    return `${(grams / 1000).toLocaleString("cs-CZ", {
      maximumFractionDigits: 2,
    })} kg`;
  }
  return `${grams.toLocaleString("cs-CZ")} g`;
}

function formatBeamVolume(cm3) {
  return `${cm3.toLocaleString("cs-CZ")} cm³`;
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

function applySpringMorphToSet(pathEls, frameKey, force) {
  if (!morphData || !pathEls.length) return;

  const forces = morphData.forces;
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

  for (let i = 0; i < morphData.paths.length; i++) {
    const pathItem = morphData.paths[i];
    const frameSet = pathItem[frameKey];
    const nums = lerpNums(frameSet[segment], frameSet[segment + 1], t);
    pathEls[i].setAttribute("d", rebuildPath(pathItem.structure, nums));
  }
}

function applySpringMorph(force) {
  applySpringMorphToSet(morphPathEls, "frames", force);
  applySpringMorphToSet(morphPathEdgeEls, "edgeFrames", force);
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

function applyBeamMaterialToRoot(root, material) {
  if (!root) return;

  const bodyEls = root.querySelectorAll(".beam-body");
  const wireEls = root.querySelectorAll(".beam-wire");
  const hookEls = root.querySelectorAll(".beam-hook");

  if (bodyEls.length && wireEls.length && hookEls.length) {
    bodyEls.forEach((el) => el.setAttribute("fill", material.body));
    wireEls.forEach((el) => el.setAttribute("stroke", material.wire));
    hookEls.forEach((el) => el.setAttribute("stroke", material.hook));
    return;
  }

  const paths = root.querySelectorAll(":scope > path");
  if (paths.length < 3) return;

  paths[0].setAttribute("stroke", material.hook);
  paths[1].setAttribute("fill", material.body);
  paths[2].setAttribute("stroke", material.wire);
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

function applyBeamHook(root, scale, origin, silomerEnd, beamEnd, silomerOffset) {
  const hookEl = root?.querySelector(".beam-hook");
  if (!hookEl) return;

  if (Math.abs(scale - 1) < 0.001) {
    hookEl.setAttribute(
      "d",
      `M${silomerEnd.x} ${silomerEnd.y}L${beamEnd.x} ${beamEnd.y}`
    );
    return;
  }

  const worldSilomerEnd = {
    x: silomerEnd.x + silomerOffset.x,
    y: silomerEnd.y + silomerOffset.y,
  };
  const localSilomerEnd = unscalePoint(worldSilomerEnd, scale, origin);

  hookEl.setAttribute(
    "d",
    `M${localSilomerEnd.x} ${localSilomerEnd.y}L${beamEnd.x} ${beamEnd.y}`
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

  for (const root of [beamFlatEl, beamEdgeEl]) {
    applyBeamMaterialToRoot(root, variant);
  }

  applyBeamScaleToRoot(beamFlatEl, scale, FLAT_BEAM_SCALE_ORIGIN);
  applyBeamScaleToRoot(beamEdgeEl, scale, EDGE_BEAM_SCALE_ORIGIN);

  applySilomerOffset(silomerFlatEl, flatOffset);
  applySilomerOffset(silomerEdgeEl, edgeOffset);

  applyBeamHook(
    beamFlatEl,
    scale,
    FLAT_BEAM_SCALE_ORIGIN,
    FLAT_HOOK_SILOMER,
    FLAT_HOOK_ATTACH,
    flatOffset
  );
  applyBeamHook(
    beamEdgeEl,
    scale,
    EDGE_BEAM_SCALE_ORIGIN,
    EDGE_HOOK_SILOMER,
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

function renderScene() {
  const beamOffset = slideOffset(beamSlidePx);
  const springForce = stretchPx * springK();
  const displayForce = stretchVisualPx * springK();
  const morphForce = morphForceFromDisplay(
    dragging ? springForce : displayForce
  );

  if (beamEl) {
    beamEl.setAttribute(
      "transform",
      `translate(${beamOffset.x} ${beamOffset.y})`
    );
  }

  applyBeamOrientation();
  applyBeamMaterial();

  applySpringMorph(morphForce);

  const forceLabel = formatForce(displayForce);
  if (forceReadoutEl) forceReadoutEl.textContent = forceLabel;
  if (forceReadoutEdgeEl) forceReadoutEdgeEl.textContent = forceLabel;

  for (const hitEl of [silomerHitEl, silomerEdgeHitEl]) {
    if (!hitEl) continue;
    const { staticN } = beamFrictionForces();
    hitEl.setAttribute("aria-valuemax", String(Math.ceil(staticN)));
    hitEl.setAttribute("aria-valuenow", String(Math.round(displayForce * 10) / 10));
    hitEl.setAttribute(
      "aria-valuetext",
      `${forceLabel.replace(" N", "")} newtonů`
    );
  }
}

function animationLoop() {
  stepSpringVisual();
  renderScene();
  requestAnimationFrame(animationLoop);
}

function applyVisuals() {
  renderScene();
}

function pxToSvg(px) {
  return px * (VIEWBOX_WIDTH / padWrap.clientWidth);
}

function slideOffset(px) {
  const svgPx = pxToSvg(px);
  return {
    x: svgPx,
    y: svgPx * -0.12,
  };
}

function applyPull(handleTravelPx) {
  const travel = Math.max(0, handleTravelPx);

  if (!sliding) {
    if (grabStretch + travel < STRETCH_STATIC) {
      stretchPx = clamp(grabStretch + travel, 0, MAX_STRETCH_PX);
      beamSlidePx = grabBeam;
    } else {
      sliding = true;
      const overTravel = grabStretch + travel - STRETCH_STATIC;
      stretchPx = STRETCH_STATIC;
      beamSlidePx = clamp(grabBeam + overTravel, 0, MAX_BEAM_SLIDE_PX);
    }
  } else {
    const stretchGain = Math.max(0, STRETCH_KINETIC - grabStretch);
    const beamTravel = Math.max(0, travel - stretchGain);
    stretchPx = clamp(STRETCH_KINETIC, 0, MAX_STRETCH_PX);
    beamSlidePx = clamp(grabBeam + beamTravel, 0, MAX_BEAM_SLIDE_PX);
  }

  applyVisuals();
}

function resetScene() {
  if (dragging) endDrag();

  sliding = false;
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
  stretchPx = 0;
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
    const travel = Math.max(0, event.clientX - grabClientX);
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
    if (event.key === "ArrowRight") {
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
  const assetVersion = "20260720-steel-small-beam";
  const [sceneResponse, morphResponse] = await Promise.all([
    fetch(`assets/scene.svg?v=${assetVersion}`, { cache: "no-store" }),
    fetch(`assets/spring-morph.json?v=${assetVersion}`, { cache: "no-store" }),
  ]);

  if (!sceneResponse.ok) throw new Error("Nepodařilo se načíst scénu.");
  if (!morphResponse.ok) throw new Error("Nepodařilo se načíst morph data.");

  padWrap.innerHTML = await sceneResponse.text();
  morphData = await morphResponse.json();

  padEl = padWrap.querySelector("#pad");
  beamEl = padWrap.querySelector("#beam");
  beamFlatEl = padWrap.querySelector("#beamFlat");
  beamEdgeEl = padWrap.querySelector("#beamEdge");
  flatSceneEl = padWrap.querySelector("#flatScene");
  edgeSceneEl = padWrap.querySelector("#edgeScene");
  silomerFlatEl = padWrap.querySelector("#silomerFlat");
  silomerEdgeEl = padWrap.querySelector("#silomerEdge");
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
    !flatSceneEl ||
    !edgeSceneEl ||
    !silomerFlatEl ||
    !silomerEdgeEl ||
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
