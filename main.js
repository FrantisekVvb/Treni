const padWrap = document.getElementById("padWrap");

if (!padWrap) {
  throw new Error("Chybí základní prvky scény.");
}

/** N per pixel of pull drag */
const SPRING_K = 0.045;
const F_STATIC = 3.2;
const F_KINETIC = 2.4;
const MAX_STRETCH_PX = 120;
const MAX_BEAM_SLIDE_PX = 180;
const VIEWBOX_WIDTH = 763;

const STRETCH_STATIC = F_STATIC / SPRING_K;
const STRETCH_KINETIC = F_KINETIC / SPRING_K;
const SPRING_DRAG_FOLLOW = 0.34;
const SPRING_RELEASE_STIFFNESS = 0.24;
const SPRING_RELEASE_DAMPING = 0.76;

let beamEl = null;
let forceReadoutEl = null;
let silomerHitEl = null;
let morphData = null;
let morphPathEls = [];

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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

function applySpringMorph(force) {
  if (!morphData || !morphPathEls.length) return;

  const forces = morphData.forces;
  const clamped = clamp(force, forces[0], forces[forces.length - 1]);

  let segment = 0;
  while (
    segment < forces.length - 2 &&
    clamped > forces[segment + 1]
  ) {
    segment += 1;
  }

  const f0 = forces[segment];
  const f1 = forces[segment + 1];
  const t = f1 === f0 ? 0 : (clamped - f0) / (f1 - f0);

  for (let i = 0; i < morphData.paths.length; i++) {
    const pathItem = morphData.paths[i];
    const nums = lerpNums(pathItem.frames[segment], pathItem.frames[segment + 1], t);
    morphPathEls[i].setAttribute("d", rebuildPath(pathItem.structure, nums));
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

function renderScene() {
  const beamOffset = slideOffset(beamSlidePx);
  const displayForce = stretchVisualPx * SPRING_K;

  if (beamEl) {
    beamEl.setAttribute(
      "transform",
      `translate(${beamOffset.x} ${beamOffset.y})`
    );
  }

  applySpringMorph(displayForce);

  if (forceReadoutEl) {
    forceReadoutEl.textContent = formatForce(displayForce);
  }

  if (silomerHitEl) {
    silomerHitEl.setAttribute(
      "aria-valuenow",
      String(Math.round(displayForce * 10) / 10)
    );
    silomerHitEl.setAttribute(
      "aria-valuetext",
      `${formatForce(displayForce).replace(" N", "")} newtonů`
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

function endDrag() {
  if (!dragging) return;
  dragging = false;
  pointerId = null;
  sliding = false;
  stretchPx = 0;
  silomerHitEl?.classList.remove("is-dragging");
  applyVisuals();
}

function bindSilomerEvents() {
  if (!silomerHitEl) return;

  silomerHitEl.setAttribute("role", "slider");
  silomerHitEl.setAttribute("tabindex", "0");
  silomerHitEl.setAttribute("aria-valuemin", "0");
  silomerHitEl.setAttribute("aria-valuemax", "10");

  silomerHitEl.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    dragging = true;
    pointerId = event.pointerId;
    grabClientX = event.clientX;
    grabStretch = stretchPx;
    grabBeam = beamSlidePx;
    sliding = beamSlidePx > 0;
    silomerHitEl.classList.add("is-dragging");
    silomerHitEl.setPointerCapture(event.pointerId);
    event.preventDefault();
  });

  silomerHitEl.addEventListener("pointermove", (event) => {
    if (!dragging || event.pointerId !== pointerId) return;
    applyPull(event.clientX - grabClientX);
  });

  silomerHitEl.addEventListener("pointerup", (event) => {
    if (event.pointerId !== pointerId) return;
    endDrag();
  });

  silomerHitEl.addEventListener("pointercancel", (event) => {
    if (event.pointerId !== pointerId) return;
    endDrag();
  });

  silomerHitEl.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 18 : 8;
    if (event.key === "ArrowRight") {
      grabStretch = stretchPx;
      grabBeam = beamSlidePx;
      applyPull(step);
      event.preventDefault();
    } else if (event.key === "ArrowLeft" || event.key === "Escape") {
      sliding = false;
      stretchPx = 0;
      applyVisuals();
      event.preventDefault();
    } else if (event.key === "Home") {
      sliding = false;
      stretchPx = 0;
      beamSlidePx = 0;
      applyVisuals();
      event.preventDefault();
    }
  });
}

async function init() {
  const [sceneResponse, morphResponse] = await Promise.all([
    fetch("assets/scene.svg"),
    fetch("assets/spring-morph.json"),
  ]);

  if (!sceneResponse.ok) throw new Error("Nepodařilo se načíst scénu.");
  if (!morphResponse.ok) throw new Error("Nepodařilo se načíst morph data.");

  padWrap.innerHTML = await sceneResponse.text();
  morphData = await morphResponse.json();

  beamEl = padWrap.querySelector("#beam");
  forceReadoutEl = padWrap.querySelector("#forceReadout");
  silomerHitEl = padWrap.querySelector("#silomer");
  morphPathEls = morphData.paths.map((_, index) =>
    padWrap.querySelector(`#springPath${index}`)
  );

  if (
    !beamEl ||
    !forceReadoutEl ||
    !silomerHitEl ||
    morphPathEls.some((el) => !el)
  ) {
    throw new Error("Scéna nemá očekávané vrstvy.");
  }

  bindSilomerEvents();
  renderScene();
  requestAnimationFrame(animationLoop);
}

init();
