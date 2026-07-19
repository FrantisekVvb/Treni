import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const assets = path.join(root, "assets");
const scenePath = path.join(assets, "scene.svg");
const morphPath = path.join(assets, "spring-morph.json");

const frames = [
  { force: 0, file: "scene-rest.svg", marker: "M561.021" },
  { force: 2, file: "scene-2n.svg", marker: "M574.819" },
  { force: 4, file: "scene-4n.svg", marker: "M588.617" },
  { force: 6, file: "scene-stretched.svg", marker: "M601.444" },
];

function isReadoutBox(line) {
  return line.includes("M508.584 70.4504");
}

function isForceText(line) {
  return line.includes('fill="#171923"');
}

function extractDefs(svg) {
  const match = svg.match(/<defs>[\s\S]*?<\/defs>/);
  return match ? match[0] : "";
}

function extractSilomerPaths(svg, marker) {
  const lines = svg.split("\n");
  const start = lines.findIndex((line) => line.includes(marker));
  const end = lines.findIndex(
    (line, index) =>
      index > start && (isReadoutBox(line) || isForceText(line))
  );
  if (start === -1 || end === -1) {
    throw new Error(`Nepodařilo se najít siloměr (${marker}).`);
  }

  return lines
    .slice(start, end)
    .filter((line) => line.trim().startsWith("<path"))
    .map((line) => {
      const d = line.match(/d="([^"]+)"/)?.[1];
      if (!d) throw new Error("Path bez d atributu.");
      const attrs = line
        .replace(/^\s*<path\s+/, "")
        .replace(/\s*\/>\s*$/, "")
        .replace(/d="[^"]+"\s*/, "")
        .trim();
      const fill = line.match(/fill="([^"]*)"/)?.[1] || "";
      const stroke = line.match(/stroke="([^"]*)"/)?.[1] || "";
      const strokeWidth = line.match(/stroke-width="([^"]*)"/)?.[1] || "";
      const commands = (d.match(/[A-Za-z]/g) || []).join("");
      const nums = (d.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/g) || []).map(Number);
      return {
        d,
        attrs,
        fill,
        stroke,
        strokeWidth,
        commands,
        nums,
        key: `${fill}|${stroke}|${strokeWidth}|${commands}|${nums.length}`,
      };
    });
}

function tokenizePath(d) {
  return d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
}

function pathStructure(d) {
  return tokenizePath(d).map((token) =>
    /[A-Za-z]/.test(token) ? token : null
  );
}

function extractBeam(svg) {
  const lines = svg.split("\n");
  const markerStart = lines.findIndex((line) => line.includes("M369.25 72.25"));
  const silomerStart = lines.findIndex(
    (line, index) => index > markerStart && line.includes("M561.021")
  );
  return lines.slice(markerStart, silomerStart);
}

function extractPad(svg) {
  const lines = svg.split("\n");
  const start = lines.findIndex((line) => line.includes("M551.25 1.25L761.25"));
  const end = lines.findIndex(
    (line, index) => index > start && line.includes("M369.25 72.25")
  );
  return lines.slice(start, end);
}

function extractReadoutBox(svg) {
  const line = svg.split("\n").find(isReadoutBox);
  if (!line) throw new Error("Chybí rámeček ukazatele síly.");
  return line;
}

function alignBaseToReference(basePaths, referencePaths) {
  const used = new Set();
  return referencePaths.map((ref) => {
    const matchIndex = basePaths.findIndex(
      (pathItem, index) => !used.has(index) && pathItem.key === ref.key
    );
    if (matchIndex === -1) {
      throw new Error(`Nelze napárovat cestu: ${ref.key}`);
    }
    used.add(matchIndex);
    return basePaths[matchIndex];
  });
}

const loaded = frames.map((frame) => {
  const svg = fs.readFileSync(path.join(assets, frame.file), "utf8");
  return {
    ...frame,
    svg,
    paths: extractSilomerPaths(svg, frame.marker),
  };
});

const rest = loaded[0];
const alignedRest = alignBaseToReference(rest.paths, loaded[1].paths);

for (let i = 1; i < loaded.length; i++) {
  if (loaded[i].paths.length !== alignedRest.length) {
    throw new Error(`Frame ${loaded[i].force}N má jiný počet cest.`);
  }
  for (let p = 0; p < alignedRest.length; p++) {
    if (loaded[i].paths[p].key !== alignedRest[p].key) {
      throw new Error(
        `Frame ${loaded[i].force}N, path ${p}: struktura nesedí (${loaded[i].paths[p].key} vs ${alignedRest[p].key}).`
      );
    }
  }
}

const morph = {
  forces: frames.map((frame) => frame.force),
  paths: alignedRest.map((basePath, index) => ({
    attrs: basePath.attrs,
    structure: pathStructure(basePath.d),
    frames: [
      basePath.nums,
      ...loaded.slice(1).map((frame) => frame.paths[index].nums),
    ],
  })),
};

const defs = extractDefs(rest.svg);
const padPaths = extractPad(rest.svg);
const beamLines = extractBeam(rest.svg);
const readoutBox = extractReadoutBox(rest.svg);

const morphPathsMarkup = morph.paths
  .map(
    (pathItem, index) =>
      `<path id="springPath${index}" d="${alignedRest[index].d}" ${pathItem.attrs}/>`
  )
  .join("\n");

const output = `<svg width="763" height="208" viewBox="0 0 763 208" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Základní scéna tření">
${defs}
<g id="pad" aria-label="Kovová podložka">
${padPaths.join("\n")}
</g>
<g id="rig">
<g id="beam">
${beamLines.join("\n")}
<g id="silomerGroup">
<g id="silomerMorph">
${morphPathsMarkup}
</g>
<g id="forceReadoutWrap">
${readoutBox}
<text id="forceReadout" x="487" y="92" text-anchor="middle" font-family="Fenomen Sans, system-ui, sans-serif" font-size="14" font-weight="600" fill="#171923">0 N</text>
</g>
<rect id="silomer" x="365" y="14" width="270" height="98" fill="transparent" cursor="grab" aria-label="Siloměr"/>
</g>
</g>
</g>
</svg>
`;

fs.writeFileSync(scenePath, output);
fs.writeFileSync(morphPath, JSON.stringify(morph));
console.log(
  `scene.svg + spring-morph.json: ${morph.paths.length} paths × ${morph.forces.length} keyframes`
);
