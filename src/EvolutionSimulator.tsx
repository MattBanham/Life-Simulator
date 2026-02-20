import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  ActivityCycle,
  Biome,
  BiomeDisplayMode,
  BehaviorTuning,
  DailyPopulationStats,
  DisplayOptions,
  EntitySnapshot,
  Genome,
  MutationEvent,
  SpeciesDetails,
  SpeciesClass,
  ViewMode,
} from "./types";
import { Sim, W, H, isNight } from "./simLogic";
import { LivingAtlasRenderer } from "./render/livingAtlasRenderer";

// Helper function removed - using Math.max/Math.min instead

const DIET_NAMES = ["photosynthesis", "herbivore", "carnivore", "omnivore"];
const ACTIVITY_NAMES = ["diurnal", "nocturnal", "cathemeral"];
const CLASS_ICONS: Record<SpeciesClass, string> = {
  fish: "🐟",
  mammal: "🦎", 
  bird: "🦅",
  reptile: "🐍",
  amphibian: "🐸",
  insect: "🐞",
};

const WORLD_SIZE_PRESETS = [
  { key: "250x250", label: "250x250", width: 250, height: 250 },
  { key: "500x500", label: "500x500", width: 500, height: 500 },
  { key: "640x400", label: "640x400", width: 640, height: 400 },
  { key: "480x300", label: "480x300", width: 480, height: 300 },
  { key: "320x200", label: "320x200", width: 320, height: 200 },
] as const;

type WorldSizePresetKey = typeof WORLD_SIZE_PRESETS[number]["key"];
type SpeciesCategory = "all" | "plants" | "animals" | "fish" | "mammal" | "bird" | "reptile" | "amphibian" | "insect" | "herbivore" | "carnivore" | "omnivore";
type RandomizableGenomeTrait =
  | "hostility"
  | "speed"
  | "size"
  | "vision"
  | "fertility"
  | "camouflage"
  | "sociality"
  | "temperatureTolerance"
  | "mutationRate";

const BASELINE_WORLD_CELLS = 500 * 500;
const BASELINE_START_PLANTS = 15000;
const BASELINE_START_ANIMALS = 3000;

function getScaledStartingPopulations(worldWidth: number, worldHeight: number) {
  const cells = Math.max(1, worldWidth * worldHeight);
  const plants = Math.max(200, Math.round((cells / BASELINE_WORLD_CELLS) * BASELINE_START_PLANTS));
  const animals = Math.max(40, Math.round((cells / BASELINE_WORLD_CELLS) * BASELINE_START_ANIMALS));
  return { plants, animals };
}

export default function EvolutionSimulator() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const atlasRendererRef = useRef<LivingAtlasRenderer | null>(null);
  const dragLastPosRef = useRef<{ x: number; y: number } | null>(null);
  const minimapDraggingRef = useRef(false);
  const minimapDragStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const minimapPointerIdRef = useRef<number | null>(null);

  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(15);
  const [isDragging, setIsDragging] = useState(false);
  
  // Camera-based viewport system instead of direct canvas transforms
  const [camera, setCamera] = useState({
    x: W / 2,      // Camera center X in world coordinates
    y: H / 2,      // Camera center Y in world coordinates  
    zoom: 8,       // Zoom level - higher values show smaller area
  });
  
  // Viewport dimensions (will be updated from container size)
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const [seed, setSeed] = useState(42);
  const initialWorldSize = Sim.getWorldSize();
  const initialWorldPreset =
    WORLD_SIZE_PRESETS.find((p) => p.width === initialWorldSize.width && p.height === initialWorldSize.height)?.key ??
    "500x500";
  const [worldSizePreset, setWorldSizePreset] = useState<WorldSizePresetKey>(initialWorldPreset);
  const currentWorldPreset = useMemo(
    () => WORLD_SIZE_PRESETS.find((p) => p.key === worldSizePreset) ?? WORLD_SIZE_PRESETS[1],
    [worldSizePreset]
  );
  const initialPops = getScaledStartingPopulations(currentWorldPreset.width, currentWorldPreset.height);
  const [startPlants, setStartPlants] = useState(initialPops.plants);
  const [startAnimals, setStartAnimals] = useState(initialPops.animals);
  const [showGrid, setShowGrid] = useState(false);
  const [hoveredSpeciesDetails, setHoveredSpeciesDetails] = useState<SpeciesDetails | null>(null);
  const [speciesCategory, setSpeciesCategory] = useState<SpeciesCategory>("all");
  const [speciesSearch, setSpeciesSearch] = useState("");
  const [minimapCollapsed, setMinimapCollapsed] = useState(false);
  const [worldRenderRevision, setWorldRenderRevision] = useState(0);

  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [hoverInfo, setHoverInfo] = useState<EntitySnapshot | null>(null);
  const [mutationLog, setMutationLog] = useState<MutationEvent[]>([]);

  // Entity builder state
  const [placingMode, setPlacingMode] = useState(false);
  const [customGenome, setCustomGenome] = useState<Genome>({
    speciesId: 42,
    lifeType: "animal",
    speciesClass: "mammal",
    diet: "herbivore",
    reproduction: "sexual",
    hostility: 0.5,
    speed: 0.5,
    size: 0.5,
    vision: 0.5,
    fertility: 0.5,
    maturityAge: 800,
    maxAge: 4000,
    camouflage: 0.5,
    sociality: 0.5,
    activity: "diurnal",
    temperatureTolerance: 0.5,
    preferredBiome: "grassland",
    seedSpread: 0.0,
    mutationRate: 0.05,
    supplementalCarnivory: false,
  });
  const [traitModes, setTraitModes] = useState<Record<string, 'set' | 'random'>>({});

  // Display controls state
  const [displayOptions, setDisplayOptions] = useState<DisplayOptions>({
    biomeDisplayMode: "enhanced",
    biomeIntensity: 0.92,
    showBiomeBorders: false,
    showPlants: true,
    showAnimals: true,
    showEggs: true,
    showDead: false,
    visibleSpeciesClasses: new Set(["fish", "mammal", "bird", "reptile", "amphibian", "insect"]),
    viewMode: "standard",
    showReproductionStates: true,
    showMutationGlow: true,
    showStressIndicators: false,
    showEnergyWarnings: false,
    showShapes: true,
    showTrails: true,
    showSizeScaling: true,
    showLifePulse: false,
    trailLength: 3,
    maxVisibleEntities: 0,
    enableClustering: false,
    
    // Multi-scale rendering and LOD system
    adaptiveDetailLevel: false,
    zoomThresholds: {
      maxDetail: 28,     // zoom >= 28: full detail with all effects
      mediumDetail: 14,  // zoom >= 14: medium detail, some effects disabled
      lowDetail: 7,      // zoom >= 7: basic rendering only
      clustering: 5,     // zoom < 5: cluster-heavy overview
    },
    forceDetailLevel: "auto",
  });
  const [behaviorTuning, setBehaviorTuning] = useState<BehaviorTuning>(() => Sim.getBehaviorTuning());

  const lastRef = useRef(performance.now());
  const [fps, setFps] = useState(0);
  const [renderTime, setRenderTime] = useState(0);
  const fpsCounterRef = useRef(0);
  const fpsLastRef = useRef(performance.now());
  
  // Advanced performance intelligence
  const [performanceMetrics, setPerformanceMetrics] = useState({
    averageFps: 60,
    averageRenderTime: 16.67,
    frameTimeHistory: [] as number[],
    suggestions: [] as string[],
    healthScore: 100, // 0-100 performance health
  });
  
  const frameTimeHistoryRef = useRef<number[]>([]);
  
  // ===== Camera & Viewport System =====
  
  // Calculate the visible world area based on camera and viewport
  function getVisibleBounds() {
    const worldWidth = viewportSize.width / camera.zoom;
    const worldHeight = viewportSize.height / camera.zoom;
    
    return {
      left: camera.x - worldWidth / 2,
      right: camera.x + worldWidth / 2,
      top: camera.y - worldHeight / 2,
      bottom: camera.y + worldHeight / 2,
      width: worldWidth,
      height: worldHeight
    };
  }
  
  // Convert screen coordinates to world coordinates
  function screenToWorld(screenX: number, screenY: number) {
    const bounds = getVisibleBounds();
    const worldX = bounds.left + (screenX / viewportSize.width) * bounds.width;
    const worldY = bounds.top + (screenY / viewportSize.height) * bounds.height;
    
    return { 
      x: Math.floor(worldX), 
      y: Math.floor(worldY) 
    };
  }

  function screenToWorldPrecise(
    screenX: number,
    screenY: number,
    cam: { x: number; y: number; zoom: number }
  ) {
    const worldWidth = viewportSize.width / cam.zoom;
    const worldHeight = viewportSize.height / cam.zoom;
    return {
      x: cam.x - worldWidth / 2 + (screenX / viewportSize.width) * worldWidth,
      y: cam.y - worldHeight / 2 + (screenY / viewportSize.height) * worldHeight,
    };
  }
  
  // Constrain camera position to keep world visible
  function constrainCamera(newCamera: { x: number; y: number; zoom: number }) {
    let { x, y, zoom } = newCamera;
    
    // Clamp zoom to broad range so full-world overview fits smaller screens.
    zoom = Math.max(0.5, Math.min(64, zoom));
    
    // Calculate constraints to keep world visible
    const worldWidth = viewportSize.width / zoom;
    const worldHeight = viewportSize.height / zoom;

    // If zoomed out beyond world extents, pin camera to center axis.
    if (worldWidth >= W) {
      x = W / 2;
    } else {
      const minX = Math.max(worldWidth / 2, 0);
      const maxX = Math.min(W - worldWidth / 2, W);
      x = Math.max(minX, Math.min(maxX, x));
    }
    if (worldHeight >= H) {
      y = H / 2;
    } else {
      const minY = Math.max(worldHeight / 2, 0);
      const maxY = Math.min(H - worldHeight / 2, H);
      y = Math.max(minY, Math.min(maxY, y));
    }
    
    return { x, y, zoom };
  }

  // ===== Initialization =====
  useEffect(() => {
    reseedWorld();
    atlasRendererRef.current = new LivingAtlasRenderer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Minimap renderer for orientation at any zoom level
  useEffect(() => {
    const mini = minimapRef.current;
    if (!mini) return;
    const maxSide = 220;
    const worldAspect = W / H;
    const w = worldAspect >= 1 ? maxSide : Math.max(120, Math.round(maxSide * worldAspect));
    const h = worldAspect >= 1 ? Math.max(120, Math.round(maxSide / worldAspect)) : maxSide;
    if (mini.width !== w || mini.height !== h) {
      mini.width = w;
      mini.height = h;
      mini.style.width = `${w}px`;
      mini.style.height = `${h}px`;
    }
    const ctx = mini.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { biomeMap, waterMap } = Sim.getEnvMaps();
    const image = ctx.createImageData(w, h);
    const data = image.data;
    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const wx = Math.floor((px / w) * W);
        const wy = Math.floor((py / h) * H);
        const idxWorld = wy * W + wx;
        const biome = biomeMap[idxWorld];
        const water = waterMap[idxWorld] === 1;
        let r = 18, g = 30, b = 25;
        if (water || biome === 5) [r, g, b] = [26, 82, 125];
        else if (biome === 0) [r, g, b] = [52, 108, 56];
        else if (biome === 1) [r, g, b] = [34, 87, 45];
        else if (biome === 2) [r, g, b] = [128, 102, 52];
        else if (biome === 3) [r, g, b] = [92, 111, 136];
        else if (biome === 4) [r, g, b] = [49, 109, 97];
        const p = (py * w + px) * 4;
        data[p] = r;
        data[p + 1] = g;
        data[p + 2] = b;
        data[p + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);

    const bounds = getVisibleBounds();
    const rawRx = (bounds.left / W) * w;
    const rawRy = (bounds.top / H) * h;
    const rawRw = (bounds.width / W) * w;
    const rawRh = (bounds.height / H) * h;
    const rx = Math.max(0, Math.min(w, rawRx));
    const ry = Math.max(0, Math.min(h, rawRy));
    const rw = Math.max(0, Math.min(w - rx, rawRw));
    const rh = Math.max(0, Math.min(h - ry, rawRh));

    // Civ-style shading: keep full map visible and dim outside current camera.
    if (rw > 0 && rh > 0 && (rw < w || rh < h)) {
      ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
      ctx.fillRect(0, 0, w, ry); // top
      ctx.fillRect(0, ry + rh, w, Math.max(0, h - (ry + rh))); // bottom
      ctx.fillRect(0, ry, rx, rh); // left
      ctx.fillRect(rx + rw, ry, Math.max(0, w - (rx + rw)), rh); // right
    }

    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineWidth = 1.8;
    if (rw > 0 && rh > 0) {
      ctx.strokeRect(rx, ry, rw, rh);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, worldRenderRevision]);
  
  // Track viewport container size changes
  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;
    
    const updateViewportSize = () => {
      const rect = container.getBoundingClientRect();
      setViewportSize({ width: rect.width, height: rect.height });
    };
    
    // Initial size
    updateViewportSize();
    
    // Track resize changes
    const resizeObserver = new ResizeObserver(updateViewportSize);
    resizeObserver.observe(container);
    
    return () => {
      resizeObserver.disconnect();
    };
  }, []);
  
  // Global event prevention system to disable browser interference
  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;
    
    // Prevent browser zoom and navigation shortcuts when viewport is focused
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if the event target is within our viewport
      const target = e.target as Element;
      if (!container.contains(target) && target !== container) return;
      
      // Block browser zoom shortcuts
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0') {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
      
      // Block spacebar scrolling when viewport is focused
      if (e.key === ' ' && (target === container || container.contains(target))) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      
      // Block arrow key scrolling when viewport is focused
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key)) {
        if (target === container || container.contains(target)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }
    };
    
    // Global wheel event capture to prevent page scrolling and browser pinch-zoom.
    const handleGlobalWheel = (e: WheelEvent) => {
      const target = e.target as Element;

      // macOS pinch on trackpad often arrives as ctrl+wheel or meta+wheel.
      if ((e.ctrlKey || e.metaKey) && (container.contains(target) || target === container)) {
        e.preventDefault();
        return;
      }

      // Prevent wheel events within the viewport from scrolling the page.
      if (container.contains(target) || target === container) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    
    // Context menu prevention
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as Element;
      if (container.contains(target) || target === container) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    
    // Touch event prevention for mobile
    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as Element;
      if (container.contains(target) || target === container) {
        // Allow single touch but prevent multi-touch gestures
        if (e.touches.length > 1) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    
    const handleTouchMove = (e: TouchEvent) => {
      const target = e.target as Element;
      if (container.contains(target) || target === container) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Safari gesture events can bypass wheel handlers for pinch-zoom.
    const handleGesture = (e: Event) => {
      const target = e.target as Element;
      if (container.contains(target) || target === container) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    
    // Add event listeners with proper options
    document.addEventListener('keydown', handleKeyDown, { capture: true });
    document.addEventListener('wheel', handleGlobalWheel, { passive: false, capture: true });
    document.addEventListener('contextmenu', handleContextMenu, { capture: true });
    document.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
    document.addEventListener('touchmove', handleTouchMove, { passive: false, capture: true });
    document.addEventListener('gesturestart', handleGesture, { passive: false, capture: true });
    document.addEventListener('gesturechange', handleGesture, { passive: false, capture: true });
    document.addEventListener('gestureend', handleGesture, { passive: false, capture: true });
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown, { capture: true });
      document.removeEventListener('wheel', handleGlobalWheel, { capture: true });
      document.removeEventListener('contextmenu', handleContextMenu, { capture: true });
      document.removeEventListener('touchstart', handleTouchStart, { capture: true });
      document.removeEventListener('touchmove', handleTouchMove, { capture: true });
      document.removeEventListener('gesturestart', handleGesture, { capture: true });
      document.removeEventListener('gesturechange', handleGesture, { capture: true });
      document.removeEventListener('gestureend', handleGesture, { capture: true });
    };
  }, []);
  
  // Focus management for keyboard accessibility
  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;
    
    // Make container focusable and handle focus events
    container.setAttribute('tabindex', '0');
    container.setAttribute('role', 'application');
    container.setAttribute('aria-label', 'Evolution Simulator Viewport - Use mouse wheel to zoom, drag to pan');
    
    const handleFocus = () => {
      container.style.outline = '2px solid rgba(59, 130, 246, 0.5)';
      container.style.outlineOffset = '2px';
    };
    
    const handleBlur = () => {
      container.style.outline = '';
      container.style.outlineOffset = '';
    };
    
    container.addEventListener('focus', handleFocus);
    container.addEventListener('blur', handleBlur);
    
    return () => {
      container.removeEventListener('focus', handleFocus);
      container.removeEventListener('blur', handleBlur);
    };
  }, []);

  function reseedWorld() {
    Sim.init(seed, startPlants, startAnimals, currentWorldPreset.width, currentWorldPreset.height);
    centerAndFit();
    setMutationLog([]);
    setWorldRenderRevision(v => v + 1);
  }

  function handleReset() {
    Sim.reseed(seed, startPlants, startAnimals, currentWorldPreset.width, currentWorldPreset.height);
    setMutationLog([]);
    setHoveredSpeciesDetails(null);
    setWorldRenderRevision(v => v + 1);
  }

  function handleWorldSizeChange(presetKey: WorldSizePresetKey) {
    const preset = WORLD_SIZE_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    const scaled = getScaledStartingPopulations(preset.width, preset.height);
    setWorldSizePreset(presetKey);
    setStartPlants(scaled.plants);
    setStartAnimals(scaled.animals);
    Sim.reseed(seed, scaled.plants, scaled.animals, preset.width, preset.height);
    atlasRendererRef.current = new LivingAtlasRenderer();
    centerAndFit();
    setMutationLog([]);
    setHoveredSpeciesDetails(null);
    setWorldRenderRevision(v => v + 1);
  }

  useEffect(() => {
    Sim.setSpeed(speed);
  }, [speed]);

  function updateBehaviorTuning<K extends keyof BehaviorTuning>(key: K, value: number) {
    const next = { ...behaviorTuning, [key]: value };
    setBehaviorTuning(next);
    Sim.setBehaviorTuning(next);
  }

  function resetBehaviorTuningToDefault() {
    Sim.resetBehaviorTuning();
    setBehaviorTuning(Sim.getBehaviorTuning());
  }

  // ===== Animation Loop =====
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const now = performance.now();
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;

      if (running) {
        const advanced = Sim.stepTime(dt);
        if (advanced) {
          setMutationLog([...Sim.getMutationLog()]);
        }
      }

      const canvas = canvasRef.current;
      if (canvas && viewportSize.width > 0 && viewportSize.height > 0) {
        // Resize canvas to match viewport
        if (canvas.width !== viewportSize.width || canvas.height !== viewportSize.height) {
          canvas.width = viewportSize.width;
          canvas.height = viewportSize.height;
        }
        
        const ctx = canvas.getContext("2d")!;
        drawFrame(ctx, camera, showGrid);
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, speed, camera, showGrid, displayOptions, viewportSize]);

  // ===== Rendering =====
  function drawFrame(ctx: CanvasRenderingContext2D, cam: { x: number; y: number; zoom: number }, showGrid: boolean) {
    const renderStart = performance.now();
    const atlas = atlasRendererRef.current;
    if (atlas) {
      atlas.render({
        ctx,
        camera: cam,
        viewportSize,
        displayOptions,
        showGrid,
        tick: Sim.getTick(),
        mutationLog: Sim.getMutationLog(),
      });
    }
    
    // Advanced performance monitoring and intelligence
    const renderEnd = performance.now();
    const frameTime = renderEnd - renderStart;
    
    // Update frame time history for performance analysis
    frameTimeHistoryRef.current.push(frameTime);
    if (frameTimeHistoryRef.current.length > 120) { // Keep last 2 seconds at 60fps
      frameTimeHistoryRef.current.shift();
    }
    
    // FPS calculation
    fpsCounterRef.current++;
    if (renderEnd - fpsLastRef.current >= 1000) {
      const currentFps = fpsCounterRef.current;
      setFps(currentFps);
      fpsCounterRef.current = 0;
      fpsLastRef.current = renderEnd;
      
      // Update performance intelligence (every second)
      const avgFrameTime = frameTimeHistoryRef.current.reduce((a, b) => a + b, 0) / frameTimeHistoryRef.current.length || 16.67;
      const avgFps = 1000 / avgFrameTime;
      setRenderTime(avgFrameTime);
      
      // Calculate performance health score
      const targetFrameTime = 16.67; // 60fps target
      const healthScore = Math.max(0, Math.min(100, 100 - (avgFrameTime - targetFrameTime) * 2));
      
      // Generate performance suggestions
      const suggestions: string[] = [];
      const entityCount = counts.total;
      
      if (avgFrameTime > 25) { // Below 40 FPS
        if (displayOptions.showTrails) suggestions.push("Disable movement trails for better performance");
        if (displayOptions.showShapes) suggestions.push("Use simple pixels instead of shapes");
        if (displayOptions.showLifePulse) suggestions.push("Disable life pulse animation");
        if (entityCount > 80000) suggestions.push("Reduce max visible entities to 50k-80k");
        if (camera.zoom < 8 && !displayOptions.enableClustering) suggestions.push("Enable entity clustering at low zoom");
      }
      
      if (avgFrameTime > 33) { // Below 30 FPS
        if (displayOptions.biomeDisplayMode !== "subtle") suggestions.push("Use subtle biome display mode");
        if (displayOptions.viewMode !== "standard") suggestions.push("Switch to standard view mode for best performance");
        suggestions.push("Force detail level to 'Low' in LOD settings");
      }
      
      if (avgFrameTime < 12) { // Above 80 FPS - can increase quality
        if (!displayOptions.showShapes) suggestions.push("Enable behavior shapes for better visuals");
        if (!displayOptions.showTrails && camera.zoom >= 16) suggestions.push("Enable movement trails at high zoom");
        if (displayOptions.biomeDisplayMode === "subtle") suggestions.push("Try enhanced or prominent biome modes");
      }
      
      setPerformanceMetrics({
        averageFps: avgFps,
        averageRenderTime: avgFrameTime,
        frameTimeHistory: [...frameTimeHistoryRef.current],
        suggestions,
        healthScore
      });
    }

  }

  // ===== Mouse/Touch Handlers =====
  function clientToScreen(clientX: number, clientY: number) {
    const vp = viewportRef.current;
    if (!vp) return { x: -1, y: -1 };
    const rect = vp.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (isDragging && !placingMode) {
      const last = dragLastPosRef.current;
      if (last) {
        const dx = e.clientX - last.x;
        const dy = e.clientY - last.y;
        setCamera(prev => constrainCamera({
          ...prev,
          x: prev.x - dx / prev.zoom,
          y: prev.y - dy / prev.zoom,
        }));
      }
      dragLastPosRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const screenPos = clientToScreen(e.clientX, e.clientY);
    const worldPos = screenToWorld(screenPos.x, screenPos.y);
    
    if (worldPos.x < 0 || worldPos.y < 0 || worldPos.x >= W || worldPos.y >= H) {
      setHover(null);
      setHoverInfo(null);
      return;
    }
    setHover(worldPos);
    const entity = Sim.inspect(worldPos.x, worldPos.y);
    setHoverInfo(entity);
  }

  function handleCanvasClick(e: React.PointerEvent) {
    if (!placingMode) return;
    
    const screenPos = clientToScreen(e.clientX, e.clientY);
    const worldPos = screenToWorld(screenPos.x, screenPos.y);
    if (worldPos.x < 0 || worldPos.y < 0 || worldPos.x >= W || worldPos.y >= H) return;
    
    // Apply trait modes (random vs set)
    const finalGenome = { ...customGenome };
    const randomizableTraits: RandomizableGenomeTrait[] = [
      "hostility",
      "speed",
      "size",
      "vision",
      "fertility",
      "camouflage",
      "sociality",
      "temperatureTolerance",
      "mutationRate",
    ];
    Object.entries(traitModes).forEach(([trait, mode]) => {
      if (mode === 'random') {
        // Apply random values based on trait type
        if (randomizableTraits.includes(trait as RandomizableGenomeTrait)) {
          finalGenome[trait as RandomizableGenomeTrait] = Math.random();
        } else if (trait === 'maturityAge') {
          finalGenome.maturityAge = Math.floor(100 + Math.random() * 1400);
        } else if (trait === 'maxAge') {
          finalGenome.maxAge = Math.floor(1500 + Math.random() * 6000);
        }
        // Add more random generators for other traits as needed
      }
    });
    
    const success = Sim.place(worldPos.x, worldPos.y, finalGenome, 0.8);
    if (success) {
      console.log(`Placed ${finalGenome.lifeType} at (${worldPos.x}, ${worldPos.y})`);
    }
  }

  function handlePointerDown(e: React.PointerEvent) {
    if (placingMode) {
      handleCanvasClick(e);
      return;
    }

    if (e.button !== 0) return;
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    dragLastPosRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
  }

  function endPointerDrag(e: React.PointerEvent) {
    if (!isDragging) return;
    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    dragLastPosRef.current = null;
    setIsDragging(false);
  }

  function handleWheel(e: React.WheelEvent) {
    if (!viewportRef.current) return;
    
    e.preventDefault();
    
    // Get screen coordinates relative to viewport
    const screenPos = clientToScreen(e.clientX, e.clientY);
    
    // Determine if this is a zoom or pan gesture
    const isZooming = e.ctrlKey || e.metaKey || (Math.abs(e.deltaY) > Math.abs(e.deltaX) && Math.abs(e.deltaY) > 10);
    
    if (isZooming) {
      // Zoom at cursor position
      const worldPosBefore = screenToWorldPrecise(screenPos.x, screenPos.y, camera);
      
      // Calculate zoom factor with better sensitivity for different input devices
      const zoomSensitivity = e.ctrlKey || e.metaKey ? 0.003 : 0.002; // More sensitive with modifier keys
      const zoomFactor = Math.exp(-e.deltaY * zoomSensitivity);
      
      const newZoom = Math.max(0.5, Math.min(64, camera.zoom * zoomFactor));

      // Keep cursor-anchored world position stable through zoom.
      const normX = screenPos.x / Math.max(1, viewportSize.width);
      const normY = screenPos.y / Math.max(1, viewportSize.height);
      const newWorldWidth = viewportSize.width / newZoom;
      const newWorldHeight = viewportSize.height / newZoom;
      const newX = worldPosBefore.x - (normX - 0.5) * newWorldWidth;
      const newY = worldPosBefore.y - (normY - 0.5) * newWorldHeight;

      setCamera(prev => constrainCamera({
        ...prev,
        zoom: newZoom,
        x: newX,
        y: newY
      }));
    } else {
      // Pan with trackpad or horizontal wheel
      const panSensitivity = 0.5; // Adjust for comfortable panning
      const deltaWorldX = (e.deltaX * panSensitivity) / camera.zoom;
      const deltaWorldY = (e.deltaY * panSensitivity) / camera.zoom;
      
      // Apply constrained camera update
      setCamera(prev => constrainCamera({
        ...prev,
        x: prev.x + deltaWorldX,
        y: prev.y + deltaWorldY
      }));
    }
  }

  // resetView function removed - using centerAndFit directly

  function centerAndFit() {
    if (!viewportRef.current || viewportSize.width === 0 || viewportSize.height === 0) return;
    
    // Calculate zoom to fit entire world in viewport with some padding
    const paddingFactor = 0.9; // 10% padding
    const zoomToFitWidth = (viewportSize.width * paddingFactor) / W;
    const zoomToFitHeight = (viewportSize.height * paddingFactor) / H;
    const zoomToFit = Math.min(zoomToFitWidth, zoomToFitHeight);
    
    const newZoom = Math.max(0.5, Math.min(64, zoomToFit));
    
    // Center camera on world center
    setCamera({
      x: W / 2,
      y: H / 2,
      zoom: newZoom
    });
  }
  
  function zoomIn() {
    setCamera(prev => constrainCamera({
      ...prev,
      zoom: Math.min(64, prev.zoom * 1.5)
    }));
  }
  
  function zoomOut() {
    setCamera(prev => constrainCamera({
      ...prev,
      zoom: Math.max(0.5, prev.zoom / 1.5)
    }));
  }

  function applyZoomPreset(level: "planetary" | "regional" | "local" | "individual") {
    if (level === "planetary") {
      centerAndFit();
      return;
    }
    const z = level === "regional" ? 4.5 : level === "local" ? 12 : 28;
    setCamera(prev => constrainCamera({ ...prev, zoom: z }));
  }

  function minimapScreenToWorld(clientX: number, clientY: number) {
    const mini = minimapRef.current;
    if (!mini) return null;
    const rect = mini.getBoundingClientRect();
    const rx = (clientX - rect.left) / Math.max(1, rect.width);
    const ry = (clientY - rect.top) / Math.max(1, rect.height);
    if (rx < 0 || ry < 0 || rx > 1 || ry > 1) return null;
    return { x: rx * W, y: ry * H };
  }

  function handleMinimapPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    minimapDraggingRef.current = true;
    minimapPointerIdRef.current = e.pointerId;
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);
    minimapDragStartRef.current = { x: e.clientX, y: e.clientY, moved: false };
  }

  function handleMinimapPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!minimapDraggingRef.current) return;
    if (minimapPointerIdRef.current !== e.pointerId) return;
    if ((e.buttons & 1) !== 1) return;
    const drag = minimapDragStartRef.current;
    if (!drag) return;
    const dragged = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 3;
    if (!dragged && !drag.moved) return;
    drag.moved = true;
    const worldPos = minimapScreenToWorld(e.clientX, e.clientY);
    if (!worldPos) return;
    setCamera(prev => constrainCamera({ ...prev, x: worldPos.x, y: worldPos.y }));
  }

  function handleMinimapPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    minimapDraggingRef.current = false;
    minimapDragStartRef.current = null;
    minimapPointerIdRef.current = null;
    if ((e.currentTarget as HTMLCanvasElement).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    }
  }
  
  // ===== Touch Event Handlers =====
  function handleTouchStart(e: React.TouchEvent) {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.touches.length > 1) {
      // Multi-touch gesture - prevent default behavior completely
      return;
    }
    
    // Single touch - prevent default behavior
    // Touch coordinates available for future pan gesture implementation
    
    // Store touch start position for potential pan calculations
    // (Pan gestures with touch could be implemented here if needed)
  }
  
  function handleTouchMove(e: React.TouchEvent) {
    e.preventDefault();
    e.stopPropagation();
    
    // Prevent all touch move to avoid scroll/zoom gestures
  }
  
  function handleTouchEnd(e: React.TouchEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  // ===== Data =====
  const counts = Sim.getCounts();
  const tick = Sim.getTick();
  const night = isNight(tick);
  const dayPhase = (tick % 2400) / 2400;
  const dialAngle = dayPhase * Math.PI * 2 - Math.PI / 2;
  const dialRadius = 16;
  const dialCenter = 24;
  const dialOrbX = dialCenter + Math.cos(dialAngle) * dialRadius;
  const dialOrbY = dialCenter + Math.sin(dialAngle) * dialRadius;
  const eggs = Sim.getEggs();
  const speciesStats = Sim.getSpeciesStats();
  const worldStats = Sim.getWorldStats();
  const populationDiagnostics = Sim.getPopulationDiagnostics();
  const weatherState = Sim.getWeatherState();
  const worldPulse = mutationLog.length === 0
    ? "Evolution is in establishment phase."
    : mutationLog[0].ecologicalContext
      ? `Latest pressure: ${mutationLog[0].ecologicalContext}.`
      : "Genetic drift is active with emerging variants.";
  const filteredSpeciesStats = useMemo(() => {
    const q = speciesSearch.trim().toLowerCase();
    return speciesStats.filter((s) => {
      const isPlant = s.dominantLifeType === "plant";
      const categoryMatch =
        speciesCategory === "all" ? true :
        speciesCategory === "plants" ? isPlant :
        speciesCategory === "animals" ? !isPlant :
        speciesCategory === "herbivore" ? s.dominantDiet === "herbivore" :
        speciesCategory === "carnivore" ? s.dominantDiet === "carnivore" :
        speciesCategory === "omnivore" ? s.dominantDiet === "omnivore" :
        s.dominantClass === speciesCategory;
      if (!categoryMatch) return false;
      if (!q) return true;
      return `#${s.speciesId}`.toLowerCase().includes(q) || String(s.speciesId).includes(q);
    });
  }, [speciesStats, speciesCategory, speciesSearch]);
  const hoveredSpeciesIsPlant = hoveredSpeciesDetails?.dominantLifeType === "plant";

  function renderDaySummary(label: string, stats: DailyPopulationStats) {
    return (
      <div className="rounded-xl border border-white/10 bg-black/20 p-2">
        <div className="text-[11px] uppercase tracking-wide text-white/60 mb-1">{label} (Day {stats.day})</div>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
          <div className="text-white/70">Births</div>
          <div className="tabular-nums text-emerald-300">
            <div>{stats.births}</div>
            <div className="text-[11px] text-emerald-200/90">{stats.birthsAnimals}A / {stats.birthsPlants}P</div>
          </div>
          <div className="text-white/70">Deaths</div>
          <div className="tabular-nums text-rose-300">
            <div>{stats.deaths}</div>
            <div className="text-[11px] text-rose-200/90">{stats.deathsAnimals}A / {stats.deathsPlants}P</div>
          </div>
          <div className="text-white/70">Net</div>
          <div className={`tabular-nums ${stats.netPopulation >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
            {stats.netPopulation >= 0 ? "+" : ""}{stats.netPopulation}
          </div>
          <div className="text-white/70">Starvation</div>
          <div className="tabular-nums">{stats.deathsByCause.starvation}</div>
          <div className="text-white/70">Dehydration</div>
          <div className="tabular-nums">{stats.deathsByCause.dehydration}</div>
          <div className="text-white/70">Predation</div>
          <div className="tabular-nums">{stats.deathsByCause.predation}</div>
          <div className="text-white/70">Fire</div>
          <div className="tabular-nums">{stats.deathsByCause.fire}</div>
          <div className="text-white/70">Old Age</div>
          <div className="tabular-nums">{stats.deathsByCause.age}</div>
        </div>
      </div>
    );
  }

  // Beautiful styling variables
  const headerStyle = {
    background: "linear-gradient(100deg, rgba(13,42,58,0.95), rgba(11,66,90,0.88) 48%, rgba(33,111,95,0.84))",
    color: "#f3f8fa",
    borderBottom: "1px solid rgba(185, 225, 234, 0.2)"
  };

  const pill = "atlas-chip px-3 py-1.5 rounded-xl text-sm shadow-sm";
  const stat = "atlas-chip px-2 py-1 rounded-lg";
  const panel = "atlas-panel rounded-2xl p-3 backdrop-blur-sm";

  return (
    <div className="w-full h-[100dvh] flex flex-col overflow-hidden" style={{
      background: "radial-gradient(1200px 500px at 15% -10%, rgba(16,132,99,0.25), transparent), radial-gradient(900px 600px at 100% 100%, rgba(32,87,140,0.28), transparent), #08131c",
      color: "#e5e7eb"
    }}>
      {/* Header */}
      <div className="p-3 flex flex-wrap items-center gap-3" style={headerStyle}>
        <div className="font-semibold tracking-wide">Life Simulator v1</div>
        
        <button 
          className={pill} 
          onClick={() => setRunning(!running)}
        >
          {running ? "Pause" : "Run"}
        </button>

        <button
          className={pill}
          onClick={() => Sim.stepOnce()}
          disabled={running}
        >
          Step
        </button>

        <label className="flex items-center gap-2">
          Speed
          <input 
            className="mx-2" 
            type="range" 
            min={1} 
            max={120} 
            value={speed} 
            onChange={e => setSpeed(parseInt(e.target.value))}
          />
          <span className="tabular-nums w-12">{speed} tps</span>
        </label>
        <div className="text-[11px] text-amber-200/85">
          Higher TPS may cause lag, especially with more moving entities.
        </div>

        <label className="flex items-center gap-2">
          Zoom
          <input 
            className="mx-2" 
            type="range" 
            min={0.5} 
            max={64} 
            step={0.5}
            value={camera.zoom} 
            onChange={e => setCamera(prev => constrainCamera({ ...prev, zoom: parseFloat(e.target.value) }))}
          />
          <span className="tabular-nums w-12">{camera.zoom.toFixed(1)}x</span>
        </label>

        <label className="flex items-center gap-2">
          <input 
            type="checkbox" 
            checked={showGrid} 
            onChange={e => setShowGrid(e.target.checked)}
          />
          Grid
        </label>

        {/* Viewport Controls */}
        <div className="flex gap-1">
          <button
            className="atlas-chip px-2 py-1 text-xs rounded transition-colors"
            onClick={zoomIn}
            title="Zoom in"
          >
            🔍+
          </button>
          <button
            className="atlas-chip px-2 py-1 text-xs rounded transition-colors"
            onClick={zoomOut}
            title="Zoom out"
          >
            🔍−
          </button>
        </div>

        <div className="flex gap-1">
          <button className="atlas-chip px-2 py-1 text-xs rounded" onClick={() => applyZoomPreset("planetary")}>Planetary</button>
          <button className="atlas-chip px-2 py-1 text-xs rounded" onClick={() => applyZoomPreset("regional")}>Regional</button>
          <button className="atlas-chip px-2 py-1 text-xs rounded" onClick={() => applyZoomPreset("local")}>Local</button>
          <button className="atlas-chip px-2 py-1 text-xs rounded" onClick={() => applyZoomPreset("individual")}>Individual</button>
        </div>

        <button className={pill} onClick={handleReset}>
          Reset Sim
        </button>

        <div className="ml-auto flex items-center gap-3 text-sm">
          <div className={stat}>
            Tick <span className="tabular-nums">{tick.toLocaleString()}</span>
          </div>
          <div className={stat}>
            Entities <span className="tabular-nums">{counts.total.toLocaleString()}</span>
          </div>
          <div className={stat}>
            Time <span className="tabular-nums">
              {(tick % 2400).toString().padStart(4, '0')} / 2400 ({night ? "Night" : "Day"})
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-12 gap-3 p-3 flex-1 min-h-0 overflow-hidden">
        
        {/* Left sidebar */}
        <div className="col-span-3 xl:col-span-2 min-h-0 flex flex-col gap-3 overflow-y-auto pr-1">
          <div className={panel}>
            <div className="font-semibold mb-2">Settings</div>
            <div className="space-y-2 text-sm">
              <label className="flex items-center justify-between">
                World
                <select
                  className="w-24 bg-white/10 border border-white/10 rounded px-2 py-1 text-xs"
                  value={worldSizePreset}
                  onChange={e => handleWorldSizeChange(e.target.value as WorldSizePresetKey)}
                >
                  {WORLD_SIZE_PRESETS.map((preset) => (
                    <option key={preset.key} value={preset.key}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center justify-between">
                Seed
                <input
                  className="w-20 bg-white/10 border border-white/10 rounded px-2 py-1 text-xs"
                  type="number"
                  value={seed}
                  onChange={e => setSeed(parseInt(e.target.value) || 0)}
                />
              </label>
              <label className="flex items-center justify-between">
                Plants
                <input
                  className="w-20 bg-white/10 border border-white/10 rounded px-2 py-1 text-xs"
                  type="number"
                  value={startPlants}
                  onChange={e => setStartPlants(Math.max(0, parseInt(e.target.value) || 0))}
                />
              </label>
              <label className="flex items-center justify-between">
                Animals
                <input
                  className="w-20 bg-white/10 border border-white/10 rounded px-2 py-1 text-xs"
                  type="number"
                  value={startAnimals}
                  onChange={e => setStartAnimals(Math.max(0, parseInt(e.target.value) || 0))}
                />
              </label>
            </div>
            <div className="text-xs text-white/70 mt-2">
              Drag to pan. Ctrl/Cmd+Wheel to zoom at cursor.
            </div>
          </div>

          <div className={panel}>
            <div className="font-semibold mb-2 flex items-center justify-between">
              Behavior Tuning
              <button
                className="px-2 py-1 rounded text-[11px] bg-white/10 hover:bg-white/20 border border-white/10"
                onClick={resetBehaviorTuningToDefault}
              >
                Reset
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <label className="flex items-center justify-between gap-2">
                <span className="text-white/80">Thirst</span>
                <input
                  type="range"
                  min="0.4"
                  max="2.0"
                  step="0.05"
                  value={behaviorTuning.thirstWeight}
                  onChange={e => updateBehaviorTuning("thirstWeight", parseFloat(e.target.value))}
                  className="w-20"
                />
                <span className="tabular-nums w-10 text-right">{behaviorTuning.thirstWeight.toFixed(2)}</span>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-white/80">Hunger</span>
                <input
                  type="range"
                  min="0.4"
                  max="2.2"
                  step="0.05"
                  value={behaviorTuning.hungerWeight}
                  onChange={e => updateBehaviorTuning("hungerWeight", parseFloat(e.target.value))}
                  className="w-20"
                />
                <span className="tabular-nums w-10 text-right">{behaviorTuning.hungerWeight.toFixed(2)}</span>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-white/80">Mate</span>
                <input
                  type="range"
                  min="0.4"
                  max="2.2"
                  step="0.05"
                  value={behaviorTuning.mateWeight}
                  onChange={e => updateBehaviorTuning("mateWeight", parseFloat(e.target.value))}
                  className="w-20"
                />
                <span className="tabular-nums w-10 text-right">{behaviorTuning.mateWeight.toFixed(2)}</span>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-white/80">Fear</span>
                <input
                  type="range"
                  min="0.2"
                  max="2.0"
                  step="0.05"
                  value={behaviorTuning.fearWeight}
                  onChange={e => updateBehaviorTuning("fearWeight", parseFloat(e.target.value))}
                  className="w-20"
                />
                <span className="tabular-nums w-10 text-right">{behaviorTuning.fearWeight.toFixed(2)}</span>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-white/80">Move Boost</span>
                <input
                  type="range"
                  min="0.1"
                  max="0.8"
                  step="0.01"
                  value={behaviorTuning.motiveMoveBoostMax}
                  onChange={e => updateBehaviorTuning("motiveMoveBoostMax", parseFloat(e.target.value))}
                  className="w-20"
                />
                <span className="tabular-nums w-10 text-right">{behaviorTuning.motiveMoveBoostMax.toFixed(2)}</span>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-white/80">Feed Chance</span>
                <input
                  type="range"
                  min="0"
                  max="0.5"
                  step="0.01"
                  value={behaviorTuning.opportunisticFeedChance}
                  onChange={e => updateBehaviorTuning("opportunisticFeedChance", parseFloat(e.target.value))}
                  className="w-20"
                />
                <span className="tabular-nums w-10 text-right">{behaviorTuning.opportunisticFeedChance.toFixed(2)}</span>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-white/80">Mate Threshold</span>
                <input
                  type="range"
                  min="0.1"
                  max="0.8"
                  step="0.01"
                  value={behaviorTuning.reproductionReadinessThreshold}
                  onChange={e => updateBehaviorTuning("reproductionReadinessThreshold", parseFloat(e.target.value))}
                  className="w-20"
                />
                <span className="tabular-nums w-10 text-right">{behaviorTuning.reproductionReadinessThreshold.toFixed(2)}</span>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-white/80">Metabolism</span>
                <input
                  type="range"
                  min="0.3"
                  max="1.4"
                  step="0.02"
                  value={behaviorTuning.animalMetabolismMultiplier}
                  onChange={e => updateBehaviorTuning("animalMetabolismMultiplier", parseFloat(e.target.value))}
                  className="w-20"
                />
                <span className="tabular-nums w-10 text-right">{behaviorTuning.animalMetabolismMultiplier.toFixed(2)}</span>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-white/80">Plant Bite</span>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.02"
                  value={behaviorTuning.plantBiteAmount}
                  onChange={e => updateBehaviorTuning("plantBiteAmount", parseFloat(e.target.value))}
                  className="w-20"
                />
                <span className="tabular-nums w-10 text-right">{behaviorTuning.plantBiteAmount.toFixed(2)}</span>
              </label>
              <label className="flex items-center justify-between gap-2">
                <span className="text-white/80">Attack Gain</span>
                <input
                  type="range"
                  min="0.2"
                  max="1.0"
                  step="0.02"
                  value={behaviorTuning.attackEnergyGain}
                  onChange={e => updateBehaviorTuning("attackEnergyGain", parseFloat(e.target.value))}
                  className="w-20"
                />
                <span className="tabular-nums w-10 text-right">{behaviorTuning.attackEnergyGain.toFixed(2)}</span>
              </label>
            </div>
          </div>

          <div className={panel}>
            <div className="font-semibold mb-2">Population</div>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Total:</span>
                <span className="tabular-nums">{counts.total.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-green-400">
                <span>Plants:</span>
                <span className="tabular-nums">{counts.plants.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-blue-400">
                <span>Animals:</span>
                <span className="tabular-nums">{counts.animals.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-yellow-400">
                <span>Eggs:</span>
                <span className="tabular-nums">{eggs.length.toLocaleString()}</span>
              </div>
            </div>
          </div>

          {/* Custom Entity Builder */}
          <div className={panel}>
            <div className="font-semibold mb-2 flex items-center justify-between">
              Custom Entity Builder
              <button
                onClick={() => setPlacingMode(!placingMode)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  placingMode 
                    ? 'bg-green-600/30 text-green-300 border border-green-400/30' 
                    : 'bg-white/10 text-white/70 border border-white/10 hover:bg-white/20'
                }`}
              >
                Placing: {placingMode ? 'ON' : 'OFF'}
              </button>
            </div>
            
            <div className="space-y-3 text-sm">
              {/* Life Type */}
              <div className="space-y-1">
                <label className="flex items-center justify-between">
                  Life Type
                  <select
                    value={customGenome.lifeType}
                    onChange={e => {
                      const newLifeType = e.target.value as 'plant' | 'animal';
                      setCustomGenome(prev => ({
                        ...prev,
                        lifeType: newLifeType,
                        speciesClass: newLifeType === 'plant' ? 'insect' : prev.speciesClass === 'insect' ? 'mammal' : prev.speciesClass,
                        diet: newLifeType === 'plant' ? 'photosynthesis' : prev.diet === 'photosynthesis' ? 'herbivore' : prev.diet,
                        supplementalCarnivory: newLifeType === 'plant' ? prev.supplementalCarnivory : false,
                        speed: newLifeType === 'plant' ? 0 : prev.speed,
                        vision: newLifeType === 'plant' ? 0 : prev.vision,
                        seedSpread: newLifeType === 'plant' ? 0.3 : 0
                      }));
                    }}
                    className="w-20 bg-white/10 border border-white/10 rounded px-2 py-1 text-xs"
                  >
                    <option value="plant">Plant</option>
                    <option value="animal">Animal</option>
                  </select>
                </label>
              </div>

              {/* Species Class */}
              <div className="space-y-1">
                <label className="flex items-center justify-between">
                  Species Class
                  <select
                    value={customGenome.speciesClass}
                    onChange={e => setCustomGenome(prev => ({ ...prev, speciesClass: e.target.value as SpeciesClass }))}
                    className="w-20 bg-white/10 border border-white/10 rounded px-2 py-1 text-xs"
                  >
                    <option value="fish">Fish</option>
                    <option value="mammal">Mammal</option>
                    <option value="bird">Bird</option>
                    <option value="reptile">Reptile</option>
                    <option value="amphibian">Amphibian</option>
                    <option value="insect">Insect</option>
                  </select>
                </label>
              </div>

              {/* Diet */}
              <div className="space-y-1">
                <label className="flex items-center justify-between">
                  Diet
                  <select
                    value={customGenome.diet}
                    onChange={e => setCustomGenome(prev => ({ ...prev, diet: e.target.value as Genome["diet"] }))}
                    disabled={customGenome.lifeType === 'plant'}
                    className="w-20 bg-white/10 border border-white/10 rounded px-2 py-1 text-xs disabled:opacity-50"
                  >
                    {customGenome.lifeType === 'plant' ? (
                      <option value="photosynthesis">Photo</option>
                    ) : (
                      <>
                        <option value="herbivore">Herb</option>
                        <option value="carnivore">Carn</option>
                        <option value="omnivore">Omni</option>
                      </>
                    )}
                  </select>
                </label>
              </div>

              {/* Hostility */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span>Hostility</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTraitModes(prev => ({ ...prev, hostility: prev.hostility === 'random' ? 'set' : 'random' }))}
                      className={`px-1 py-0.5 text-xs rounded ${traitModes.hostility === 'random' ? 'bg-orange-600/30 text-orange-300' : 'bg-white/10 text-white/50'}`}
                    >
                      {traitModes.hostility === 'random' ? 'R' : 'S'}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={customGenome.hostility}
                      onChange={e => setCustomGenome(prev => ({ ...prev, hostility: parseFloat(e.target.value) }))}
                      disabled={traitModes.hostility === 'random'}
                      className="w-16 disabled:opacity-50"
                    />
                    <span className="text-xs w-8 tabular-nums">{(customGenome.hostility * 100).toFixed(0)}</span>
                  </div>
                </div>
              </div>

              {/* Speed */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span>Speed</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTraitModes(prev => ({ ...prev, speed: prev.speed === 'random' ? 'set' : 'random' }))}
                      className={`px-1 py-0.5 text-xs rounded ${traitModes.speed === 'random' ? 'bg-orange-600/30 text-orange-300' : 'bg-white/10 text-white/50'}`}
                      disabled={customGenome.lifeType === 'plant'}
                    >
                      {traitModes.speed === 'random' ? 'R' : 'S'}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={customGenome.lifeType === 'plant' ? 0 : customGenome.speed}
                      onChange={e => setCustomGenome(prev => ({ ...prev, speed: parseFloat(e.target.value) }))}
                      disabled={traitModes.speed === 'random' || customGenome.lifeType === 'plant'}
                      className="w-16 disabled:opacity-50"
                    />
                    <span className="text-xs w-8 tabular-nums">{((customGenome.lifeType === 'plant' ? 0 : customGenome.speed) * 100).toFixed(0)}</span>
                  </div>
                </div>
              </div>

              {/* Size */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span>Size</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTraitModes(prev => ({ ...prev, size: prev.size === 'random' ? 'set' : 'random' }))}
                      className={`px-1 py-0.5 text-xs rounded ${traitModes.size === 'random' ? 'bg-orange-600/30 text-orange-300' : 'bg-white/10 text-white/50'}`}
                    >
                      {traitModes.size === 'random' ? 'R' : 'S'}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={customGenome.size}
                      onChange={e => setCustomGenome(prev => ({ ...prev, size: parseFloat(e.target.value) }))}
                      disabled={traitModes.size === 'random'}
                      className="w-16 disabled:opacity-50"
                    />
                    <span className="text-xs w-8 tabular-nums">{(customGenome.size * 100).toFixed(0)}</span>
                  </div>
                </div>
              </div>

              {/* Preferred Biome */}
              <div className="space-y-1">
                <label className="flex items-center justify-between">
                  Preferred Biome
                  <select
                    value={customGenome.preferredBiome}
                    onChange={e => setCustomGenome(prev => ({ ...prev, preferredBiome: e.target.value as Biome }))}
                    className="w-20 bg-white/10 border border-white/10 rounded px-2 py-1 text-xs"
                  >
                    <option value="grassland">Grass</option>
                    <option value="forest">Forest</option>
                    <option value="desert">Desert</option>
                    <option value="tundra">Tundra</option>
                    <option value="wetlands">Wetland</option>
                    <option value="ocean">Ocean</option>
                  </select>
                </label>
              </div>

              {/* Temperature Tolerance */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span>Temp. Tolerance</span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTraitModes(prev => ({ ...prev, temperatureTolerance: prev.temperatureTolerance === 'random' ? 'set' : 'random' }))}
                      className={`px-1 py-0.5 text-xs rounded ${traitModes.temperatureTolerance === 'random' ? 'bg-orange-600/30 text-orange-300' : 'bg-white/10 text-white/50'}`}
                    >
                      {traitModes.temperatureTolerance === 'random' ? 'R' : 'S'}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={customGenome.temperatureTolerance}
                      onChange={e => setCustomGenome(prev => ({ ...prev, temperatureTolerance: parseFloat(e.target.value) }))}
                      disabled={traitModes.temperatureTolerance === 'random'}
                      className="w-16 disabled:opacity-50"
                    />
                    <span className="text-xs w-8 tabular-nums">{(customGenome.temperatureTolerance * 100).toFixed(0)}</span>
                  </div>
                </div>
              </div>

              {/* Activity Cycle */}
              <div className="space-y-1">
                <label className="flex items-center justify-between">
                  Activity Cycle
                  <select
                    value={customGenome.activity}
                    onChange={e => setCustomGenome(prev => ({ ...prev, activity: e.target.value as ActivityCycle }))}
                    className="w-20 bg-white/10 border border-white/10 rounded px-2 py-1 text-xs"
                  >
                    <option value="diurnal">Day</option>
                    <option value="nocturnal">Night</option>
                    <option value="cathemeral">Both</option>
                  </select>
                </label>
              </div>

              {/* Reproduction Type */}
              <div className="space-y-1">
                <label className="flex items-center justify-between">
                  Reproduction
                  <select
                    value={customGenome.reproduction}
                    onChange={e => setCustomGenome(prev => ({ ...prev, reproduction: e.target.value as "asexual" | "sexual" }))}
                    className="w-20 bg-white/10 border border-white/10 rounded px-2 py-1 text-xs"
                  >
                    <option value="asexual">Asexual</option>
                    <option value="sexual">Sexual</option>
                  </select>
                </label>
              </div>

              {/* Randomize Button */}
              <button
                onClick={() => {
                  const biomes: Biome[] = ["grassland", "forest", "desert", "tundra", "wetlands", "ocean"];
                  const activities: ActivityCycle[] = ["diurnal", "nocturnal", "cathemeral"];
                  const newGenome: Genome = {
                    ...customGenome,
                    hostility: Math.random(),
                    speed: customGenome.lifeType === 'plant' ? 0 : Math.random(),
                    size: Math.random(),
                    vision: customGenome.lifeType === 'plant' ? 0 : Math.random(),
                    fertility: Math.random(),
                    maturityAge: Math.floor(100 + Math.random() * 1400),
                    maxAge: Math.floor(1500 + Math.random() * 6000),
                    camouflage: Math.random(),
                    sociality: Math.random(),
                    temperatureTolerance: Math.random(),
                    preferredBiome: biomes[Math.floor(Math.random() * biomes.length)],
                    activity: activities[Math.floor(Math.random() * activities.length)],
                    reproduction: Math.random() < 0.7 ? "sexual" : "asexual",
                    mutationRate: Math.random() * 0.1,
                    seedSpread: customGenome.lifeType === 'plant' ? Math.random() * 0.5 : 0,
                  };
                  setCustomGenome(newGenome);
                }}
                className="w-full px-3 py-2 bg-purple-600/30 hover:bg-purple-600/50 border border-purple-400/30 rounded text-sm transition-colors"
              >
                Randomize All Traits
              </button>
            </div>
            
            {placingMode && (
              <div className="text-xs text-green-300 mt-2 p-2 bg-green-900/20 rounded border border-green-400/20">
                Click on the canvas to place an entity
              </div>
            )}
          </div>

          {/* Display Controls Panel */}
          <div className={panel}>
            <div className="font-semibold mb-2">🎨 Display Controls</div>
            
            <div className="space-y-3 text-sm">
              {/* Biome Display Mode */}
              <div className="space-y-1">
                <label className="flex items-center justify-between">
                  Biome Mode
                  <select 
                    value={displayOptions.biomeDisplayMode}
                    onChange={e => setDisplayOptions(prev => ({ ...prev, biomeDisplayMode: e.target.value as BiomeDisplayMode }))}
                    className="w-24 bg-white/10 border border-white/10 rounded px-2 py-1 text-xs"
                  >
                    <option value="subtle">Subtle</option>
                    <option value="enhanced">Enhanced</option>
                    <option value="prominent">Prominent</option>
                    <option value="pure_biome">Pure</option>
                  </select>
                </label>
              </div>

              {/* Biome Intensity Slider */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span>Biome Intensity</span>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={displayOptions.biomeIntensity}
                      onChange={e => setDisplayOptions(prev => ({ ...prev, biomeIntensity: parseFloat(e.target.value) }))}
                      className="w-16"
                    />
                    <span className="text-xs w-8 tabular-nums">{(displayOptions.biomeIntensity * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>

              {/* View Mode */}
              <div className="space-y-1">
                <label className="flex items-center justify-between">
                  View Mode
                  <select 
                    value={displayOptions.viewMode}
                    onChange={e => setDisplayOptions(prev => ({ ...prev, viewMode: e.target.value as ViewMode }))}
                    className="w-24 bg-white/10 border border-white/10 rounded px-2 py-1 text-xs"
                  >
                    <option value="standard">Standard</option>
                    <option value="energy">Energy</option>
                    <option value="age">Age</option>
                    <option value="health">Health</option>
                    <option value="genetics">Genetics</option>
                    <option value="diet">Diet</option>
                    <option value="temperature">Temperature</option>
                    <option value="biome_match">Biome Match</option>
                  </select>
                </label>
              </div>

              {/* Entity Type Toggles */}
              <div className="space-y-1">
                <div className="text-xs text-white/70 mb-1">Show Entities:</div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={displayOptions.showPlants}
                      onChange={e => setDisplayOptions(prev => ({ ...prev, showPlants: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <span className="text-green-400">🌱 Plants</span>
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={displayOptions.showAnimals}
                      onChange={e => setDisplayOptions(prev => ({ ...prev, showAnimals: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <span className="text-blue-400">🐾 Animals</span>
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={displayOptions.showEggs}
                      onChange={e => setDisplayOptions(prev => ({ ...prev, showEggs: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <span className="text-yellow-400">🥚 Eggs</span>
                  </label>
                </div>
              </div>

              {/* Species Class Filtering */}
              <div className="space-y-1">
                <div className="text-xs text-white/70 mb-1">Species Classes:</div>
                <div className="grid grid-cols-2 gap-1 text-xs">
                  {(["fish", "mammal", "bird", "reptile", "amphibian", "insect"] as SpeciesClass[]).map(speciesClass => (
                    <label key={speciesClass} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={displayOptions.visibleSpeciesClasses.has(speciesClass)}
                        onChange={e => {
                          const newSet = new Set(displayOptions.visibleSpeciesClasses);
                          if (e.target.checked) {
                            newSet.add(speciesClass);
                          } else {
                            newSet.delete(speciesClass);
                          }
                          setDisplayOptions(prev => ({ ...prev, visibleSpeciesClasses: newSet }));
                        }}
                        className="w-3 h-3"
                      />
                      <span>{CLASS_ICONS[speciesClass]} {speciesClass.charAt(0).toUpperCase() + speciesClass.slice(1)}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Enhanced Visual Features */}
              <div className="space-y-1">
                <div className="text-xs text-white/70 mb-1">Enhanced Visuals:</div>
                <div className="grid grid-cols-1 gap-1 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={displayOptions.showShapes}
                      onChange={e => setDisplayOptions(prev => ({ ...prev, showShapes: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <span>🔺 Behavior Shapes</span>
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={displayOptions.showTrails}
                      onChange={e => setDisplayOptions(prev => ({ ...prev, showTrails: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <span>🌊 Movement Trails</span>
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={displayOptions.showSizeScaling}
                      onChange={e => setDisplayOptions(prev => ({ ...prev, showSizeScaling: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <span>📏 Size Scaling</span>
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={displayOptions.showLifePulse}
                      onChange={e => setDisplayOptions(prev => ({ ...prev, showLifePulse: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <span>💓 Life Pulse</span>
                  </label>
                </div>
                
                {/* Trail Length Slider */}
                {displayOptions.showTrails && (
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs">Trail Length</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min="1"
                        max="8"
                        step="1"
                        value={displayOptions.trailLength}
                        onChange={e => setDisplayOptions(prev => ({ ...prev, trailLength: parseInt(e.target.value) }))}
                        className="w-12"
                      />
                      <span className="text-xs w-4 tabular-nums">{displayOptions.trailLength}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Visual Effects */}
              <div className="space-y-1">
                <div className="text-xs text-white/70 mb-1">Effects:</div>
                <div className="grid grid-cols-1 gap-1 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={displayOptions.showMutationGlow}
                      onChange={e => setDisplayOptions(prev => ({ ...prev, showMutationGlow: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <span>✨ Mutation Glow</span>
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={displayOptions.showReproductionStates}
                      onChange={e => setDisplayOptions(prev => ({ ...prev, showReproductionStates: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <span>💝 Reproduction</span>
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={displayOptions.showEnergyWarnings}
                      onChange={e => setDisplayOptions(prev => ({ ...prev, showEnergyWarnings: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <span>⚡ Energy Warnings</span>
                  </label>
                </div>
              </div>

              {/* Multi-Scale Rendering & Performance */}
              <div className="space-y-1">
                <div className="text-xs text-white/70 mb-1">LOD & Performance:</div>
                <div className="space-y-1">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={displayOptions.adaptiveDetailLevel}
                      onChange={e => setDisplayOptions(prev => ({ ...prev, adaptiveDetailLevel: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <span className="text-xs">🎯 Adaptive LOD</span>
                  </label>
                  
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <span className="text-xs text-white/70 w-16">Detail:</span>
                      <select
                        value={displayOptions.forceDetailLevel}
                        onChange={e => setDisplayOptions(prev => ({ ...prev, forceDetailLevel: e.target.value as "auto" | "high" | "medium" | "low" }))}
                        className="text-xs bg-white/10 border border-white/20 rounded px-1 py-0.5 flex-1"
                        disabled={!displayOptions.adaptiveDetailLevel}
                      >
                        <option value="auto">Auto</option>
                        <option value="high">High</option>
                        <option value="medium">Medium</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                    
                    <div className="text-xs text-white/50 pl-2">
                      Current: {camera.zoom >= displayOptions.zoomThresholds.maxDetail ? "High" : 
                              camera.zoom >= displayOptions.zoomThresholds.mediumDetail ? "Medium" :
                              camera.zoom >= displayOptions.zoomThresholds.lowDetail ? "Low" : "Clustering"}
                    </div>
                  </div>
                  
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={displayOptions.enableClustering}
                      onChange={e => setDisplayOptions(prev => ({ ...prev, enableClustering: e.target.checked }))}
                      className="w-3 h-3"
                    />
                    <span className="text-xs">🔢 Entity Clustering</span>
                  </label>
                  
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-white/70 w-16">Max Ents:</span>
                    <input
                      type="number"
                      min="0"
                      max="120000"
                      step="1000"
                      value={displayOptions.maxVisibleEntities}
                      onChange={e => setDisplayOptions(prev => ({ ...prev, maxVisibleEntities: parseInt(e.target.value) || 0 }))}
                      className="text-xs bg-white/10 border border-white/20 rounded px-1 py-0.5 w-16"
                    />
                    <span className="text-xs text-white/50">{displayOptions.maxVisibleEntities === 0 ? "∞" : displayOptions.maxVisibleEntities.toLocaleString()}</span>
                  </div>
                </div>
              </div>

              {/* Quick Presets */}
              <div className="space-y-1">
                <div className="text-xs text-white/70 mb-1">Quick Presets:</div>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    onClick={() => setDisplayOptions(prev => ({
                      ...prev,
                      biomeDisplayMode: "subtle",
                      biomeIntensity: 1.0,
                      viewMode: "standard",
                      showPlants: true,
                      showAnimals: true,
                      showEggs: true,
                      visibleSpeciesClasses: new Set(["fish", "mammal", "bird", "reptile", "amphibian", "insect"])
                    }))}
                    className="px-2 py-1 bg-blue-600/30 hover:bg-blue-600/50 border border-blue-400/30 rounded text-xs transition-colors"
                  >
                    Overview
                  </button>
                  <button
                    onClick={() => setDisplayOptions(prev => ({
                      ...prev,
                      biomeDisplayMode: "pure_biome",
                      biomeIntensity: 1.5,
                      showPlants: false,
                      showAnimals: false,
                      showEggs: false
                    }))}
                    className="px-2 py-1 bg-green-600/30 hover:bg-green-600/50 border border-green-400/30 rounded text-xs transition-colors"
                  >
                    Biomes
                  </button>
                  <button
                    onClick={() => setDisplayOptions(prev => ({
                      ...prev,
                      viewMode: "energy",
                      biomeDisplayMode: "subtle",
                      biomeIntensity: 0.3,
                      showEnergyWarnings: true
                    }))}
                    className="px-2 py-1 bg-yellow-600/30 hover:bg-yellow-600/50 border border-yellow-400/30 rounded text-xs transition-colors"
                  >
                    Energy
                  </button>
                  <button
                    onClick={() => setDisplayOptions(prev => ({
                      ...prev,
                      viewMode: "health",
                      biomeDisplayMode: "subtle", 
                      biomeIntensity: 0.5,
                      showStressIndicators: true
                    }))}
                    className="px-2 py-1 bg-red-600/30 hover:bg-red-600/50 border border-red-400/30 rounded text-xs transition-colors"
                  >
                    Health
                  </button>
                </div>
              </div>

              {/* Advanced Performance Intelligence */}
              <div className="space-y-1">
                <div className="text-xs text-white/70 mb-1">Performance Intelligence:</div>
                
                {/* Performance Health Score */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs">Health:</span>
                  <div className="flex items-center gap-2">
                    <div className={`h-2 w-16 rounded-full border ${
                      performanceMetrics.healthScore >= 80 ? 'border-green-400/30 bg-green-400/20' :
                      performanceMetrics.healthScore >= 60 ? 'border-yellow-400/30 bg-yellow-400/20' :
                      'border-red-400/30 bg-red-400/20'
                    }`}>
                      <div 
                        className={`h-full rounded-full transition-all duration-300 ${
                          performanceMetrics.healthScore >= 80 ? 'bg-green-400' :
                          performanceMetrics.healthScore >= 60 ? 'bg-yellow-400' :
                          'bg-red-400'
                        }`}
                        style={{ width: `${performanceMetrics.healthScore}%` }}
                      />
                    </div>
                    <span className={`tabular-nums text-xs ${
                      performanceMetrics.healthScore >= 80 ? 'text-green-400' :
                      performanceMetrics.healthScore >= 60 ? 'text-yellow-400' :
                      'text-red-400'
                    }`}>
                      {Math.round(performanceMetrics.healthScore)}%
                    </span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-1 text-xs">
                  <div className="flex justify-between">
                    <span>FPS:</span>
                    <span className={`tabular-nums ${fps >= 50 ? 'text-green-400' : fps >= 30 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {fps}/{Math.round(performanceMetrics.averageFps)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Frame:</span>
                    <span className={`tabular-nums ${renderTime <= 16.67 ? 'text-green-400' : renderTime <= 25 ? 'text-yellow-400' : 'text-red-400'}`}>
                      {renderTime.toFixed(1)}ms
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Entities:</span>
                    <span className="tabular-nums text-white/70">{counts.total.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Zoom/LOD:</span>
                    <span className="tabular-nums text-white/70">{camera.zoom.toFixed(1)}x / {
                      camera.zoom >= displayOptions.zoomThresholds.maxDetail ? "High" :
                      camera.zoom >= displayOptions.zoomThresholds.mediumDetail ? "Med" :
                      camera.zoom >= displayOptions.zoomThresholds.lowDetail ? "Low" : "Clust"
                    }</span>
                  </div>
                </div>
                
                {/* Intelligent Performance Suggestions */}
                {performanceMetrics.suggestions.length > 0 && (
                  <div className={`text-xs border rounded p-2 mt-2 ${
                    performanceMetrics.healthScore >= 80 ? 'bg-blue-900/20 border-blue-400/20' :
                    performanceMetrics.healthScore >= 60 ? 'bg-yellow-900/20 border-yellow-400/20' :
                    'bg-red-900/20 border-red-400/20'
                  }`}>
                    <div className={`mb-1 font-medium ${
                      performanceMetrics.healthScore >= 80 ? 'text-blue-300' :
                      performanceMetrics.healthScore >= 60 ? 'text-yellow-300' :
                      'text-red-300'
                    }`}>
                      {performanceMetrics.healthScore >= 80 ? 'Quality Boost:' :
                       performanceMetrics.healthScore >= 60 ? 'Optimize:' :
                       'Fix Performance:'}
                    </div>
                    <ul className={`space-y-0.5 ${
                      performanceMetrics.healthScore >= 80 ? 'text-blue-200/80' :
                      performanceMetrics.healthScore >= 60 ? 'text-yellow-200/80' :
                      'text-red-200/80'
                    }`}>
                      {performanceMetrics.suggestions.slice(0, 3).map((suggestion, i) => (
                        <li key={i}>• {suggestion}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Center: Canvas viewport */}
        <div 
          ref={viewportRef}
          onPointerMove={handlePointerMove}
          onPointerDown={handlePointerDown}
          onPointerUp={endPointerDrag}
          onPointerCancel={endPointerDrag}
          onPointerLeave={endPointerDrag}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          className={`viewport-container col-span-6 xl:col-span-8 min-h-0 h-full relative rounded-2xl border border-white/10 bg-black/20 overflow-hidden ${
            placingMode ? 'cursor-crosshair' : isDragging ? 'cursor-grabbing' : 'cursor-grab'
          }`}
          style={{
            // Disable browser zoom and selection
            userSelect: 'none',
            WebkitUserSelect: 'none',
            msUserSelect: 'none',
            // Disable touch callouts and highlights
            WebkitTouchCallout: 'none',
            WebkitTapHighlightColor: 'transparent',
            // Disable scroll chaining and overscroll
            overscrollBehavior: 'none',
            // Additional WebKit properties via any cast
            ...({ WebkitUserDrag: 'none' } as CSSProperties),
            // Disable text selection
            MozUserSelect: 'none',
            // Ensure proper touch handling
            touchAction: 'none',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              imageRendering: "pixelated",
              display: "block",
              width: "100%",
              height: "100%",
              cursor: placingMode ? "crosshair" : isDragging ? "grabbing" : "grab",
            }}
          />

          <div className="absolute top-2 left-2 z-10 rounded-xl border border-white/20 bg-black/45 backdrop-blur-sm p-2">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-[10px] uppercase tracking-wide text-white/75">Navigator</div>
              <button
                className="text-[10px] px-2 py-0.5 rounded border border-white/20 text-white/80 hover:bg-white/10"
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMinimapCollapsed(v => !v);
                }}
                title={minimapCollapsed ? "Expand minimap" : "Collapse minimap"}
              >
                {minimapCollapsed ? "Show" : "Hide"}
              </button>
            </div>
            {!minimapCollapsed && (
              <canvas
                ref={minimapRef}
                onPointerDown={handleMinimapPointerDown}
                onPointerMove={handleMinimapPointerMove}
                onPointerUp={handleMinimapPointerUp}
                onPointerCancel={handleMinimapPointerUp}
                onPointerLeave={handleMinimapPointerUp}
                className="rounded-md border border-white/10 block cursor-pointer"
              />
            )}
          </div>
          
          {/* Hover inspector */}
          {hover && hoverInfo && (
            <div 
              className="absolute top-2 right-2 max-w-sm atlas-panel rounded-2xl p-3 shadow-xl text-sm z-10"
              style={{
                background: "linear-gradient(165deg, rgba(16,42,57,0.85), rgba(8,18,29,0.82))",
                backdropFilter: "blur(12px)"
              }}
            >
              <div className="font-semibold mb-1 flex items-center gap-2">
                <span className="text-base">
                  {hoverInfo.genome.lifeType === "plant" ? "🌱" : CLASS_ICONS[hoverInfo.genome.speciesClass]}
                </span>
                {hoverInfo.genome.lifeType === "plant" ? "PLANT" : "ANIMAL"} — Species {hoverInfo.genome.speciesId}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="text-white/70">Position:</div>
                <div className="tabular-nums">({hover.x}, {hover.y})</div>
                <div className="text-white/70">Class:</div>
                <div className="capitalize">{hoverInfo.genome.lifeType === "plant" ? "plant" : hoverInfo.genome.speciesClass}</div>
                <div className="text-white/70">Age:</div>
                <div className="tabular-nums">{hoverInfo.age} / {hoverInfo.genome.maxAge}</div>
                <div className="text-white/70">Energy:</div>
                <div className="tabular-nums">{(hoverInfo.energy * 100).toFixed(1)}%</div>
                <div className="text-white/70">Hydration:</div>
                <div className="tabular-nums">{(hoverInfo.hydration * 100).toFixed(1)}%</div>
                <div className="text-white/70">Diet:</div>
                <div>{typeof hoverInfo.genome.diet === 'number' ? DIET_NAMES[hoverInfo.genome.diet] : hoverInfo.genome.diet}</div>
                <div className="text-white/70">Activity:</div>
                <div>{typeof hoverInfo.genome.activity === 'number' ? ACTIVITY_NAMES[hoverInfo.genome.activity] : hoverInfo.genome.activity}</div>
                <div className="text-white/70">Repro State:</div>
                <div className="capitalize">{hoverInfo.reproductionState}</div>
                {hoverInfo.reproductionState !== "ready" && (
                  <>
                    <div className="text-white/70">Timer:</div>
                    <div className="tabular-nums">{hoverInfo.reproductionTimer} ticks</div>
                  </>
                )}
                {hoverInfo.reproductionState === "ready" && (
                  <>
                    <div className="text-white/70">Readiness:</div>
                    <div className="tabular-nums">{(hoverInfo.breedingReadiness * 100).toFixed(1)}%</div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right sidebar: Time & Mutations */}
        <div className="col-span-3 xl:col-span-2 min-h-0 flex flex-col gap-3 overflow-y-auto pr-1">
          {/* Time Display Clock */}
          <div className={panel}>
            <div className="font-semibold mb-2">World Time</div>
            <div className="flex items-center justify-between">
              <div className="text-sm">
                <div className="tabular-nums font-medium">
                  Day {Math.floor(tick / 2400) + 1}
                </div>
                <div className="text-xs text-white/70">
                  Tick {(tick % 2400).toString().padStart(4, '0')} / 2400
                </div>
              </div>
              <div className="relative">
                {/* Circular Day/Night Indicator */}
                <div className="w-12 h-12 rounded-full border-2 border-white/20 relative overflow-hidden">
                  {/* Day background */}
                  <div className="absolute inset-0 bg-gradient-to-b from-blue-400/30 to-green-400/30"></div>
                  {/* Night overlay */}
                  <div 
                    className="absolute inset-0 bg-gradient-to-b from-indigo-900/80 to-black/80 transition-transform duration-1000"
                    style={{
                      transform: `translateY(${night ? '0%' : '100%'})`
                    }}
                  ></div>
                  {/* Sun/Moon indicator */}
                  <div 
                    className="absolute w-3 h-3 rounded-full"
                    style={{
                      backgroundColor: night ? '#fbbf24' : '#fef08a',
                      boxShadow: night ? '0 0 6px #fbbf24' : '0 0 8px #fef08a',
                      left: `${dialOrbX}px`,
                      top: `${dialOrbY}px`,
                      transform: 'translate(-50%, -50%)'
                    }}
                  ></div>
                  {/* Center dot */}
                  <div className="absolute w-1 h-1 bg-white/40 rounded-full" style={{
                    left: '50%',
                    top: '50%',
                    transform: 'translate(-50%, -50%)'
                  }}></div>
                </div>
              </div>
            </div>
            <div className="mt-2 text-center">
              <span className={`text-xs px-2 py-1 rounded-full ${
                night 
                  ? 'bg-indigo-900/40 text-indigo-200 border border-indigo-400/30' 
                  : 'bg-yellow-900/40 text-yellow-200 border border-yellow-400/30'
              }`}>
                {night ? '🌙 Night' : '☀️ Day'}
              </span>
            </div>
          </div>

          {/* Species Statistics */}
          <div className={panel}>
            <div className="font-semibold mb-2">Top Species</div>
            <div className="grid grid-cols-2 gap-1 mb-2 text-xs">
              <select
                value={speciesCategory}
                onChange={e => setSpeciesCategory(e.target.value as SpeciesCategory)}
                className="bg-white/10 border border-white/10 rounded px-2 py-1"
              >
                <option value="all">All</option>
                <option value="animals">Animals</option>
                <option value="plants">Plants</option>
                <option value="mammal">Mammals</option>
                <option value="bird">Birds</option>
                <option value="reptile">Reptiles</option>
                <option value="amphibian">Amphibians</option>
                <option value="fish">Fish</option>
                <option value="insect">Insects</option>
                <option value="herbivore">Herbivores</option>
                <option value="carnivore">Carnivores</option>
                <option value="omnivore">Omnivores</option>
              </select>
              <input
                value={speciesSearch}
                onChange={e => setSpeciesSearch(e.target.value)}
                placeholder="Search #id"
                className="bg-white/10 border border-white/10 rounded px-2 py-1"
              />
            </div>
            <div className="space-y-1 text-xs max-h-32 overflow-auto">
              {filteredSpeciesStats.slice(0, 8).map((species) => {
                const isPlantSpecies = species.dominantLifeType === "plant";
                return (
                  <div
                    key={species.speciesId}
                    className="flex items-center justify-between p-1 bg-white/5 rounded cursor-help hover:bg-white/10 transition-colors"
                    onMouseEnter={() => setHoveredSpeciesDetails(Sim.getSpeciesDetails(species.speciesId, species.dominantLifeType ?? undefined))}
                    onMouseLeave={() => setHoveredSpeciesDetails(null)}
                  >
                    <div className="flex items-center gap-1">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: `hsl(${(species.speciesId * 37) % 360}, 65%, 50%)` }}
                      ></div>
                    <span className="tabular-nums">#{species.speciesId}</span>
                    <span className="text-[10px] text-white/55 capitalize">
                        {isPlantSpecies ? "Plant" : (species.dominantClass ?? "Unknown")}
                    </span>
                  </div>
                    <div className="tabular-nums text-white/70">{species.population}</div>
                  </div>
                );
              })}
              {filteredSpeciesStats.length === 0 && (
                <div className="text-white/50 text-center py-2">No species data yet</div>
              )}
            </div>
            {hoveredSpeciesDetails && (
              <div className="mt-2 p-2 rounded-xl border border-white/10 bg-black/20 text-xs space-y-1">
                <div className="font-medium text-white/90">Species #{hoveredSpeciesDetails.speciesId}</div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                  <div className="text-white/65">Class</div>
                  <div className="capitalize">{hoveredSpeciesIsPlant ? "plant" : (hoveredSpeciesDetails.dominantClass ?? "unknown")}</div>
                  <div className="text-white/65">Diet</div>
                  <div className="capitalize">{hoveredSpeciesDetails.dominantDiet ?? "unknown"}</div>
                  <div className="text-white/65">Activity</div>
                  <div className="capitalize">{hoveredSpeciesDetails.dominantActivity ?? "unknown"}</div>
                  <div className="text-white/65">Biome</div>
                  <div className="capitalize">{hoveredSpeciesDetails.dominantBiome ?? "unknown"}</div>
                  <div className="text-white/65">Energy</div>
                  <div>{(hoveredSpeciesDetails.avgEnergy * 100).toFixed(0)}%</div>
                  <div className="text-white/65">Hydration</div>
                  <div>{(hoveredSpeciesDetails.avgHydration * 100).toFixed(0)}%</div>
                  <div className="text-white/65">Avg Age</div>
                  <div className="tabular-nums">{Math.round(hoveredSpeciesDetails.avgAge)}</div>
                </div>
                <div className="pt-1 border-t border-white/10 text-white/70">
                  Death mix: S {hoveredSpeciesDetails.mortalityCauses.starvation}, D {hoveredSpeciesDetails.mortalityCauses.dehydration}, P {hoveredSpeciesDetails.mortalityCauses.predation}, F {hoveredSpeciesDetails.mortalityCauses.fire}
                </div>
              </div>
            )}
          </div>

          {/* World Information */}
          <div className={panel}>
            <div className="font-semibold mb-2">World</div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-blue-400">Water:</span>
                <span className="tabular-nums text-white/70">{worldStats.waterPercentage.toFixed(1)}%</span>
              </div>
              <div className="space-y-0.5">
                <div className="flex justify-between">
                  <span className="text-green-400">Grassland:</span>
                  <span className="tabular-nums text-white/70">{worldStats.biomePercentages.grassland.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-emerald-400">Forest:</span>
                  <span className="tabular-nums text-white/70">{worldStats.biomePercentages.forest.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-orange-400">Desert:</span>
                  <span className="tabular-nums text-white/70">{worldStats.biomePercentages.desert.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-cyan-400">Tundra:</span>
                  <span className="tabular-nums text-white/70">{worldStats.biomePercentages.tundra.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-teal-400">Wetlands:</span>
                  <span className="tabular-nums text-white/70">{worldStats.biomePercentages.wetlands.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-500">Ocean:</span>
                  <span className="tabular-nums text-white/70">{worldStats.biomePercentages.ocean.toFixed(1)}%</span>
                </div>
              </div>
            </div>
          </div>

          <div className={panel}>
            <div className="font-semibold mb-2">Weather</div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-sky-300">Rain Coverage:</span>
                <span className="tabular-nums text-white/80">{(weatherState.rainCoverage * 100).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-orange-300">Active Fires:</span>
                <span className="tabular-nums text-white/80">{weatherState.activeFires}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-yellow-200">Last Lightning:</span>
                <span className="tabular-nums text-white/80">
                  {weatherState.lastLightningTick < 0 ? "None" : `T${weatherState.lastLightningTick}`}
                </span>
              </div>
            </div>
          </div>

          <div className={panel}>
            <div className="font-semibold mb-2">World Pulse</div>
            <div className="text-xs text-white/80 leading-relaxed">{worldPulse}</div>
            <div className="mt-2 text-[11px] text-white/60">
              Read mode: {camera.zoom < 7 ? "Bioregion overview" : camera.zoom < 16 ? "Population field" : "Individual behavior"}
            </div>
          </div>

          <div className={panel}>
            <div className="font-semibold mb-2">Population Diagnostics</div>
            <div className="space-y-2">
              {renderDaySummary("Current", populationDiagnostics.currentDay)}
              {populationDiagnostics.lastDay
                ? renderDaySummary("Previous", populationDiagnostics.lastDay)
                : (
                  <div className="text-xs text-white/60 rounded-xl border border-white/10 bg-black/20 p-2">
                    Previous day summary will appear after day 1 completes.
                  </div>
                )}
            </div>
          </div>

          <div className={`${panel} min-h-[260px] max-h-[42vh] overflow-hidden`}>
            <div className="font-semibold mb-2 flex items-center justify-between">
              <span>Mutations</span>
              <span className="text-xs text-white/60 tabular-nums">{mutationLog.length}</span>
            </div>
            <div className="text-xs text-white/70 mb-2">
              Recent species evolution events
            </div>
            <div className="h-[220px] overflow-auto space-y-2 pr-1">
              {mutationLog.length === 0 ? (
                <div className="text-sm text-white/60 text-center py-8">
                  No mutations yet
                </div>
              ) : (
                mutationLog.slice(0, 80).map((mutation, i) => (
                  <div 
                    key={i} 
                    className="border border-white/10 rounded-xl p-2 text-xs bg-black/20 backdrop-blur-xs"
                  >
                    <div className="flex justify-between items-center mb-1">
                      <div className="text-purple-400 font-medium">
                        Species #{mutation.newSpeciesId}
                      </div>
                      <div className="text-white/50 text-xs">
                        T{mutation.tick}
                      </div>
                    </div>
                    {(mutation.entityId !== undefined || mutation.lifeType) && (
                      <div className="text-white/70 mb-1">
                        {mutation.entityId !== undefined ? `Entity #${mutation.entityId}` : "Entity"}
                        {mutation.lifeType ? ` · ${mutation.lifeType}` : ""}
                      </div>
                    )}
                    <div className="text-white/70 mb-1">
                      From #{mutation.parentSpeciesId}
                    </div>
                    {mutation.ecologicalContext && (
                      <div className="text-emerald-400 text-xs mb-1 italic">
                        {mutation.ecologicalContext}
                      </div>
                    )}
                    {Object.entries(mutation.deltas).length > 0 && (
                      <div className="text-white/60">
                        {Object.entries(mutation.deltas).slice(0, 3).map(([key, value]) => (
                          <div key={key} className="truncate">
                            {key}: {typeof value === 'number' ? 
                              (value > 0 ? '+' : '') + value.toFixed(2) : 
                              value
                            }
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer tip */}
      <div className="p-3 text-xs text-white/70" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        Tip: Planetary view for ecosystem patterns, local view for behaviors. Drag to pan, Ctrl/Cmd+Wheel to zoom at cursor.
      </div>
    </div>
  );
}
