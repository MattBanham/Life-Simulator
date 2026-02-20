# Contributing

Thanks for contributing to Life Simulator v1.

## Getting Started

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run lint
npm run build
```

## How To Contribute

1. Fork the repo and create a branch.
2. Keep changes focused and small when possible.
3. Run lint/build before opening a PR.
4. Open a PR with a clear summary and testing notes.

## Pull Request Checklist

- [ ] I ran `npm run lint`
- [ ] I ran `npm run build`
- [ ] I described behavior changes and tradeoffs
- [ ] I included screenshots/GIFs for UI changes (if applicable)

## Coding Notes

- Main simulation logic: `src/simLogic.ts`
- UI container: `src/EvolutionSimulator.tsx`
- Renderer: `src/render/livingAtlasRenderer.ts`
- Types: `src/types.ts`

## Reporting Bugs

Please include:

- Steps to reproduce
- Expected vs actual behavior
- Browser/OS info
- World preset, entity counts, and TPS (if relevant)
- Screenshot or short recording if possible
