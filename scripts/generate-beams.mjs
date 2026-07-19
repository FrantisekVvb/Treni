import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const assets = path.join(root, "assets");

const wireframes = JSON.parse(
  fs.readFileSync(path.join(assets, "beam-wireframes.json"), "utf8")
);

/** Scene contact edge on the metal pad (same for both orientations). */
const CONTACT_L = [187.771, 135.491];
const CONTACT_R = [366.083, 106.991];

const STROKE = '#5C3A18';
const STROKE_W = "2.31";

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function toPath(points) {
  return `M${points.map((p) => `${p[0].toFixed(3)} ${p[1].toFixed(3)}`).join(" L")} Z`;
}

/** Similarity transform mapping local segment A→B onto scene CONTACT_L→CONTACT_R. */
function makeMapper(localA, localB) {
  const lx = localB[0] - localA[0];
  const ly = localB[1] - localA[1];
  const sx = CONTACT_R[0] - CONTACT_L[0];
  const sy = CONTACT_R[1] - CONTACT_L[1];
  const localLen = Math.hypot(lx, ly);
  const sceneLen = Math.hypot(sx, sy);
  const scale = sceneLen / localLen;
  const localAngle = Math.atan2(ly, lx);
  const sceneAngle = Math.atan2(sy, sx);
  const angle = sceneAngle - localAngle;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return (point) => {
    const dx = point[0] - localA[0];
    const dy = point[1] - localA[1];
    return [
      CONTACT_L[0] + (dx * cos - dy * sin) * scale,
      CONTACT_L[1] + (dx * sin + dy * cos) * scale,
    ];
  };
}

function facePath(points, paintId) {
  return `<path d="${toPath(points)}" fill="url(#${paintId})" stroke="${STROKE}" stroke-width="${STROKE_W}" stroke-linejoin="round"/>`;
}

function grainOn(points) {
  const [a, b, c, d] = points;
  return [0.3, 0.5, 0.7]
    .map((t) => {
      const left = lerp(a, d, t);
      const right = lerp(b, c, t);
      return `<path d="M${left[0].toFixed(3)} ${left[1].toFixed(3)} L${right[0].toFixed(3)} ${right[1].toFixed(3)}" stroke="#8B5A2B" stroke-width="1.365" stroke-linecap="round"/>`;
    })
    .join("\n");
}

function hookLine(from, to) {
  return `<path d="M${from[0].toFixed(2)} ${from[1].toFixed(2)}L${to[0].toFixed(2)} ${to[1].toFixed(2)}" stroke="black"/>`;
}

// Flat beam comes from assets/scene-flat-user.svg (exact user wireframe).

// --- Edge (on side) ---------------------------------------------------------
// Local corners from user wireframe (viewBox 149×117)
const edgeLocal = {
  blt: [0.499547, 0.5],
  brt: [127.28, 0.5],
  frt: [148.036, 21.8171],
  flt: [20.1337, 21.8171],
  frb: [148.036, 116.061],
  flb: [20.1337, 116.061],
  blb: [0.499547, 94.7439],
};

const mapEdge = makeMapper(edgeLocal.flb, edgeLocal.frb);
const edge = Object.fromEntries(
  Object.entries(edgeLocal).map(([k, v]) => [k, mapEdge(v)])
);

const edgeFaces = {
  left: [edge.blt, edge.flt, edge.flb, edge.blb],
  // Large side face = former top (light wood)
  side: [edge.flt, edge.frt, edge.frb, edge.flb],
  // Thin top strip = former bottom/side
  top: [edge.blt, edge.brt, edge.frt, edge.flt],
};

const edgeHookInner = edge.frt;
const edgeHookOuter = [edgeHookInner[0] + 22, edgeHookInner[1] - 4];

const edgeSvg = `${hookLine(edgeHookOuter, edgeHookInner)}
${facePath(edgeFaces.top, "paint7_linear_2079_97")}
${facePath(edgeFaces.left, "paint6_linear_2079_97")}
${facePath(edgeFaces.side, "paint5_linear_2079_97")}
<g opacity="0.28">
${grainOn(edgeFaces.side)}
</g>
`;

fs.writeFileSync(path.join(assets, "beam-edge.svg"), edgeSvg);

function lengths(name, faces) {
  for (const [face, pts] of Object.entries(faces)) {
    const edges = pts.map((p, i) => dist(p, pts[(i + 1) % 4]).toFixed(2));
    console.log(name, face, edges.join(", "));
  }
}

console.log("edge hook y", edgeHookInner[1].toFixed(1));
lengths("edge", edgeFaces);

const edgeSideHLocal = dist(edgeLocal.flt, edgeLocal.flb);
const edgeTopDLocal = dist(edgeLocal.blt, edgeLocal.flt);
console.log(
  "local edge W/H/depth",
  dist(edgeLocal.flt, edgeLocal.frt).toFixed(1),
  edgeSideHLocal.toFixed(1),
  edgeTopDLocal.toFixed(1)
);
