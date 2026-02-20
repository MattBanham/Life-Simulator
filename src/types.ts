// src/types.ts

// ===== Core life classifications =====
export type LifeType = "plant" | "animal";
export const LifeType = {
  Plant: "plant" as LifeType,
  Animal: "animal" as LifeType,
};

// ===== Diet =====
export type Diet = "photosynthesis" | "herbivore" | "carnivore" | "omnivore";
export const Diet = {
  Photosynthesis: "photosynthesis" as Diet,
  Herbivore: "herbivore" as Diet,
  Carnivore: "carnivore" as Diet,
  Omnivore: "omnivore" as Diet,
};

// ===== Reproduction =====
export type Reproduction = "asexual" | "sexual";
export const Reproduction = {
  Asexual: "asexual" as Reproduction,
  Sexual: "sexual" as Reproduction,
};

// ===== Activity Cycle (3 states used in sim) =====
export type ActivityCycle = "diurnal" | "nocturnal" | "cathemeral";
export const ActivityCycle = {
  Diurnal: "diurnal" as ActivityCycle,
  Nocturnal: "nocturnal" as ActivityCycle,
  Cathemeral: "cathemeral" as ActivityCycle,
};

// ===== Species Class =====
export type SpeciesClass =
  | "fish"
  | "mammal"
  | "bird"
  | "reptile"
  | "amphibian"
  | "insect";
export const SpeciesClass = {
  Fish: "fish" as SpeciesClass,
  Mammal: "mammal" as SpeciesClass,
  Bird: "bird" as SpeciesClass,
  Reptile: "reptile" as SpeciesClass,
  Amphibian: "amphibian" as SpeciesClass,
  Insect: "insect" as SpeciesClass,
};

// ===== Biomes =====
export type Biome = "grassland" | "forest" | "desert" | "tundra" | "wetlands" | "ocean";
export const Biome = {
  Grassland: "grassland" as Biome,
  Forest: "forest" as Biome,
  Desert: "desert" as Biome,
  Tundra: "tundra" as Biome,
  Wetlands: "wetlands" as Biome,
  Ocean: "ocean" as Biome,
};

// ===== Genome =====
export type Genome = {
  speciesId: number; // cluster/color group
  lifeType: LifeType;
  speciesClass: SpeciesClass;
  diet: Diet;
  reproduction: Reproduction;
  hostility: number; // 0..1
  speed: number; // 0..1
  size: number; // 0..1
  vision: number; // tiles
  fertility: number; // 0..1
  maturityAge: number; // ticks
  maxAge: number; // ticks
  camouflage: number; // 0..1
  sociality: number; // 0..1
  activity: ActivityCycle;
  temperatureTolerance: number; // 0..1
  preferredBiome: Biome;
  seedSpread: number; // plants only
  mutationRate: number; // 0..1
  supplementalCarnivory: boolean; // plants only: venus-flytrap style bonus feeding
};

// ===== Entity Snapshot =====
export type EntitySnapshot = {
  id: number;
  x: number;
  y: number;
  genome: Genome;
  energy: number; // 0..1
  hydration: number; // 0..1
  age: number;
  alive: boolean;
  isAdult: boolean;
  reproductionState: ReproductionState;
  reproductionTimer: number; // ticks remaining in current state
  breedingReadiness: number; // 0..1
};

// ===== Reproduction System =====
export type ReproductionState = "ready" | "gestating" | "cooldown" | "incubating";
export const ReproductionState = {
  Ready: "ready" as ReproductionState,
  Gestating: "gestating" as ReproductionState,
  Cooldown: "cooldown" as ReproductionState,
  Incubating: "incubating" as ReproductionState,
};

export type EggGenes = {
  hostility: [number, number];
  speed: [number, number];
  size: [number, number];
  vision: [number, number];
  fertility: [number, number];
  camouflage: [number, number];
  sociality: [number, number];
  temperatureTolerance: [number, number];
  seedSpread: [number, number];
  mutationRate: [number, number];
  maturityAge: [number, number];
  maxAge: [number, number];
};

export type EggData = {
  speciesId: number;
  parentId1: number;
  parentId2: number | null;
  genome: Genome;
  genes: EggGenes;
  incubationTime: number;
  maxIncubationTime: number;
  x: number;
  y: number;
  viability: number; // 0-1, affected by environment
  shiftedDiet?: boolean; // temporary adaptation penalty on hatch
};

// ===== Species Statistics =====
export type SpeciesStats = {
  speciesId: number;
  population: number;
  dominantLifeType: "plant" | "animal" | null;
  dominantClass: SpeciesClass | null;
  dominantDiet: Diet | null;
  dominantActivity: ActivityCycle | null;
  avgEnergy: number;
  avgHydration: number;
  avgAge: number;
  meanTraits: {
    hostility: number;
    speed: number;
    size: number;
    vision: number;
    fertility: number;
    camouflage: number;
    sociality: number;
    temperatureTolerance: number;
  };
  dominantBiomes: Record<Biome, number>; // count per biome
  mortalityCauses: {
    starvation: number;
    dehydration: number;
    age: number;
    predation: number;
    fire: number;
  };
  lastSeen: number; // tick when last individual was alive
};

// ===== Mutation Event =====
export type MutationEvent = {
  tick: number;
  parentSpeciesId: number;
  newSpeciesId: number;
  entityId?: number;
  lifeType?: LifeType;
  deltas: Partial<Record<keyof Genome, number | string>>;
  countBorn: number;
  ecologicalContext?: string; // inferred driver
};

// ===== Display Options =====
export type BiomeDisplayMode = "subtle" | "enhanced" | "prominent" | "pure_biome";
export const BiomeDisplayMode = {
  Subtle: "subtle" as BiomeDisplayMode,
  Enhanced: "enhanced" as BiomeDisplayMode,
  Prominent: "prominent" as BiomeDisplayMode,
  PureBiome: "pure_biome" as BiomeDisplayMode,
};

export type ViewMode = "standard" | "energy" | "age" | "health" | "behavior" | "genetics" | "diet" | "temperature" | "biome_match";
export const ViewMode = {
  Standard: "standard" as ViewMode,
  Energy: "energy" as ViewMode,
  Age: "age" as ViewMode,
  Health: "health" as ViewMode,
  Behavior: "behavior" as ViewMode,
  Genetics: "genetics" as ViewMode,
  Diet: "diet" as ViewMode,
  Temperature: "temperature" as ViewMode,
  BiomeMatch: "biome_match" as ViewMode,
};

export type DisplayOptions = {
  // Biome settings
  biomeDisplayMode: BiomeDisplayMode;
  biomeIntensity: number; // 0-1 multiplier for biome colors
  showBiomeBorders: boolean;
  
  // Entity filtering
  showPlants: boolean;
  showAnimals: boolean;
  showEggs: boolean;
  showDead: boolean; // recently deceased
  
  // Species class filtering
  visibleSpeciesClasses: Set<SpeciesClass>;
  
  // View modes
  viewMode: ViewMode;
  
  // Information overlays
  showReproductionStates: boolean;
  showMutationGlow: boolean;
  showStressIndicators: boolean;
  showEnergyWarnings: boolean;
  
  // Enhanced visual features
  showShapes: boolean; // use shapes instead of pixels
  showTrails: boolean; // movement trail effects
  showSizeScaling: boolean; // scale entity size by genome
  showLifePulse: boolean; // breathing animation effect
  trailLength: number; // how many past positions to show (1-10)
  
  // Performance settings
  maxVisibleEntities: number; // 0 = no limit
  enableClustering: boolean; // group entities at low zoom
  
  // Multi-scale rendering and LOD system
  adaptiveDetailLevel: boolean; // automatically adjust detail based on zoom
  zoomThresholds: {
    maxDetail: number; // zoom >= this: full detail with all effects
    mediumDetail: number; // zoom >= this: medium detail, some effects disabled  
    lowDetail: number; // zoom >= this: basic rendering only
    clustering: number; // zoom < this: enable entity clustering
  };
  forceDetailLevel: "auto" | "high" | "medium" | "low"; // override adaptive system
};

export type BehaviorTuning = {
  thirstWeight: number;
  hungerWeight: number;
  mateWeight: number;
  fearWeight: number;
  motiveMoveBoostMax: number;
  opportunisticFeedChance: number;
  reproductionReadinessThreshold: number;
  animalMetabolismMultiplier: number;
  plantBiteAmount: number;
  attackEnergyGain: number;
};

export type DailyPopulationStats = {
  day: number;
  births: number;
  birthsPlants: number;
  birthsAnimals: number;
  deaths: number;
  deathsPlants: number;
  deathsAnimals: number;
  deathsByCause: {
    starvation: number;
    dehydration: number;
    age: number;
    predation: number;
    fire: number;
  };
  startPopulation: number;
  endPopulation: number;
  startPlants: number;
  endPlants: number;
  startAnimals: number;
  endAnimals: number;
  netPopulation: number;
};

export type PopulationDiagnostics = {
  currentDay: DailyPopulationStats;
  lastDay: DailyPopulationStats | null;
};

export type SpeciesDetails = {
  speciesId: number;
  population: number;
  dominantLifeType: "plant" | "animal" | null;
  dominantClass: SpeciesClass | null;
  dominantDiet: Diet | null;
  dominantActivity: ActivityCycle | null;
  dominantBiome: Biome | null;
  avgEnergy: number;
  avgHydration: number;
  avgAge: number;
  meanTraits: SpeciesStats["meanTraits"];
  mortalityCauses: SpeciesStats["mortalityCauses"];
};
