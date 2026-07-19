import fs from "fs";
import path from "path";
import os from "os";

const root = path.resolve(import.meta.dirname, "..");
const assets = path.join(root, "assets");
const downloads = path.join(os.homedir(), "Downloads");

const scene = fs.readFileSync(path.join(assets, "scene.svg"), "utf8");

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
      if (depth === 0) {
        return svg.slice(openStart, index + 4);
      }
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

function figmaSanitize(markup) {
  return markup
    .replace(/\sstyle="display:\s*none"/g, "")
    .replace(/\s+cursor="[^"]*"/g, "")
    .replace(/<rect id="silomer(?:EdgeHit)?"[\s\S]*?\/>/g, "")
    .replace(/font-family="Fenomen Sans[^"]*"/g, 'font-family="Inter"')
    .replace(/aria-label="[^"]*"/g, "")
    .replace(/id="springPath(?:Edge)?\d+"/g, "")
    .trim();
}

function buildScene({ rigMarkup }) {
  const defs = figmaSanitize(extractDefs(scene));
  const pad = figmaSanitize(extractGroupById(scene, "pad"));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="763" height="267" viewBox="0 -60 763 267" fill="none" xmlns="http://www.w3.org/2000/svg">
${defs}
${pad}
<g id="rig">
${figmaSanitize(rigMarkup)}
</g>
</svg>
`;
}

const flatScene = buildScene({
  rigMarkup: extractGroupById(scene, "flatScene"),
});

const edgeScene = buildScene({
  rigMarkup: extractGroupById(scene, "edgeScene"),
});

const flatPath = path.join(downloads, "treni-na-plose.svg");
const edgePath = path.join(downloads, "treni-na-bocni-stene.svg");

fs.writeFileSync(flatPath, flatScene, "utf8");
fs.writeFileSync(edgePath, edgeScene, "utf8");

for (const file of [flatPath, edgePath]) {
  const { execFileSync } = await import("child_process");
  try {
    execFileSync("xmllint", ["--noout", file], { stdio: "pipe" });
    console.log("OK", file);
  } catch {
    console.error("XML chyba", file);
  }
}

console.log("Uloženo:");
console.log(flatPath);
console.log(edgePath);
