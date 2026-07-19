import fs from "fs";
import path from "path";

const assets = path.join(path.resolve(import.meta.dirname, ".."), "assets");
const scenePath = path.join(assets, "scene.svg");
const morphPath = path.join(assets, "spring-morph.json");
const flatUserPath = path.join(assets, "scene-flat-user.svg");
const edgeUserPath = path.join(assets, "scene-edge-user.svg");

const SILOMER_SHIFT_X = 51.789;
const SILOMER_SHIFT_Y = -21.6446;
/** Edge user SVG has the pad lower; keep flat pad fixed and shift edge rig up. */
const EDGE_LAYOUT_Y_OFFSET = 1.37842 - 60.5215;

const morphFrames = [
  { force: 0, file: "scene-rest.svg", marker: "M561.021" },
  { force: 2, file: "scene-2n.svg", marker: "M574.819" },
  { force: 4, file: "scene-4n.svg", marker: "M588.617" },
  { force: 6, file: "scene-stretched.svg", marker: "M601.444" },
];

function extractDefs(svg) {
  const match = svg.match(/<defs>[\s\S]*?<\/defs>/);
  return match ? match[0] : "";
}

function mergeDefs(flatDefs, edgeDefs) {
  const edgeInner = edgeDefs.replace(/^<defs>\s*/, "").replace(/\s*<\/defs>$/, "");
  return flatDefs.replace("</defs>", `${edgeInner}\n</defs>`);
}

function extractSilomerPaths(svg, marker, endMarker) {
  const lines = svg.split("\n");
  const start = lines.findIndex((line) => line.includes(marker));
  const end = lines.findIndex(
    (line, index) => index > start && line.includes(endMarker)
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

function shiftNums(nums) {
  return nums.map((value, index) =>
    index % 2 === 0 ? value + SILOMER_SHIFT_X : value + SILOMER_SHIFT_Y
  );
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

function tagBeamPaths(lines) {
  return lines.map((line) => {
    if (!line.includes("<path")) return line;
    if (line.includes('stroke="black"')) {
      return line.replace("<path ", '<path class="beam-hook" ');
    }
    if (line.includes('fill="#F1A558"')) {
      return line.replace("<path ", '<path class="beam-body" ');
    }
    if (line.includes('stroke="#5C3A18"')) {
      return line.replace("<path ", '<path class="beam-wire" ');
    }
    return line;
  });
}

function extractFlatSections(svg) {
  const lines = svg.split("\n");
  const padEnd = lines.findIndex((line) => line.includes("M612.81 17.4316"));
  const readoutStart = lines.findIndex((line) =>
    line.includes("M560.372 48.8058")
  );
  const hookStart = lines.findIndex((line) =>
    line.includes("M421.5 49.6284L395 56.1284")
  );

  if (padEnd === -1 || readoutStart === -1 || hookStart === -1) {
    throw new Error("scene-flat-user.svg nemá očekávanou strukturu.");
  }

  return {
    pad: lines.slice(1, padEnd),
    readoutBox: lines[readoutStart],
    beam: lines.slice(hookStart, hookStart + 3),
  };
}

function extractEdgeSections(svg) {
  const lines = svg.split("\n");
  const padStart = lines.findIndex((line) => line.includes("M551.25 60.5215"));
  const silomerStart = lines.findIndex((line) =>
    line.includes("M589.81 32.5747")
  );
  const readoutStart = lines.findIndex((line) =>
    line.includes("M537.372 63.9488")
  );
  const hookStart = lines.findIndex((line) =>
    line.includes("M398 66.2715L371.5 72.7715")
  );
  const beamFill = lines.findIndex((line) =>
    line.includes("M183.451 189.113")
  );

  if (
    padStart === -1 ||
    silomerStart === -1 ||
    readoutStart === -1 ||
    hookStart === -1 ||
    beamFill === -1
  ) {
    throw new Error("scene-edge-user.svg nemá očekávanou strukturu.");
  }

  return {
    pad: lines.slice(padStart, silomerStart),
    readoutBox: lines[readoutStart],
    beam: [lines[hookStart], lines[beamFill], lines[beamFill + 1]],
  };
}

function deriveEdgeFrames(flatRestPaths, flatFrameSets, edgeRestPaths) {
  return flatFrameSets.map((framePaths) =>
    framePaths.map((pathItem, pathIndex) => {
      const flatRest = flatRestPaths[pathIndex].nums;
      const edgeRest = edgeRestPaths[pathIndex].nums;
      return pathItem.nums.map(
        (value, index) => edgeRest[index] + (value - flatRest[index])
      );
    })
  );
}

const flatUser = fs.readFileSync(flatUserPath, "utf8");
const edgeUser = fs.readFileSync(edgeUserPath, "utf8");
const flatSections = extractFlatSections(flatUser);
const edgeSections = extractEdgeSections(edgeUser);

const restFromFlat = extractSilomerPaths(
  flatUser,
  "M612.81 17.4316",
  "M560.372 48.8058"
);
const restFromEdge = extractSilomerPaths(
  edgeUser,
  "M589.81 32.5747",
  "M537.372 63.9488"
);

const loaded = morphFrames.map((frame) => {
  const svg = fs.readFileSync(path.join(assets, frame.file), "utf8");
  return {
    ...frame,
    paths: extractSilomerPaths(svg, frame.marker, "M508.584 70.4504").map(
      (pathItem) => ({
        ...pathItem,
        nums: shiftNums(pathItem.nums),
      })
    ),
  };
});

loaded[0].paths = alignBaseToReference(restFromFlat, loaded[1].paths);
const alignedEdgeRest = alignBaseToReference(restFromEdge, loaded[1].paths);

for (let i = 1; i < loaded.length; i++) {
  if (loaded[i].paths.length !== loaded[0].paths.length) {
    throw new Error(`Frame ${loaded[i].force}N má jiný počet cest.`);
  }
  for (let p = 0; p < loaded[0].paths.length; p++) {
    if (loaded[i].paths[p].key !== loaded[0].paths[p].key) {
      throw new Error(
        `Frame ${loaded[i].force}N, path ${p}: struktura nesedí (${loaded[i].paths[p].key} vs ${loaded[0].paths[p].key}).`
      );
    }
  }
}

const alignedFlatRest = loaded[0].paths;
const flatFrameSets = loaded.map((frame) => frame.paths);
const edgeFrameSets = deriveEdgeFrames(
  alignedFlatRest,
  flatFrameSets,
  alignedEdgeRest
);

const morph = {
  forces: morphFrames.map((frame) => frame.force),
  paths: alignedFlatRest.map((basePath, index) => ({
    attrs: basePath.attrs,
    structure: pathStructure(basePath.d),
    frames: flatFrameSets.map((frameSet) => frameSet[index].nums),
    edgeFrames: edgeFrameSets.map((frameSet) => frameSet[index]),
  })),
};

const defs = mergeDefs(extractDefs(flatUser), extractDefs(edgeUser));

const flatMorphMarkup = morph.paths
  .map(
    (pathItem, index) =>
      `<path id="springPath${index}" d="${alignedFlatRest[index].d}" ${pathItem.attrs}/>`
  )
  .join("\n");

const READOUT_FLAT = { x: 539.04, y: 66.61, angle: -9.582 };
const READOUT_EDGE = { x: 516.04, y: 81.75, angle: -9.582 };

const edgeMorphMarkup = morph.paths
  .map(
    (pathItem, index) =>
      `<path id="springPathEdge${index}" d="${alignedEdgeRest[index].d}" ${pathItem.attrs}/>`
  )
  .join("\n");

const output = `<svg width="763" height="267" viewBox="0 -60 763 267" fill="none" xmlns="http://www.w3.org/2000/svg" aria-label="Základní scéna tření">
${defs}
<g id="pad" aria-label="Kovová podložka">
${flatSections.pad.join("\n")}
</g>
<g id="rig">
<g id="beam">
<g id="flatScene">
<g id="beamFlat">
${tagBeamPaths(flatSections.beam).join("\n")}
</g>
<g id="silomerFlat">
<g id="silomerMorph">
${flatMorphMarkup}
</g>
<g id="forceReadoutWrap">
${flatSections.readoutBox}
<text id="forceReadout" x="${READOUT_FLAT.x}" y="${READOUT_FLAT.y}" transform="rotate(${READOUT_FLAT.angle} ${READOUT_FLAT.x} ${READOUT_FLAT.y})" text-anchor="middle" dominant-baseline="middle" font-family="Fenomen Sans, system-ui, sans-serif" font-size="14" font-weight="600" fill="#171923">0 N</text>
</g>
<rect id="silomer" x="417" y="-8" width="270" height="98" fill="transparent" cursor="grab" aria-label="Siloměr"/>
</g>
</g>
<g id="edgeScene" style="display:none" transform="translate(0 ${EDGE_LAYOUT_Y_OFFSET})">
<g id="beamEdge">
${tagBeamPaths(edgeSections.beam).join("\n")}
</g>
<g id="silomerEdge">
<g id="silomerMorphEdge">
${edgeMorphMarkup}
</g>
<g id="forceReadoutWrapEdge">
${edgeSections.readoutBox}
<text id="forceReadoutEdge" x="${READOUT_EDGE.x}" y="${READOUT_EDGE.y}" transform="rotate(${READOUT_EDGE.angle} ${READOUT_EDGE.x} ${READOUT_EDGE.y})" text-anchor="middle" dominant-baseline="middle" font-family="Fenomen Sans, system-ui, sans-serif" font-size="14" font-weight="600" fill="#171923">0 N</text>
</g>
<rect id="silomerEdgeHit" x="394" y="7" width="270" height="98" fill="transparent" cursor="grab" aria-label="Siloměr"/>
</g>
</g>
</g>
</g>
</svg>
`;

fs.writeFileSync(scenePath, output);
fs.writeFileSync(morphPath, JSON.stringify(morph));
console.log(
  `scene.svg + spring-morph.json: ${morph.paths.length} paths × ${morph.forces.length} keyframes (flat + edge)`
);
