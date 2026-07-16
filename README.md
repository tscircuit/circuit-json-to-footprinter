# circuit-json-to-footprinter

Discover the parameterized [`@tscircuit/footprinter`](https://github.com/tscircuit/footprinter) string that best represents the PCB pads in Circuit JSON.

The search combines footprint-family heuristics with continuous optimization of dimensions such as pitch, body width, pad width, pad length, plated-hole size, and thermal-pad size. Candidates are ranked using copper and hole intersection-over-union plus optional domain hints.

## Install

```bash
npm install circuit-json-to-footprinter
```

## Usage

```ts
import { circuitJsonToFootprinter } from "circuit-json-to-footprinter"

const result = circuitJsonToFootprinter(circuitJson, {
  maxCandidates: 5,
  sourceHints: ["QFN-56 exposed pad"],
})

console.log(result.best?.footprinterString)
// qfn56_thermalpad3.1mmx3.1mm_p0.4mm_w7mm_h7mm_pw0.2mm_pl0.85mm
```

The result includes the best match, ranked alternatives, geometry scores, separate `copperIntersectionOverUnion` and `holeIntersectionOverUnion` scores, optimized parameters, and search diagnostics. Hole IoU is `1` when both footprints contain no holes. The input must contain at least one `pcb_smtpad` or `pcb_plated_hole` element.

## Development

```bash
bun install
bun test
bun run typecheck
bun run format:check
bun run build
```

To benchmark the current highest-stock parts across representative JLC
categories, run `bun run audit:jlc`. The command requires network access and
exits non-zero for parts below 98% copper IoU. See the
[JLC top-stock footprint audit](docs/jlc-top-stock-audit.md) for the latest
snapshot and proposed footprinter additions.

## License

MIT
