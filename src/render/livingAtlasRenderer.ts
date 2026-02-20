import type { DisplayOptions, MutationEvent } from "../types";
import { H, Sim, W } from "../simLogic";

type Camera = { x: number; y: number; zoom: number };
type ViewportSize = { width: number; height: number };

type RenderArgs = {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  viewportSize: ViewportSize;
  displayOptions: DisplayOptions;
  showGrid: boolean;
  tick: number;
  mutationLog: MutationEvent[];
};

export class LivingAtlasRenderer {
  private terrainCanvas: HTMLCanvasElement;
  private terrainCtx: CanvasRenderingContext2D;
  private entityCanvas: HTMLCanvasElement;
  private entityCtx: CanvasRenderingContext2D;
  private grainCanvas: HTMLCanvasElement;
  private terrainCacheKey = "";

  constructor() {
    this.terrainCanvas = document.createElement("canvas");
    this.terrainCanvas.width = W;
    this.terrainCanvas.height = H;
    const terrainCtx = this.terrainCanvas.getContext("2d");
    if (!terrainCtx) throw new Error("Could not create terrain context");
    this.terrainCtx = terrainCtx;

    this.entityCanvas = document.createElement("canvas");
    this.entityCanvas.width = W;
    this.entityCanvas.height = H;
    const entityCtx = this.entityCanvas.getContext("2d");
    if (!entityCtx) throw new Error("Could not create entity context");
    this.entityCtx = entityCtx;

    this.grainCanvas = document.createElement("canvas");
    this.grainCanvas.width = 256;
    this.grainCanvas.height = 256;
    this.buildGrainTexture();
  }

  render(args: RenderArgs) {
    const { ctx, camera, viewportSize, displayOptions, showGrid, tick, mutationLog } = args;
    const bounds = this.getVisibleBounds(camera, viewportSize);
    this.paintTerrain(displayOptions, tick);
    this.paintEntities(displayOptions, camera.zoom);

    ctx.clearRect(0, 0, viewportSize.width, viewportSize.height);
    ctx.imageSmoothingEnabled = camera.zoom < 10;

    this.drawWorldSlice(ctx, this.terrainCanvas, bounds, viewportSize);
    this.drawContours(ctx, bounds, viewportSize, camera.zoom);
    this.drawWorldSlice(ctx, this.entityCanvas, bounds, viewportSize);
    this.drawEntityBloom(ctx, bounds, viewportSize, camera.zoom);
    this.drawAtmosphere(ctx, viewportSize, tick);
    this.drawMutationBursts(ctx, mutationLog, bounds, viewportSize, tick);

    if (showGrid && camera.zoom >= 20) {
      this.drawGrid(ctx, bounds, viewportSize);
    }
  }

  private paintTerrain(displayOptions: DisplayOptions, tick: number) {
    const cacheKey = `${displayOptions.biomeDisplayMode}|${displayOptions.biomeIntensity.toFixed(2)}|${Math.floor(tick / 5)}`;
    if (cacheKey === this.terrainCacheKey) return;
    this.terrainCacheKey = cacheKey;

    const { biomeMap, waterMap } = Sim.getEnvMaps();
    const image = this.terrainCtx.createImageData(W, H);
    const data = image.data;
    const t = tick * 0.001;

    for (let i = 0; i < W * H; i++) {
      const x = i % W;
      const y = (i / W) | 0;
      const biome = biomeMap[i];
      const isWater = waterMap[i] === 1 || biome === 5;
      let r = 14, g = 28, b = 22;

      if (isWater) {
        const wave = Math.sin(x * 0.03 + t * 2.2) * Math.sin(y * 0.025 + t * 1.8);
        r = 24 + wave * 8;
        g = 88 + wave * 16;
        b = 136 + wave * 24;
      } else if (biome === 0) {
        r = 63; g = 121; b = 72;
      } else if (biome === 1) {
        r = 44; g = 95; b = 53;
      } else if (biome === 2) {
        r = 151; g = 123; b = 71;
      } else if (biome === 3) {
        r = 101; g = 123; b = 150;
      } else if (biome === 4) {
        r = 59; g = 121; b = 112;
      }

      const noise = (Math.sin(x * 0.07 + y * 0.05 + t) + Math.sin(x * 0.02 + y * 0.025 + t * 0.4)) * 0.055 + 0.945;
      const ridge = Math.sin((x + y) * 0.015 + t * 0.4) * 0.03 + 0.97;
      const coast = this.coastFactor(x, y, waterMap, biomeMap);
      const p = i * 4;
      const intensity = noise * ridge * displayOptions.biomeIntensity;
      data[p] = Math.max(0, Math.min(255, Math.floor((r + coast * 18) * intensity)));
      data[p + 1] = Math.max(0, Math.min(255, Math.floor((g + coast * 24) * intensity)));
      data[p + 2] = Math.max(0, Math.min(255, Math.floor((b + coast * 18) * intensity)));
      data[p + 3] = 255;
    }

    this.terrainCtx.putImageData(image, 0, 0);
  }

  private paintEntities(displayOptions: DisplayOptions, zoom: number) {
    const rgba = Sim.buildEntityLayerBuffer(displayOptions, zoom);
    const image = this.entityCtx.createImageData(W, H);
    image.data.set(rgba);
    this.entityCtx.putImageData(image, 0, 0);
  }

  private getVisibleBounds(camera: Camera, viewport: ViewportSize) {
    const width = viewport.width / camera.zoom;
    const height = viewport.height / camera.zoom;
    return {
      left: camera.x - width / 2,
      top: camera.y - height / 2,
      width,
      height,
      right: camera.x + width / 2,
      bottom: camera.y + height / 2,
    };
  }

  private drawWorldSlice(
    ctx: CanvasRenderingContext2D,
    source: HTMLCanvasElement,
    bounds: { left: number; top: number; width: number; height: number },
    viewport: ViewportSize
  ) {
    const sx = Math.max(0, bounds.left);
    const sy = Math.max(0, bounds.top);
    const sw = Math.min(W - sx, bounds.width);
    const sh = Math.min(H - sy, bounds.height);
    if (sw <= 0 || sh <= 0) return;

    const dx = ((sx - bounds.left) / bounds.width) * viewport.width;
    const dy = ((sy - bounds.top) / bounds.height) * viewport.height;
    const dw = (sw / bounds.width) * viewport.width;
    const dh = (sh / bounds.height) * viewport.height;

    ctx.drawImage(source, sx, sy, sw, sh, dx, dy, dw, dh);
  }

  private drawContours(
    ctx: CanvasRenderingContext2D,
    bounds: { left: number; top: number; width: number; height: number },
    viewport: ViewportSize,
    zoom: number
  ) {
    if (zoom > 10) return;
    const { biomeMap } = Sim.getEnvMaps();
    const step = zoom < 6 ? 4 : 2;
    ctx.fillStyle = "rgba(241, 250, 255, 0.11)";
    for (let sy = 0; sy < viewport.height; sy += step) {
      for (let sx = 0; sx < viewport.width; sx += step) {
        const wx = Math.floor(bounds.left + (sx / viewport.width) * bounds.width);
        const wy = Math.floor(bounds.top + (sy / viewport.height) * bounds.height);
        if (wx < 0 || wy < 0 || wx >= W - 1 || wy >= H - 1) continue;
        const b0 = biomeMap[wy * W + wx];
        const bx = biomeMap[wy * W + wx + 1];
        const by = biomeMap[(wy + 1) * W + wx];
        if (b0 !== bx || b0 !== by) {
          ctx.fillRect(sx, sy, step, step);
        }
      }
    }
  }

  private drawAtmosphere(ctx: CanvasRenderingContext2D, viewport: ViewportSize, tick: number) {
    const day = tick % 2400;
    let darkness = 0.12;
    if (day < 800) darkness = 0.28 - (day / 800) * 0.18;
    else if (day > 2200) darkness = 0.1 + ((day - 2200) / 200) * 0.18;

    const sky = ctx.createLinearGradient(0, 0, 0, viewport.height);
    sky.addColorStop(0, `rgba(22, 53, 84, ${darkness})`);
    sky.addColorStop(0.45, `rgba(16, 37, 59, ${darkness * 1.08})`);
    sky.addColorStop(1, `rgba(7, 16, 27, ${darkness * 1.3})`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    const vignette = ctx.createRadialGradient(
      viewport.width * 0.5,
      viewport.height * 0.5,
      Math.min(viewport.width, viewport.height) * 0.28,
      viewport.width * 0.5,
      viewport.height * 0.5,
      Math.max(viewport.width, viewport.height) * 0.75
    );
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.25)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, viewport.width, viewport.height);

    ctx.save();
    ctx.globalAlpha = 0.05;
    const pat = ctx.createPattern(this.grainCanvas, "repeat");
    if (pat) {
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, viewport.width, viewport.height);
    }
    ctx.restore();
  }

  private drawMutationBursts(
    ctx: CanvasRenderingContext2D,
    mutationLog: MutationEvent[],
    bounds: { left: number; top: number; width: number; height: number },
    viewport: ViewportSize,
    tick: number
  ) {
    if (mutationLog.length === 0) return;
    const newest = mutationLog.slice(0, 6);
    for (let i = 0; i < newest.length; i++) {
      const m = newest[i];
      const age = Math.max(0, tick - m.tick);
      if (age > 1200) continue;

      // Without exact mutation coordinates in log, create stable pseudo-locations by species/tick hash.
      const hx = ((m.newSpeciesId * 73856093 + m.tick * 19349663) >>> 0) % W;
      const hy = ((m.parentSpeciesId * 83492791 + m.tick * 29791) >>> 0) % H;
      if (hx < bounds.left || hx > bounds.left + bounds.width || hy < bounds.top || hy > bounds.top + bounds.height) continue;

      const sx = ((hx - bounds.left) / bounds.width) * viewport.width;
      const sy = ((hy - bounds.top) / bounds.height) * viewport.height;
      const pulse = 1 - age / 1200;
      const radius = 8 + pulse * 26;
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
      grad.addColorStop(0, `rgba(195, 255, 164, ${pulse * 0.35})`);
      grad.addColorStop(1, "rgba(195, 255, 164, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawGrid(
    ctx: CanvasRenderingContext2D,
    bounds: { left: number; top: number; right: number; bottom: number; width: number; height: number },
    viewport: ViewportSize
  ) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    const startX = Math.floor(bounds.left);
    const startY = Math.floor(bounds.top);
    for (let wx = startX; wx <= bounds.right; wx++) {
      if (wx < 0 || wx > W) continue;
      const sx = ((wx - bounds.left) / bounds.width) * viewport.width;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, viewport.height);
      ctx.stroke();
    }
    for (let wy = startY; wy <= bounds.bottom; wy++) {
      if (wy < 0 || wy > H) continue;
      const sy = ((wy - bounds.top) / bounds.height) * viewport.height;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(viewport.width, sy);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawEntityBloom(
    ctx: CanvasRenderingContext2D,
    bounds: { left: number; top: number; width: number; height: number },
    viewport: ViewportSize,
    zoom: number
  ) {
    if (zoom < 9) return;
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.filter = "blur(1.6px) saturate(1.2)";
    this.drawWorldSlice(ctx, this.entityCanvas, bounds, viewport);
    ctx.restore();
  }

  private coastFactor(x: number, y: number, waterMap: Uint8Array, biomeMap: Uint8Array) {
    const hereWater = waterMap[y * W + x] === 1 || biomeMap[y * W + x] === 5;
    if (hereWater) return 0;
    let nearWater = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const np = ny * W + nx;
        if (waterMap[np] === 1 || biomeMap[np] === 5) nearWater++;
      }
    }
    return Math.min(1, nearWater / 4);
  }

  private buildGrainTexture() {
    const ctx = this.grainCanvas.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(this.grainCanvas.width, this.grainCanvas.height);
    for (let i = 0; i < image.data.length; i += 4) {
      const n = 120 + Math.floor(Math.random() * 40);
      image.data[i] = n;
      image.data[i + 1] = n;
      image.data[i + 2] = n;
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }
}
