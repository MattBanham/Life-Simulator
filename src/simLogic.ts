import type {
  ActivityCycle,
  Biome,
  Diet,
  DisplayOptions,
  BiomeDisplayMode,
  BehaviorTuning,
  DailyPopulationStats,
  EntitySnapshot,
  EggData,
  EggGenes,
  Genome,
  MutationEvent,
  PopulationDiagnostics,
  ReproductionState,
  SpeciesDetails,
  SpeciesClass,
  SpeciesStats,
} from "./types";

/** Grid size */
export let W = 500;
export let H = 500;
export const MAX_ENTITIES = 120_000;

/** Time model */
const DAY_LENGTH = 2400; // ticks per day
export const isNight = (t: number) => {
  const phase = t % DAY_LENGTH;
  return phase >= 1600;
};

/** Energy/Hydration constants */
const TICK_ENERGY_DECAY = 0.00058;
const PLANT_PHOTOSYNTHESIS_RATE = 0.0054;
const MOVE_ENERGY_COST = 0.001;
const CHILD_ENERGY_START = 0.48;
const PLANT_REPRO_MIN_ENERGY = 0.66;
const PLANT_REPRO_MIN_HYDRATION = 0.45;
const PLANT_REPRO_CROWD_LIMIT = 7;
const PLANT_REPRO_BASE_CHANCE = 0.002;
const PLANT_REPRO_OCEAN_BASE_CHANCE = 0.00035;
const PLANT_REPRO_MIN_COOLDOWN = 650;
const PLANT_DAILY_BIRTH_RATE_CAP = 0.3; // max births/day as fraction of current plants
const PLANT_DAILY_BIRTH_MIN_CAP = 2200;
const PLANT_DIGESTION_EFFICIENCY_HERB = 0.9;
const PLANT_DIGESTION_EFFICIENCY_OMNI = 0.76;
const MEAT_DIGESTION_EFFICIENCY_CARN = 1.18;
const MEAT_DIGESTION_EFFICIENCY_OMNI = 0.98;
const SUPPLEMENTAL_PLANT_CARNIVORY_GAIN = 0.065;
const SUPPLEMENTAL_PLANT_TRAP_CHANCE = 0.13;
const SUPPLEMENTAL_PLANT_TRAP_COOLDOWN = 16;

// Temporary post-diet-shift adaptation penalties.
const DIET_SHIFT_PENALTY_TICKS = 1800;
const DIET_SHIFT_EXTRA_METABOLISM = 1.13;
const DIET_SHIFT_EXTRA_HYDRATION = 1.09;
const DIET_SHIFT_FERTILITY_FACTOR = 0.62;

/** Vision/size */
const VISION_TILES_MAX = 8;
const SIZE_BONUS_FACTOR = 0.5;

/** Hydration & water */
const BASE_HYDRATION_DECAY = 0.00034; // per tick baseline
const DRINK_RATE = 0.03; // per tick when on water
const RAIN_HYDRATION_GAIN = 0.0024;
const RAIN_PLANT_GROWTH_BONUS = 0.00045;
const MOISTURE_REHYDRATION_GAIN = 0.00035;
const LIGHTNING_STRIKE_CHANCE = 0.00035;

/** Biomes: encoded 0..5 */
const BIOMES: Biome[] = ["grassland", "forest", "desert", "tundra", "wetlands", "ocean"];
const BIOME_PROPS = {
  grassland: { foodRegen: 1.0, hydrationFactor: 1.0, moveCost: 1.0, temp: 0.6, tempRange: 0.15 },
  forest: { foodRegen: 1.1, hydrationFactor: 0.9, moveCost: 1.1, temp: 0.55, tempRange: 0.12 },
  desert: { foodRegen: 0.6, hydrationFactor: 1.6, moveCost: 1.0, temp: 0.9, tempRange: 0.25 },
  tundra: { foodRegen: 0.7, hydrationFactor: 1.2, moveCost: 1.1, temp: 0.2, tempRange: 0.18 },
  wetlands: { foodRegen: 1.2, hydrationFactor: 0.5, moveCost: 1.2, temp: 0.65, tempRange: 0.1 },
  ocean: { foodRegen: 0.8, hydrationFactor: 0.3, moveCost: 0.8, temp: 0.5, tempRange: 0.08 },
} as const;

/** Species class props */
const CLASS_PROPS: Record<
  SpeciesClass,
  {
    moveSpeedBonus: number; // factor on speed
    visionBonus: number; // additive 0..1
    hydrationUse: number; // factor on decay
    mustStayOnWater: boolean;
    canUseWater: boolean; // can drink from water tiles
  }
> = {
  fish: { moveSpeedBonus: 1.0, visionBonus: 0.0, hydrationUse: 0.4, mustStayOnWater: true, canUseWater: true },
  mammal: { moveSpeedBonus: 1.0, visionBonus: 0.1, hydrationUse: 0.88, mustStayOnWater: false, canUseWater: true },
  bird: { moveSpeedBonus: 1.4, visionBonus: 0.2, hydrationUse: 0.95, mustStayOnWater: false, canUseWater: true },
  reptile: { moveSpeedBonus: 0.9, visionBonus: 0.0, hydrationUse: 0.62, mustStayOnWater: false, canUseWater: true },
  amphibian: { moveSpeedBonus: 0.9, visionBonus: 0.0, hydrationUse: 0.54, mustStayOnWater: false, canUseWater: true },
  insect: { moveSpeedBonus: 1.2, visionBonus: 0.0, hydrationUse: 0.62, mustStayOnWater: false, canUseWater: true },
};

/** Utils */
const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const idx = (x: number, y: number) => y * W + x;
const normalizeDiet = (lifeType: "plant" | "animal", diet: Diet): Diet =>
  lifeType === "plant" ? "photosynthesis" : (diet === "photosynthesis" ? "herbivore" : diet);
const normalizeSpeciesClass = (lifeType: "plant" | "animal", speciesClass: SpeciesClass): SpeciesClass =>
  lifeType === "plant" ? "insect" : speciesClass;

/** Calculate temperature stress factor (0-1, where 1 = high stress) */
function getTemperatureStress(entityTemp: number, biomeTemp: number, biomeRange: number): number {
  const distance = Math.abs(entityTemp - biomeTemp);
  const tolerance = biomeRange;
  if (distance <= tolerance) return 0; // within comfortable range
  return Math.min(1, (distance - tolerance) / (1 - tolerance)); // linear stress beyond tolerance
}
let RNG_S = 1234567;
const rng = () => {
  RNG_S = (RNG_S * 1664525 + 1013904223) >>> 0;
  return RNG_S / 0xffffffff;
};

const clampU8 = (v: number) => Math.max(0, Math.min(ALLELE_MAX, Math.round(v)));
const encodeAllele01 = (v: number) => clampU8(clamp01(v) * ALLELE_MAX);
const decodeAllele01 = (a: number) => a / ALLELE_MAX;
const decodeTrait = (a1: number, a2: number) => (decodeAllele01(a1) + decodeAllele01(a2)) * 0.5;
const decodeAgeTrait = (a1: number, a2: number, min: number, max: number) =>
  Math.round(min + decodeTrait(a1, a2) * (max - min));
const mutateAllele = (a: number, rate: number, scale = 18) =>
  rng() < rate ? clampU8(a + (rng() - 0.5) * scale * 2) : a;
const pickAllele = (a1: number, a2: number) => (rng() < 0.5 ? a1 : a2);

/** World arrays */
let tick = 0;
let occ: Int32Array; // index of entity or -1
let count = 0;

let idA: Int32Array;
let xA: Int16Array;
let yA: Int16Array;
let energyA: Float32Array;
let hydrationA: Float32Array;
let ageA: Int32Array;
let aliveA: Uint8Array;
let adultA: Uint8Array;

// genome
let speciesA: Int16Array;
let lifeTypeA: Uint8Array; // 0 plant, 1 animal
let classA: Uint8Array; // 0..5
let dietA: Uint8Array; // 0 photo 1 herb 2 carn 3 omni
let reproA: Uint8Array; // 0 asex 1 sex
let hostilityA: Float32Array;
let speedA: Float32Array;
let sizeA: Float32Array;
let visionA: Float32Array;
let fertilityA: Float32Array;
let maturityA: Int32Array;
let maxAgeA: Int32Array;
let camoA: Float32Array;
let socialA: Float32Array;
let activityA: Uint8Array; // 0 diur 1 noct 2 cat
let tempTolA: Float32Array;
let prefBiomeA: Uint8Array; // 0..3
let seedSpreadA: Float32Array;
let mutRateA: Float32Array;
let supplementalCarnA: Uint8Array; // plants only

// Behavioral/ecological memory for adaptive diet evolution.
let plantFeedHistoryA: Float32Array;
let preyFeedHistoryA: Float32Array;
let starvationStressA: Float32Array;
let dietShiftPenaltyA: Int32Array;
let plantTrapCooldownA: Int32Array;

// reproduction state
let reproStateA: Uint8Array; // 0=ready, 1=gestating, 2=cooldown, 3=incubating  
let reproTimerA: Int32Array; // ticks until state change
let gestationTimeA: Int32Array; // total gestation period for this entity
let breedingReadinessA: Float32Array; // 0-1 breeding desire
let lastReproTickA: Int32Array; // for cooldown calculation

// trail system for movement visualization
let trailHistoryX: Int16Array[];
let trailHistoryY: Int16Array[];
let trailLength: Uint8Array;

// env maps
let biomeMap: Uint8Array; // 0..3
let waterMap: Uint8Array; // 0/1 water
let waterDistanceMap: Float32Array; // distance to nearest water
let moistureMap: Float32Array; // normalized moisture 0..1
let fireTTLMap: Uint16Array;
let activeFires: number[] = [];
let activeFireCount = 0;
let weatherSeed = 1;
let lastLightningTick = -1;
let lastLightningX = -1;
let lastLightningY = -1;
let lightningFlashUntil = -1;
let rainCoverageNow = 0;

// Diploid genotype storage (two alleles per quantitative trait)
let hostG1A: Uint8Array, hostG2A: Uint8Array;
let speedG1A: Uint8Array, speedG2A: Uint8Array;
let sizeG1A: Uint8Array, sizeG2A: Uint8Array;
let visionG1A: Uint8Array, visionG2A: Uint8Array;
let fertG1A: Uint8Array, fertG2A: Uint8Array;
let camoG1A: Uint8Array, camoG2A: Uint8Array;
let socialG1A: Uint8Array, socialG2A: Uint8Array;
let tempG1A: Uint8Array, tempG2A: Uint8Array;
let seedG1A: Uint8Array, seedG2A: Uint8Array;
let mutG1A: Uint8Array, mutG2A: Uint8Array;
let matG1A: Uint8Array, matG2A: Uint8Array;
let maxAgeG1A: Uint8Array, maxAgeG2A: Uint8Array;

// color caches
const SPECIES_MAX = 2048;
const speciesRGB: [number, number, number][] = new Array(SPECIES_MAX);
const plantRGB: [number, number, number][] = new Array(SPECIES_MAX);
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = (h % 360) / 360;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c);
  };
  return [f(0), f(8), f(4)];
}
const ENERGY_LUT = Array.from({ length: 16 }, (_, i) => 0.6 + (i / 15) * 0.4);
const ALLELE_MAX = 255;
const MATURITY_MIN = 500;
const MATURITY_MAX = 6000;
const MAX_AGE_MIN = 12000;
const MAX_AGE_MAX = 52000;

// counters
let total = 0,
  animals = 0,
  plants = 0;

let currentDayStats: DailyPopulationStats | null = null;
let lastDayStats: DailyPopulationStats | null = null;

// sim rate
let running = true;
let simRate = 15; // ticks/sec (default slower)
let acc = 0;

// mutation tracking
const MUTATION_LOG: MutationEvent[] = [];
const MUT_GLW_TICKS = 600;
let glowUntil: Int32Array; // per-entity tick until glow shows

function pushMutationEvent(evt: MutationEvent) {
  MUTATION_LOG.unshift(evt);
  if (MUTATION_LOG.length > 200) MUTATION_LOG.pop();
}

// Terrain render caching
let biomeLayerCache: Uint8ClampedArray | null = null;
let biomeLayerCacheKey = "";
let biomeLayerCacheTickBucket = -1;

// egg management
const eggs: EggData[] = [];
const MAX_EGGS = 10000;

// species analytics
const speciesStats: Map<number, SpeciesStats> = new Map();
let lastStatsUpdate = 0;
const STATS_UPDATE_INTERVAL = 100; // update every 100 ticks
const speciesStatsKey = (speciesId: number, lifeType: 0 | 1) => (lifeType << 12) | speciesId;

function getBiomeCacheKey(opts: DisplayOptions) {
  return [
    opts.biomeDisplayMode,
    opts.biomeIntensity.toFixed(2),
    opts.showBiomeBorders ? "b1" : "b0",
  ].join("|");
}

const DEFAULT_BEHAVIOR_TUNING: BehaviorTuning = {
  thirstWeight: 1.2,
  hungerWeight: 1.45,
  mateWeight: 1.4,
  fearWeight: 1.0,
  motiveMoveBoostMax: 0.42,
  opportunisticFeedChance: 0.08,
  reproductionReadinessThreshold: 0.3,
  animalMetabolismMultiplier: 0.44,
  plantBiteAmount: 0.72,
  attackEnergyGain: 0.58,
};
let behaviorTuning: BehaviorTuning = { ...DEFAULT_BEHAVIOR_TUNING };

function makeDayStats(day: number, startPopulation: number, startPlants: number, startAnimals: number): DailyPopulationStats {
  return {
    day,
    births: 0,
    birthsPlants: 0,
    birthsAnimals: 0,
    deaths: 0,
    deathsPlants: 0,
    deathsAnimals: 0,
    deathsByCause: {
      starvation: 0,
      dehydration: 0,
      age: 0,
      predation: 0,
      fire: 0,
    },
    startPopulation,
    endPopulation: startPopulation,
    startPlants,
    endPlants: startPlants,
    startAnimals,
    endAnimals: startAnimals,
    netPopulation: 0,
  };
}

function finalizeDayStats(stats: DailyPopulationStats, endPopulation: number, endPlants: number, endAnimals: number): DailyPopulationStats {
  return {
    ...stats,
    endPopulation,
    endPlants,
    endAnimals,
    netPopulation: endPopulation - stats.startPopulation,
  };
}

function resetPopulationDiagnostics() {
  const day = Math.floor(tick / DAY_LENGTH) + 1;
  currentDayStats = makeDayStats(day, total, plants, animals);
  lastDayStats = null;
}

function startNextDayIfNeeded() {
  const day = Math.floor(tick / DAY_LENGTH) + 1;
  if (currentDayStats === null) {
    currentDayStats = makeDayStats(day, total, plants, animals);
    return;
  }
  if (day === currentDayStats.day) return;
  lastDayStats = finalizeDayStats(currentDayStats, total, plants, animals);
  currentDayStats = makeDayStats(day, total, plants, animals);
}

function recordBirth(lifeType: 0 | 1) {
  if (!currentDayStats) return;
  currentDayStats.births++;
  if (lifeType === 1) currentDayStats.birthsAnimals++;
  else currentDayStats.birthsPlants++;
}

function getPopulationDiagnosticsSnapshot(): PopulationDiagnostics {
  const current = currentDayStats !== null
    ? finalizeDayStats(currentDayStats, total, plants, animals)
    : makeDayStats(Math.floor(tick / DAY_LENGTH) + 1, total, plants, animals);
  return {
    currentDay: current,
    lastDay: lastDayStats,
  };
}

function normalizeWorldSize(value: number) {
  return Math.max(120, Math.min(2048, Math.floor(value)));
}

function setWorldSize(width: number, height: number) {
  W = normalizeWorldSize(width);
  H = normalizeWorldSize(height);
}

/** API exposed to component */
export const Sim = {
  init(seed: number, startPlants: number, startAnimals: number, worldWidth: number = W, worldHeight: number = H) {
    setWorldSize(worldWidth, worldHeight);
    RNG_S = (seed >>> 0) || 1;
    weatherSeed = (seed >>> 0) || 1;
    lastLightningTick = -1;
    lastLightningX = -1;
    lastLightningY = -1;
    lightningFlashUntil = -1;
    activeFires = [];
    activeFireCount = 0;
    speciesStats.clear();
    lastStatsUpdate = 0;
    biomeLayerCache = null;
    biomeLayerCacheKey = "";
    biomeLayerCacheTickBucket = -1;
    alloc();
    buildEnv(seed);
    seedWorld(startPlants, startAnimals);
    resetPopulationDiagnostics();
  },
  reseed(seed: number, startPlants: number, startAnimals: number, worldWidth: number = W, worldHeight: number = H) {
    setWorldSize(worldWidth, worldHeight);
    RNG_S = (seed >>> 0) || 1;
    weatherSeed = (seed >>> 0) || 1;
    lastLightningTick = -1;
    lastLightningX = -1;
    lastLightningY = -1;
    lightningFlashUntil = -1;
    activeFires = [];
    activeFireCount = 0;
    tick = 0;
    acc = 0;
    count = 0;
    total = animals = plants = 0;
    MUTATION_LOG.length = 0;
    eggs.length = 0;
    speciesStats.clear();
    lastStatsUpdate = 0;
    activeFireCount = 0;
    biomeLayerCache = null;
    biomeLayerCacheKey = "";
    biomeLayerCacheTickBucket = -1;
    alloc();
    buildEnv(seed);
    seedWorld(startPlants, startAnimals);
    resetPopulationDiagnostics();
  },
  getWorldSize() {
    return { width: W, height: H };
  },
  setRunning(v: boolean) {
    running = v;
  },
  setSpeed(tps: number) {
    simRate = Math.max(0, tps);
  },
  stepTime(dtSec: number) {
    if (!running || simRate <= 0) return false;
    acc += simRate * dtSec;
    let steps = Math.floor(acc);
    if (steps > 0) {
      steps = Math.min(steps, 2000);
      for (let i = 0; i < steps; i++) stepOnce();
      acc -= steps;
      return true;
    }
    return false;
  },
  stepOnce() {
    stepOnce();
  },
  getTick() {
    return tick;
  },
  getCounts() {
    return { total, animals, plants };
  },
  getMutationLog() {
    return MUTATION_LOG;
  },
  getEnvMaps() {
    return { biomeMap, waterMap };
  },
  getEggs() {
    return eggs;
  },
  getSpeciesStats() {
    return Array.from(speciesStats.values()).sort((a, b) => b.population - a.population);
  },
  getSpeciesDetails(speciesId: number, lifeType?: "plant" | "animal"): SpeciesDetails | null {
    const requestedLifeType = lifeType === undefined ? null : (lifeType === "animal" ? 1 : 0);
    const cacheKey = requestedLifeType === null ? null : speciesStatsKey(speciesId, requestedLifeType);
    const cached = cacheKey === null ? null : speciesStats.get(cacheKey);
    if (cached && cached.population > 0) {
      const bestBiome = Object.entries(cached.dominantBiomes).sort((a, b) => b[1] - a[1])[0]?.[0] as Biome | undefined;
      return {
        speciesId,
        population: cached.population,
        dominantLifeType: cached.dominantLifeType,
        dominantClass: cached.dominantClass,
        dominantDiet: cached.dominantDiet,
        dominantActivity: cached.dominantActivity,
        dominantBiome: bestBiome ?? null,
        avgEnergy: cached.avgEnergy,
        avgHydration: cached.avgHydration,
        avgAge: cached.avgAge,
        meanTraits: cached.meanTraits,
        mortalityCauses: cached.mortalityCauses,
      };
    }

    const lifeCounts = new Int32Array(2);
    const classCounts = new Int32Array(6);
    const dietCounts = new Int32Array(4);
    const activityCounts = new Int32Array(3);
    const biomeCounts = new Int32Array(6);
    let pop = 0;
    let sumEnergy = 0;
    let sumHydration = 0;
    let sumAge = 0;

    for (let i = 0; i < count; i++) {
      if (!aliveA[i] || speciesA[i] !== speciesId) continue;
      if (requestedLifeType !== null && lifeTypeA[i] !== requestedLifeType) continue;
      pop++;
      lifeCounts[lifeTypeA[i]]++;
      classCounts[classA[i]]++;
      dietCounts[dietA[i]]++;
      activityCounts[activityA[i]]++;
      biomeCounts[biomeMap[idx(xA[i], yA[i])]]++;
      sumEnergy += energyA[i];
      sumHydration += hydrationA[i];
      sumAge += ageA[i];
    }

    if (pop === 0) return null;

    const argmax = (arr: Int32Array) => {
      let bi = 0;
      for (let i = 1; i < arr.length; i++) {
        if (arr[i] > arr[bi]) bi = i;
      }
      return bi;
    };
    const classList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
    const dietList: ("photosynthesis" | "herbivore" | "carnivore" | "omnivore")[] = ["photosynthesis", "herbivore", "carnivore", "omnivore"];
    const activityList: ("diurnal" | "nocturnal" | "cathemeral")[] = ["diurnal", "nocturnal", "cathemeral"];
    const biomeList: Biome[] = ["grassland", "forest", "desert", "tundra", "wetlands", "ocean"];
    const dominantLifeType = lifeCounts[0] >= lifeCounts[1] ? 0 : 1;

    const stats = cacheKey === null ? null : speciesStats.get(cacheKey);

    return {
      speciesId,
      population: pop,
      dominantLifeType: dominantLifeType === 0 ? "plant" : "animal",
      dominantClass: dominantLifeType === 0 ? null : (classList[argmax(classCounts)] ?? null),
      dominantDiet: dietList[argmax(dietCounts)] ?? null,
      dominantActivity: activityList[argmax(activityCounts)] ?? null,
      dominantBiome: biomeList[argmax(biomeCounts)] ?? null,
      avgEnergy: sumEnergy / pop,
      avgHydration: sumHydration / pop,
      avgAge: sumAge / pop,
      meanTraits: stats?.meanTraits ?? {
        hostility: 0,
        speed: 0,
        size: 0,
        vision: 0,
        fertility: 0,
        camouflage: 0,
        sociality: 0,
        temperatureTolerance: 0,
      },
      mortalityCauses: stats?.mortalityCauses ?? {
        starvation: 0,
        dehydration: 0,
        age: 0,
        predation: 0,
        fire: 0,
      },
    };
  },
  getWorldStats() {
    // Return default stats if maps aren't initialized yet
    if (!biomeMap || !waterMap) {
      return {
        biomePercentages: {
          grassland: 16.7,
          forest: 16.7,
          desert: 16.7,
          tundra: 16.7,
          wetlands: 16.7,
          ocean: 16.5,
        },
        waterPercentage: 0,
      };
    }
    
    const biomes = { grassland: 0, forest: 0, desert: 0, tundra: 0, wetlands: 0, ocean: 0 };
    let waterCount = 0;
    const total = W * H;
    
    for (let i = 0; i < total; i++) {
      const biomeIdx = biomeMap[i];
      if (biomeIdx === 0) biomes.grassland++;
      else if (biomeIdx === 1) biomes.forest++;
      else if (biomeIdx === 2) biomes.desert++;
      else if (biomeIdx === 3) biomes.tundra++;
      else if (biomeIdx === 4) biomes.wetlands++;
      else if (biomeIdx === 5) biomes.ocean++;
      
      if (waterMap[i] === 1) waterCount++;
    }
    
    return {
      biomePercentages: {
        grassland: (biomes.grassland / total) * 100,
        forest: (biomes.forest / total) * 100,
        desert: (biomes.desert / total) * 100,
        tundra: (biomes.tundra / total) * 100,
        wetlands: (biomes.wetlands / total) * 100,
        ocean: (biomes.ocean / total) * 100,
      },
      waterPercentage: (waterCount / total) * 100,
    };
  },
  getPopulationDiagnostics(): PopulationDiagnostics {
    return getPopulationDiagnosticsSnapshot();
  },
  getWeatherState() {
    const rainCells = getRainCells(tick);
    const rainCoverage = Math.min(
      1,
      rainCells.reduce((sum, c) => sum + Math.PI * c.radius * c.radius, 0) / (W * H)
    );
    return {
      rainCoverage,
      activeFires: activeFireCount,
      lastLightningTick,
      lightningFlashActive: tick <= lightningFlashUntil,
    };
  },
  getBehaviorTuning(): BehaviorTuning {
    return { ...behaviorTuning };
  },
  setBehaviorTuning(next: BehaviorTuning) {
    behaviorTuning = {
      ...next,
      thirstWeight: Math.max(0, next.thirstWeight),
      hungerWeight: Math.max(0, next.hungerWeight),
      mateWeight: Math.max(0, next.mateWeight),
      fearWeight: Math.max(0, next.fearWeight),
      motiveMoveBoostMax: Math.max(0, next.motiveMoveBoostMax),
      opportunisticFeedChance: clamp01(next.opportunisticFeedChance),
      reproductionReadinessThreshold: clamp01(next.reproductionReadinessThreshold),
      animalMetabolismMultiplier: Math.max(0.2, next.animalMetabolismMultiplier),
      plantBiteAmount: Math.max(0.05, next.plantBiteAmount),
      attackEnergyGain: Math.max(0.1, next.attackEnergyGain),
    };
  },
  resetBehaviorTuning() {
    behaviorTuning = { ...DEFAULT_BEHAVIOR_TUNING };
  },
  buildFrameBuffer(displayOptions?: DisplayOptions, zoomLevel?: number): Uint8ClampedArray {
    // Default display options for backward compatibility  
    const opts: DisplayOptions = displayOptions || {
      biomeDisplayMode: "subtle",
      biomeIntensity: 1.0,
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
      showShapes: false,
      showTrails: true,
      showSizeScaling: true,
      showLifePulse: false,
      trailLength: 3,
      maxVisibleEntities: 0,
      enableClustering: false,
      
      // Multi-scale rendering and LOD system
      adaptiveDetailLevel: false,
      zoomThresholds: {
        maxDetail: 8,      // zoom >= 8: full detail with all effects
        mediumDetail: 4,   // zoom >= 4: medium detail, some effects disabled
        lowDetail: 2,      // zoom >= 2: basic rendering only
        clustering: 1.5,   // zoom < 1.5: enable entity clustering
      },
      forceDetailLevel: "auto",
    };

    // Apply adaptive LOD system if enabled
    const adaptedOpts = this.applyAdaptiveLOD(opts, zoomLevel || 4);
    
    const buf = new Uint8ClampedArray(W * H * 4);
    
    const cacheKey = getBiomeCacheKey(adaptedOpts);
    const tickBucket = Math.floor(tick / 4); // update terrain animation at 15fps
    const needBiomeRefresh =
      !biomeLayerCache || biomeLayerCacheKey !== cacheKey || biomeLayerCacheTickBucket !== tickBucket;
    if (needBiomeRefresh) {
      biomeLayerCache = new Uint8ClampedArray(W * H * 4);
      this.renderBiomes(biomeLayerCache, adaptedOpts);
      biomeLayerCacheKey = cacheKey;
      biomeLayerCacheTickBucket = tickBucket;
    }

    if (biomeLayerCache) {
      buf.set(biomeLayerCache);
    }

    // Use display options to determine rendering approach
    if (adaptedOpts.biomeDisplayMode === "pure_biome") {
      return buf;
    }

    // Dynamic layers
    this.renderEntities(buf, adaptedOpts);
    
    // Render eggs if enabled
    if (adaptedOpts.showEggs) {
      this.renderEggs(buf);
    }
    
    return buf;
  },

  buildEntityLayerBuffer(displayOptions?: DisplayOptions, zoomLevel?: number): Uint8ClampedArray {
    const opts: DisplayOptions = displayOptions || {
      biomeDisplayMode: "subtle",
      biomeIntensity: 1.0,
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
      adaptiveDetailLevel: false,
      zoomThresholds: {
        maxDetail: 8,
        mediumDetail: 4,
        lowDetail: 2,
        clustering: 1.5,
      },
      forceDetailLevel: "auto",
    };

    const adaptedOpts = this.applyAdaptiveLOD(opts, zoomLevel || 4);
    const buf = new Uint8ClampedArray(W * H * 4);
    this.renderEntities(buf, adaptedOpts);
    if (adaptedOpts.showEggs) {
      this.renderEggs(buf);
    }
    return buf;
  },
  
  // Adaptive Level of Detail (LOD) system for multi-scale rendering excellence
  applyAdaptiveLOD(opts: DisplayOptions, zoomLevel: number): DisplayOptions {
    // If adaptive LOD is disabled or force detail level is set, use original options
    if (!opts.adaptiveDetailLevel) return opts;
    
    // Determine current detail level
    let detailLevel = "high";
    if (opts.forceDetailLevel !== "auto") {
      detailLevel = opts.forceDetailLevel;
    } else {
      const thresholds = opts.zoomThresholds;
      if (zoomLevel >= thresholds.maxDetail) {
        detailLevel = "high";
      } else if (zoomLevel >= thresholds.mediumDetail) {
        detailLevel = "medium";
      } else if (zoomLevel >= thresholds.lowDetail) {
        detailLevel = "low";
      } else {
        detailLevel = "clustering";
      }
    }
    
    // Create adapted options based on detail level
    const adaptedOpts = { ...opts };
    
    switch (detailLevel) {
      case "high":
        // Full detail - use all original settings
        break;
        
      case "medium":
        // Reduce some expensive effects for better performance
        adaptedOpts.showTrails = false; // trails are expensive at medium zoom
        adaptedOpts.showLifePulse = false; // pulse animation disabled
        adaptedOpts.biomeDisplayMode = opts.biomeDisplayMode === "pure_biome" ? "prominent" : opts.biomeDisplayMode;
        // Keep shapes and size scaling but reduce trail complexity
        adaptedOpts.trailLength = Math.min(2, opts.trailLength);
        break;
        
      case "low":
        // Basic rendering only for performance
        adaptedOpts.showTrails = false;
        adaptedOpts.showLifePulse = false;
        adaptedOpts.showShapes = false; // use simple pixels
        adaptedOpts.showSizeScaling = false;
        adaptedOpts.showReproductionStates = false;
        adaptedOpts.showMutationGlow = false;
        adaptedOpts.biomeDisplayMode = "subtle"; // simplest biome rendering
        adaptedOpts.biomeIntensity = Math.min(0.7, opts.biomeIntensity);
        // Increase entity limits for better performance
        adaptedOpts.maxVisibleEntities = Math.max(50000, opts.maxVisibleEntities);
        break;
        
      case "clustering":
        // Ultra performance mode with clustering
        adaptedOpts.enableClustering = true;
        adaptedOpts.showTrails = false;
        adaptedOpts.showLifePulse = false;
        adaptedOpts.showShapes = false;
        adaptedOpts.showSizeScaling = false;
        adaptedOpts.showReproductionStates = false;
        adaptedOpts.showMutationGlow = false;
        adaptedOpts.showStressIndicators = false;
        adaptedOpts.showEnergyWarnings = false;
        adaptedOpts.biomeDisplayMode = "subtle";
        adaptedOpts.biomeIntensity = 0.5;
        adaptedOpts.maxVisibleEntities = Math.max(20000, opts.maxVisibleEntities);
        // Reduce view mode complexity
        if (adaptedOpts.viewMode !== "standard" && adaptedOpts.viewMode !== "energy") {
          adaptedOpts.viewMode = "standard"; // simplest view mode
        }
        break;
    }
    
    return adaptedOpts;
  },
  
  // Helper function to get enhanced biome colors
  getBiomeColors(biomeIndex: number, mode: BiomeDisplayMode) {
    const colors = {
      subtle: [
        { r: 20, g: 40, b: 20 },   // grassland 
        { r: 18, g: 35, b: 18 },   // forest
        { r: 40, g: 30, b: 18 },   // desert
        { r: 25, g: 30, b: 40 },   // tundra
        { r: 30, g: 50, b: 45 },   // wetlands
        { r: 15, g: 35, b: 60 }    // ocean
      ],
      enhanced: [
        { r: 40, g: 80, b: 40 },   // grassland - vibrant green
        { r: 25, g: 60, b: 25 },   // forest - rich emerald
        { r: 120, g: 80, b: 40 },  // desert - sandy orange
        { r: 60, g: 80, b: 120 },  // tundra - icy blue
        { r: 50, g: 90, b: 80 },   // wetlands - blue-green marsh
        { r: 30, g: 60, b: 130 }   // ocean - deep blue
      ],
      prominent: [
        { r: 60, g: 140, b: 60 },  // grassland - bright green
        { r: 35, g: 100, b: 35 },  // forest - deep emerald
        { r: 180, g: 120, b: 60 }, // desert - warm sandy
        { r: 100, g: 130, b: 180 }, // tundra - bright ice blue
        { r: 70, g: 130, b: 120 }, // wetlands - teal marsh
        { r: 40, g: 90, b: 200 }   // ocean - vibrant blue
      ],
      pure_biome: [
        { r: 80, g: 200, b: 80 },  // grassland - pure green
        { r: 50, g: 150, b: 50 },  // forest - pure emerald
        { r: 220, g: 160, b: 80 }, // desert - pure sand
        { r: 150, g: 180, b: 220 }, // tundra - pure ice
        { r: 100, g: 180, b: 150 }, // wetlands - pure teal
        { r: 60, g: 120, b: 255 }  // ocean - pure blue
      ]
    };
    
    const colorSet = colors[mode] || colors.subtle;
    return colorSet[biomeIndex] || colorSet[0]; // fallback to first color
  },
  
  // Helper function to get biome temperature for temperature view mode
  getBiomeTemperature(biomeIndex: number): number {
    // Return temperature values 0-1 (cold to hot)
    const temperatures = [
      0.5, // grassland - moderate
      0.4, // forest - slightly cool 
      0.9, // desert - very hot
      0.1, // tundra - very cold
      0.6, // wetlands - warm and humid
      0.3  // ocean - cool
    ];
    return temperatures[biomeIndex] || 0.5; // default moderate temperature
  },
  
  // Helper function to get colors for biome match view mode
  getBiomeMatchColors(biomeIndex: number, isMatch: boolean) {
    if (isMatch) {
      // Green tint for matching biome
      return { r: 50, g: 200, b: 50 };
    } else {
      // Use biome-specific color with red tint for mismatch
      const biomeColors = [
        { r: 150, g: 80, b: 40 },   // grassland mismatch
        { r: 120, g: 100, b: 40 },  // forest mismatch
        { r: 200, g: 100, b: 40 },  // desert mismatch  
        { r: 120, g: 140, b: 180 }, // tundra mismatch
        { r: 100, g: 150, b: 120 }, // wetlands mismatch
        { r: 80, g: 120, b: 180 }   // ocean mismatch
      ];
      return biomeColors[biomeIndex] || { r: 150, g: 80, b: 40 };
    }
  },
  
  // Helper functions for enhanced rendering
  renderBiomes(buf: Uint8ClampedArray, opts: DisplayOptions) {
    const intensityMultiplier = opts.biomeIntensity;
    const isEnhanced = opts.biomeDisplayMode === "enhanced";
    const isProminent = opts.biomeDisplayMode === "prominent";
    const isPureBiome = opts.biomeDisplayMode === "pure_biome";
    
    // Time-based effects for cinematic rendering
    const time = tick * 0.001; // slow time progression
    const fastTime = tick * 0.01; // faster time for waves
    
    for (let p = 0; p < W * H; p++) {
      const x = p % W;
      const y = Math.floor(p / W);
      const b = biomeMap[p];
      const isWater = waterMap[p] === 1;
      let r = 0, g = 0, bv = 0;
      const a = 255;
      
      if (isWater) {
        // Cinematic animated water with wave effects
        const waveX = Math.sin(x * 0.02 + fastTime) * 0.3;
        const waveY = Math.sin(y * 0.03 + fastTime * 0.7) * 0.2;
        const depth = Math.sin(x * 0.005 + y * 0.007 + time) * 0.4 + 0.6;
        const shimmer = Math.sin(x * 0.1 + y * 0.1 + fastTime * 2) * 0.1 + 0.9;
        
        if (isProminent || isPureBiome) {
          r = Math.floor((40 + waveX * 10) * depth * shimmer);
          g = Math.floor((120 + waveY * 15) * depth * shimmer);
          bv = Math.floor((200 + (waveX + waveY) * 20) * depth * shimmer);
        } else if (isEnhanced) {
          r = Math.floor((30 + waveX * 8) * depth * shimmer);
          g = Math.floor((90 + waveY * 12) * depth * shimmer);
          bv = Math.floor((160 + (waveX + waveY) * 15) * depth * shimmer);
        } else {
          r = Math.floor((20 + waveX * 5) * depth * shimmer);
          g = Math.floor((70 + waveY * 8) * depth * shimmer);
          bv = Math.floor((130 + (waveX + waveY) * 10) * depth * shimmer);
        }
      } else {
        // Cinematic biome rendering with organic textures
        const baseColors = this.getBiomeColors(b, opts.biomeDisplayMode);
        
        // Create organic texture using multiple noise layers
        const noise1 = Math.sin(x * 0.01 + y * 0.013 + time * 0.5) * 0.5 + 0.5;
        const noise2 = Math.sin(x * 0.03 + y * 0.025 + time * 0.3) * 0.3 + 0.5;
        const noise3 = Math.sin(x * 0.07 + y * 0.05 + time * 0.1) * 0.2 + 0.5;
        const organicNoise = (noise1 * 0.6 + noise2 * 0.3 + noise3 * 0.1);
        
        // Biome-specific atmospheric effects
        let atmosphericEffect = 1.0;
        if (b === 2) { // desert - heat shimmer
          atmosphericEffect = Math.sin(x * 0.05 + y * 0.03 + fastTime * 3) * 0.05 + 0.95;
        } else if (b === 1) { // forest - dappled light
          atmosphericEffect = Math.sin(x * 0.08 + y * 0.06 + time) * 0.1 + 0.9;
        } else if (b === 3) { // tundra - ice sparkle
          const sparkle = Math.sin(x * 0.2 + y * 0.15 + fastTime) * Math.sin(x * 0.17 + y * 0.13 + fastTime * 1.3);
          atmosphericEffect = sparkle > 0.8 ? 1.2 : 1.0;
        } else if (b === 4) { // wetlands - mist
          atmosphericEffect = Math.sin(x * 0.02 + y * 0.025 + time * 2) * 0.08 + 0.92;
        }
        
        // Apply all effects
        const textureMultiplier = 0.8 + organicNoise * 0.4;
        r = Math.floor(baseColors.r * textureMultiplier * atmosphericEffect);
        g = Math.floor(baseColors.g * textureMultiplier * atmosphericEffect);
        bv = Math.floor(baseColors.b * textureMultiplier * atmosphericEffect);
        
        // Add subtle gradient based on distance from water
        if (opts.biomeDisplayMode !== "subtle") {
          const moisture = moistureMap[p];
          const moistureGradient = 0.7 + moisture * 0.3;
          g = Math.floor(g * moistureGradient);
          bv = Math.floor(bv * (1.0 + (1.0 - moistureGradient) * 0.1));
        }
      }

      // Fire overlay: visible burning tiles with flicker/smoke.
      const fireTTL = fireTTLMap[p];
      if (fireTTL > 0 && !isWater) {
        const flicker = 0.75 + Math.sin((x * 0.31 + y * 0.27 + tick * 0.35)) * 0.25;
        const fireHeat = Math.min(1, fireTTL / 140);
        const smoke = Math.max(0, 1 - fireHeat) * 0.45;
        r = Math.min(255, Math.floor(r * 0.35 + (180 + 70 * fireHeat) * flicker));
        g = Math.min(255, Math.floor(g * 0.3 + (70 + 80 * fireHeat) * flicker));
        bv = Math.max(0, Math.floor(bv * (0.2 + smoke)));
      }

      // Lightning strike marker (short red/orange pulse around impact).
      if (tick <= lightningFlashUntil && lastLightningX >= 0 && lastLightningY >= 0) {
        const ddx = x - lastLightningX;
        const ddy = y - lastLightningY;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < 20 * 20) {
          const pulse = (lightningFlashUntil - tick + 1) / 10;
          const dist = Math.sqrt(d2);
          const amp = Math.max(0, 1 - dist / 20) * pulse;
          const core = dist < 3 ? 1 : 0;
          r = Math.min(255, Math.floor(r + 240 * amp + 80 * core));
          g = Math.min(255, Math.floor(g + 95 * amp + 25 * core));
          bv = Math.max(0, Math.floor(bv * (1 - 0.75 * amp)));
        }
      }
      
      // Apply intensity multiplier
      r = Math.min(255, Math.floor(r * intensityMultiplier));
      g = Math.min(255, Math.floor(g * intensityMultiplier));
      bv = Math.min(255, Math.floor(bv * intensityMultiplier));
      
      const i = p * 4;
      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = bv;
      buf[i + 3] = a;
    }
  },
  
  // Exposed for diagnostics/UI if needed.
  getDistanceToWater(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    return waterDistanceMap[idx(x, y)];
  },
  
  renderEntities(buf: Uint8ClampedArray, opts: DisplayOptions) {
    // Smart density management - sample entities if needed
    let entitiesToRender: number[] = [];
    for (let i = 0; i < count; i++) {
      if (!aliveA[i]) continue;
      const isPlant = lifeTypeA[i] === 0;
      if (!opts.showPlants && isPlant) continue;
      if (!opts.showAnimals && !isPlant) continue;
      // Species class filter applies to animals only.
      if (!isPlant) {
        const classList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
        const entitySpeciesClass = classList[classA[i]];
        if (!opts.visibleSpeciesClasses.has(entitySpeciesClass)) continue;
      }
      entitiesToRender.push(i);
    }
    
    // Limit entities if max is set
    if (opts.maxVisibleEntities > 0 && entitiesToRender.length > opts.maxVisibleEntities) {
      // Sample evenly across the array to maintain distribution
      const step = Math.floor(entitiesToRender.length / opts.maxVisibleEntities);
      const sampled: number[] = [];
      for (let j = 0; j < entitiesToRender.length; j += step) {
        sampled.push(entitiesToRender[j]);
        if (sampled.length >= opts.maxVisibleEntities) break;
      }
      entitiesToRender = sampled;
    }
    
    // Clustering mode for very low zoom
    if (opts.enableClustering) {
      this.renderEntityClusters(buf, entitiesToRender);
      return;
    }
    
    for (const i of entitiesToRender) {
      const isPlant = lifeTypeA[i] === 0;
      
      const p = (yA[i] * W + xA[i]) * 4;
      let r = 0, g = 0, b = 0;
      
      // Determine color based on view mode
      if (opts.viewMode === "energy") {
        // Color by energy level (red=low, green=high)
        const energy = energyA[i];
        r = Math.floor((1 - energy) * 255);
        g = Math.floor(energy * 255);
        b = 0;
      } else if (opts.viewMode === "age") {
        // Color by age (young=bright, old=dim)
        const ageRatio = Math.min(1, ageA[i] / maxAgeA[i]);
        const brightness = Math.floor((1 - ageRatio) * 255);
        r = brightness;
        g = brightness;
        b = brightness;
      } else if (opts.viewMode === "health") {
        // Color by combined energy + hydration
        const health = (energyA[i] + hydrationA[i]) / 2;
        r = health < 0.3 ? 255 : 0; // Red for unhealthy
        g = health > 0.7 ? 255 : Math.floor(health * 255); // Green for healthy  
        b = 0;
      } else if (opts.viewMode === "genetics") {
        // Color by genetic traits combination
        const hostility = hostilityA[i];
        const speed = speedA[i]; 
        const sociality = socialA[i];
        r = Math.floor(hostility * 255);
        g = Math.floor(speed * 255);
        b = Math.floor(sociality * 255);
      } else if (opts.viewMode === "diet") {
        // Color by diet type
        const diet = dietA[i];
        if (diet === 0) { // photosynthesis
          r = 50; g = 200; b = 50;
        } else if (diet === 1) { // herbivore  
          r = 100; g = 255; b = 100;
        } else if (diet === 2) { // carnivore
          r = 255; g = 50; b = 50;
        } else { // omnivore
          r = 255; g = 200; b = 100;
        }
      } else if (opts.viewMode === "temperature") {
        // Color by temperature tolerance
        const tolerance = tempTolA[i];
        const currentBiome = biomeMap[idx(xA[i], yA[i])];
        const biomeTemp = this.getBiomeTemperature(currentBiome);
        const stress = Math.abs(tolerance - biomeTemp);
        r = Math.floor(stress * 255); // Red for high stress
        g = Math.floor((1 - stress) * 255); // Green for good match
        b = Math.floor(tolerance * 255); // Blue for cold tolerance
      } else if (opts.viewMode === "biome_match") {
        // Color by how well entity matches current biome
        const currentBiome = biomeMap[idx(xA[i], yA[i])];
        const preferredBiome = prefBiomeA[i];
        const match = currentBiome === preferredBiome;
        const biomeColors = this.getBiomeMatchColors(currentBiome, match);
        r = biomeColors.r;
        g = biomeColors.g; 
        b = biomeColors.b;
      } else {
        // Standard view mode - species colors
        const lvl = Math.min(15, Math.max(0, (energyA[i] * 15) | 0));
        const m = ENERGY_LUT[lvl];
        
        if (isPlant) {
          const [r0, g0, b0] = plantRGB[speciesA[i] % SPECIES_MAX];
          r = Math.min(255, Math.round(r0 * m));
          g = Math.min(255, Math.round(g0 * m));
          b = Math.min(255, Math.round(b0 * m));
        } else {
          const [r0, g0, b0] = speciesRGB[speciesA[i] % SPECIES_MAX];
          r = Math.min(255, Math.round(r0 * m));
          g = Math.min(255, Math.round(g0 * m));
          b = Math.min(255, Math.round(b0 * m));
        }
      }

      const burning = fireTTLMap[idx(xA[i], yA[i])] > 0;
      if (burning) {
        if (isPlant) {
          const flame = 0.82 + 0.18 * Math.sin((tick + i * 13) * 0.21);
          r = Math.min(255, Math.floor(r * 0.3 + 210 * flame));
          g = Math.min(255, Math.floor(g * 0.45 + 95 * flame));
          b = Math.floor(b * 0.12);
        } else {
          r = Math.min(255, r + 55);
          g = Math.max(0, g - 20);
        }
      }
      
      // Apply optional overlays
      if (opts.showMutationGlow && glowUntil[i] > tick) {
        r = Math.min(255, r + 80);
        g = Math.min(255, g + 40);
        b = Math.min(255, b + 80);
      }
      
      if (opts.showReproductionStates && reproStateA[i] === 1) {
        const progress = 1.0 - (reproTimerA[i] / Math.max(1, gestationTimeA[i]));
        const ringIntensity = Math.floor(30 + progress * 50);
        r = Math.min(255, r + ringIntensity);
        g = Math.min(255, g + ringIntensity * 0.3);
        b = Math.min(255, b + ringIntensity * 0.7);
      }
      
      if (opts.showEnergyWarnings && energyA[i] < 0.2) {
        // Red outline for low energy
        r = Math.min(255, r + 100);
      }
      
      // Render movement trails if enabled
      if (opts.showTrails && !isPlant) {
        this.renderEntityTrail(buf, i, r, g, b, opts);
      }
      
      // Enhanced rendering with shapes and size scaling
      if (opts.showShapes) {
        // Render shapes based on behavior and entity type
        this.renderEntityShape(buf, xA[i], yA[i], r, g, b, i, opts);
      } else if (opts.showSizeScaling) {
        // Render with size scaling
        const size = Math.max(1, Math.floor(sizeA[i] * 3 + 1));
        this.renderEntityPixels(buf, xA[i], yA[i], r, g, b, size, opts);
      } else {
        // Standard single pixel rendering
        buf[p] = r;
        buf[p + 1] = g;
        buf[p + 2] = b;
        buf[p + 3] = 255;
      }
    }
  },

  renderEntityTrail(buf: Uint8ClampedArray, entityIndex: number, r: number, g: number, b: number, opts: DisplayOptions) {
    const maxTrailLength = Math.min(opts.trailLength, trailLength[entityIndex]);
    if (maxTrailLength <= 0) return;
    
    for (let t = 0; t < maxTrailLength; t++) {
      const tx = trailHistoryX[entityIndex][t];
      const ty = trailHistoryY[entityIndex][t];
      
      if (tx >= 0 && ty >= 0 && tx < W && ty < H) {
        // Calculate fade based on trail position (older = more faded)
        const age = t / maxTrailLength;
        const fade = (1 - age) * 0.7; // max 70% opacity, fading to 0%
        
        // Apply speed-based trail effect
        const speed = speedA[entityIndex];
        const trailIntensity = Math.min(1, speed + 0.3); // faster entities = brighter trails
        
        const finalFade = fade * trailIntensity;
        const trailR = Math.floor(r * finalFade);
        const trailG = Math.floor(g * finalFade);
        const trailB = Math.floor(b * finalFade);
        
        const p = (ty * W + tx) * 4;
        
        // Blend with existing pixel (additive blending for trail effect)
        buf[p] = Math.min(255, buf[p] + trailR);
        buf[p + 1] = Math.min(255, buf[p + 1] + trailG);  
        buf[p + 2] = Math.min(255, buf[p + 2] + trailB);
        buf[p + 3] = 255;
      }
    }
  },

  renderEntityShape(buf: Uint8ClampedArray, x: number, y: number, r: number, g: number, b: number, entityIndex: number, opts: DisplayOptions) {
    // Determine shape based on entity behavior and type
    const isPlant = lifeTypeA[entityIndex] === 0;
    const size = Math.max(1, Math.floor(sizeA[entityIndex] * 2 + 1));
    
    // Life pulse effect
    let pulseFactor = 1;
    if (opts.showLifePulse) {
      const pulsePhase = (tick + entityIndex * 7) * 0.05; // Unique phase per entity
      pulseFactor = 0.8 + 0.2 * Math.sin(pulsePhase);
    }
    
    const finalSize = Math.max(1, Math.floor(size * pulseFactor));
    
    if (isPlant) {
      this.drawLeafGlyph(buf, x, y, finalSize, r, g, b);
      return;
    }

    const cls = classA[entityIndex];
    if (reproStateA[entityIndex] === 1) {
      this.drawDiamond(buf, x, y, finalSize, r, g, b);
      return;
    }
    switch (cls) {
      case 0: // fish
        this.drawFishGlyph(buf, x, y, finalSize, r, g, b);
        break;
      case 2: // bird
        this.drawBirdGlyph(buf, x, y, finalSize, r, g, b);
        break;
      case 5: // insect
        this.drawCrossGlyph(buf, x, y, finalSize, r, g, b);
        break;
      default:
        this.drawCircle(buf, x, y, finalSize, r, g, b);
        break;
    }
  },

  renderEntityPixels(buf: Uint8ClampedArray, x: number, y: number, r: number, g: number, b: number, size: number, opts: DisplayOptions) {
    // Life pulse effect
    let pulseFactor = 1;
    if (opts.showLifePulse) {
      const pulsePhase = (tick + x * 7 + y * 11) * 0.03; // Unique phase based on position
      pulseFactor = 0.9 + 0.1 * Math.sin(pulsePhase);
    }
    
    const finalSize = Math.max(1, Math.floor(size * pulseFactor));
    this.drawSquare(buf, x, y, finalSize, r, g, b);
  },

  // Shape drawing utilities
  drawCircle(buf: Uint8ClampedArray, cx: number, cy: number, radius: number, r: number, g: number, b: number) {
    const radiusSquared = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radiusSquared) {
          const px = cx + dx;
          const py = cy + dy;
          if (px >= 0 && py >= 0 && px < W && py < H) {
            const p = (py * W + px) * 4;
            buf[p] = r;
            buf[p + 1] = g;
            buf[p + 2] = b;
            buf[p + 3] = 255;
          }
        }
      }
    }
  },

  drawTriangle(buf: Uint8ClampedArray, cx: number, cy: number, size: number, r: number, g: number, b: number) {
    // Draw upward-pointing triangle
    for (let dy = -size; dy <= size; dy++) {
      const rowWidth = size - Math.abs(dy);
      for (let dx = -rowWidth; dx <= rowWidth; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && py >= 0 && px < W && py < H) {
          const p = (py * W + px) * 4;
          buf[p] = r;
          buf[p + 1] = g;
          buf[p + 2] = b;
          buf[p + 3] = 255;
        }
      }
    }
  },

  drawDiamond(buf: Uint8ClampedArray, cx: number, cy: number, size: number, r: number, g: number, b: number) {
    // Draw diamond shape
    for (let dy = -size; dy <= size; dy++) {
      const rowWidth = size - Math.abs(dy);
      for (let dx = -rowWidth; dx <= rowWidth; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && py >= 0 && px < W && py < H) {
          const p = (py * W + px) * 4;
          buf[p] = r;
          buf[p + 1] = g;
          buf[p + 2] = b;
          buf[p + 3] = 255;
        }
      }
    }
  },

  drawSquare(buf: Uint8ClampedArray, cx: number, cy: number, size: number, r: number, g: number, b: number) {
    const halfSize = Math.floor(size / 2);
    for (let dy = -halfSize; dy <= halfSize; dy++) {
      for (let dx = -halfSize; dx <= halfSize; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px >= 0 && py >= 0 && px < W && py < H) {
          const p = (py * W + px) * 4;
          buf[p] = r;
          buf[p + 1] = g;
          buf[p + 2] = b;
          buf[p + 3] = 255;
        }
      }
    }
  },

  drawLeafGlyph(buf: Uint8ClampedArray, cx: number, cy: number, size: number, r: number, g: number, b: number) {
    this.drawCircle(buf, cx, cy, Math.max(1, size), r, g, b);
    this.drawSquare(buf, cx, cy + 1, 1, Math.min(255, r + 20), Math.min(255, g + 25), b);
  },

  drawFishGlyph(buf: Uint8ClampedArray, cx: number, cy: number, size: number, r: number, g: number, b: number) {
    this.drawCircle(buf, cx, cy, Math.max(1, size), r, g, b);
    this.drawTriangle(buf, cx - Math.max(1, size), cy, Math.max(1, size - 1), r, g, b);
  },

  drawBirdGlyph(buf: Uint8ClampedArray, cx: number, cy: number, size: number, r: number, g: number, b: number) {
    this.drawTriangle(buf, cx, cy, Math.max(1, size), r, g, b);
    this.drawSquare(buf, cx, cy + 1, 1, Math.min(255, r + 30), Math.min(255, g + 30), Math.min(255, b + 20));
  },

  drawCrossGlyph(buf: Uint8ClampedArray, cx: number, cy: number, size: number, r: number, g: number, b: number) {
    const arm = Math.max(1, size);
    for (let d = -arm; d <= arm; d++) {
      const p1x = cx + d;
      const p1y = cy;
      const p2x = cx;
      const p2y = cy + d;
      if (p1x >= 0 && p1y >= 0 && p1x < W && p1y < H) {
        const p = (p1y * W + p1x) * 4;
        buf[p] = r; buf[p + 1] = g; buf[p + 2] = b; buf[p + 3] = 255;
      }
      if (p2x >= 0 && p2y >= 0 && p2x < W && p2y < H) {
        const p = (p2y * W + p2x) * 4;
        buf[p] = r; buf[p + 1] = g; buf[p + 2] = b; buf[p + 3] = 255;
      }
    }
  },
  
  renderEntityClusters(buf: Uint8ClampedArray, entities: number[]) {
    // At far zoom, render soft density splats (no square sprite blocks).
    const CLUSTER_SIZE = 8;
    const clusters: Map<string, {count: number, plants: number, animals: number, avgEnergy: number}> = new Map();
    
    // Group entities into clusters
    for (const i of entities) {
      const clusterX = Math.floor(xA[i] / CLUSTER_SIZE);
      const clusterY = Math.floor(yA[i] / CLUSTER_SIZE);
      const key = `${clusterX},${clusterY}`;
      
      const existing = clusters.get(key) || {count: 0, plants: 0, animals: 0, avgEnergy: 0};
      existing.count++;
      existing.avgEnergy += energyA[i];
      
      if (lifeTypeA[i] === 0) {
        existing.plants++;
      } else {
        existing.animals++;
      }
      
      clusters.set(key, existing);
    }
    
    // Render as radial density field with alpha falloff.
    for (const [key, cluster] of clusters) {
      const [clusterX, clusterY] = key.split(',').map(Number);
      const avgEnergy = cluster.avgEnergy / cluster.count;

      let r = 0, g = 0, b = 0;
      const density = Math.min(1, cluster.count / 52);
      if (cluster.plants > cluster.animals) {
        r = Math.floor(52 + 46 * density);
        g = Math.floor(118 + 95 * avgEnergy * density);
        b = Math.floor(54 + 36 * density);
      } else {
        r = Math.floor(94 + 96 * (1 - avgEnergy) * density);
        g = Math.floor(86 + 96 * avgEnergy * density);
        b = Math.floor(72 + 66 * density);
      }

      const cx = clusterX * CLUSTER_SIZE + CLUSTER_SIZE / 2;
      const cy = clusterY * CLUSTER_SIZE + CLUSTER_SIZE / 2;
      const radius = 4 + density * 6;
      const radiusSq = radius * radius;
      const minX = Math.max(0, Math.floor(cx - radius));
      const maxX = Math.min(W - 1, Math.ceil(cx + radius));
      const minY = Math.max(0, Math.floor(cy - radius));
      const maxY = Math.min(H - 1, Math.ceil(cy + radius));

      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const dx = px - cx;
          const dy = py - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 > radiusSq) continue;
          const falloff = Math.exp(-d2 / (radiusSq * 0.55));
          const alpha = Math.floor(35 + 120 * falloff * density);
          const p = (py * W + px) * 4;
          buf[p] = Math.min(255, buf[p] + Math.floor(r * falloff * 0.55));
          buf[p + 1] = Math.min(255, buf[p + 1] + Math.floor(g * falloff * 0.55));
          buf[p + 2] = Math.min(255, buf[p + 2] + Math.floor(b * falloff * 0.55));
          buf[p + 3] = Math.min(255, buf[p + 3] + alpha);
        }
      }
    }
  },
  
  renderEggs(buf: Uint8ClampedArray) {
    for (const egg of eggs) {
      const p = (egg.y * W + egg.x) * 4;
      if (p >= 0 && p < buf.length - 3 && occ[idx(egg.x, egg.y)] === -1) {
        const viabilityBrightness = Math.floor(egg.viability * 255);
        const progress = egg.incubationTime / egg.maxIncubationTime;
        const progressColor = Math.floor(progress * 100);
        
        buf[p] = Math.min(255, viabilityBrightness + progressColor);
        buf[p + 1] = Math.min(255, viabilityBrightness * 0.7 + progressColor * 0.5);
        buf[p + 2] = Math.min(255, viabilityBrightness * 0.3 + progressColor * 0.8);
        buf[p + 3] = 255;
      }
    }
  },
  
  inspect(x: number, y: number): EntitySnapshot | null {
    const i = occ[idx(x, y)];
    if (i === -1) return null;
    return encodeEntity(i);
  },
  place(x: number, y: number, g: Genome, energy: number) {
    if (count >= MAX_ENTITIES) return false;
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    if (occ[idx(x, y)] !== -1) return false;
    const k = count++;
    applyGenome(k, g);
    idA[k] = k + 1;
    energyA[k] = clamp01(energy);
    hydrationA[k] = 1;
    ageA[k] = 0;
    aliveA[k] = 1;
    adultA[k] = 0;
    speciesA[k] = speciesA[k] % SPECIES_MAX;
    if (!placeAt(k, x, y)) {
      count--;
      return false;
    }
    total++;
    lifeTypeA[k] === 1 ? animals++ : plants++;
    return true;
  },
};

/** ====== internals ====== */
function alloc() {
  occ = new Int32Array(W * H).fill(-1);
  idA = new Int32Array(MAX_ENTITIES);
  xA = new Int16Array(MAX_ENTITIES);
  yA = new Int16Array(MAX_ENTITIES);
  energyA = new Float32Array(MAX_ENTITIES);
  hydrationA = new Float32Array(MAX_ENTITIES);
  ageA = new Int32Array(MAX_ENTITIES);
  aliveA = new Uint8Array(MAX_ENTITIES);
  adultA = new Uint8Array(MAX_ENTITIES);

  speciesA = new Int16Array(MAX_ENTITIES);
  lifeTypeA = new Uint8Array(MAX_ENTITIES);
  classA = new Uint8Array(MAX_ENTITIES);
  dietA = new Uint8Array(MAX_ENTITIES);
  reproA = new Uint8Array(MAX_ENTITIES);
  hostilityA = new Float32Array(MAX_ENTITIES);
  speedA = new Float32Array(MAX_ENTITIES);
  sizeA = new Float32Array(MAX_ENTITIES);
  visionA = new Float32Array(MAX_ENTITIES);
  fertilityA = new Float32Array(MAX_ENTITIES);
  maturityA = new Int32Array(MAX_ENTITIES);
  maxAgeA = new Int32Array(MAX_ENTITIES);
  camoA = new Float32Array(MAX_ENTITIES);
  socialA = new Float32Array(MAX_ENTITIES);
  activityA = new Uint8Array(MAX_ENTITIES);
  tempTolA = new Float32Array(MAX_ENTITIES);
  prefBiomeA = new Uint8Array(MAX_ENTITIES);
  seedSpreadA = new Float32Array(MAX_ENTITIES);
  mutRateA = new Float32Array(MAX_ENTITIES);
  supplementalCarnA = new Uint8Array(MAX_ENTITIES);
  plantFeedHistoryA = new Float32Array(MAX_ENTITIES);
  preyFeedHistoryA = new Float32Array(MAX_ENTITIES);
  starvationStressA = new Float32Array(MAX_ENTITIES);
  dietShiftPenaltyA = new Int32Array(MAX_ENTITIES);
  plantTrapCooldownA = new Int32Array(MAX_ENTITIES);

  hostG1A = new Uint8Array(MAX_ENTITIES);
  hostG2A = new Uint8Array(MAX_ENTITIES);
  speedG1A = new Uint8Array(MAX_ENTITIES);
  speedG2A = new Uint8Array(MAX_ENTITIES);
  sizeG1A = new Uint8Array(MAX_ENTITIES);
  sizeG2A = new Uint8Array(MAX_ENTITIES);
  visionG1A = new Uint8Array(MAX_ENTITIES);
  visionG2A = new Uint8Array(MAX_ENTITIES);
  fertG1A = new Uint8Array(MAX_ENTITIES);
  fertG2A = new Uint8Array(MAX_ENTITIES);
  camoG1A = new Uint8Array(MAX_ENTITIES);
  camoG2A = new Uint8Array(MAX_ENTITIES);
  socialG1A = new Uint8Array(MAX_ENTITIES);
  socialG2A = new Uint8Array(MAX_ENTITIES);
  tempG1A = new Uint8Array(MAX_ENTITIES);
  tempG2A = new Uint8Array(MAX_ENTITIES);
  seedG1A = new Uint8Array(MAX_ENTITIES);
  seedG2A = new Uint8Array(MAX_ENTITIES);
  mutG1A = new Uint8Array(MAX_ENTITIES);
  mutG2A = new Uint8Array(MAX_ENTITIES);
  matG1A = new Uint8Array(MAX_ENTITIES);
  matG2A = new Uint8Array(MAX_ENTITIES);
  maxAgeG1A = new Uint8Array(MAX_ENTITIES);
  maxAgeG2A = new Uint8Array(MAX_ENTITIES);

  reproStateA = new Uint8Array(MAX_ENTITIES);
  reproTimerA = new Int32Array(MAX_ENTITIES);
  gestationTimeA = new Int32Array(MAX_ENTITIES);
  breedingReadinessA = new Float32Array(MAX_ENTITIES);
  lastReproTickA = new Int32Array(MAX_ENTITIES);

  glowUntil = new Int32Array(MAX_ENTITIES);
  
  // Trail system for movement visualization
  trailHistoryX = new Array(MAX_ENTITIES).fill(null).map(() => new Int16Array(10)); // max 10 positions
  trailHistoryY = new Array(MAX_ENTITIES).fill(null).map(() => new Int16Array(10));
  trailLength = new Uint8Array(MAX_ENTITIES); // current trail length for each entity

  for (let i = 0; i < SPECIES_MAX; i++) {
    const hueAnimal = (i * 37) % 360;
    speciesRGB[i] = hslToRgb(hueAnimal, 0.65, 0.35);
    const huePlant = 120 + ((i * 47) % 60);
    plantRGB[i] = hslToRgb(huePlant, 0.6, 0.3);
  }

  biomeMap = new Uint8Array(W * H);
  waterMap = new Uint8Array(W * H);
  waterDistanceMap = new Float32Array(W * H);
  moistureMap = new Float32Array(W * H);
  fireTTLMap = new Uint16Array(W * H);
}

function buildEnv(seed: number) {
  const total = W * H;
  const elevation = new Float32Array(total);
  const temperature = new Float32Array(total);
  const humidity = new Float32Array(total);

  const seaLevel = 0.42;

  // 1) Build coherent geophysical fields.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = idx(x, y);
      const nx = x / (W - 1);
      const ny = y / (H - 1);
      const cx = nx - 0.5;
      const cy = ny - 0.5;
      const radialFalloff = Math.sqrt(cx * cx + cy * cy) * 1.25;

      const continental = fractalValueNoise(nx * 2.1, ny * 2.1, seed + 11, 4, 2.0, 0.5);
      const regional = fractalValueNoise(nx * 5.2, ny * 5.2, seed + 101, 3, 2.0, 0.5);
      const ridge = Math.abs(fractalValueNoise(nx * 8.5, ny * 8.5, seed + 907, 3, 2.1, 0.55) * 2 - 1);
      const elev = clamp01(0.58 * continental + 0.24 * regional + 0.18 * (1 - ridge) - radialFalloff * 0.48 + 0.12);
      elevation[p] = elev;

      const lat = 1 - Math.abs(ny * 2 - 1); // warmest near equator
      const tempNoise = fractalValueNoise(nx * 3.0, ny * 3.0, seed + 2107, 3, 2.2, 0.5);
      temperature[p] = clamp01(0.68 * lat + 0.32 * tempNoise - elev * 0.28);

      const humidNoiseA = fractalValueNoise(nx * 4.3, ny * 4.3, seed + 3301, 4, 2.0, 0.5);
      const humidNoiseB = fractalValueNoise(nx * 11.4, ny * 11.4, seed + 7123, 2, 2.0, 0.45);
      const humidBase = 0.7 * humidNoiseA + 0.3 * humidNoiseB;
      humidity[p] = clamp01(humidBase + (1 - elev) * 0.24);
    }
  }

  // 2) Initial biome classification from the fields.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = idx(x, y);
      const e = elevation[p];
      const t = temperature[p];
      const h = humidity[p];

      if (e <= seaLevel) {
        biomeMap[p] = 5; // ocean
        waterMap[p] = 1;
        continue;
      }

      waterMap[p] = 0;
      const aridity = t * 1.05 - h;
      if (t < 0.2) biomeMap[p] = 3; // tundra
      else if (aridity > 0.2 && t > 0.5 && e > seaLevel + 0.03) biomeMap[p] = 2; // desert
      else if (h > 0.72 && e < seaLevel + 0.18) biomeMap[p] = 4; // wetlands
      else if (h > 0.52) biomeMap[p] = 1; // forest
      else biomeMap[p] = 0; // grassland
    }
  }

  // 3) Carve downhill rivers from high-elevation wet sources.
  const sourceCount = 18;
  for (let s = 0; s < sourceCount; s++) {
    let bestP = -1;
    let bestScore = -1;
    for (let tries = 0; tries < 120; tries++) {
      const x = (rng() * W) | 0;
      const y = (rng() * H) | 0;
      const p = idx(x, y);
      if (elevation[p] <= seaLevel + 0.08) continue;
      const score = elevation[p] * 0.8 + humidity[p] * 0.6 + fractalValueNoise(x * 0.03, y * 0.03, seed + s * 17, 1, 2, 0.5) * 0.2;
      if (score > bestScore) {
        bestScore = score;
        bestP = p;
      }
    }
    if (bestP === -1) continue;
    let cx = bestP % W;
    let cy = (bestP / W) | 0;
    for (let step = 0; step < 800; step++) {
      const p = idx(cx, cy);
      waterMap[p] = 1;
      if (elevation[p] <= seaLevel + 0.01) break;

      let nextX = cx;
      let nextY = cy;
      let bestNext = elevation[p];
      for (const [dx, dy] of N8) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
        const np = idx(nx, ny);
        const flowBias = waterMap[np] === 1 ? 0.015 : 0;
        const candidate = elevation[np] - flowBias + (rng() - 0.5) * 0.005;
        if (candidate <= bestNext) {
          bestNext = candidate;
          nextX = nx;
          nextY = ny;
        }
      }
      if (nextX === cx && nextY === cy) break;
      cx = nextX;
      cy = nextY;
    }
  }

  // 4) Expand tiny basins into lakes.
  for (let pass = 0; pass < 2; pass++) {
    const nextWater = new Uint8Array(waterMap);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const p = idx(x, y);
        if (waterMap[p] === 1 || elevation[p] <= seaLevel + 0.02) continue;
        let nearWater = 0;
        for (const [dx, dy] of N8) {
          if (waterMap[idx(x + dx, y + dy)] === 1) nearWater++;
        }
        if (nearWater >= 6 && elevation[p] < seaLevel + 0.09) nextWater[p] = 1;
      }
    }
    waterMap.set(nextWater);
  }

  // 5) Reconcile land biomes around water and coastal zones.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = idx(x, y);
      if (waterMap[p] === 1) {
        biomeMap[p] = elevation[p] <= seaLevel + 0.02 ? 5 : 4;
      } else {
        let waterNeighbors = 0;
        for (const [dx, dy] of N8) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (waterMap[idx(nx, ny)] === 1) waterNeighbors++;
        }
        if (waterNeighbors >= 4 && biomeMap[p] === 2) biomeMap[p] = 0; // no tiny desert coasts
        if (waterNeighbors >= 3 && biomeMap[p] === 0 && humidity[p] > 0.55) biomeMap[p] = 1;

        // Re-introduce inland deserts after hydrology pass.
        // This prevents rivers/lakes from wiping desert generation globally.
        if (waterNeighbors <= 1 && biomeMap[p] === 0) {
          const aridity = temperature[p] * 1.08 - humidity[p];
          const desertNoise = fractalValueNoise(x * 0.018, y * 0.018, seed + 919, 2, 2.0, 0.5);
          if (aridity > 0.22 && temperature[p] > 0.54 && elevation[p] > seaLevel + 0.05 && desertNoise > 0.45) {
            biomeMap[p] = 2;
          }
        }
      }
    }
  }

  // 6) Remove speckles / enforce patch coherence.
  smoothBiomeMap(3);
  precomputeHydrology();
}

function precomputeHydrology() {
  const total = W * H;
  const nearestWater = new Int32Array(total).fill(-1);
  const q = new Int32Array(total);
  let qHead = 0;
  let qTail = 0;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = idx(x, y);
      if (waterMap[p] === 1) {
        nearestWater[p] = p;
        waterDistanceMap[p] = 0;
        q[qTail++] = p;
      } else {
        waterDistanceMap[p] = Number.POSITIVE_INFINITY;
      }
    }
  }

  while (qHead < qTail) {
    const p = q[qHead++];
    const px = p % W;
    const py = (p / W) | 0;
    const source = nearestWater[p];

    for (const [dx, dy] of N8) {
      const nx = px + dx;
      const ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const np = idx(nx, ny);
      if (nearestWater[np] !== -1) continue;
      nearestWater[np] = source;
      const sx = source % W;
      const sy = (source / W) | 0;
      waterDistanceMap[np] = Math.hypot(nx - sx, ny - sy);
      q[qTail++] = np;
    }
  }

  const maxDist = Math.hypot(W, H);
  for (let p = 0; p < total; p++) {
    if (!Number.isFinite(waterDistanceMap[p])) waterDistanceMap[p] = maxDist;
    moistureMap[p] = clamp01(1 - waterDistanceMap[p] / 40);
  }
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function valueNoise2D(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;

  const n00 = hash(xi + seed * 0.017, yi + seed * 0.023);
  const n10 = hash(xi + 1 + seed * 0.017, yi + seed * 0.023);
  const n01 = hash(xi + seed * 0.017, yi + 1 + seed * 0.023);
  const n11 = hash(xi + 1 + seed * 0.017, yi + 1 + seed * 0.023);

  const u = smoothstep(xf);
  const v = smoothstep(yf);
  const nx0 = lerp(n00, n10, u);
  const nx1 = lerp(n01, n11, u);
  return lerp(nx0, nx1, v);
}

function fractalValueNoise(x: number, y: number, seed: number, octaves: number, lacunarity: number, gain: number) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2D(x * freq, y * freq, seed + i * 7919) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

function smoothBiomeMap(passes: number) {
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint8Array(biomeMap);
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const p = idx(x, y);
        if (waterMap[p] === 1) {
          next[p] = biomeMap[p];
          continue;
        }

        const counts = new Int16Array(6);
        for (const [dx, dy] of N8) {
          const b = biomeMap[idx(x + dx, y + dy)];
          counts[b]++;
        }
        let bestBiome = biomeMap[p];
        let bestCount = counts[bestBiome];
        for (let b = 0; b < 6; b++) {
          if (counts[b] > bestCount && b !== 5) { // don't let ocean invade land in smoothing
            bestBiome = b;
            bestCount = counts[b];
          }
        }
        if (bestCount >= 5) next[p] = bestBiome;
      }
    }
    biomeMap.set(next);
  }
}

function hash(x: number, y: number) {
  // tiny hash → 0..1
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function placeAt(i: number, x: number, y: number) {
  const k = idx(x, y);
  if (occ[k] !== -1) return false;
  xA[i] = x;
  yA[i] = y;
  occ[k] = i;
  return true;
}
function removeAt(i: number) {
  if (!aliveA[i]) return;
  aliveA[i] = 0;
  const k = idx(xA[i], yA[i]);
  if (occ[k] === i) occ[k] = -1;
  total--;
  lifeTypeA[i] === 1 ? animals-- : plants--;
}
function moveEntity(i: number, nx: number, ny: number) {
  if (nx < 0 || ny < 0 || nx >= W || ny >= H) return false;
  const to = idx(nx, ny);
  if (occ[to] !== -1) return false;
  const from = idx(xA[i], yA[i]);
  occ[from] = -1;
  occ[to] = i;
  
  // Update trail history before moving
  updateEntityTrail(i, xA[i], yA[i]);
  
  xA[i] = nx;
  yA[i] = ny;
  return true;
}

function updateEntityTrail(entityIndex: number, oldX: number, oldY: number) {
  // Only track trails for living entities  
  if (!aliveA[entityIndex]) return;
  
  const currentLength = trailLength[entityIndex];
  const maxTrail = Math.min(10, currentLength + 1);
  
  // Shift existing trail positions back
  for (let j = maxTrail - 1; j > 0; j--) {
    trailHistoryX[entityIndex][j] = trailHistoryX[entityIndex][j - 1];
    trailHistoryY[entityIndex][j] = trailHistoryY[entityIndex][j - 1];
  }
  
  // Add old position to front of trail
  trailHistoryX[entityIndex][0] = oldX;
  trailHistoryY[entityIndex][0] = oldY;
  
  trailLength[entityIndex] = maxTrail;
}

function setTraitAlleles(i: number, g: EggGenes) {
  hostG1A[i] = g.hostility[0]; hostG2A[i] = g.hostility[1];
  speedG1A[i] = g.speed[0]; speedG2A[i] = g.speed[1];
  sizeG1A[i] = g.size[0]; sizeG2A[i] = g.size[1];
  visionG1A[i] = g.vision[0]; visionG2A[i] = g.vision[1];
  fertG1A[i] = g.fertility[0]; fertG2A[i] = g.fertility[1];
  camoG1A[i] = g.camouflage[0]; camoG2A[i] = g.camouflage[1];
  socialG1A[i] = g.sociality[0]; socialG2A[i] = g.sociality[1];
  tempG1A[i] = g.temperatureTolerance[0]; tempG2A[i] = g.temperatureTolerance[1];
  seedG1A[i] = g.seedSpread[0]; seedG2A[i] = g.seedSpread[1];
  mutG1A[i] = g.mutationRate[0]; mutG2A[i] = g.mutationRate[1];
  matG1A[i] = g.maturityAge[0]; matG2A[i] = g.maturityAge[1];
  maxAgeG1A[i] = g.maxAge[0]; maxAgeG2A[i] = g.maxAge[1];
}

function genesFromGenome(g: Genome): EggGenes {
  const jitter = (v: number, r = 0.08) => clamp01(v + (rng() - 0.5) * r);
  const maturityNorm = clamp01((g.maturityAge - MATURITY_MIN) / (MATURITY_MAX - MATURITY_MIN));
  const maxAgeNorm = clamp01((g.maxAge - MAX_AGE_MIN) / (MAX_AGE_MAX - MAX_AGE_MIN));
  return {
    hostility: [encodeAllele01(jitter(g.hostility)), encodeAllele01(jitter(g.hostility))],
    speed: [encodeAllele01(jitter(g.lifeType === "plant" ? 0 : g.speed)), encodeAllele01(jitter(g.lifeType === "plant" ? 0 : g.speed))],
    size: [encodeAllele01(jitter(g.size)), encodeAllele01(jitter(g.size))],
    vision: [encodeAllele01(jitter(g.lifeType === "plant" ? 0 : g.vision)), encodeAllele01(jitter(g.lifeType === "plant" ? 0 : g.vision))],
    fertility: [encodeAllele01(jitter(g.fertility)), encodeAllele01(jitter(g.fertility))],
    camouflage: [encodeAllele01(jitter(g.camouflage)), encodeAllele01(jitter(g.camouflage))],
    sociality: [encodeAllele01(jitter(g.sociality)), encodeAllele01(jitter(g.sociality))],
    temperatureTolerance: [encodeAllele01(jitter(g.temperatureTolerance)), encodeAllele01(jitter(g.temperatureTolerance))],
    seedSpread: [encodeAllele01(jitter(g.lifeType === "plant" ? g.seedSpread : 0)), encodeAllele01(jitter(g.lifeType === "plant" ? g.seedSpread : 0))],
    mutationRate: [encodeAllele01(jitter(g.mutationRate, 0.03)), encodeAllele01(jitter(g.mutationRate, 0.03))],
    maturityAge: [encodeAllele01(jitter(maturityNorm, 0.04)), encodeAllele01(jitter(maturityNorm, 0.04))],
    maxAge: [encodeAllele01(jitter(maxAgeNorm, 0.04)), encodeAllele01(jitter(maxAgeNorm, 0.04))],
  };
}

function applyPhenotypeFromGenes(i: number) {
  hostilityA[i] = decodeTrait(hostG1A[i], hostG2A[i]);
  speedA[i] = lifeTypeA[i] === 0 ? 0 : decodeTrait(speedG1A[i], speedG2A[i]);
  sizeA[i] = decodeTrait(sizeG1A[i], sizeG2A[i]);
  visionA[i] = lifeTypeA[i] === 0 ? 0 : decodeTrait(visionG1A[i], visionG2A[i]);
  fertilityA[i] = decodeTrait(fertG1A[i], fertG2A[i]);
  camoA[i] = decodeTrait(camoG1A[i], camoG2A[i]);
  socialA[i] = decodeTrait(socialG1A[i], socialG2A[i]);
  tempTolA[i] = decodeTrait(tempG1A[i], tempG2A[i]);
  seedSpreadA[i] = lifeTypeA[i] === 0 ? decodeTrait(seedG1A[i], seedG2A[i]) : 0;
  mutRateA[i] = decodeTrait(mutG1A[i], mutG2A[i]);
  maturityA[i] = decodeAgeTrait(matG1A[i], matG2A[i], MATURITY_MIN, MATURITY_MAX);
  maxAgeA[i] = Math.max(maturityA[i] + 200, decodeAgeTrait(maxAgeG1A[i], maxAgeG2A[i], MAX_AGE_MIN, MAX_AGE_MAX));
}

function recombineGenesFromParents(p1: number, p2: number | null, lifeType: "plant" | "animal"): EggGenes {
  const parentMutRate = p2 === null
    ? mutRateA[p1]
    : clamp01((mutRateA[p1] + mutRateA[p2]) * 0.5);
  const mutate = (a: number) => mutateAllele(a, parentMutRate);
  const from = (a1: Uint8Array, a2: Uint8Array): [number, number] => {
    const p2g1 = p2 === null ? pickAllele(a1[p1], a2[p1]) : pickAllele(a1[p2], a2[p2]);
    return [mutate(pickAllele(a1[p1], a2[p1])), mutate(p2g1)];
  };

  const genes: EggGenes = {
    hostility: from(hostG1A, hostG2A),
    speed: from(speedG1A, speedG2A),
    size: from(sizeG1A, sizeG2A),
    vision: from(visionG1A, visionG2A),
    fertility: from(fertG1A, fertG2A),
    camouflage: from(camoG1A, camoG2A),
    sociality: from(socialG1A, socialG2A),
    temperatureTolerance: from(tempG1A, tempG2A),
    seedSpread: from(seedG1A, seedG2A),
    mutationRate: from(mutG1A, mutG2A),
    maturityAge: from(matG1A, matG2A),
    maxAge: from(maxAgeG1A, maxAgeG2A),
  };

  if (lifeType === "plant") {
    genes.speed = [0, 0];
    genes.vision = [0, 0];
  } else {
    genes.seedSpread = [0, 0];
  }
  return genes;
}

function randomGenome(life: "plant" | "animal"): Genome {
  const isPlant = life === "plant";
  const classes: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
  const speciesClass = isPlant
    ? ("insect" as SpeciesClass)
    : (classes[(rng() * classes.length) | 0] as SpeciesClass);
  const diet: Diet = isPlant ? "photosynthesis" : rng() < 0.55 ? "herbivore" : rng() < 0.5 ? "carnivore" : "omnivore";
  const activity: ActivityCycle = rng() < 0.6 ? "diurnal" : rng() < 0.8 ? "nocturnal" : "cathemeral";
  const preferredBiome: Biome = BIOMES[(rng() * 6) | 0];

  return {
    speciesId: (rng() * SPECIES_MAX) | 0,
    lifeType: life,
    speciesClass,
    diet,
    reproduction: isPlant ? (rng() < 0.6 ? "asexual" : "sexual") : rng() < 0.8 ? "sexual" : "asexual",
    hostility: isPlant ? 0 : rng() ** 2,
    speed: isPlant ? 0 : rng(),
    size: isPlant ? rng() * 0.6 : rng(),
    vision: isPlant ? 0 : rng(),
    fertility: clamp01(0.3 + rng() * 0.5),
    maturityAge: Math.floor(MATURITY_MIN + rng() * (MATURITY_MAX - MATURITY_MIN)),
    maxAge: Math.floor(MAX_AGE_MIN + rng() * (MAX_AGE_MAX - MAX_AGE_MIN)),
    camouflage: isPlant ? clamp01(0.4 + rng() * 0.5) : rng(),
    sociality: rng(),
    activity,
    temperatureTolerance: clamp01(0.3 + rng() * 0.6),
    preferredBiome,
    seedSpread: isPlant ? rng() : 0,
    mutationRate: clamp01(0.04 + rng() * 0.12),
    supplementalCarnivory: isPlant ? rng() < 0.02 : false,
  };
}

function applyGenome(i: number, g: Genome) {
  speciesA[i] = g.speciesId;
  lifeTypeA[i] = g.lifeType === "plant" ? 0 : 1;
  const dietNormalized = normalizeDiet(g.lifeType, g.diet);
  const classNormalized = normalizeSpeciesClass(g.lifeType, g.speciesClass);
  const dietMap: Record<Diet, number> = { photosynthesis: 0, herbivore: 1, carnivore: 2, omnivore: 3 };
  const reproMap: Record<"asexual" | "sexual", number> = { asexual: 0, sexual: 1 };
  const actMap: Record<ActivityCycle, number> = { diurnal: 0, nocturnal: 1, cathemeral: 2 };
  const classMap: Record<SpeciesClass, number> = { fish: 0, mammal: 1, bird: 2, reptile: 3, amphibian: 4, insect: 5 };
  const biomeMapIndex: Record<Biome, number> = { grassland: 0, forest: 1, desert: 2, tundra: 3, wetlands: 4, ocean: 5 };

  classA[i] = classMap[classNormalized];
  dietA[i] = dietMap[dietNormalized];
  reproA[i] = reproMap[g.reproduction];
  activityA[i] = actMap[g.activity];
  tempTolA[i] = g.temperatureTolerance;
  prefBiomeA[i] = biomeMapIndex[g.preferredBiome];
  setTraitAlleles(i, genesFromGenome(g));
  supplementalCarnA[i] = g.lifeType === "plant" && g.supplementalCarnivory ? 1 : 0;
  plantFeedHistoryA[i] = 0;
  preyFeedHistoryA[i] = 0;
  starvationStressA[i] = 0;
  dietShiftPenaltyA[i] = 0;
  plantTrapCooldownA[i] = 0;
  applyPhenotypeFromGenes(i);
}

function encodeEntity(i: number): EntitySnapshot {
  const classList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
  const dietMap: Diet[] = ["photosynthesis", "herbivore", "carnivore", "omnivore"];
  const actMap: ActivityCycle[] = ["diurnal", "nocturnal", "cathemeral"];
  const biomeList: Biome[] = ["grassland", "forest", "desert", "tundra", "wetlands", "ocean"];

  const g: Genome = {
    speciesId: speciesA[i],
    lifeType: lifeTypeA[i] === 0 ? "plant" : "animal",
    speciesClass: classList[classA[i]],
    diet: dietMap[dietA[i]],
    reproduction: reproA[i] === 0 ? "asexual" : "sexual",
    hostility: hostilityA[i],
    speed: speedA[i],
    size: sizeA[i],
    vision: visionA[i],
    fertility: fertilityA[i],
    maturityAge: maturityA[i],
    maxAge: maxAgeA[i],
    camouflage: camoA[i],
    sociality: socialA[i],
    activity: actMap[activityA[i]],
    temperatureTolerance: tempTolA[i],
    preferredBiome: biomeList[prefBiomeA[i]],
    seedSpread: seedSpreadA[i],
    mutationRate: mutRateA[i],
    supplementalCarnivory: lifeTypeA[i] === 0 && supplementalCarnA[i] === 1,
  };

  const reproStateNames: ReproductionState[] = ["ready", "gestating", "cooldown", "incubating"];

  return {
    id: idA[i],
    x: xA[i],
    y: yA[i],
    genome: g,
    energy: energyA[i],
    hydration: hydrationA[i],
    age: ageA[i],
    alive: !!aliveA[i],
    isAdult: !!adultA[i],
    reproductionState: reproStateNames[reproStateA[i]],
    reproductionTimer: reproTimerA[i],
    breedingReadiness: breedingReadinessA[i],
  };
}

function seedWorld(plantCount: number, animalCount: number) {
  for (let i = 0; i < plantCount; i++) addEntity(randomGenome("plant"), 0.62 + rng() * 0.28, (rng() * 40) | 0);
  for (let i = 0; i < animalCount; i++) addEntity(randomGenome("animal"), 0.58 + rng() * 0.32, (rng() * 60) | 0);
}

function addEntity(g: Genome, energy: number, age: number) {
  if (count >= MAX_ENTITIES) return;
  const i = count++;
  idA[i] = i + 1;
  applyGenome(i, g);
  aliveA[i] = 1;
  adultA[i] = 0;
  energyA[i] = energy;
  hydrationA[i] = 1;
  ageA[i] = age;
  // place in suitable tile
  for (let tries = 0; tries < 20; tries++) {
    const x = (rng() * W) | 0,
      y = (rng() * H) | 0;
    if (lifeTypeA[i] === 1 && classA[i] === 0 /*fish*/ && waterMap[idx(x, y)] !== 1) continue;
    if (placeAt(i, x, y)) break;
  }
  total++;
  lifeTypeA[i] === 1 ? animals++ : plants++;
}

const N8 = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [1, -1],
  [1, 1],
  [-1, 1],
  [-1, -1],
] as const;

function canSee(actor: number, target: number, dist: number) {
  const vis = dist * (1 + camoA[target] * 1.5);
  const classList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
  const cls: SpeciesClass = classList[classA[actor]];
  const maxT = 1 + Math.floor(clamp01(visionA[actor] + CLASS_PROPS[cls].visionBonus) * VISION_TILES_MAX);
  return vis <= maxT;
}

function findAllNeighbors(i: number, radius: number, pred: (j: number) => boolean): number[] {
  const results: number[] = [];
  const r = Math.max(1, Math.floor(radius));
  const cx = xA[i], cy = yA[i];
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = occ[idx(nx, ny)];
      if (j !== -1 && pred(j)) results.push(j);
    }
  return results;
}

function findBestNeighborByScore(i: number, radius: number, pred: (j: number) => boolean, scoreFn: (j: number, dist: number) => number): number {
  const r = Math.max(1, Math.floor(radius));
  const cx = xA[i], cy = yA[i];
  const weighted: { id: number; weight: number }[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = occ[idx(nx, ny)];
      if (j === -1 || !pred(j)) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const score = scoreFn(j, dist);
      if (score > 0) weighted.push({ id: j, weight: score });
    }
  }
  if (weighted.length === 0) return -1;
  const totalWeight = weighted.reduce((sum, c) => sum + c.weight, 0);
  let rv = rng() * totalWeight;
  for (const c of weighted) {
    rv -= c.weight;
    if (rv <= 0) return c.id;
  }
  return weighted[weighted.length - 1].id;
}

function geneticDistanceEntities(i: number, j: number): number {
  let d = 0;
  d += Math.abs(decodeTrait(hostG1A[i], hostG2A[i]) - decodeTrait(hostG1A[j], hostG2A[j]));
  d += Math.abs(decodeTrait(speedG1A[i], speedG2A[i]) - decodeTrait(speedG1A[j], speedG2A[j]));
  d += Math.abs(decodeTrait(sizeG1A[i], sizeG2A[i]) - decodeTrait(sizeG1A[j], sizeG2A[j]));
  d += Math.abs(decodeTrait(visionG1A[i], visionG2A[i]) - decodeTrait(visionG1A[j], visionG2A[j]));
  d += Math.abs(decodeTrait(fertG1A[i], fertG2A[i]) - decodeTrait(fertG1A[j], fertG2A[j]));
  d += Math.abs(decodeTrait(tempG1A[i], tempG2A[i]) - decodeTrait(tempG1A[j], tempG2A[j]));
  d += classA[i] === classA[j] ? 0 : 0.12;
  d += activityA[i] === activityA[j] ? 0 : 0.08;
  d += dietA[i] === dietA[j] ? 0 : 0.08;
  d += prefBiomeA[i] === prefBiomeA[j] ? 0 : 0.05;
  return d / 10;
}

function geneticCompatibility(i: number, j: number): number {
  return clamp01(1 - geneticDistanceEntities(i, j));
}

function countNearbyPredators(i: number): number {
  return findAllNeighbors(i, 3, (j) =>
    lifeTypeA[j] === 1 && // animal
    (dietA[j] === 2 || dietA[j] === 3) && // carnivore/omnivore
    sizeA[j] >= sizeA[i] && // same or larger size
    hostilityA[j] > 0.5 // aggressive
  ).length;
}

function getBiomeReproductionBonus(i: number): number {
  const currentBiome = biomeMap[idx(xA[i], yA[i])];
  const preferredBiome = prefBiomeA[i];
  const classList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
  const speciesClass = classList[classA[i]];
  
  // Base bonus for preferred biome
  let bonus = currentBiome === preferredBiome ? 1.2 : 1.0;
  
  // Species class specific biome modifiers
  const biome = BIOMES[currentBiome];
  switch (speciesClass) {
    case "fish":
      // Fish need water-rich biomes
      bonus *= (biome === "ocean" || biome === "wetlands") ? 1.3 : 0.7;
      break;
    case "amphibian":
      // Amphibians prefer wetlands, struggle in deserts
      if (biome === "wetlands") bonus *= 1.4;
      else if (biome === "desert") bonus *= 0.4;
      break;
    case "bird":
      // Birds adaptable but prefer open areas
      if (biome === "grassland" || biome === "tundra") bonus *= 1.1;
      break;
    case "reptile":
      // Reptiles prefer warm, dry biomes
      if (biome === "desert") bonus *= 1.3;
      else if (biome === "tundra") bonus *= 0.5;
      break;
    case "mammal":
      // Mammals versatile but struggle in extreme biomes
      if (biome === "grassland" || biome === "forest") bonus *= 1.1;
      else if (biome === "desert" || biome === "tundra") bonus *= 0.8;
      break;
    case "insect":
      // Insects prefer warmer biomes with vegetation
      if (biome === "forest" || biome === "grassland") bonus *= 1.2;
      else if (biome === "tundra") bonus *= 0.6;
      break;
  }
  
  // Temperature stress also affects reproduction
  const biomeProps = BIOME_PROPS[biome];
  const tempStress = getTemperatureStress(tempTolA[i], biomeProps.temp, biomeProps.tempRange);
  bonus *= Math.max(0.3, 1.0 - tempStress * 0.7); // reduce reproduction under temperature stress
  
  return bonus;
}

function calculateBreedingReadiness(i: number): number {
  if (!adultA[i] || ageA[i] < maturityA[i]) return 0;
  
  const energySurplus = Math.max(0, energyA[i] - 0.42) * 1.72; // 0-1
  const hydrationGood = Math.max(0, hydrationA[i] - 0.24) * 1.32; // 0-1
  const predatorStress = countNearbyPredators(i);
  const lowStress = Math.max(0, 1.0 - predatorStress * 0.2);
  const biomeBonus = getBiomeReproductionBonus(i);
  const socialBonus = socialA[i] > 0.6 ? 1.16 : 1.0;
  
  return clamp01(energySurplus * hydrationGood * lowStress * biomeBonus * socialBonus);
}

function findPotentialMates(i: number, searchRadius: number): number[] {
  const classList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
  const maxVis = 1 + Math.floor(clamp01(visionA[i] + CLASS_PROPS[classList[classA[i]]].visionBonus) * VISION_TILES_MAX);
  const radius = Math.min(searchRadius, maxVis);
  
  return findAllNeighbors(i, radius, (j) =>
    j !== i &&
    lifeTypeA[j] === lifeTypeA[i] && // same life type
    classA[j] === classA[i] && // same reproductive class
    !!adultA[j] && // adult
    reproStateA[j] === 0 && // ready state
    energyA[j] > 0.34 && // good energy
    hydrationA[j] > 0.26 && // good hydration
    geneticCompatibility(i, j) >= 0.45 // allow broader mating pool inside class
  );
}

function calculateMateScore(i: number, j: number): number {
  const sizePreference = 1.0 + Math.abs(sizeA[j] - sizeA[i]) * -0.3; // prefer similar size
  const healthBonus = energyA[j] * hydrationA[j]; // prefer healthy mates
  const activityMatch = activityA[i] === activityA[j] ? 1.2 : 0.8; // prefer same activity cycle
  const biomeMatch = prefBiomeA[i] === prefBiomeA[j] ? 1.1 : 0.9; // prefer same biome preference
  const fertilityBonus = fertilityA[j] * (dietShiftPenaltyA[j] > 0 ? DIET_SHIFT_FERTILITY_FACTOR : 1); // transient post-shift fertility suppression
  const compatibility = 0.6 + geneticCompatibility(i, j) * 0.8;
  const dist = Math.max(Math.abs(xA[j] - xA[i]), Math.abs(yA[j] - yA[i]));
  const distanceWeight = 1 / (dist + 0.5);
  
  return sizePreference * healthBonus * activityMatch * biomeMatch * fertilityBonus * compatibility * distanceWeight;
}

function weightedRandomSelect(candidates: { id: number; score: number }[]): number {
  if (candidates.length === 0) return -1;
  if (candidates.length === 1) return candidates[0].id;
  
  const totalScore = candidates.reduce((sum, c) => sum + c.score, 0);
  if (totalScore <= 0) return candidates[Math.floor(rng() * candidates.length)].id;
  
  let randomValue = rng() * totalScore;
  for (const candidate of candidates) {
    randomValue -= candidate.score;
    if (randomValue <= 0) return candidate.id;
  }
  
  return candidates[candidates.length - 1].id;
}

function findBestMate(i: number): number {
  const classList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
  const maxVis = 1 + Math.floor(clamp01(visionA[i] + CLASS_PROPS[classList[classA[i]]].visionBonus) * VISION_TILES_MAX);
  const candidates = findPotentialMates(i, maxVis);
  if (candidates.length === 0) return -1;
  
  const scores = candidates.map(j => ({
    id: j,
    score: calculateMateScore(i, j)
  }));
  
  return weightedRandomSelect(scores);
}

function getEggCount(speciesClass: SpeciesClass, size: number): number {
  const baseCount = {
    fish: 8,
    mammal: 0, // mammals don't lay eggs
    bird: 3,
    reptile: 6,
    amphibian: 12,
    insect: 15,
  }[speciesClass];
  
  return Math.max(1, Math.floor(baseCount * (0.5 + size * 0.8)));
}

function getIncubationTime(speciesClass: SpeciesClass): number {
  const baseTimes = {
    fish: 300,
    mammal: 0, // not used
    bird: 800,
    reptile: 1200,
    amphibian: 400,
    insect: 200,
  };
  
  return baseTimes[speciesClass] + Math.floor(rng() * 200 - 100);
}

function getCooldownTime(speciesClass: SpeciesClass): number {
  const baseCooldowns = {
    fish: 600,
    mammal: 1200,
    bird: 900,
    reptile: 1800,
    amphibian: 800,
    insect: 400,
  };
  
  return baseCooldowns[speciesClass] + Math.floor(rng() * 400 - 200);
}

function findNearbyEmpty(x: number, y: number, radius: number): { x: number; y: number } | null {
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (occ[idx(nx, ny)] === -1) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

function findNearbyWater(x: number, y: number, radius: number): { x: number; y: number } | null {
  for (let r = 1; r <= radius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (waterMap[idx(nx, ny)] === 1 && occ[idx(nx, ny)] === -1) return { x: nx, y: ny };
      }
    }
  }
  return null;
}

function findNearestWater(x: number, y: number, visionRange: number): { x: number; y: number } | null {
  let closest: { x: number; y: number } | null = null;
  let closestDist = Infinity;
  
  for (let dx = -visionRange; dx <= visionRange; dx++) {
    for (let dy = -visionRange; dy <= visionRange; dy++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (waterMap[idx(nx, ny)] === 1) {
        const dist = Math.abs(dx) + Math.abs(dy); // Manhattan distance
        if (dist < closestDist) {
          closest = { x: nx, y: ny };
          closestDist = dist;
        }
      }
    }
  }
  return closest;
}

function countPlantsAround(x: number, y: number, radius: number): number {
  let n = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = occ[idx(nx, ny)];
      if (j !== -1 && aliveA[j] && lifeTypeA[j] === 0) n++;
    }
  }
  return n;
}

function findEggLayingSpot(parentId: number, speciesClass: SpeciesClass): { x: number; y: number } | null {
  const x = xA[parentId], y = yA[parentId];
  
  if (speciesClass === "fish" || speciesClass === "amphibian") {
    return findNearbyWater(x, y, 2);
  } else {
    return findNearbyEmpty(x, y, 1);
  }
}

function startMammalGestation(parentId: number, _mateId: number | null) {
  reproStateA[parentId] = 1; // gestating
  const baseGestationTime = 800 + Math.floor(sizeA[parentId] * 400); // 800-1200 ticks
  gestationTimeA[parentId] = baseGestationTime;
  reproTimerA[parentId] = baseGestationTime;
  lastReproTickA[parentId] = tick;
}

function layEggs(parentId: number, mateId: number | null) {
  const classList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
  const speciesClass = classList[classA[parentId]];
  
  const eggCount = getEggCount(speciesClass, sizeA[parentId]);
  const incubationTime = getIncubationTime(speciesClass);
  
  for (let e = 0; e < eggCount; e++) {
    const eggPos = findEggLayingSpot(parentId, speciesClass);
    if (eggPos && eggs.length < MAX_EGGS) {
      const offspring = createOffspringData(parentId, mateId);
      eggs.push({
        speciesId: offspring.genome.speciesId,
        parentId1: parentId,
        parentId2: mateId,
        genome: offspring.genome,
        genes: offspring.genes,
        shiftedDiet: offspring.shiftedDiet,
        incubationTime: 0,
        maxIncubationTime: incubationTime,
        x: eggPos.x,
        y: eggPos.y,
        viability: 1.0
      });
    }
  }
  
  // Set parent cooldown
  reproStateA[parentId] = 2; // cooldown
  reproTimerA[parentId] = getCooldownTime(speciesClass);
  lastReproTickA[parentId] = tick;
  if (mateId !== null) {
    reproStateA[mateId] = 2; // cooldown
    reproTimerA[mateId] = getCooldownTime(speciesClass);
    lastReproTickA[mateId] = tick;
  }
}

function tryReproduce(i: number) {
  // Check reproduction state and cooldown
  if (reproStateA[i] !== 0) return; // not ready
  
  const isPlant = lifeTypeA[i] === 0;
  const classList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
  const speciesClass = classList[classA[i]];
  const readiness = calculateBreedingReadiness(i);
  const readinessWithDietPenalty = dietShiftPenaltyA[i] > 0 ? readiness * DIET_SHIFT_FERTILITY_FACTOR : readiness;
  breedingReadinessA[i] = readinessWithDietPenalty;
  if (!isPlant) {
    if (readinessWithDietPenalty < behaviorTuning.reproductionReadinessThreshold) return; // not ready enough
    if (energyA[i] < 0.54 || hydrationA[i] < 0.42) return;
  }
  if (count >= MAX_ENTITIES) return; // population limit
  
  // Plants and asexual reproduction
  if (reproA[i] === 0 /*asexual*/ || isPlant) {
    // Plant seed spreading
    if (isPlant) {
      const biomeAtParent = biomeMap[idx(xA[i], yA[i])];
      const pIdx = idx(xA[i], yA[i]);
      if (currentDayStats) {
        const dailyPlantCap = Math.max(
          PLANT_DAILY_BIRTH_MIN_CAP,
          Math.floor(plants * PLANT_DAILY_BIRTH_RATE_CAP)
        );
        if (currentDayStats.birthsPlants >= dailyPlantCap) return;
      }
      if (isNight(tick)) return;
      if (energyA[i] < PLANT_REPRO_MIN_ENERGY || hydrationA[i] < PLANT_REPRO_MIN_HYDRATION) return;
      const nearbyPlants = findAllNeighbors(i, 2, (j) => lifeTypeA[j] === 0).length;
      const marineCrowdLimit = biomeAtParent === 5 ? 5 : biomeAtParent === 4 ? 6 : PLANT_REPRO_CROWD_LIMIT;
      if (nearbyPlants >= marineCrowdLimit) return;
      if (biomeAtParent === 5 && energyA[i] < 0.74) return;

      // Reproduction is probabilistic and linked to water cycle + ecosystem pressure.
      const localMoisture = moistureMap[pIdx];
      const isOcean = biomeAtParent === 5;
      const baseChance = isOcean ? PLANT_REPRO_OCEAN_BASE_CHANCE : PLANT_REPRO_BASE_CHANCE;
      const rainFactor = 0.55 + rainCoverageNow * 0.9;
      const moistureFactor = isOcean ? (0.55 + localMoisture * 0.35) : (0.7 + localMoisture * 0.5);
      const energyFactor = 0.72 + (energyA[i] - PLANT_REPRO_MIN_ENERGY) * 0.9;
      const crowdFactor = Math.max(0.15, 1 - nearbyPlants / (marineCrowdLimit + 1));
      const plantAnimalRatio = plants / Math.max(1, animals);
      const ecologicalBrake =
        plantAnimalRatio > 16 ? 0.55 :
        plantAnimalRatio > 10 ? 0.68 :
        plantAnimalRatio > 6 ? 0.8 :
        0.92;
      const reproChance = clamp01(baseChance * rainFactor * moistureFactor * energyFactor * crowdFactor * ecologicalBrake);
      if (rng() > reproChance) return;

      const rad = Math.max(1, 1 + Math.floor(seedSpreadA[i] * 3));
      const dx = ((rng() * (rad * 2 + 1)) | 0) - rad;
      const dy = ((rng() * (rad * 2 + 1)) | 0) - rad;
      const nx = Math.max(0, Math.min(W - 1, xA[i] + dx));
      const ny = Math.max(0, Math.min(H - 1, yA[i] + dy));
      if (occ[idx(nx, ny)] === -1) {
        birth(i, null, nx, ny);
        energyA[i] *= 0.68;
        reproStateA[i] = 2; // cooldown
        reproTimerA[i] = Math.max(PLANT_REPRO_MIN_COOLDOWN, getCooldownTime(speciesClass) + 280);
        lastReproTickA[i] = tick;
      }
    } else {
      // Asexual animals (rare) - lay eggs or give birth directly
      if (speciesClass === "mammal") {
        startMammalGestation(i, null);
        energyA[i] *= 0.6;
      } else {
        layEggs(i, null);
        energyA[i] *= 0.6;
      }
    }
    return;
  }

  // Sexual reproduction - find mate
  const mate = findBestMate(i);
  if (mate === -1) return;
  
  // Check if mate is still available and ready
  if (reproStateA[mate] !== 0 || !adultA[mate]) return;
  
  // Fertility check
  if (rng() > clamp01(0.12 + fertilityA[i] * fertilityA[mate])) return;
  
  // Species-specific reproduction
  if (speciesClass === "mammal") {
    startMammalGestation(i, mate);
    energyA[i] *= 0.82;
    energyA[mate] *= 0.72; // mate contributes less energy
  } else {
    layEggs(i, mate);
    energyA[i] *= 0.82;
    energyA[mate] *= 0.74;
  }
}

function updateGestation(i: number) {
  if (reproStateA[i] !== 1) return; // not gestating
  
  const dailyEnergyCost = 0.001 + sizeA[i] * 0.0005;
  const dailyHydrationCost = 0.0008;
  
  energyA[i] = clamp01(energyA[i] - dailyEnergyCost);
  hydrationA[i] = clamp01(hydrationA[i] - dailyHydrationCost);
  
  // Movement speed reduction during late pregnancy could be applied here in future
  
  reproTimerA[i]--;
  if (reproTimerA[i] <= 0) {
    giveBirth(i);
  }
}

function giveBirth(parentId: number) {
  // Try to find a spot near parent
  const spots: [number, number][] = [];
  for (const [dx, dy] of N8) {
    const nx = xA[parentId] + dx, ny = yA[parentId] + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < H && occ[idx(nx, ny)] === -1) {
      spots.push([nx, ny]);
    }
  }
  
  const classList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
  
  if (spots.length === 0) {
    // Failed to give birth - miscarriage
    reproStateA[parentId] = 2; // cooldown
    reproTimerA[parentId] = getCooldownTime(classList[classA[parentId]]) * 1.5; // longer cooldown
    energyA[parentId] *= 0.8; // energy loss
    return;
  }
  
  // Mammals typically have 1-3 offspring
  const litterSize = Math.max(1, Math.floor(sizeA[parentId] * 2.5 + rng()));
  
  for (let b = 0; b < litterSize && count < MAX_ENTITIES; b++) {
    const spot = spots[Math.floor(rng() * spots.length)];
    if (occ[idx(spot[0], spot[1])] === -1) {
      birth(parentId, null, spot[0], spot[1]);
    }
  }
  
  // Set parent to cooldown
  reproStateA[parentId] = 2;
  reproTimerA[parentId] = getCooldownTime(classList[classA[parentId]]);
  lastReproTickA[parentId] = tick;
}

function calculateTemperatureStress(tolerance: number, temp: number): number {
  const idealTemp = tolerance; // entity's ideal temperature
  const tempDiff = Math.abs(temp - idealTemp);
  return Math.max(0, tempDiff - 0.3) * 0.002; // stress beyond tolerance range
}

function calculateMoistureStress(speciesClass: SpeciesClass, x: number, y: number, biome: number): number {
  const biomeName = BIOMES[biome];
  const biomeProps = BIOME_PROPS[biomeName];
  
  // Species-specific moisture needs
  const moistureNeeds = {
    fish: 0.0, // always in water
    amphibian: 0.8,
    mammal: 0.4,
    bird: 0.3,
    reptile: 0.2,
    insect: 0.3,
  };
  
  const need = moistureNeeds[speciesClass];
  const localMoisture = moistureMap[idx(x, y)];
  const biomeBaseline = 1.0 / biomeProps.hydrationFactor;
  const available = clamp01((biomeBaseline + localMoisture) * 0.5);
  
  return Math.max(0, need - available) * 0.001;
}

function countAdjacentPredators(x: number, y: number): number {
  let count = 0;
  for (const [dx, dy] of N8) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const j = occ[idx(nx, ny)];
    if (j !== -1 && lifeTypeA[j] === 1 && (dietA[j] === 2 || dietA[j] === 3) && hostilityA[j] > 0.4) {
      count++;
    }
  }
  return count;
}

function hatchEgg(egg: EggData) {
  if (count >= MAX_ENTITIES) return;
  
  const k = count++;
  applyGenome(k, egg.genome);
  setTraitAlleles(k, egg.genes);
  applyPhenotypeFromGenes(k);
  idA[k] = k + 1;
  energyA[k] = CHILD_ENERGY_START * egg.viability; // viability affects starting energy
  hydrationA[k] = 0.8;
  ageA[k] = 0;
  aliveA[k] = 1;
  adultA[k] = 0;
  reproStateA[k] = 0;
  reproTimerA[k] = 0;
  lastReproTickA[k] = tick;
  
  // Fish must hatch in water
  if (lifeTypeA[k] === 1 && classA[k] === 0 && waterMap[idx(egg.x, egg.y)] !== 1) {
    // Try nearby water
    const waterSpot = findNearbyWater(egg.x, egg.y, 2);
    if (waterSpot && occ[idx(waterSpot.x, waterSpot.y)] === -1) {
      placeAt(k, waterSpot.x, waterSpot.y);
    } else {
      count--; // failed to hatch
      return;
    }
  } else {
    if (occ[idx(egg.x, egg.y)] === -1) {
      placeAt(k, egg.x, egg.y);
    } else {
      count--; // failed to hatch
      return;
    }
  }
  
  total++;
  lifeTypeA[k] === 1 ? animals++ : plants++;
  recordBirth(lifeTypeA[k] as 0 | 1);
  if (egg.shiftedDiet) {
    dietShiftPenaltyA[k] = DIET_SHIFT_PENALTY_TICKS;
  }
  
  // Check for mutation (same as birth)
  const parentG = encodeEntity(egg.parentId1).genome;
  const childG = encodeEntity(k).genome;
  const dist = genomeDistance(parentG, childG);
  const deltas = genomeDeltas(parentG, childG);
  const forcedAdaptiveShift =
    egg.shiftedDiet === true ||
    parentG.supplementalCarnivory !== childG.supplementalCarnivory;
  const shouldLogMutation = dist > 0.12 || forcedAdaptiveShift;
  if (!shouldLogMutation) return;

  if (dist > 0.12 || egg.parentId2 !== null) {
    speciesA[k] = (speciesA[egg.parentId1] + ((rng() * 97) | 0) + 1) % SPECIES_MAX;
  }
  glowUntil[k] = tick + MUT_GLW_TICKS;
  pushMutationEvent({
    tick,
    parentSpeciesId: parentG.speciesId,
    newSpeciesId: speciesA[k],
    entityId: idA[k],
    lifeType: lifeTypeA[k] === 1 ? "animal" : "plant",
    deltas,
    countBorn: 1,
  });
}

function updateEggs() {
  for (let e = eggs.length - 1; e >= 0; e--) {
    const egg = eggs[e];
    
    // Environmental stress affects viability
    const biome = biomeMap[idx(egg.x, egg.y)];
    const temp = BIOME_PROPS[BIOMES[biome]].temp;
    const tempStress = calculateTemperatureStress(egg.genome.temperatureTolerance, temp);
    const moistureStress = calculateMoistureStress(egg.genome.speciesClass, egg.x, egg.y, biome);
    
    egg.viability = clamp01(egg.viability - tempStress - moistureStress);
    egg.incubationTime++;
    
    // Predation risk (adjacent carnivores can destroy eggs)
    const predatorRisk = countAdjacentPredators(egg.x, egg.y) * 0.05;
    if (rng() < predatorRisk) {
      eggs.splice(e, 1); // egg destroyed
      continue;
    }
    
    // Hatching conditions
    if (egg.incubationTime >= egg.maxIncubationTime) {
      if (egg.viability > 0.3 && rng() < egg.viability) {
        hatchEgg(egg);
      }
      eggs.splice(e, 1); // remove egg (hatched or died)
    }
  }
}

function getParentalCareLevel(speciesClass: SpeciesClass): number {
  const careMap = {
    mammal: 0.8,
    bird: 0.6,
    reptile: 0.2,
    amphibian: 0.1,
    fish: 0.1,
    insect: 0.0
  };
  return careMap[speciesClass];
}

function findNearbyOffspring(i: number, radius: number): number[] {
  return findAllNeighbors(i, radius, (j) =>
    j !== i &&
    speciesA[j] === speciesA[i] && // same species
    lifeTypeA[j] === lifeTypeA[i] && // same life type
    !adultA[j] && // juvenile
    ageA[j] < maturityA[j] * 0.3 // very young
  );
}

function updateParentalCare(i: number) {
  if (reproStateA[i] !== 2) return; // only during cooldown period
  
  const classList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
  const speciesClass = classList[classA[i]];
  const careIntensity = getParentalCareLevel(speciesClass);
  
  if (careIntensity > 0) {
    // Find nearby offspring (same species, young)
    const offspring = findNearbyOffspring(i, 3);
    if (offspring.length > 0) {
      // Energy cost for care
      energyA[i] = clamp01(energyA[i] - careIntensity * 0.001);
      
      // Benefit to offspring
      offspring.forEach(childId => {
        energyA[childId] = clamp01(energyA[childId] + 0.0008);
        hydrationA[childId] = clamp01(hydrationA[childId] + 0.0008);
      });
    }
  }
}

function updateReproductionStates() {
  for (let i = 0; i < count; i++) {
    if (!aliveA[i]) continue;
    
    if (reproStateA[i] === 1) {
      // Gestating
      updateGestation(i);
    } else if (reproStateA[i] === 2) {
      // Cooldown
      reproTimerA[i]--;
      if (reproTimerA[i] <= 0) {
        reproStateA[i] = 0; // ready
      }
    }
  }
}

function updateSpeciesStats() {
  if (tick - lastStatsUpdate < STATS_UPDATE_INTERVAL) return;
  lastStatsUpdate = tick;
  
  // Clear old stats
  speciesStats.clear();
  const lifeCountBySpecies = new Map<number, Int32Array>();
  const classCountBySpecies = new Map<number, Int32Array>();
  const dietCountBySpecies = new Map<number, Int32Array>();
  const activityCountBySpecies = new Map<number, Int32Array>();
  
  // Collect data for each living entity
  for (let i = 0; i < count; i++) {
    if (!aliveA[i]) continue;
    
    const species = speciesA[i];
    const lifeType = lifeTypeA[i] as 0 | 1;
    const speciesKey = speciesStatsKey(species, lifeType);
    if (!speciesStats.has(speciesKey)) {
      speciesStats.set(speciesKey, {
        speciesId: species,
        dominantLifeType: lifeType === 0 ? "plant" : "animal",
        population: 0,
        dominantClass: null,
        dominantDiet: null,
        dominantActivity: null,
        avgEnergy: 0,
        avgHydration: 0,
        avgAge: 0,
        meanTraits: {
          hostility: 0,
          speed: 0,
          size: 0,
          vision: 0,
          fertility: 0,
          camouflage: 0,
          sociality: 0,
          temperatureTolerance: 0,
        },
        dominantBiomes: {
          grassland: 0,
          forest: 0,
          desert: 0,
          tundra: 0,
          wetlands: 0,
          ocean: 0,
        },
        mortalityCauses: {
          starvation: 0,
          dehydration: 0,
          age: 0,
          predation: 0,
          fire: 0,
        },
        lastSeen: tick,
      });
      lifeCountBySpecies.set(speciesKey, new Int32Array(2));
      classCountBySpecies.set(speciesKey, new Int32Array(6));
      dietCountBySpecies.set(speciesKey, new Int32Array(4));
      activityCountBySpecies.set(speciesKey, new Int32Array(3));
    }
    
    const stats = speciesStats.get(speciesKey)!;
    stats.population++;
    stats.lastSeen = tick;
    stats.avgEnergy += energyA[i];
    stats.avgHydration += hydrationA[i];
    stats.avgAge += ageA[i];
    
    // Accumulate traits for mean calculation
    stats.meanTraits.hostility += hostilityA[i];
    stats.meanTraits.speed += speedA[i];
    stats.meanTraits.size += sizeA[i];
    stats.meanTraits.vision += visionA[i];
    stats.meanTraits.fertility += fertilityA[i];
    stats.meanTraits.camouflage += camoA[i];
    stats.meanTraits.sociality += socialA[i];
    stats.meanTraits.temperatureTolerance += tempTolA[i];
    
    // Track biome distribution
    const biomeIdx = biomeMap[idx(xA[i], yA[i])];
    const biomeName = BIOMES[biomeIdx];
    stats.dominantBiomes[biomeName]++;
    lifeCountBySpecies.get(speciesKey)![lifeTypeA[i]]++;
    classCountBySpecies.get(speciesKey)![classA[i]]++;
    dietCountBySpecies.get(speciesKey)![dietA[i]]++;
    activityCountBySpecies.get(speciesKey)![activityA[i]]++;
  }
  
  // Calculate means
  const classList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
  const dietList: Diet[] = ["photosynthesis", "herbivore", "carnivore", "omnivore"];
  const activityList: ActivityCycle[] = ["diurnal", "nocturnal", "cathemeral"];
  const argmax = (arr: Int32Array) => {
    let bi = 0;
    for (let i = 1; i < arr.length; i++) {
      if (arr[i] > arr[bi]) bi = i;
    }
    return bi;
  };
  for (const [key, stats] of speciesStats) {
    if (stats.population > 0) {
      const pop = stats.population;
      stats.avgEnergy /= pop;
      stats.avgHydration /= pop;
      stats.avgAge /= pop;
      stats.meanTraits.hostility /= pop;
      stats.meanTraits.speed /= pop;
      stats.meanTraits.size /= pop;
      stats.meanTraits.vision /= pop;
      stats.meanTraits.fertility /= pop;
      stats.meanTraits.camouflage /= pop;
      stats.meanTraits.sociality /= pop;
      stats.meanTraits.temperatureTolerance /= pop;
      const c = classCountBySpecies.get(key)!;
      const d = dietCountBySpecies.get(key)!;
      const a = activityCountBySpecies.get(key)!;
      const lifeCounts = lifeCountBySpecies.get(key)!;
      const dominantLifeType = lifeCounts[0] >= lifeCounts[1] ? 0 : 1;
      stats.dominantLifeType = dominantLifeType === 0 ? "plant" : "animal";
      stats.dominantClass = dominantLifeType === 0 ? null : (classList[argmax(c)] ?? null);
      stats.dominantDiet = dietList[argmax(d)] ?? null;
      stats.dominantActivity = activityList[argmax(a)] ?? null;
    }
  }
}

function recordDeath(entityIndex: number, cause: 'starvation' | 'dehydration' | 'age' | 'predation' | 'fire') {
  const species = speciesA[entityIndex];
  const lifeType = lifeTypeA[entityIndex] as 0 | 1;
  const stats = speciesStats.get(speciesStatsKey(species, lifeType));
  if (stats) {
    stats.mortalityCauses[cause]++;
  }
  if (currentDayStats) {
    currentDayStats.deaths++;
    if (lifeTypeA[entityIndex] === 1) currentDayStats.deathsAnimals++;
    else currentDayStats.deathsPlants++;
    currentDayStats.deathsByCause[cause]++;
  }
}

function inferEcologicalContext(parentGenome: Genome, childGenome: Genome, environment: { biome: Biome; hasWater: boolean; pressure: number; tempStress?: number }): string {
  const deltas = genomeDeltas(parentGenome, childGenome);
  const significantTraits = (Object.keys(deltas) as (keyof Genome)[]).filter((k) => {
    const value = deltas[k];
    return typeof value === "string" || (typeof value === "number" && Math.abs(value) > 0.1);
  });
  
  if (significantTraits.length === 0) return "Minor genetic drift";
  
  // Temperature stress-driven adaptations
  if (deltas.temperatureTolerance && Math.abs(deltas.temperatureTolerance as number) > 0.1) {
    if (environment.tempStress && environment.tempStress > 0.3) {
      switch (environment.biome) {
        case "desert": return "Desert heat → thermal adaptation";
        case "tundra": return "Arctic cold → freeze tolerance";
        case "ocean": return "Ocean temperature → thermal regulation";
        case "wetlands": return "Wetland climate → temperature adjustment";
        default: return "Temperature stress → thermal tolerance";
      }
    }
  }
  
  // Water-related adaptations  
  if (!environment.hasWater && (deltas.temperatureTolerance as number > 0.05 || deltas.size as number < -0.05)) {
    return "Water scarcity → conservation traits";
  }
  
  // Enhanced biome-specific movement adaptations
  if (deltas.speed && (deltas.speed as number) > 0.1) {
    if (environment.pressure > 0.5) return "Predation pressure → escape speed";
    switch (environment.biome) {
      case "ocean": 
      case "wetlands": return "Aquatic environment → swimming adaptation";
      case "desert": return "Harsh terrain → mobility increase";
      case "tundra": return "Frozen landscape → movement efficiency";
      case "forest": return "Dense vegetation → navigation speed";
      default: return "Environmental mobility pressure";
    }
  }
  
  if (deltas.size && (deltas.size as number) > 0.1) {
    if (environment.pressure > 0.3) return "Predation pressure → defensive size";
    if (environment.biome === "wetlands" || environment.biome === "forest") return "Rich environment → size advantage";
    return "Resource availability → growth adaptation";
  }
  
  if (deltas.hostility && (deltas.hostility as number) > 0.1) {
    if (environment.biome === "desert") return "Resource scarcity → territorial aggression";
    return "Competition → behavioral aggression";
  }
  
  if (deltas.camouflage && (deltas.camouflage as number) > 0.1) {
    if (environment.biome === "forest") return "Forest cover → stealth evolution";
    if (environment.biome === "ocean") return "Marine camouflage → predator evasion";
    return "Predation pressure → camouflage adaptation";
  }
  
  if (deltas.vision && (deltas.vision as number) > 0.1) {
    switch (environment.biome) {
      case "grassland": 
      case "tundra": return "Open terrain → enhanced vision";
      case "ocean": return "Aquatic environment → underwater sight";
      case "forest": return "Dense environment → visual acuity";
      default: return "Environmental visibility → vision adaptation";
    }
  }

  if (deltas.diet) {
    return `Food-web pressure → diet shift (${deltas.diet})`;
  }

  if (deltas.supplementalCarnivory) {
    return "Nutrient stress → supplemental carnivory";
  }
  
  // Species class changes indicate major environmental adaptations
  if (deltas.speciesClass) {
    return `Environmental pressure → ${deltas.speciesClass} specialization`;
  }
  
  // Biome-specific general adaptations for new biomes
  switch (environment.biome) {
    case "wetlands": return "Wetland ecosystem specialization";
    case "ocean": return "Marine environment adaptation";
    case "desert": return "Arid climate adaptation";
    case "tundra": return "Cold environment adaptation";
    case "forest": return "Forest ecosystem adaptation";
    default: return `${environment.biome} environmental adaptation`;
  }
}

function birth(p1: number, p2: number | null, x: number, y: number) {
  if (count >= MAX_ENTITIES) return;
  const k = count++;
  const offspring = createOffspringData(p1, p2);
  applyGenome(k, offspring.genome);
  setTraitAlleles(k, offspring.genes);
  applyPhenotypeFromGenes(k);
  idA[k] = k + 1;
  energyA[k] = CHILD_ENERGY_START;
  hydrationA[k] = 1;
  ageA[k] = 0;
  aliveA[k] = 1;
  adultA[k] = 0;
  // fish must spawn in water
  if (lifeTypeA[k] === 1 && classA[k] === 0 && waterMap[idx(x, y)] !== 1) {
    // try nearby
    let placed = false;
    for (const [dx, dy] of N8) {
      const nx = x + dx,
        ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (waterMap[idx(nx, ny)] === 1 && occ[idx(nx, ny)] === -1) {
        if (placeAt(k, nx, ny)) placed = true;
        break;
      }
    }
    if (!placed) {
      count--;
      return;
    }
  } else {
    if (!placeAt(k, x, y)) {
      count--;
      return;
    }
  }

  // counters
  total++;
  lifeTypeA[k] === 1 ? animals++ : plants++;
  recordBirth(lifeTypeA[k] as 0 | 1);
  if (offspring.shiftedDiet) {
    dietShiftPenaltyA[k] = DIET_SHIFT_PENALTY_TICKS;
  }

  // mutation & glow detection
  const parentG = encodeEntity(p1).genome;
  const childG = encodeEntity(k).genome;
  const dist = genomeDistance(parentG, childG);
  const deltas = genomeDeltas(parentG, childG);
  const forcedAdaptiveShift =
    offspring.shiftedDiet ||
    parentG.supplementalCarnivory !== childG.supplementalCarnivory;
  const shouldLogMutation = dist > 0.12 || forcedAdaptiveShift;
  if (!shouldLogMutation) return;

  if (dist > 0.12) {
    speciesA[k] = (speciesA[p1] + ((rng() * 97) | 0) + 1) % SPECIES_MAX;
  }
  glowUntil[k] = tick + MUT_GLW_TICKS;
  
  // Analyze environment for ecological context
  const biomeIdx = biomeMap[idx(x, y)];
  const biome = BIOMES[biomeIdx]; // use the full 6-biome array
  const hasWater = waterMap[idx(x, y)] === 1;
  const nearbyPredators = countNearbyPredators(p1);
  const pressure = nearbyPredators / 8; // normalized pressure
  const biomeProps = BIOME_PROPS[biome];
  const tempStress = getTemperatureStress(parentG.temperatureTolerance, biomeProps.temp, biomeProps.tempRange);
  
  const context = inferEcologicalContext(parentG, childG, { biome, hasWater, pressure, tempStress });
  
  pushMutationEvent({
    tick,
    parentSpeciesId: parentG.speciesId,
    newSpeciesId: speciesA[k],
    entityId: idA[k],
    lifeType: lifeTypeA[k] === 1 ? "animal" : "plant",
    deltas,
    countBorn: 1,
    ecologicalContext: context,
  });
}

function genomeDistance(a: Genome, b: Genome) {
  // simple numeric diff over normalized subset
  let d = 0,
    n = 0;
  const num = (x: number, y: number) => {
    d += Math.abs(x - y);
    n++;
  };
  num(a.hostility, b.hostility);
  num(a.speed, b.speed);
  num(a.size, b.size);
  num(a.vision, b.vision);
  num(a.fertility, b.fertility);
  num(a.maturityAge / 10000, b.maturityAge / 10000);
  num(a.maxAge / 20000, b.maxAge / 20000);
  num(a.camouflage, b.camouflage);
  num(a.sociality, b.sociality);
  num(a.temperatureTolerance, b.temperatureTolerance);
  num(a.seedSpread, b.seedSpread);
  num(a.mutationRate * 5, b.mutationRate * 5);
  d += a.activity === b.activity ? 0 : 0.2;
  n++;
  d += a.diet === b.diet ? 0 : 0.2;
  n++;
  d += a.speciesClass === b.speciesClass ? 0 : 0.2;
  n++;
  d += a.preferredBiome === b.preferredBiome ? 0 : 0.2;
  n++;
  return d / n;
}
function genomeDeltas(a: Genome, b: Genome) {
  const out: Partial<Record<keyof Genome, number | string>> = {};
  const add = (k: keyof Genome, x: number, y: number) => {
    const dd = +(y - x).toFixed(2);
    if (Math.abs(dd) >= 0.05) out[k] = dd;
  };
  add("hostility", a.hostility, b.hostility);
  add("speed", a.speed, b.speed);
  add("size", a.size, b.size);
  add("vision", a.vision, b.vision);
  add("fertility", a.fertility, b.fertility);
  add("maturityAge", a.maturityAge, b.maturityAge);
  add("maxAge", a.maxAge, b.maxAge);
  add("camouflage", a.camouflage, b.camouflage);
  add("sociality", a.sociality, b.sociality);
  add("temperatureTolerance", a.temperatureTolerance, b.temperatureTolerance);
  add("seedSpread", a.seedSpread, b.seedSpread);
  add("mutationRate", a.mutationRate, b.mutationRate);
  if (a.activity !== b.activity) out.activity = `${a.activity}→${b.activity}`;
  if (a.diet !== b.diet) out.diet = `${a.diet}→${b.diet}`;
  if (a.speciesClass !== b.speciesClass) out.speciesClass = `${a.speciesClass}→${b.speciesClass}`;
  if (a.preferredBiome !== b.preferredBiome) out.preferredBiome = `${a.preferredBiome}→${b.preferredBiome}`;
  if (a.supplementalCarnivory !== b.supplementalCarnivory) {
    out.supplementalCarnivory = `${a.supplementalCarnivory ? "on" : "off"}→${b.supplementalCarnivory ? "on" : "off"}`;
  }
  return out;
}

type OffspringData = { genome: Genome; genes: EggGenes; shiftedDiet: boolean };

function canAdoptCarnivory(speciesClass: SpeciesClass, size: number, vision: number, hostility: number) {
  const byClass = {
    fish: { size: 0.28, vision: 0.18, hostility: 0.22 },
    bird: { size: 0.25, vision: 0.34, hostility: 0.22 },
    mammal: { size: 0.3, vision: 0.28, hostility: 0.25 },
    reptile: { size: 0.28, vision: 0.24, hostility: 0.3 },
    amphibian: { size: 0.22, vision: 0.16, hostility: 0.22 },
    insect: { size: 0.14, vision: 0.1, hostility: 0.14 },
  }[speciesClass];
  return size >= byClass.size && vision >= byClass.vision && hostility >= byClass.hostility;
}

function getDietShiftContext(parentId: number) {
  const speciesClassList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
  const cls = speciesClassList[classA[parentId]];
  const canEatPlantsNearby = (j: number) => lifeTypeA[j] === 0;
  const canEatPreyNearby = (j: number) =>
    lifeTypeA[j] === 1 &&
    j !== parentId &&
    sizeA[j] < sizeA[parentId] + 0.08 &&
    !(dietA[parentId] === 3 && dietA[j] === 3);

  const nearbyPlants = findAllNeighbors(parentId, 3, canEatPlantsNearby).length;
  const nearbyPrey = findAllNeighbors(parentId, 3, canEatPreyNearby).length;
  const nearbyFish = findAllNeighbors(parentId, 3, (j) => lifeTypeA[j] === 1 && classA[j] === 0).length;
  const starvePressure = clamp01(starvationStressA[parentId]);
  const plantOpportunity = clamp01(nearbyPlants / 10 + plantFeedHistoryA[parentId] * 0.55);
  const preyOpportunity = clamp01(nearbyPrey / 8 + preyFeedHistoryA[parentId] * 0.65 + (cls === "bird" || cls === "mammal" ? nearbyFish / 12 : 0));
  return { cls, starvePressure, plantOpportunity, preyOpportunity };
}

function maybeMutateAnimalDiet(
  parentId: number,
  inheritedDiet: Diet,
  mutationRate: number,
  speciesClass: SpeciesClass,
  size: number,
  vision: number,
  hostility: number
): { diet: Diet; shifted: boolean } {
  const { starvePressure, plantOpportunity, preyOpportunity } = getDietShiftContext(parentId);
  const pressure = clamp01(starvePressure * 0.8 + Math.max(0, 0.28 - energyA[parentId]) * 1.6);
  const gateCarn = canAdoptCarnivory(speciesClass, size, vision, hostility);

  // Transition matrix with rarity controls.
  const tryShift = (baseChance: number, opportunityBias: number) =>
    rng() < clamp01(baseChance * mutationRate * (0.5 + pressure * 1.8 + opportunityBias));

  switch (inheritedDiet) {
    case "herbivore":
      if (gateCarn && tryShift(0.015, preyOpportunity * 0.9 - plantOpportunity * 0.2)) {
        return { diet: "carnivore", shifted: true };
      }
      if (tryShift(0.12, preyOpportunity * 0.7)) {
        return { diet: "omnivore", shifted: true };
      }
      return { diet: "herbivore", shifted: false };
    case "omnivore":
      if (gateCarn && tryShift(0.07, preyOpportunity * 0.9 - plantOpportunity * 0.3)) {
        return { diet: "carnivore", shifted: true };
      }
      if (tryShift(0.03, plantOpportunity * 0.7 - preyOpportunity * 0.3)) {
        return { diet: "herbivore", shifted: true };
      }
      return { diet: "omnivore", shifted: false };
    case "carnivore":
      if (tryShift(0.08, plantOpportunity * 0.6 + Math.max(0, 0.5 - preyOpportunity) * 0.8)) {
        return { diet: "omnivore", shifted: true };
      }
      return { diet: "carnivore", shifted: false };
    default:
      return { diet: inheritedDiet, shifted: false };
  }
}

function createOffspringData(p1: number, p2: number | null): OffspringData {
  const g1 = encodeEntity(p1).genome;
  const g2 = p2 === null ? null : encodeEntity(p2).genome;
  const lifeType = g1.lifeType;
  const genes = recombineGenesFromParents(p1, p2, lifeType);
  const mr = Math.max(0.012, decodeTrait(genes.mutationRate[0], genes.mutationRate[1]));

  const pick = <T>(a: T, b: T) => (rng() < 0.5 ? a : b);
  const mixSpeciesClass = () => {
    const inherited = g2 ? pick(g1.speciesClass, g2.speciesClass) : g1.speciesClass;
    if (lifeType === "plant") return "insect" as SpeciesClass;
    if (rng() < mr * 0.03) {
      const classes: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
      return classes[(rng() * classes.length) | 0];
    }
    return inherited;
  };
  const mixBiome = () => {
    const inherited = g2 ? pick(g1.preferredBiome, g2.preferredBiome) : g1.preferredBiome;
    if (rng() < mr * 0.06) return BIOMES[(rng() * BIOMES.length) | 0];
    return inherited;
  };

  const speciesClass = mixSpeciesClass();
  const preferredBiome = mixBiome();
  const inheritedDiet = lifeType === "plant"
    ? "photosynthesis"
    : normalizeDiet("animal", g2 ? pick(g1.diet, g2.diet) : g1.diet);
  const derivedSize = decodeTrait(genes.size[0], genes.size[1]);
  const derivedVision = lifeType === "plant" ? 0 : decodeTrait(genes.vision[0], genes.vision[1]);
  const derivedHostility = decodeTrait(genes.hostility[0], genes.hostility[1]);
  const dietMutation = lifeType === "animal"
    ? maybeMutateAnimalDiet(p1, inheritedDiet, mr, speciesClass, derivedSize, derivedVision, derivedHostility)
    : { diet: "photosynthesis" as Diet, shifted: false };
  const diet = lifeType === "plant" ? "photosynthesis" : dietMutation.diet;
  const reproduction = g2 ? pick(g1.reproduction, g2.reproduction) : g1.reproduction;
  const activity = g2 ? pick(g1.activity, g2.activity) : g1.activity;
  const speciesId = g2
    ? (geneticCompatibility(p1, p2!) >= 0.8 ? pick(g1.speciesId, g2.speciesId) : (Math.max(g1.speciesId, g2.speciesId) + 1) % SPECIES_MAX)
    : g1.speciesId;
  const inheritedSupplementalCarn = g2 ? pick(g1.supplementalCarnivory, g2.supplementalCarnivory) : g1.supplementalCarnivory;
  const plantNutritionStress =
    lifeType === "plant"
      ? clamp01(Math.max(0, 0.52 - energyA[p1]) * 1.8 + Math.max(0, 0.45 - hydrationA[p1]) * 1.2)
      : 0;
  const nearbyInsects = lifeType === "plant" ? findAllNeighbors(p1, 2, (j) => lifeTypeA[j] === 1 && classA[j] === 5).length : 0;
  const supplementalCarnivory = lifeType === "plant"
    ? (
      inheritedSupplementalCarn ||
      (rng() < clamp01(mr * 0.18 * (0.2 + plantNutritionStress + nearbyInsects / 7)))
    )
    : false;

  const genome: Genome = {
    speciesId,
    lifeType,
    speciesClass,
    diet,
    reproduction,
    hostility: decodeTrait(genes.hostility[0], genes.hostility[1]),
    speed: lifeType === "plant" ? 0 : decodeTrait(genes.speed[0], genes.speed[1]),
    size: decodeTrait(genes.size[0], genes.size[1]),
    vision: lifeType === "plant" ? 0 : decodeTrait(genes.vision[0], genes.vision[1]),
    fertility: decodeTrait(genes.fertility[0], genes.fertility[1]),
    maturityAge: decodeAgeTrait(genes.maturityAge[0], genes.maturityAge[1], MATURITY_MIN, MATURITY_MAX),
    maxAge: decodeAgeTrait(genes.maxAge[0], genes.maxAge[1], MAX_AGE_MIN, MAX_AGE_MAX),
    camouflage: decodeTrait(genes.camouflage[0], genes.camouflage[1]),
    sociality: decodeTrait(genes.sociality[0], genes.sociality[1]),
    activity,
    temperatureTolerance: decodeTrait(genes.temperatureTolerance[0], genes.temperatureTolerance[1]),
    preferredBiome,
    seedSpread: lifeType === "plant" ? decodeTrait(genes.seedSpread[0], genes.seedSpread[1]) : 0,
    mutationRate: decodeTrait(genes.mutationRate[0], genes.mutationRate[1]),
    supplementalCarnivory,
  };
  return { genome, genes, shiftedDiet: dietMutation.shifted };
}

type RainCell = {
  x: number;
  y: number;
  radius: number;
  intensity: number;
};

function getRainCells(t: number): RainCell[] {
  const phase = t * 0.0035;
  const cells: RainCell[] = [];
  const cellCount = 3;
  for (let i = 0; i < cellCount; i++) {
    const p = phase + i * 2.1 + weatherSeed * 0.00007;
    const x = Math.floor(((Math.sin(p * 0.91) * 0.5 + 0.5) * 0.82 + 0.09) * (W - 1));
    const y = Math.floor(((Math.cos(p * 1.13) * 0.5 + 0.5) * 0.82 + 0.09) * (H - 1));
    const radius = 34 + Math.floor((Math.sin(p * 0.57) * 0.5 + 0.5) * 22);
    const intensity = 0.45 + (Math.cos(p * 0.77) * 0.5 + 0.5) * 0.55;
    cells.push({ x, y, radius, intensity });
  }
  return cells;
}

function getRainAmountAt(x: number, y: number, rainCells: RainCell[]): number {
  let amount = 0;
  for (const c of rainCells) {
    const dx = x - c.x;
    const dy = y - c.y;
    const d = Math.hypot(dx, dy);
    if (d >= c.radius) continue;
    const falloff = 1 - d / c.radius;
    amount += c.intensity * falloff;
  }
  return clamp01(amount);
}

function isFlammableBiome(b: number) {
  return b === 0 || b === 1 || b === 2 || b === 4; // grassland/forest/desert/wetlands
}

function biomeDrynessFactor(b: number) {
  if (b === 1) return 0.58; // forest
  if (b === 0) return 0.52; // grassland
  if (b === 2) return 0.42; // desert (lower fuel)
  if (b === 4) return 0.22; // wetlands
  if (b === 3) return 0.2; // tundra
  return 0.15;
}

function hasPlantFuelNear(tileIndex: number): boolean {
  const x = tileIndex % W;
  const y = (tileIndex / W) | 0;
  const center = occ[tileIndex];
  if (center !== -1 && lifeTypeA[center] === 0) return true;
  for (const [dx, dy] of N8) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const j = occ[idx(nx, ny)];
    if (j !== -1 && lifeTypeA[j] === 0) return true;
  }
  return false;
}

function localDryness(tileIndex: number, rainAmount: number): number {
  const b = biomeMap[tileIndex];
  const moisture = moistureMap[tileIndex];
  const biomeDryness = biomeDrynessFactor(b);
  return clamp01((1 - moisture) * 0.58 + biomeDryness * 0.42 - rainAmount * 0.78);
}

function addFireAt(tileIndex: number, ttl = 120) {
  if (waterMap[tileIndex] === 1) return;
  if (!isFlammableBiome(biomeMap[tileIndex])) return;
  if (fireTTLMap[tileIndex] === 0) {
    activeFires.push(tileIndex);
    activeFireCount++;
  }
  fireTTLMap[tileIndex] = Math.max(fireTTLMap[tileIndex], ttl);
}

function spawnLightning(rainCells: RainCell[]) {
  if (rng() > LIGHTNING_STRIKE_CHANCE) return;
  const cell = rainCells[(rng() * rainCells.length) | 0];
  for (let tries = 0; tries < 20; tries++) {
    const rx = Math.floor(cell.x + (rng() - 0.5) * cell.radius * 1.2);
    const ry = Math.floor(cell.y + (rng() - 0.5) * cell.radius * 1.2);
    if (rx < 0 || ry < 0 || rx >= W || ry >= H) continue;
    const p = idx(rx, ry);
    if (waterMap[p] === 1) continue;
    if (!hasPlantFuelNear(p)) continue;
    const b = biomeMap[p];
    const rain = getRainAmountAt(rx, ry, rainCells);
    const dryness = localDryness(p, rain);
    if (dryness < 0.28) continue;
    const strikeChance = (b === 1 ? 0.52 : b === 0 ? 0.33 : b === 4 ? 0.1 : 0.08) * (0.6 + dryness * 0.7);
    if (rng() < strikeChance) {
      addFireAt(p, 70 + ((rng() * 70) | 0));
      lastLightningTick = tick;
      lastLightningX = rx;
      lastLightningY = ry;
      lightningFlashUntil = tick + 10;
      return;
    }
  }
}

function updateFires(rainCells: RainCell[]) {
  if (activeFires.length === 0) return;
  const nextActive: number[] = [];
  const newlyIgnited: number[] = [];
  for (const p of activeFires) {
    let ttl = fireTTLMap[p];
    if (ttl <= 0) continue;
    const x = p % W;
    const y = (p / W) | 0;
    const rain = getRainAmountAt(x, y, rainCells);
    ttl = Math.max(0, ttl - 1 - Math.floor(rain * 2));
    fireTTLMap[p] = ttl;
    if (ttl > 0) {
      nextActive.push(p);
      const spreadRolls = ttl % 9 === 0 ? 2 : 1;
      for (let s = 0; s < spreadRolls; s++) {
        const dir = N8[(rng() * N8.length) | 0];
        const nx = x + dir[0];
        const ny = y + dir[1];
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const np = idx(nx, ny);
        if (waterMap[np] === 1 || fireTTLMap[np] > 0 || !isFlammableBiome(biomeMap[np])) continue;
        if (!hasPlantFuelNear(np)) continue;
        const b = biomeMap[np];
        const dryness = localDryness(np, rain);
        const baseSpread = b === 1 ? 0.18 : b === 0 ? 0.11 : b === 2 ? 0.06 : 0.04;
        const dampedSpread = baseSpread * dryness * (1 - rain * 0.9);
        if (rng() < dampedSpread) {
          const ttlNew = 80 + ((rng() * 80) | 0);
          if (fireTTLMap[np] === 0) {
            fireTTLMap[np] = ttlNew;
            activeFireCount++;
            newlyIgnited.push(np);
          } else {
            fireTTLMap[np] = Math.max(fireTTLMap[np], ttlNew);
          }
        }
      }
    } else if (fireTTLMap[p] !== 0) {
      fireTTLMap[p] = 0;
      activeFireCount = Math.max(0, activeFireCount - 1);
    }
  }
  activeFires = nextActive.concat(newlyIgnited);
}

function pickWaterGradientStep(i: number): { dx: number; dy: number } | null {
  const cx = xA[i];
  const cy = yA[i];
  const currentDist = waterDistanceMap[idx(cx, cy)];
  let bestDx = 0;
  let bestDy = 0;
  let bestScore = currentDist;
  for (const [dx, dy] of N8) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const p = idx(nx, ny);
    if (occ[p] !== -1) continue;
    if (fireTTLMap[p] > 0) continue;
    const d = waterDistanceMap[p];
    if (d < bestScore) {
      bestScore = d;
      bestDx = dx;
      bestDy = dy;
    }
  }
  if (bestScore < currentDist) return { dx: bestDx, dy: bestDy };
  return null;
}

function habitatSuitabilityAt(i: number, x: number, y: number): number {
  const p = idx(x, y);
  if (fireTTLMap[p] > 0) return -1;
  if (waterMap[p] === 1 && classA[i] !== 0) return -0.2; // non-fish avoid water tiles
  const b = biomeMap[p];
  const bp = BIOME_PROPS[BIOMES[b]];
  const classList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
  const cls: SpeciesClass = classList[classA[i]];
  const clsP = CLASS_PROPS[cls];
  const tempFit = 1 - getTemperatureStress(tempTolA[i], bp.temp, bp.tempRange);
  const biomeFit = prefBiomeA[i] === b ? 1 : 0.3;
  const moisture = moistureMap[p];
  const waterAccess = clsP.canUseWater ? clamp01(1 - waterDistanceMap[p] / 90) : 0.45;
  return biomeFit * 0.34 + tempFit * 0.34 + moisture * 0.18 + waterAccess * 0.14;
}

function pickHabitatStep(i: number): { dx: number; dy: number } | null {
  const cx = xA[i];
  const cy = yA[i];
  const currentScore = habitatSuitabilityAt(i, cx, cy);
  let bestScore = currentScore;
  let bestDx = 0;
  let bestDy = 0;
  for (const [dx, dy] of N8) {
    const nx = cx + dx;
    const ny = cy + dy;
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const p = idx(nx, ny);
    if (occ[p] !== -1) continue;
    const s = habitatSuitabilityAt(i, nx, ny);
    if (s > bestScore + 0.015) {
      bestScore = s;
      bestDx = dx;
      bestDy = dy;
    }
  }
  if (bestDx !== 0 || bestDy !== 0) return { dx: bestDx, dy: bestDy };
  return null;
}

function stepOnce() {
  tick++;
  startNextDayIfNeeded();
  const night = isNight(tick);
  const rainCells = getRainCells(tick);
  rainCoverageNow = Math.min(
    1,
    rainCells.reduce((sum, c) => sum + Math.PI * c.radius * c.radius, 0) / (W * H)
  );
  spawnLightning(rainCells);
  updateFires(rainCells);
  let liveAnimals = 0;
  let livePlants = 0;

  // randomized sweep to reduce directional bias
  const start = (tick * 9973) % (count || 1);

  for (let n = 0; n < count; n++) {
    const i = (start + n) % count;
    if (!aliveA[i]) continue;

    ageA[i] += 1;
    adultA[i] = ageA[i] >= maturityA[i] ? 1 : 0;
    if (dietShiftPenaltyA[i] > 0) dietShiftPenaltyA[i]--;
    if (plantTrapCooldownA[i] > 0) plantTrapCooldownA[i]--;
    plantFeedHistoryA[i] *= 0.992;
    preyFeedHistoryA[i] *= 0.992;
    starvationStressA[i] *= 0.994;

    const b = biomeMap[idx(xA[i], yA[i])];
    const bp = BIOME_PROPS[BIOMES[b]];
    const classList: SpeciesClass[] = ["fish", "mammal", "bird", "reptile", "amphibian", "insect"];
    const cls: SpeciesClass = classList[classA[i]];
    const clsP = CLASS_PROPS[cls];
    const onWater = waterMap[idx(xA[i], yA[i])] === 1;
    const rainAmount = getRainAmountAt(xA[i], yA[i], rainCells);

    // Hydration
    const hydUse = BASE_HYDRATION_DECAY * bp.hydrationFactor * clsP.hydrationUse * (1 - rainAmount * 0.35);
    hydrationA[i] = clamp01(hydrationA[i] - hydUse);
    if (onWater && clsP.canUseWater) {
      hydrationA[i] = clamp01(hydrationA[i] + DRINK_RATE);
    } else if (clsP.canUseWater) {
      hydrationA[i] = clamp01(hydrationA[i] + moistureMap[idx(xA[i], yA[i])] * MOISTURE_REHYDRATION_GAIN);
    }
    if (rainAmount > 0) hydrationA[i] = clamp01(hydrationA[i] + RAIN_HYDRATION_GAIN * rainAmount);
    // fish must remain on water
    if (clsP.mustStayOnWater && !onWater) {
      hydrationA[i] = clamp01(hydrationA[i] - 0.02);
    }
    if (energyA[i] < 0.22) {
      starvationStressA[i] = clamp01(starvationStressA[i] + 0.016);
    }

    // Temperature stress calculation
    const biomeProps = BIOME_PROPS[BIOMES[b]];
    const tempStress = getTemperatureStress(tempTolA[i], biomeProps.temp, biomeProps.tempRange);
    const stressFactor = 1 + tempStress * 2; // up to 3x energy cost under severe temp stress

    // Metabolism / Photosynthesis
    if (lifeTypeA[i] === 0) {
      const pIdx = idx(xA[i], yA[i]);
      const nearbyPlants = countPlantsAround(xA[i], yA[i], 2);
      // Enhanced night photosynthesis reduction with biome modifiers
      let lightModifier = night ? 0.12 : 1.0; // low night gain, stronger day-night cycle
      const biomeName = BIOMES[b];
      
      // Some biomes provide better light conditions
      if (biomeName === "grassland") lightModifier *= 1.1; // open sky
      else if (biomeName === "forest" && !night) lightModifier *= 0.9; // some shade
      else if (biomeName === "desert") lightModifier *= 1.15; // intense sun
      else if (biomeName === "tundra") lightModifier *= 0.8; // less sunlight
      
      const crowdPenalty = b === 5 ? 0.06 : b === 4 ? 0.055 : 0.04;
      const crowdFactor = Math.max(0.24, 1 - nearbyPlants * crowdPenalty);
      const coastNutrient = clamp01(1 - waterDistanceMap[pIdx] / 26);
      const nutrientFactor = b === 5
        ? 0.34 + coastNutrient * 0.66
        : waterMap[pIdx] === 1
          ? 0.55 + coastNutrient * 0.45
          : 1.0;
      const rate = PLANT_PHOTOSYNTHESIS_RATE * lightModifier * biomeProps.foodRegen * crowdFactor * nutrientFactor;
      const plantUpkeep = TICK_ENERGY_DECAY * 0.5 * stressFactor;
      const bloomStress = Math.max(0, nearbyPlants - (b === 5 ? 7 : 10)) * 0.00005;
      energyA[i] = clamp01(energyA[i] + rate - plantUpkeep - bloomStress + rainAmount * RAIN_PLANT_GROWTH_BONUS);
      if (supplementalCarnA[i] === 1 && plantTrapCooldownA[i] <= 0) {
        const insectPrey = findBestNeighborByScore(
          i,
          1,
          (j) => lifeTypeA[j] === 1 && classA[j] === 5 && sizeA[j] <= Math.max(0.45, sizeA[i] + 0.25),
          (j) => 0.4 + energyA[j] * 0.6
        );
        const trapDrive = clamp01(0.35 + starvationStressA[i] + Math.max(0, 0.7 - energyA[i]));
        if (insectPrey !== -1 && rng() < SUPPLEMENTAL_PLANT_TRAP_CHANCE * trapDrive) {
          energyA[i] = clamp01(energyA[i] + energyA[insectPrey] * SUPPLEMENTAL_PLANT_CARNIVORY_GAIN);
          recordDeath(insectPrey, "predation");
          removeAt(insectPrey);
          plantTrapCooldownA[i] = SUPPLEMENTAL_PLANT_TRAP_COOLDOWN;
        }
      }
    } else {
      const baseUpkeep = TICK_ENERGY_DECAY * (1 + sizeA[i] * SIZE_BONUS_FACTOR + speedA[i] * 0.5);
      const shiftPenalty = dietShiftPenaltyA[i] > 0 ? DIET_SHIFT_EXTRA_METABOLISM : 1;
      const animalUpkeep = baseUpkeep * stressFactor * behaviorTuning.animalMetabolismMultiplier * shiftPenalty;
      energyA[i] = clamp01(energyA[i] - animalUpkeep);
      if (dietShiftPenaltyA[i] > 0) {
        hydrationA[i] = clamp01(hydrationA[i] - BASE_HYDRATION_DECAY * (DIET_SHIFT_EXTRA_HYDRATION - 1));
      }
    }

    // Activity window
    const active = (activityA[i] === 0 && !night) || (activityA[i] === 1 && night) || activityA[i] === 2;

    // Behavior & movement (animals)
    if (lifeTypeA[i] === 1 && active) {
      const maxVis = 1 + Math.floor(clamp01(visionA[i] + clsP.visionBonus) * VISION_TILES_MAX);
      if (reproStateA[i] === 0 && !!adultA[i]) {
        breedingReadinessA[i] = calculateBreedingReadiness(i);
      }
      const readinessNow = breedingReadinessA[i];

      // Motives: thirst, hunger, mating and fear.
      const thirstDrive = clamp01((0.8 - hydrationA[i]) * 1.6) * behaviorTuning.thirstWeight;
      const hungerDrive = clamp01((0.82 - energyA[i]) * 1.55) * behaviorTuning.hungerWeight;
      const mateDrive =
        reproStateA[i] === 0 && !!adultA[i]
          ? clamp01(Math.max(0, readinessNow * 1.2 + (energyA[i] - 0.45) * 0.6)) * behaviorTuning.mateWeight
          : 0;
      const predatorPressure = countNearbyPredators(i);
      const fearDrive = clamp01(predatorPressure * 0.18 + Math.max(0, 0.45 - energyA[i]) * 0.25 - hostilityA[i] * 0.12) * behaviorTuning.fearWeight;
      const habitatMismatch = prefBiomeA[i] === b ? 0 : 0.35;
      const waterStress = clsP.canUseWater ? Math.max(0, waterDistanceMap[idx(xA[i], yA[i])] / 95 - 0.14) : 0;
      const habitatDrive = clamp01(habitatMismatch + tempStress * 0.9 + waterStress);

      let waterTarget = null as { x: number; y: number } | null;
      let foodTarget = -1;
      let mateTarget = -1;
      let threatTarget = -1;

      if (thirstDrive > 0.06 && clsP.canUseWater) {
        waterTarget = findNearestWater(xA[i], yA[i], maxVis);
      }
      if (hungerDrive > 0.08) {
        if (dietA[i] === 1 || dietA[i] === 3) {
          foodTarget = findBestNeighborByScore(
            i,
            maxVis,
            (j) => lifeTypeA[j] === 0 && canSee(i, j, Math.max(Math.abs(xA[j] - xA[i]), Math.abs(yA[j] - yA[i]))),
            (j, dist) => hungerDrive * (0.25 + energyA[j] * 0.75) * (1 / (dist + 0.5)),
          );
        }
        if (foodTarget === -1 && (dietA[i] === 2 || dietA[i] === 3)) {
          foodTarget = findBestNeighborByScore(
            i,
            maxVis,
            (j) =>
              lifeTypeA[j] === 1 &&
              j !== i &&
              sizeA[j] < sizeA[i] &&
              (
                (
                  dietA[j] !== 2 && // avoid carnivore-on-carnivore collapse by default
                  !(dietA[i] === 3 && dietA[j] === 3) // omnivores avoid hunting omnivores normally
                ) ||
                (hungerDrive > 0.92 && energyA[i] < 0.18 && hostilityA[i] > 0.85) // desperate fallback cannibalism
              ) &&
              canSee(i, j, Math.max(Math.abs(xA[j] - xA[i]), Math.abs(yA[j] - yA[i]))),
            (j, dist) => {
              const preyValue = Math.max(0.1, energyA[j]);
              const risk = Math.max(0.2, 1 - Math.max(0, sizeA[j] - sizeA[i]) * 2);
              return hungerDrive * preyValue * risk * (1 / (dist + 0.5));
            },
          );
        }
      }
      if (mateDrive > 0.32) {
        mateTarget = findBestMate(i);
      }
      if (fearDrive > 0.15) {
        threatTarget = findBestNeighborByScore(
          i,
          Math.min(4, maxVis),
          (j) =>
            lifeTypeA[j] === 1 &&
            j !== i &&
            (dietA[j] === 2 || dietA[j] === 3) &&
            sizeA[j] >= sizeA[i] &&
            hostilityA[j] > 0.35,
          (_j, dist) => fearDrive * (1 / (dist + 0.5)),
        );
      }

      // Move chance (class bonus + motive boost) + biome move cost.
      const baseMove = clamp01((speedA[i] * clsP.moveSpeedBonus) / bp.moveCost);
      const strongestDrive = Math.max(thirstDrive, hungerDrive, mateDrive, fearDrive, habitatDrive);
      const motiveBoost = 0.12 + strongestDrive * behaviorTuning.motiveMoveBoostMax;
      if (rng() < clamp01(baseMove + motiveBoost)) {
        let dx = 0, dy = 0;
        
        if (threatTarget !== -1 && fearDrive >= Math.max(thirstDrive, hungerDrive, mateDrive)) {
          dx = Math.sign(xA[i] - xA[threatTarget]);
          dy = Math.sign(yA[i] - yA[threatTarget]);
        } else if (waterTarget !== null && thirstDrive >= Math.max(hungerDrive, mateDrive)) {
          dx = Math.sign(waterTarget.x - xA[i]);
          dy = Math.sign(waterTarget.y - yA[i]);
        } else if (thirstDrive > 0.12 && clsP.canUseWater) {
          const stepToWater = pickWaterGradientStep(i);
          if (stepToWater) {
            dx = stepToWater.dx;
            dy = stepToWater.dy;
          }
        } else if (habitatDrive > 0.18) {
          const habitatStep = pickHabitatStep(i);
          if (habitatStep) {
            dx = habitatStep.dx;
            dy = habitatStep.dy;
          }
        } else if (foodTarget !== -1) {
          dx = Math.sign(xA[foodTarget] - xA[i]);
          dy = Math.sign(yA[foodTarget] - yA[i]);
        } else if (mateTarget !== -1) {
          dx = Math.sign(xA[mateTarget] - xA[i]);
          dy = Math.sign(yA[mateTarget] - yA[i]);
        } else {
          dx = Math.sign(rng() - 0.5);
          dy = Math.sign(rng() - 0.5);
        }

        // Fish avoid leaving water
        if (clsP.mustStayOnWater) {
          const nx = Math.max(0, Math.min(W - 1, xA[i] + dx));
          const ny = Math.max(0, Math.min(H - 1, yA[i] + dy));
          if (waterMap[idx(nx, ny)] !== 1) {
            dx = 0;
            dy = 0;
          }
        }
        if (dx !== 0 || dy !== 0) {
          const nx = Math.max(0, Math.min(W - 1, xA[i] + dx));
          const ny = Math.max(0, Math.min(H - 1, yA[i] + dy));
          if (moveEntity(i, nx, ny)) {
            energyA[i] = clamp01(energyA[i] - MOVE_ENERGY_COST * (1 + sizeA[i] * 0.5) * bp.moveCost);
          }
        }
      }

      // Interactions: feed from adjacent targets.
      // Plants are consumed by herbivores/omnivores; animals are hunted by carnivores/omnivores.
      const plantAdj = (dietA[i] === 1 || dietA[i] === 3)
        ? findBestNeighborByScore(
            i,
            1,
            (j) => lifeTypeA[j] === 0,
            (j) => 0.5 + energyA[j],
          )
        : -1;
      const preyAdj = (dietA[i] === 2 || dietA[i] === 3)
        ? findBestNeighborByScore(
            i,
            1,
            (j) =>
              lifeTypeA[j] === 1 &&
              j !== i &&
              sizeA[j] < sizeA[i] &&
              (
                (
                  dietA[j] !== 2 &&
                  !(dietA[i] === 3 && dietA[j] === 3)
                ) ||
                (hungerDrive > 0.92 && energyA[i] < 0.18 && hostilityA[i] > 0.85)
              ),
            (j) => {
              const sizeAdv = Math.max(0.05, sizeA[i] - sizeA[j] + 0.5);
              return sizeAdv * (0.3 + energyA[j] * 0.7);
            },
          )
        : -1;
      if (hungerDrive > 0.16 || rng() < behaviorTuning.opportunisticFeedChance) {
        if (plantAdj !== -1) {
          const bite = behaviorTuning.plantBiteAmount;
          const taken = Math.min(bite, energyA[plantAdj]);
          const plantDigest =
            dietA[i] === 1 ? PLANT_DIGESTION_EFFICIENCY_HERB : PLANT_DIGESTION_EFFICIENCY_OMNI;
          energyA[i] = clamp01(energyA[i] + taken * plantDigest);
          plantFeedHistoryA[i] = clamp01(plantFeedHistoryA[i] + taken * 0.18);
          energyA[plantAdj] -= taken;
          if (energyA[plantAdj] <= 0.05) {
            // Count full plant consumption as an ecological predation death so diagnostics align with true population loss.
            recordDeath(plantAdj, 'predation');
            removeAt(plantAdj);
          }
        } else if (preyAdj !== -1) {
          const sizeAdv = Math.max(0, sizeA[i] - sizeA[preyAdj]);
          const stealthPenalty = camoA[preyAdj] * 0.35 + speedA[preyAdj] * 0.25;
          const chance = clamp01(0.08 + hostilityA[i] * 0.42 + sizeAdv * 0.32 - stealthPenalty);
          if (rng() < chance) {
            const meatDigest =
              dietA[i] === 2 ? MEAT_DIGESTION_EFFICIENCY_CARN : MEAT_DIGESTION_EFFICIENCY_OMNI;
            energyA[i] = clamp01(
              energyA[i] + energyA[preyAdj] * behaviorTuning.attackEnergyGain * meatDigest
            );
            preyFeedHistoryA[i] = clamp01(preyFeedHistoryA[i] + 0.24);
            recordDeath(preyAdj, 'predation');
            removeAt(preyAdj);
          } else {
            energyA[i] = clamp01(energyA[i] - 0.03);
          }
        }
      }
      // Social bonus
      if (socialA[i] > 0.6) {
        const buddy = findBestNeighborByScore(
          i,
          2,
          (j) => j !== i && lifeTypeA[j] === lifeTypeA[i] && geneticCompatibility(i, j) > 0.7,
          (j, dist) => geneticCompatibility(i, j) * (1 / (dist + 0.5))
        );
        if (buddy !== -1) energyA[i] = clamp01(energyA[i] + 0.001);
      }
      
      // Parental care behavior
      updateParentalCare(i);
    }

    // Fire damage and evacuation pressure.
    const tileFire = fireTTLMap[idx(xA[i], yA[i])];
    if (tileFire > 0) {
      hydrationA[i] = clamp01(hydrationA[i] - 0.014);
      energyA[i] = clamp01(energyA[i] - (lifeTypeA[i] === 0 ? 0.09 : 0.03));
      if (lifeTypeA[i] === 1) {
        const escape = pickWaterGradientStep(i);
        if (escape) {
          const nx = Math.max(0, Math.min(W - 1, xA[i] + escape.dx));
          const ny = Math.max(0, Math.min(H - 1, yA[i] + escape.dy));
          moveEntity(i, nx, ny);
        }
      }
      if (energyA[i] <= 0 || hydrationA[i] <= 0) {
        recordDeath(i, 'fire');
        removeAt(i);
        continue;
      }
    }

    // Reproduction
    if (count < MAX_ENTITIES) {
      tryReproduce(i);
    }

    // Death: starvation/dehydration/age + temperature stress
    const biomeTemp = BIOME_PROPS[BIOMES[b]].temp;
    const tol = tempTolA[i];
    const coldStress = Math.max(0, 0.3 - biomeTemp - (tol - 0.3));
    const heatStress = Math.max(0, biomeTemp - 0.7 - (tol - 0.3));
    const tempPenalty = 0.001 * (coldStress + heatStress);

    energyA[i] = clamp01(energyA[i] - tempPenalty);

    if (energyA[i] <= 0 || hydrationA[i] <= 0 || ageA[i] >= maxAgeA[i]) {
      // Record death cause for analytics
      if (energyA[i] <= 0) recordDeath(i, 'starvation');
      else if (hydrationA[i] <= 0) recordDeath(i, 'dehydration');  
      else if (ageA[i] >= maxAgeA[i]) recordDeath(i, 'age');
      
      removeAt(i);
      continue;
    }

    if (lifeTypeA[i] === 1) liveAnimals++;
    else livePlants++;
  }

  // Authoritative counters derived from actual alive entities for this tick.
  animals = liveAnimals;
  plants = livePlants;
  total = liveAnimals + livePlants;
  
  // Update reproduction states and eggs after all entity updates
  updateReproductionStates();
  updateEggs();
  updateSpeciesStats();
}
