import fs from "fs";
import path from "path";

const assets = path.join(path.resolve(import.meta.dirname, ".."), "assets");
const scenePath = path.join(assets, "scene.svg");
const morphPath = path.join(assets, "spring-morph.json");
const flatUserPath = path.join(assets, "scene-flat-user.svg");
const edgeUserPath = path.join(assets, "scene-edge-user.svg");
const maxSceneUserPath = path.join(assets, "scene-max-user.svg");
const maxUserPath = path.join(assets, "silomer-max.svg");
const SILOMER_RATED_N = 20;

const SILOMER_SHIFT_X = 51.789;
const SILOMER_SHIFT_Y = -21.6446;

/** Flat pad top Y vs edge pad top Y — seat edge content on the shared flat pad. */
const FLAT_PAD_TOP_Y = 16.7734;
const EDGE_PAD_TOP_Y = 101.521;
const EDGE_LAYOUT_Y_OFFSET = FLAT_PAD_TOP_Y - EDGE_PAD_TOP_Y; // ≈ -84.7476

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

function parsePathLine(line) {
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
    .map(parsePathLine);
}

/** Siloměr v celé scéně (max. natažení) — cesty až před `<defs>`. */
function extractSilomerPathsUntil(svg, marker, untilIncludes) {
  const lines = svg.split("\n");
  const start = lines.findIndex((line) => line.includes(marker));
  const end = lines.findIndex(
    (line, index) => index > start && line.includes(untilIncludes)
  );
  if (start === -1 || end === -1) {
    throw new Error(`Nepodařilo se najít siloměr (${marker} … ${untilIncludes}).`);
  }

  return lines
    .slice(start, end)
    .filter((line) => line.trim().startsWith("<path"))
    .map(parsePathLine);
}

function pathLineFromParsed(pathItem, nums) {
  const d = rebuildPathD(pathStructure(pathItem.d), nums);
  return `<path d="${d}" ${pathItem.attrs}/>`;
}

function shiftPathLineY(line, dy) {
  const pathItem = parsePathLine(line);
  return pathLineFromParsed(
    pathItem,
    shiftPathNums(pathItem.nums, 0, dy)
  );
}

/** Cropped siloměr SVG: all top-level paths in morph order. */
function extractAllPaths(svg) {
  return svg
    .split("\n")
    .filter((line) => line.trim().startsWith("<path"))
    .map(parsePathLine);
}

function shiftPathNums(nums, dx, dy) {
  return nums.map((value, index) =>
    index % 2 === 0 ? value + dx : value + dy
  );
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

function rebuildPathD(structure, nums) {
  let ni = 0;
  return structure
    .map((token) => {
      if (token !== null) return token;
      const value = nums[ni++];
      return Number.isInteger(value) ? String(value) : String(value);
    })
    .join(" ")
    .replace(/ ([A-Za-z])/g, "$1")
    .replace(/([A-Za-z]) /g, "$1");
}

/** Levý siloměr: 180° otočení delty (X i Y podél osy pružiny). */
function mirrorStretchDeltas(delta) {
  return delta.map((value) => -value);
}

/** Háček (path 4) drží Y — odečti společný pokles těla, zachovej natažení pružiny. */
const HOOK_PATH_INDEX = 4;

function pinFrameYToHook(frameNums, restNums) {
  const hookDy = frameNums[HOOK_PATH_INDEX][1] - restNums[HOOK_PATH_INDEX][1];
  if (Math.abs(hookDy) < 1e-9) return frameNums;
  return frameNums.map((nums) =>
    nums.map((value, index) => (index % 2 === 1 ? value - hookDy : value))
  );
}

function tagBeamPaths(lines) {
  return lines.map((line) => {
    if (!line.includes("<path")) return line;
    if (line.includes('stroke="black"') || line.includes("beam-hook")) {
      return line.includes('class="')
        ? line
        : line.replace("<path ", '<path class="beam-hook" ');
    }
    if (line.includes('fill="#F1A558"') || line.includes("beam-body")) {
      return line.includes('class="')
        ? line
        : line.replace("<path ", '<path class="beam-body" ');
    }
    if (line.includes('stroke="#5C3A18"') || line.includes("beam-wire")) {
      return line.includes('class="')
        ? line
        : line.replace("<path ", '<path class="beam-wire" ');
    }
    return line;
  });
}

function extractFlatSections(svg) {
  const lines = svg.split("\n");
  const padStart = lines.findIndex((line) => line.includes("M551.25 16.7734"));
  const bodyStart = lines.findIndex((line) => line.includes("M650.5 97.5234"));
  const wireStart = lines.findIndex((line) =>
    line.includes('stroke="#5C3A18"')
  );
  const hookStart = lines.findIndex((line) =>
    line.includes("M399.75 79.7734L373.25 86.2734")
  );
  const readoutStart = lines.findIndex((line) =>
    line.includes("M233.661 87.4857")
  );

  if (
    padStart === -1 ||
    bodyStart === -1 ||
    wireStart === -1 ||
    hookStart === -1 ||
    readoutStart === -1
  ) {
    throw new Error("scene-flat-user.svg nemá očekávanou strukturu.");
  }

  return {
    pad: lines.slice(padStart, padStart + 4),
    readoutBox: lines[readoutStart],
    beam: [lines[bodyStart], lines[wireStart]],
    hook: lines[hookStart],
  };
}

function extractEdgeSections(svg) {
  const lines = svg.split("\n");
  const bodyStart = lines.findIndex((line) => line.includes("M450.701 189.113"));
  const wireStart = lines.findIndex(
    (line) =>
      line.includes('stroke="#5C3A18"') && line.includes("M642.555 17.7471")
  );
  const hookStart = lines.findIndex((line) =>
    line.includes("M425.75 122.771L399.25 129.271")
  );
  const readoutStart = lines.findIndex((line) =>
    line.includes("M244.58 131.484")
  );

  if (
    bodyStart === -1 ||
    wireStart === -1 ||
    hookStart === -1 ||
    readoutStart === -1
  ) {
    throw new Error("scene-edge-user.svg nemá očekávanou edge strukturu.");
  }

  // Bottom contact of standing beam (front lower edge midpoint).
  const scaleOrigin = {
    x: (406.25 + 450.701) / 2,
    y: 189.113,
  };
  const hookAttach = { x: 425.75, y: 122.771 };
  const hookSilomer = { x: 399.25, y: 129.271 };

  return {
    readoutBox: lines[readoutStart],
    beam: [lines[bodyStart], lines[wireStart]],
    hook: lines[hookStart],
    hookAttach,
    hookSilomer,
    scaleOrigin,
  };
}

function readoutLayoutFromBox(boxLine) {
  const d = boxLine.match(/d="([^"]+)"/)?.[1];
  if (!d) throw new Error("Readout box bez d.");
  const tokens = tokenizePath(d);
  const corners = [];

  for (let i = 0; i < tokens.length && corners.length < 4; i++) {
    const token = tokens[i];
    if (token === "M" || token === "L") {
      corners.push([Number(tokens[++i]), Number(tokens[++i])]);
      continue;
    }
    if (/^[CSQTAcsqta]$/.test(token)) {
      const argCount = { C: 6, S: 4, Q: 4, T: 2, A: 7, c: 6, s: 4, q: 4, t: 2, a: 7 }[
        token
      ];
      i += argCount;
    }
  }

  if (corners.length < 2) {
    throw new Error("Readout box nemá dostatek rohů.");
  }

  const [[x0, y0], [x1, y1]] = corners;
  const x =
    corners.reduce((sum, point) => sum + point[0], 0) / corners.length;
  const y =
    corners.reduce((sum, point) => sum + point[1], 0) / corners.length;
  const angle = (Math.atan2(y1 - y0, x1 - x0) * 180) / Math.PI;

  return { x, y, angle };
}

const flatUser = fs.readFileSync(flatUserPath, "utf8");
const edgeUser = fs.readFileSync(edgeUserPath, "utf8");
const flatSections = extractFlatSections(flatUser);
const edgeSections = extractEdgeSections(edgeUser);

const newRestRaw = extractSilomerPaths(flatUser, "M181.223", "M233.661");
const edgeRestRaw = extractSilomerPaths(
  edgeUser,
  "M207.223 163.853",
  "M244.58 131.484"
);

const loaded = morphFrames.map((frame) => {
  const svg = fs.readFileSync(path.join(assets, frame.file), "utf8");
  return {
    ...frame,
    paths: extractSilomerPaths(svg, frame.marker, "M508.584").map(
      (pathItem) => ({
        ...pathItem,
        nums: shiftNums(pathItem.nums),
      })
    ),
  };
});

// Align old rest / new rest to force-frame path order (skip baked extras).
loaded[0].paths = alignBaseToReference(loaded[0].paths, loaded[1].paths);
const alignedNewRest = alignBaseToReference(newRestRaw, loaded[1].paths);
const alignedOldRest = loaded[0].paths;
// Edge rest aligned to the same flat rest order (key matching).
const alignedEdgeRest = alignBaseToReference(edgeRestRaw, alignedNewRest);

for (let i = 1; i < loaded.length; i++) {
  if (loaded[i].paths.length !== alignedOldRest.length) {
    throw new Error(`Frame ${loaded[i].force}N má jiný počet cest.`);
  }
  for (let p = 0; p < alignedOldRest.length; p++) {
    if (loaded[i].paths[p].key !== alignedOldRest[p].key) {
      throw new Error(
        `Frame ${loaded[i].force}N, path ${p}: struktura nesedí (${loaded[i].paths[p].key} vs ${alignedOldRest[p].key}).`
      );
    }
    if (loaded[i].paths[p].nums.length !== alignedNewRest[p].nums.length) {
      throw new Error(
        `Frame ${loaded[i].force}N, path ${p}: délka nums nesedí s newRest.`
      );
    }
    if (alignedEdgeRest[p].nums.length !== alignedNewRest[p].nums.length) {
      throw new Error(
        `Edge rest, path ${p}: délka nums nesedí s flat rest.`
      );
    }
  }
}

const restNums = alignedNewRest.map((pathItem) => pathItem.nums);

const frames = loaded.map((frame, frameIndex) => {
  if (frameIndex === 0) {
    return restNums.map((nums) => nums.slice());
  }
  const raw = frame.paths.map((pathItem, pathIndex) => {
    const oldRest = alignedOldRest[pathIndex].nums;
    const newRest = alignedNewRest[pathIndex].nums;
    const delta = pathItem.nums.map((value, i) => value - oldRest[i]);
    const mirrored = mirrorStretchDeltas(delta);
    return newRest.map((value, i) => value + mirrored[i]);
  });
  return pinFrameYToHook(raw, restNums);
});

// Edge morph: same flat deltas applied onto edge rest coordinates.
const flatRest = frames[0];
const edgeFrames = frames.map((frameSet) =>
  frameSet.map((pathNums, pathIndex) => {
    const rest = alignedEdgeRest[pathIndex].nums;
    const flatDelta = pathNums.map(
      (value, i) => value - flatRest[pathIndex][i]
    );
    return rest.map((value, i) => value + flatDelta[i]);
  })
);

// Exact max stretch (rated N) from user full-scene art (scene-max-user.svg).
if (!fs.existsSync(maxSceneUserPath)) {
  const cropped = fs.readFileSync(maxUserPath, "utf8");
  const croppedLines = cropped
    .split("\n")
    .filter((line) => line.trim().startsWith("<path"));
  const sceneYOffset = 184.937 - croppedLines[0].match(/-?\d*\.?\d+/g)?.[1];
  if (!Number.isFinite(sceneYOffset)) {
    throw new Error("Nelze odvodit Y posun pro scene-max-user.svg.");
  }
  const shiftedPaths = croppedLines.map((line) =>
    shiftPathLineY(line, sceneYOffset)
  );
  const sceneMaxSvg = `<svg width="941" height="256" viewBox="0 0 941 256" fill="none" xmlns="http://www.w3.org/2000/svg">
${shiftedPaths.join("\n")}
<defs></defs>
</svg>
`;
  fs.writeFileSync(maxSceneUserPath, sceneMaxSvg);
}

const maxSceneUser = fs.readFileSync(maxSceneUserPath, "utf8");
const maxRaw = extractSilomerPathsUntil(
  maxSceneUser,
  "M28.694",
  "<defs>"
);
if (maxRaw.length !== alignedNewRest.length) {
  throw new Error(
    `scene-max-user.svg má ${maxRaw.length} siloměrových cest, očekáváno ${alignedNewRest.length}.`
  );
}
for (let p = 0; p < alignedNewRest.length; p++) {
  if (maxRaw[p].key !== alignedNewRest[p].key) {
    throw new Error(
      `Max path ${p}: struktura nesedí (${maxRaw[p].key} vs ${alignedNewRest[p].key}).`
    );
  }
}
const maxShiftX = alignedNewRest[0].nums[0] - maxRaw[0].nums[0];
const maxShiftY = alignedNewRest[0].nums[1] - maxRaw[0].nums[1];
const flatMax = maxRaw.map((pathItem) =>
  shiftPathNums(pathItem.nums, maxShiftX, maxShiftY)
);

/** Pouzdro — v max. kresbě je v klidu, simulace ale pokračuje doleva až 20 N. */
const SILOMER_HOUSING_PATH_INDICES = [0, 10, 11, 24, 46];
const sixNFrame = frames[frames.length - 1];
const restFrame = frames[0];
const maxForceRatio = SILOMER_RATED_N / morphFrames[morphFrames.length - 1].force;

for (const pathIndex of SILOMER_HOUSING_PATH_INDICES) {
  flatMax[pathIndex] = restFrame[pathIndex].map((value, i) =>
    value + (sixNFrame[pathIndex][i] - restFrame[pathIndex][i]) * maxForceRatio
  );
}

const bodyDx = flatMax[0][0] - restFrame[0][0];
const bodyDy = flatMax[0][1] - restFrame[0][1];

for (let pathIndex = 0; pathIndex < flatMax.length; pathIndex++) {
  if (SILOMER_HOUSING_PATH_INDICES.includes(pathIndex)) continue;
  flatMax[pathIndex] = flatMax[pathIndex].map((value, i) =>
    i % 2 === 0 ? value + bodyDx : value + bodyDy
  );
}

const edgeMax = flatMax.map((pathNums, pathIndex) => {
  const rest = alignedEdgeRest[pathIndex].nums;
  const flatDelta = pathNums.map(
    (value, i) => value - flatRest[pathIndex][i]
  );
  return rest.map((value, i) => value + flatDelta[i]);
});

const allForces = [...morphFrames.map((frame) => frame.force), SILOMER_RATED_N];
const allFrames = [...frames, flatMax];
const allEdgeFrames = [...edgeFrames, edgeMax];

const morph = {
  forces: allForces,
  paths: alignedNewRest.map((basePath, index) => ({
    attrs: basePath.attrs,
    structure: pathStructure(basePath.d),
    frames: allFrames.map((frameSet) => frameSet[index]),
    edgeFrames: allEdgeFrames.map((frameSet) => frameSet[index]),
  })),
};

const materialDefs = `
<linearGradient id="paint0_linear_2095_869" x1="631.25" y1="56.7734" x2="791.25" y2="196.773" gradientUnits="userSpaceOnUse">
  <stop stop-color="#7A828C"/>
  <stop offset="1" stop-color="#454C54"/>
</linearGradient>
<linearGradient id="paint1_linear_2095_869" x1="11.25" y1="16.7734" x2="711.25" y2="156.773" gradientUnits="userSpaceOnUse">
  <stop stop-color="#D5DAE0"/>
  <stop offset="0.35" stop-color="#ADB5BF"/>
  <stop offset="0.7" stop-color="#8E96A1"/>
  <stop offset="1" stop-color="#6F7782"/>
</linearGradient>
<linearGradient id="paint2_linear_2095_869" x1="-8.75" y1="156.773" x2="631.25" y2="216.773" gradientUnits="userSpaceOnUse">
  <stop stop-color="#6B737D"/>
  <stop offset="1" stop-color="#3E4650"/>
</linearGradient>
<linearGradient id="paint3_linear_2095_869" x1="-8.75001" y1="156.773" x2="631.25" y2="216.773" gradientUnits="userSpaceOnUse">
  <stop stop-color="#747C86"/>
  <stop offset="1" stop-color="#454C54"/>
</linearGradient>
<linearGradient id="beamWoodFlat" x1="360" y1="20" x2="640" y2="130" gradientUnits="userSpaceOnUse">
  <stop stop-color="#F0C38A"/>
  <stop offset="0.45" stop-color="#D9984F"/>
  <stop offset="1" stop-color="#B56F2E"/>
</linearGradient>
<linearGradient id="beamWoodEdge" x1="410" y1="20" x2="620" y2="190" gradientUnits="userSpaceOnUse">
  <stop stop-color="#E8B87A"/>
  <stop offset="0.4" stop-color="#C98542"/>
  <stop offset="1" stop-color="#9E5F28"/>
</linearGradient>
<linearGradient id="beamSteelFlat" x1="360" y1="15" x2="650" y2="135" gradientUnits="userSpaceOnUse">
  <stop stop-color="#E8ECF0"/>
  <stop offset="0.28" stop-color="#B7C0C9"/>
  <stop offset="0.62" stop-color="#8A949F"/>
  <stop offset="1" stop-color="#5E6770"/>
</linearGradient>
<linearGradient id="beamSteelEdge" x1="410" y1="15" x2="630" y2="200" gradientUnits="userSpaceOnUse">
  <stop stop-color="#DDE3E9"/>
  <stop offset="0.35" stop-color="#A7B1BB"/>
  <stop offset="0.7" stop-color="#7A848E"/>
  <stop offset="1" stop-color="#4F575F"/>
</linearGradient>
<linearGradient id="leatherPad0" x1="631.25" y1="56.7734" x2="791.25" y2="196.773" gradientUnits="userSpaceOnUse">
  <stop stop-color="#7A5238"/>
  <stop offset="1" stop-color="#4E3222"/>
</linearGradient>
<linearGradient id="leatherPad1" x1="11.25" y1="16.7734" x2="711.25" y2="156.773" gradientUnits="userSpaceOnUse">
  <stop stop-color="#A36B45"/>
  <stop offset="0.4" stop-color="#8B5636"/>
  <stop offset="1" stop-color="#6A4129"/>
</linearGradient>
<linearGradient id="leatherPad2" x1="-8.75" y1="156.773" x2="631.25" y2="216.773" gradientUnits="userSpaceOnUse">
  <stop stop-color="#6E4630"/>
  <stop offset="1" stop-color="#452C1C"/>
</linearGradient>
<linearGradient id="leatherPad3" x1="-8.75" y1="156.773" x2="631.25" y2="216.773" gradientUnits="userSpaceOnUse">
  <stop stop-color="#745032"/>
  <stop offset="1" stop-color="#4A301E"/>
</linearGradient>
<linearGradient id="carpetPad0" x1="631.25" y1="56.7734" x2="791.25" y2="196.773" gradientUnits="userSpaceOnUse">
  <stop stop-color="#5A6E4A"/>
  <stop offset="1" stop-color="#3A4A30"/>
</linearGradient>
<linearGradient id="carpetPad1" x1="11.25" y1="16.7734" x2="711.25" y2="156.773" gradientUnits="userSpaceOnUse">
  <stop stop-color="#7A9168"/>
  <stop offset="0.4" stop-color="#647A54"/>
  <stop offset="1" stop-color="#4E6342"/>
</linearGradient>
<linearGradient id="carpetPad2" x1="-8.75" y1="156.773" x2="631.25" y2="216.773" gradientUnits="userSpaceOnUse">
  <stop stop-color="#4E5F40"/>
  <stop offset="1" stop-color="#2F3D2A"/>
</linearGradient>
<linearGradient id="carpetPad3" x1="-8.75" y1="156.773" x2="631.25" y2="216.773" gradientUnits="userSpaceOnUse">
  <stop stop-color="#556845"/>
  <stop offset="1" stop-color="#354532"/>
</linearGradient>
`.trim();

const defs = `<defs>\n${materialDefs}\n</defs>`;

const flatMorphMarkup = morph.paths
  .map(
    (pathItem, index) =>
      `<path id="springPath${index}" d="${rebuildPathD(
        pathItem.structure,
        frames[0][index]
      )}" ${pathItem.attrs}/>`
  )
  .join("\n");

const edgeMorphMarkup = morph.paths
  .map(
    (pathItem, index) =>
      `<path id="springPathEdge${index}" d="${rebuildPathD(
        pathItem.structure,
        edgeFrames[0][index]
      )}" ${pathItem.attrs}/>`
  )
  .join("\n");

const flatReadoutLayout = readoutLayoutFromBox(flatSections.readoutBox);
const edgeReadoutLayout = readoutLayoutFromBox(edgeSections.readoutBox);

const READOUT_FLAT = {
  x: Number(flatReadoutLayout.x.toFixed(1)),
  y: Number(flatReadoutLayout.y.toFixed(1)),
  angle: Number(flatReadoutLayout.angle.toFixed(3)),
};
const READOUT_EDGE = {
  x: Number(edgeReadoutLayout.x.toFixed(1)),
  y: Number(edgeReadoutLayout.y.toFixed(1)),
  angle: Number(edgeReadoutLayout.angle.toFixed(3)),
};

const SILOMER_HIT_FLAT = { x: 150, y: 40, width: 240, height: 110 };
// Cover left siloměr in edge local coords (before layout offset).
const SILOMER_HIT_EDGE = { x: 190, y: 95, width: 210, height: 90 };

// Beam top after Y offset ≈ -83.98; flat pad bottom ≈ 221.77.
const VIEW_X = -61;
const VIEW_Y = -90;
const VIEW_W = 824;
const VIEW_H = 320;

const output = `<svg width="${VIEW_W}" height="${VIEW_H}" viewBox="${VIEW_X} ${VIEW_Y} ${VIEW_W} ${VIEW_H}" fill="none" xmlns="http://www.w3.org/2000/svg" overflow="visible" aria-label="Základní scéna tření">
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
<rect id="silomer" x="${SILOMER_HIT_FLAT.x}" y="${SILOMER_HIT_FLAT.y}" width="${SILOMER_HIT_FLAT.width}" height="${SILOMER_HIT_FLAT.height}" fill="transparent" cursor="grab" aria-label="Siloměr"/>
</g>
<g id="beamHookFlat">
${tagBeamPaths([flatSections.hook]).join("\n")}
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
<rect id="silomerEdgeHit" x="${SILOMER_HIT_EDGE.x}" y="${SILOMER_HIT_EDGE.y}" width="${SILOMER_HIT_EDGE.width}" height="${SILOMER_HIT_EDGE.height}" fill="transparent" cursor="grab" aria-label="Siloměr"/>
</g>
<g id="beamHookEdge">
${tagBeamPaths([edgeSections.hook]).join("\n")}
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
console.log(
  `max stretch ${SILOMER_RATED_N}N shift=(${maxShiftX.toFixed(4)}, ${maxShiftY.toFixed(4)})`
);
console.log(
  `EDGE_LAYOUT_Y_OFFSET=${EDGE_LAYOUT_Y_OFFSET}`
);
console.log(
  `EDGE hooks: attach=(${edgeSections.hookAttach.x}, ${edgeSections.hookAttach.y}) silomer=(${edgeSections.hookSilomer.x}, ${edgeSections.hookSilomer.y})`
);
console.log(
  `EDGE scale origin: (${edgeSections.scaleOrigin.x}, ${edgeSections.scaleOrigin.y})`
);
console.log(
  `READOUT_FLAT=${JSON.stringify(READOUT_FLAT)} READOUT_EDGE=${JSON.stringify(READOUT_EDGE)}`
);
console.log(
  `viewBox="${VIEW_X} ${VIEW_Y} ${VIEW_W} ${VIEW_H}"`
);
