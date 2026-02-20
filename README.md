# Life Simulator v1

A browser-based ecosystem simulation with plants, animals, species-level traits, reproduction, predation, weather, mutation events, and multi-scale rendering.

## Status
This folder (`life_sim_v1`) is the primary working version and is set up as its own git repository.

## Run

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
```

## Core Mechanics

- Grid-based world with configurable world-size presets
- Plants and animals with diploid trait genetics
- Diet types: photosynthesis (plants), herbivore, carnivore, omnivore
- Reproduction: sexual/asexual, eggs, gestation/cooldowns
- Survival needs: energy, hydration, age limits, biome/temperature stress
- Predation and foraging logic
- Weather:
  - Rain coverage and moisture effects
  - Lightning strikes
  - Fire ignition/spread/suppression behavior
- Mutation logging with species lineage context
- Population diagnostics (daily births/deaths and causes)

## Current World Size Presets

- `250x250`
- `500x500`
- `640x400`
- `480x300`
- `320x200`

Changing world size reseeds the sim and scales default starting populations from the baseline:

- Baseline: `500x500 -> 15000 plants / 3000 animals`

Scaled defaults:

- `250x250 -> 3750P / 750A`
- `500x500 -> 15000P / 3000A`
- `640x400 -> 15360P / 3072A`
- `480x300 -> 8640P / 1728A`
- `320x200 -> 3840P / 768A`

## UI Notes

- App title: `Life Simulator v1`
- Speed slider includes lag warning
- Planetary/Regional/Local/Individual zoom presets
- Minimap (Navigator): click-drag to move viewport, collapsible
- Day/Night dial uses a full 360-deg orbit
- Top Species panel:
  - Category filter + ID search
  - Hover details panel
  - Plant species display as `Plant` (not insect)
- Species-class visibility filters apply to animals only (plants are controlled by `Show Plants`)
- Population Diagnostics:
  - Births and deaths each show total + `Animals/Plants` split
  - Death causes legend:
    - `S` Starvation
    - `D` Dehydration
    - `P` Predation
    - `F` Fire

## Behavior Tuning

Behavior sliders apply in real time (no reset required), including:

- thirst/hunger/mate/fear weights
- movement boost from motives
- opportunistic feeding chance
- reproduction readiness threshold
- animal metabolism multiplier
- plant bite amount
- attack energy gain

## Mutation Logging

- Mutation feed includes lineage (`From #parent -> Species #new`)
- Events include affected `Entity #id` and `lifeType` when available
- Diet shifts and supplemental carnivory shifts are logged as mutation events

## Simulation/Performance Notes

- TPS and entity count heavily influence performance.
- Large populations and zoomed-out full-map views can be expensive.
- LOD and clustering options exist in display settings.
- `Grid` is mostly a debug aid (visible only at high zoom).

## Known Gaps / Risks

- Some systems are intentionally stylized approximations and not strict biological models.
- Balance can still drift by seed (e.g., trophic stability, hydration pressure).

## Quick Troubleshooting

- If entities die too fast:
  - reduce TPS
  - lower animal metabolism
  - raise hunger/thirst behavior urgency
  - reduce predator aggression via behavior settings
- If plants explode:
  - lower start plants
  - use smaller world preset
  - watch rain coverage and plant birth pressure

## Development Conventions

- Main sim logic: `src/simLogic.ts`
- Main UI/component: `src/EvolutionSimulator.tsx`
- Renderer: `src/render/livingAtlasRenderer.ts`
- Shared types: `src/types.ts`
