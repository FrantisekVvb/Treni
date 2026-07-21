import fs from "fs";
import os from "os";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const assets = path.join(root, "assets");
const scene = fs.readFileSync(path.join(assets, "scene.svg"), "utf8");
const weightTemplate = fs.readFileSync(path.join(assets, "weight-display.svg"), "utf8");

const WOOD_SMALL_FLAT_BEAM_WEIGHT_ANCHOR = { x: 534.5, y: 120.5 };
const WOOD_SMALL_BEAM_FLAT_BODY =
  "M611.2 108.189L460 132L376.066 97.8709V55.2095L526.671 31.3984L611.2 65.5276V108.189Z";
const WOOD_SMALL_BEAM_FLAT_WIRE =
  "M460 132L611.2 108.189V65.5276L526.671 31.3984L376.066 55.2095V97.8709L460 132ZM376.066 55.2095L460 89.3386M611.2 65.5276L460 89.3386M460 132V89.3386";
const WEIGHT_ARROW_SHAFT_X = 0;
const WEIGHT_ARROW_SHAFT_TOP = 0;
const WEIGHT_ARROW_COLOR = "#FF5F5F";

function extractGroupById(svg, id) {
  const needle = `id="${id}"`;
  const start = svg.indexOf(needle);
  if (start === -1) throw new Error(`Chybí skupina #${id}`);

  const openStart = svg.lastIndexOf("<g", start);
  let depth = 0;
  let index = openStart;

  while (index < svg.length) {
    if (svg.startsWith("<g", index) && /[\s>]/.test(svg[index + 2] ?? "")) {
      depth += 1;
      index = svg.indexOf(">", index) + 1;
      continue;
    }
    if (svg.startsWith("</g>", index)) {
      depth -= 1;
      if (depth === 0) return svg.slice(openStart, index + 4);
      index += 4;
      continue;
    }
    index += 1;
  }

  throw new Error(`Neuzavřená skupina #${id}`);
}

function extractDefs(svg) {
  const start = svg.indexOf("<defs>");
  const end = svg.indexOf("</defs>");
  if (start === -1 || end === -1) throw new Error("Chybí defs.");
  return svg.slice(start, end + 7);
}

function parseViewBox(svg) {
  const match = svg.match(/viewBox="([^"]+)"/);
  if (!match) throw new Error("Chybí viewBox.");
  const [x, y, w, h] = match[1].split(/\s+/).map(Number);
  return { x, y, w, h };
}

function extractWeightMarkup(template) {
  const wrapper = template.match(/<svg[^>]*>([\s\S]*)<\/svg>/i)?.[1]?.trim();
  if (!wrapper) throw new Error("Chybí šipka tíhy v šabloně.");
  return wrapper;
}

function woodSmallBeamMarkup() {
  return `<g id="beamFlat">
<path class="beam-body" d="${WOOD_SMALL_BEAM_FLAT_BODY}" fill="#F1A558"/>
<path class="beam-wire" d="${WOOD_SMALL_BEAM_FLAT_WIRE}" stroke="#5C3A18" stroke-width="1.19055"/>
</g>`;
}

function silomerFlatMarkup(sceneSvg) {
  const silomer = extractGroupById(sceneSvg, "silomerFlat");
  const forceReadout = extractGroupById(sceneSvg, "forceReadoutWrap");
  return `${silomer}\n${forceReadout}`;
}

function weightArrowMarkup(anchor) {
  const inner = extractWeightMarkup(weightTemplate);
  return `<g class="beam-weight-arrow" transform="translate(${anchor.x} ${anchor.y}) translate(${-WEIGHT_ARROW_SHAFT_X} ${-WEIGHT_ARROW_SHAFT_TOP})" aria-hidden="true">
${inner}
</g>`;
}

const viewBox = parseViewBox(scene);
const defs = extractDefs(scene);
const pad = extractGroupById(scene, "pad");
const beamHookFlat = extractGroupById(scene, "beamHookFlat");

const output = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${viewBox.w}" height="${viewBox.h}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Tření — malý dřevěný hranol, 3 N">
${defs}
${pad}
<g id="rig">
<g id="flatScene">
${woodSmallBeamMarkup()}
${silomerFlatMarkup(scene)}
${beamHookFlat}
${weightArrowMarkup(WOOD_SMALL_FLAT_BEAM_WEIGHT_ANCHOR)}
</g>
</g>
</svg>
`;

const outPath = path.join(os.homedir(), "Downloads", "treni-maly-dreveny-hranol-3n.svg");
fs.writeFileSync(outPath, output, "utf8");
console.log(outPath);
