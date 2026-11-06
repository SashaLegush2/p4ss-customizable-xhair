const PIECES = [
  { label: "passlock", styleSuffix: "passlock", colorAlias: "p4ss_col_"    },
  { label: "piece 1",  styleSuffix: "one",      colorAlias: "p4ss_r1_col_" },
  { label: "piece 2",  styleSuffix: "two",      colorAlias: "p4ss_r2_col_" },
];

const RELOAD_COMMANDS = [
  "sv_cheats 1",
  "mat_reloadmaterial passtime/hud/passtime_ball_reticle_passlock",
  "mat_reloadmaterial passtime/hud/passtime_ball_reticle_piece_1",
  "mat_reloadmaterial passtime/hud/passtime_ball_reticle_piece_2",
  "sv_cheats 0",
];

const FULL_BACKGROUNDS = ["", "dark", "light"];

const $ = selector => document.querySelector(selector);

const state = {
  colors: [],
  textures: new Map(),
  fullBackground: 0,
};
const rows = [];
let full;

const vtfUrl = name => `${CONFIG.vtfFolder}${name}.vtf`;
const vmtUrl = number => `${CONFIG.colorFolder}${number}.vmt`;

function parseVmtColor(text) {
  const match = text.match(/\$color"?\s+"?([\[{])\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
  if (!match) return null;
  const scale = match[1] === "[" ? 255 : 1;
  return match.slice(2, 5).map(v => Math.min(255, Math.round(v * scale)));
}

async function loadColors() {
  const numbers = Array.from({ length: CONFIG.colorCount }, (_, i) => i + 1);

  await Promise.all(numbers.map(async number => {
    try {
      const response = await fetch(vmtUrl(number));
      if (!response.ok) throw new Error(response.status);
      const color = parseVmtColor(await response.text());
      if (color) state.colors[number] = color;
    } catch (error) {
      console.warn("Could not load", vmtUrl(number), error);
    }
  }));

  rows.forEach(styleColorSelect);
  rows.forEach(drawRow);
}

const brightness = ([r, g, b]) => r * 0.3 + g * 0.59 + b * 0.11;

function styleColorSelect(row) {
  for (const option of row.colorSelect.options) {
    const color = state.colors[option.value];
    if (!color) continue;
    option.style.background = `rgb(${color})`;
    option.style.color = brightness(color) > 140 ? "#000" : "#fff";
  }
  showColorStripe(row);
}

function showColorStripe(row) {
  const color = state.colors[row.colorSelect.value];
  row.colorSelect.style.boxShadow = color ? `inset 16px 0 0 rgb(${color})` : "";
}

function loadTexture(name) {
  if (!state.textures.has(name)) {
    const texture = fetch(vtfUrl(name))
      .then(response => {
        if (!response.ok) throw new Error(response.status);
        return response.arrayBuffer();
      })
      .then(decodeVTF);
    state.textures.set(name, texture);
  }
  return state.textures.get(name);
}

function tintPixels(rgba, [r, g, b]) {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < out.length; i += 4) {
    out[i]     = (out[i]     * r) / 255;
    out[i + 1] = (out[i + 1] * g) / 255;
    out[i + 2] = (out[i + 2] * b) / 255;
  }
  return out;
}

async function drawRow(row) {
  const ticket = ++row.ticket;
  const name = STYLES[row.styleSelect.value - 1];

  try {
    const texture = await loadTexture(name);
    if (ticket !== row.ticket) return;

    const color = state.colors[row.colorSelect.value] || [255, 255, 255];
    row.canvas.width = texture.width;
    row.canvas.height = texture.height;
    row.canvas.getContext("2d").putImageData(
      new ImageData(tintPixels(texture.rgba, color), texture.width, texture.height), 0, 0);

    row.canvas.style.display = "block";
    row.message.textContent = "";
    row.ready = true;
  } catch (error) {
    state.textures.delete(name);
    if (ticket !== row.ticket) return;

    row.canvas.style.display = "none";
    row.message.textContent = name;
    row.ready = false;
    console.warn("Could not load", vtfUrl(name), error);
  }
  drawFullCrosshair();
}

function drawFullCrosshair() {
  const layers = rows.slice(0, 2).filter(row => row.ready);

  if (!layers.length) {
    full.canvas.style.display = "none";
    return;
  }

  const size = Math.max(...layers.map(row =>
    Math.max(row.canvas.width, row.canvas.height)
  ));

  const context = full.canvas.getContext("2d");
  full.canvas.width = full.canvas.height = size;

  context.clearRect(0, 0, size, size);

  layers.forEach(row =>
    context.drawImage(row.canvas, 0, 0, size, size)
  );

  full.canvas.style.display = "block";
}

function buildCommand() {
  const commands = PIECES.flatMap((piece, i) => [
    `p4ss_xhair_style_${rows[i].styleSelect.value}_${piece.styleSuffix}`,
    `${piece.colorAlias}${rows[i].colorSelect.value}`,
  ]);
  commands.push(...RELOAD_COMMANDS);
  return commands.join("; ");
}

const updateCommandPreview = () => { $("#command-preview").textContent = buildCommand(); };

async function copyCommand() {
  const text = buildCommand();
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    document.body.append(box);
    box.select();
    try { document.execCommand("copy"); } catch {}
    box.remove();
  }
  const button = $("#copy-button");
  button.textContent = "Copied!";
  setTimeout(() => { button.textContent = "Button"; }, 1300);
}


function addOption(select, value, text) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  select.append(option);
}

function matchHeight(source, target, minimum = 0) {
  new ResizeObserver(() => {
    const size = Math.max(source.offsetHeight, minimum);
    target.style.width = target.style.height = `${size}px`;
  }).observe(source);
}

function buildRow(piece) {
  const element = document.createElement("div");
  element.className = "row";
  element.innerHTML = `
    <div class="controls">
      <h2 class="row-title">${piece.label}</h2>
      <select aria-label="${piece.label} image"></select>
      <select aria-label="${piece.label} colour"></select>
    </div>
    <div class="preview">
      <canvas></canvas>
      <span></span>
    </div>`;

  const [styleSelect, colorSelect] = element.querySelectorAll("select");
  STYLES.forEach((name, i) => { if (name) addOption(styleSelect, i + 1, name); });
  for (let n = 1; n <= CONFIG.colorCount; n++) addOption(colorSelect, n, `colour ${n}`);

  const row = {
    styleSelect,
    colorSelect,
    canvas: element.querySelector("canvas"),
    message: element.querySelector("span"),
    ticket: 0,
    ready: false,
  };

  styleSelect.onchange = () => { updateCommandPreview(); drawRow(row); };
  colorSelect.onchange = () => { showColorStripe(row); updateCommandPreview(); drawRow(row); };

  $("#rows").append(element);
  matchHeight(element.querySelector(".controls"), element.querySelector(".preview"));
  return row;
}
function buildFullPreview() {
  const copy = $(".copy");
  const wrapper = document.createElement("div");
  wrapper.className = "row";

  const element = document.createElement("div");
  element.className = "preview full";
  element.innerHTML = `
  <canvas></canvas>
  <span class="full-label">
    Crosshair preview
    <small>Only Passlock and Piece 1 are used for the normal crosshair.
    Piece 2 is used when locked onto a player or when indicating the goal.
    The crosshair itself might differ in-game, sorry!</small>
  </span>
`;

  copy.replaceWith(wrapper);
  wrapper.append(copy, element);
  matchHeight(copy, element, 150);

  element.onclick = () => {
    state.fullBackground = (state.fullBackground + 1) % FULL_BACKGROUNDS.length;
    element.classList.remove("dark", "light");
    if (FULL_BACKGROUNDS[state.fullBackground]) element.classList.add(FULL_BACKGROUNDS[state.fullBackground]);
  };

  return { element, canvas: element.querySelector("canvas") };
}

PIECES.forEach(piece => rows.push(buildRow(piece)));
full = buildFullPreview();
$("#copy-button").onclick = copyCommand;

updateCommandPreview();
rows.forEach(drawRow);
loadColors();
