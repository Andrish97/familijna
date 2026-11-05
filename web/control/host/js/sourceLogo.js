// Host-only renderer for the source preserved in a logo's payload.
// Logo editors and their stored formats are deliberately not changed here.

import { prepareFabric } from "../../../shared/js/core/fabric-compat.js?v=v2026-11-05T21204";

const FRAME_W = 1280;
const FRAME_H = 720;
const LOGO_ASPECT = 26 / 11;
const IMAGE_W = 1280;
const IMAGE_H = Math.round(IMAGE_W / LOGO_ASPECT);
const DEFAULT_DOT_COLOR = "#d7ff3d";
const DEFAULT_LOGO_FACE = "#ffcc00";
const WORDMARK = Object.freeze({ weight: 900, width: 82, height: 133, spacing: 11, lens: 0.5, depth: 12, angle: 32 });
const FONT_SIZE = 134;

let fontPromise;
let fabricPromise;

/** Kolor lica logo: domyślny DOT to wartość ustawienia, nie widoczny kolor
 * logo -- dopóki gracz go nie zmieni, logo (napis, piksele, źródło) jest złote. */
export function logoFaceColor(dot) {
  return String(dot || "").toLowerCase() === DEFAULT_DOT_COLOR ? DEFAULT_LOGO_FACE : dot;
}

function canvasOf(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function loadWordmarkFont() {
  if (!fontPromise) {
    fontPromise = (async () => {
      const font = new FontFace("HostUnbounded", 'url("/control/host/fonts/Unbounded-Variable.ttf?v=v2026-11-05T21204")', { weight: "200 900" });

      await font.load();
      document.fonts.add(font);
      await document.fonts.load(`900 ${FONT_SIZE}px HostUnbounded`);
    })();
  }
  return fontPromise;
}

function loadFabric() {
  if (globalThis.fabric?.StaticCanvas) return Promise.resolve(prepareFabric(globalThis.fabric));
  if (!fabricPromise) {
    fabricPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/shared/vendor/fabric.min.js?v=v2026-11-05T21204";
      script.async = true;
      script.onload = () => globalThis.fabric?.StaticCanvas ? resolve(prepareFabric(globalThis.fabric)) : reject(new Error("Fabric.js did not initialize"));
      script.onerror = () => reject(new Error("Fabric.js could not be loaded"));
      document.head.appendChild(script);
    });
  }
  return fabricPromise;
}

function colorHex(value, fallback = "#ffcc00") {
  const match = /^#?([\da-f]{6})$/i.exec(String(value || ""));
  return match ? `#${match[1]}` : fallback;
}

function darker(hex, fraction) {
  const color = colorHex(hex);
  const channels = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  return `#${channels.map(value => Math.round(value * (1 - fraction)).toString(16).padStart(2, "0")).join("")}`;
}

function measureRun(context, characters, widthStretch, spacing) {
  return characters.map(character => ({
    advance: Math.max(2, context.measureText(character).width * widthStretch + spacing),
  }));
}

function lensAt(position, lens) {
  if (lens < 0.001) return { position, scale: 1 };
  const denominator = Math.tanh(lens);
  const bent = Math.tanh(lens * position);
  return { position: bent / denominator, scale: Math.max(0.18, lens * (1 - bent ** 2) / denominator) };
}

function drawGlyphRun(context, characters, metrics, options) {
  const { weight, widthStretch, heightStretch, lens, color, offsetX, offsetY, fitScale: requestedFitScale, scaleHeight = false } = options;
  const total = metrics.reduce((sum, metric) => sum + metric.advance, 0);
  const fitScale = requestedFitScale ?? Math.min(1, 1080 / total);
  const half = total * fitScale / 2;
  context.font = `${weight} ${FONT_SIZE}px HostUnbounded`;
  context.textAlign = "center";
  context.textBaseline = "alphabetic";
  context.fillStyle = color;

  let cursor = 0;
  characters.forEach((character, index) => {
    const metric = metrics[index];
    const rawCenter = cursor + metric.advance / 2;
    const normalized = Math.max(-1, Math.min(1, rawCenter / Math.max(total, 1) * 2 - 1));
    const lensPoint = lensAt(normalized, lens);
    context.save();
    context.translate(640 + half * lensPoint.position + offsetX, 405 + offsetY);
    context.scale(fitScale * widthStretch * lensPoint.scale, heightStretch * (scaleHeight ? fitScale : 1));
    context.fillText(character, 0, 0);
    context.restore();
    cursor += metric.advance;
  });
}

function alphaBounds(pixels, width, height) {
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0, index = (y * width) * 4 + 3; x < width; x++, index += 4) {
      if (!pixels[index]) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  return right < left ? null : { left, right, top, bottom };
}

function trimCanvasToAlpha(canvas) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const bounds = alphaBounds(pixels, canvas.width, canvas.height);
  if (!bounds || (bounds.left === 0 && bounds.top === 0 && bounds.right === canvas.width - 1 && bounds.bottom === canvas.height - 1)) return canvas;
  const trimmed = canvasOf(bounds.right - bounds.left + 1, bounds.bottom - bounds.top + 1);
  trimmed.getContext("2d").drawImage(canvas, bounds.left, bounds.top, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
  return trimmed;
}

function bendWordmark(sourceCanvas, lens) {
  if (!lens) return sourceCanvas;
  const sourceContext = sourceCanvas.getContext("2d", { willReadFrequently: true });
  const source = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const bounds = alphaBounds(source.data, sourceCanvas.width, sourceCanvas.height);
  if (!bounds) return sourceCanvas;

  const result = canvasOf(sourceCanvas.width, sourceCanvas.height);
  const resultContext = result.getContext("2d", { willReadFrequently: true });
  const output = resultContext.createImageData(result.width, result.height);
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;
  const half = Math.max(1, (bounds.right - bounds.left) / 2);
  const denominator = Math.tanh(lens);

  for (let x = bounds.left; x <= bounds.right; x++) {
    const u = Math.max(-1, Math.min(1, (x - centerX) / half));
    const bent = Math.tanh(lens * u);
    const verticalScale = Math.max(0.18, lens * (1 - bent ** 2) / denominator);
    const top = Math.max(0, Math.floor(centerY + (bounds.top - centerY) * verticalScale));
    const bottom = Math.min(result.height - 1, Math.ceil(centerY + (bounds.bottom - centerY) * verticalScale));
    for (let y = top; y <= bottom; y++) {
      const sourceY = centerY + (y - centerY) / verticalScale;
      if (sourceY < 0 || sourceY > result.height - 1) continue;
      const y0 = Math.floor(sourceY), y1 = Math.min(result.height - 1, y0 + 1), fraction = sourceY - y0;
      const destinationIndex = (y * result.width + x) * 4;
      const sourceIndex0 = (y0 * sourceCanvas.width + x) * 4;
      const sourceIndex1 = (y1 * sourceCanvas.width + x) * 4;
      const alpha0 = source.data[sourceIndex0 + 3] / 255;
      const alpha1 = source.data[sourceIndex1 + 3] / 255;
      const alpha = alpha0 * (1 - fraction) + alpha1 * fraction;
      output.data[destinationIndex + 3] = Math.round(alpha * 255);
      for (let channel = 0; channel < 3; channel++) {
        const premultiplied = source.data[sourceIndex0 + channel] * alpha0 * (1 - fraction) +
          source.data[sourceIndex1 + channel] * alpha1 * fraction;
        output.data[destinationIndex + channel] = alpha ? Math.round(premultiplied / alpha) : 0;
      }
    }
  }
  resultContext.putImageData(output, 0, 0);
  return result;
}

/** Matches the approved Unbounded wordmark test: 900/82/133/11/0.50/12/32. */
export async function renderTextLogo(text, dot, { fillWidth = false } = {}) {
  await loadWordmarkFont();
  const canvas = canvasOf(FRAME_W, FRAME_H);
  const context = canvas.getContext("2d");
  const characters = Array.from(String(text || "").trim().toLocaleUpperCase("pl-PL"));
  if (!characters.length) return canvas;
  const settings = WORDMARK;
  const widthStretch = settings.width / 100;
  const heightStretch = settings.height / 100;
  const lens = settings.lens;
  context.font = `${settings.weight} ${FONT_SIZE}px HostUnbounded`;
  const metrics = measureRun(context, characters, widthStretch, settings.spacing);
  const total = metrics.reduce((sum, metric) => sum + metric.advance, 0);
  const fitScale = fillWidth
    ? Math.min(1080 / total, 520 / (FONT_SIZE * heightStretch))
    : Math.min(1, 1080 / total);
  const face = colorHex(dot);
  const extrusion = darker(face, 1 / 3);
  const angle = settings.angle * Math.PI / 180;
  const offsetX = Math.cos(angle) * 0.95;
  const offsetY = Math.sin(angle) * 0.95;

  for (let step = settings.depth; step >= 1; step--) {
    drawGlyphRun(context, characters, metrics, {
      weight: settings.weight, widthStretch, heightStretch, lens, color: extrusion,
      offsetX: step * offsetX, offsetY: step * offsetY, fitScale, scaleHeight: fillWidth,
    });
  }
  drawGlyphRun(context, characters, metrics, {
    weight: settings.weight, widthStretch, heightStretch, lens, color: face, offsetX: 0, offsetY: 0, fitScale, scaleHeight: fillWidth,
  });
  return trimCanvasToAlpha(bendWordmark(canvas, lens));
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (/^https?:/i.test(source)) image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Host could not load the logo image from Storage"));
    image.src = source;
  });
}

function sourceHasTransparency(image) {
  try {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const scale = Math.min(1, 1200 / Math.max(width, height));
    const canvas = canvasOf(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    return false;
  } catch {
    // If Storage CORS prevents inspecting alpha, keep the image untouched.
    return true;
  }
}

function median(values) {
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

/** Remove a uniform opaque backdrop globally; tolerance and edge softness are both 20. */
function removeUniformBackground(canvas, tolerance = 20, softness = 20) {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let imageData;
  try { imageData = context.getImageData(0, 0, canvas.width, canvas.height); }
  catch { return false; }
  const { data, width, height } = imageData;
  const patchWidth = Math.max(2, Math.round(width * 0.045));
  const patchHeight = Math.max(2, Math.round(height * 0.07));
  const patches = [[0, 0], [width - patchWidth, 0], [0, height - patchHeight], [width - patchWidth, height - patchHeight]];
  const colors = patches.map(([x0, y0]) => {
    const channels = [[], [], []];
    const stepX = Math.max(1, Math.floor(patchWidth / 16));
    const stepY = Math.max(1, Math.floor(patchHeight / 12));
    for (let y = y0; y < y0 + patchHeight; y += stepY) {
      for (let x = x0; x < x0 + patchWidth; x += stepX) {
        const index = (y * width + x) * 4;
        if (data[index + 3] < 240) continue;
        for (let channel = 0; channel < 3; channel++) channels[channel].push(data[index + channel]);
      }
    }
    return channels.map(values => values.length ? median(values) : null);
  });
  if (colors.some(color => color.some(value => value === null))) return false;
  const background = [0, 1, 2].map(channel => median(colors.map(color => color[channel])));
  const spread = Math.max(...colors.map(color => Math.max(...color.map((value, channel) => Math.abs(value - background[channel])))));
  if (spread > tolerance) return false;

  const fadeEnd = tolerance + softness;
  for (let index = 0; index < data.length; index += 4) {
    if (!data[index + 3]) continue;
    const distance = Math.max(Math.abs(data[index] - background[0]), Math.abs(data[index + 1] - background[1]), Math.abs(data[index + 2] - background[2]));
    if (distance >= fadeEnd) continue;
    const alpha = distance <= tolerance ? 0 : (distance - tolerance) / softness;
    if (!alpha) { data[index + 3] = 0; continue; }
    const coverage = Math.max(1 / 255, distance / 255);
    for (let channel = 0; channel < 3; channel++) {
      data[index + channel] = Math.max(0, Math.min(255, Math.round((data[index + channel] - background[channel] * (1 - coverage)) / coverage)));
    }
    data[index + 3] = Math.round(data[index + 3] * alpha);
  }
  context.putImageData(imageData, 0, 0);
  return true;
}

function rotatedWork(image, source) {
  const rotation = [0, 90, 180, 270].includes(Number(source.rotate)) ? Number(source.rotate) : 0;
  const straighten = Math.max(-30, Math.min(30, Number(source.straighten) || 0));
  const angle = (rotation + straighten) * Math.PI / 180;
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const cosine = Math.abs(Math.cos(angle)), sine = Math.abs(Math.sin(angle));
  const boundsWidth = width * cosine + height * sine;
  const boundsHeight = width * sine + height * cosine;
  const scale = Math.min(1, 2560 / Math.max(boundsWidth, boundsHeight));
  const canvas = canvasOf(Math.max(1, Math.round(boundsWidth * scale)), Math.max(1, Math.round(boundsHeight * scale)));
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(angle);
  context.scale(scale, scale);
  context.drawImage(image, -width / 2, -height / 2);
  return canvas;
}

function normalizedCrop(work, crop) {
  if (crop?.v !== 2) {
    let width = work.width, height = work.height;
    if (width / height > LOGO_ASPECT) width = height * LOGO_ASPECT;
    else height = width / LOGO_ASPECT;
    return { x: (work.width - width) / 2, y: (work.height - height) / 2, width, height };
  }
  let width = Math.max(1, Math.min(work.width, work.width * Number(crop.w)));
  let height = width / LOGO_ASPECT;
  if (height > work.height) { height = work.height; width = height * LOGO_ASPECT; }
  const x = Math.max(0, Math.min(work.width - width, work.width * Number(crop.x)));
  const y = Math.max(0, Math.min(work.height - height, work.height * Number(crop.y)));
  return { x, y, width, height };
}

export function renderImageSource(image, source = {}) {
  if (!image) return null;
  const alreadyTransparent = sourceHasTransparency(image);
  const work = rotatedWork(image, source);
  const crop = normalizedCrop(work, source.crop);
  const output = canvasOf(IMAGE_W, IMAGE_H);
  const context = output.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(work, crop.x, crop.y, crop.width, crop.height, 0, 0, output.width, output.height);
  if (!alreadyTransparent) removeUniformBackground(output, 20, 20);
  return trimCanvasToAlpha(output);
}

export async function renderImageLogo(source) {
  // Persisted user logos use Storage. Embedded imageData remains supported for
  // standalone .famlogo previews/import files before they reach Storage.
  const imageSource = source?.imageUrl || source?.imageData;
  if (!imageSource) return null;
  return renderImageSource(await loadImage(imageSource), source);
}

function safeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function stabilizeDrawStrokes(scene) {
  const visit = (object) => {
    if (!object || typeof object !== "object") return;
    // Fabric's SVG exporter keeps strokeUniform as non-scaling-stroke. The
    // SVG is then fitted from the saved world to Host's 1280px canvas, while
    // Fabric's Host raster scales the scene before drawing. Keep strokes in
    // world units so the SVG viewBox scales them with the scene just like the
    // Fabric canvas renderer; never mutate the saved source object itself.
    if (object.stroke && object.stroke !== "transparent" && Number(object.strokeWidth) > 0) object.strokeUniform = false;
    object.objects?.forEach(visit);
  };
  scene.objects?.forEach(visit);
  return scene;
}

async function renderDrawLogo(logo, dot) {
  const source = logo?.payload?.source || {};
  const savedScene = source.fabricData;
  if (!savedScene || !Array.isArray(savedScene.objects)) return null;
  const fabric = await loadFabric();
  const width = Math.max(1, Number(source.world?.w || savedScene.clipPath?.width) || 1040);
  const height = Math.max(1, Number(source.world?.h || savedScene.clipPath?.height) || 440);
  const canvas = new fabric.StaticCanvas(document.createElement("canvas"), {
    width, height, renderOnAddRemove: false, enableRetinaScaling: false,
  });
  try {
    // Composite the saved Fabric canvas in its original object order. Uniform
    // strokes stop group scaling from multiplying their displayed thickness.
    const scene = stabilizeDrawStrokes(JSON.parse(JSON.stringify(savedScene)));
    const background = source.bg === "WHITE" ? "#fff" : source.bg === "BLACK" ? "#000" : savedScene.background;
    scene.background = background || "";
    scene.backgroundColor = background || "";
    await canvas.loadFromJSON(scene);
    canvas.setDimensions({ width, height });
    canvas.renderAll();
    const svgSource = canvas.toSVG({
      suppressPreamble: true,
      width: String(width),
      height: String(height),
      viewBox: { x: 0, y: 0, width, height },
    });
    const parsed = new DOMParser().parseFromString(svgSource, "image/svg+xml");
    if (parsed.querySelector("parsererror")) throw new Error("Could not serialize DRAW scene as SVG");
    const sourceRoot = parsed.documentElement;
    const definitions = [...sourceRoot.children].filter(node => node.localName === "defs")
      .flatMap(node => [...node.childNodes].map(child => new XMLSerializer().serializeToString(child))).join("");
    const sceneContent = [...sourceRoot.childNodes]
      .filter(node => node.nodeType !== Node.ELEMENT_NODE || node.localName !== "defs")
      .map(node => new XMLSerializer().serializeToString(node)).join("");
    const maskId = `host-draw-mask-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
    const filterId = `${maskId}-luma`;
    const outputHeight = Math.max(1, Math.round(FRAME_W * height / width));
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${FRAME_W}" height="${outputHeight}" preserveAspectRatio="xMidYMid meet"><defs>${definitions}<filter id="${filterId}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/></filter><mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}" mask-type="luminance"><rect width="${width}" height="${height}" fill="#000"/><g filter="url(#${filterId})">${sceneContent}</g></mask></defs><rect width="${width}" height="${height}" fill="${safeXml(colorHex(dot))}" mask="url(#${maskId})"/></svg>`;
    const image = new Image();
    image.alt = logo?.name || ""; // ozdobny, gdy logo bez nazwy
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    return image;
  } finally {
    canvas.dispose();
  }
}

export async function renderLogoSource(logo, dot) {
  const mode = logo?.payload?.source?.mode;
  const logoDot = logoFaceColor(dot);
  try {
    if (mode === "TEXT") return renderTextLogo(logo.payload.source.text, logoDot, { fillWidth: true });
    if (mode === "IMAGE") return await renderImageLogo(logo.payload.source);
    if (mode === "DRAW") return await renderDrawLogo(logo, logoDot);
  } catch (error) {
    console.error(`[host/logo] ${mode || "source"} rendering failed`, error);
  }
  return null;
}
