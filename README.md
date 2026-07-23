# circuit-json-to-footprinter

Discover the parameterized [`@tscircuit/footprinter`](https://github.com/tscircuit/footprinter) string that best represents the PCB pads in Circuit JSON.

The search combines footprint-family heuristics with continuous optimization of dimensions such as pitch, body width, pad width, pad length, drill diameter, and thermal-pad size. Candidates are ranked using copper and hole intersection-over-union plus optional domain hints.

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

The result includes the best self-contained footprinter string, ranked alternatives,
geometry scores, copper/hole IoU, optimized parameters, and search diagnostics. When a
match requires rotation, its string includes a `pin1location(...)` modifier; no
separate `pcbRotation` is emitted. The modifier names the edge containing pin 1,
then its alignment along that edge. For example, `pin1location(leftside,top)` means
pin 1 is on the left edge near the top, as in JLCPCB's RP2040 footprint. The base
QFN string above already has that orientation, so it needs no modifier. This is
different from `pin1location(topside,left)`, which places pin 1 on the top edge near
the left and cannot be produced from the RP2040 orientation by rotation alone. The
input must contain at least one `pcb_smtpad` or `pcb_plated_hole` element.

The package also exports `circuitJsonToPreview`, `footprinterStringToPreview`,
`compareFootprints`, `summarizeCopperComparison`, and `getFootprintBounds` so
applications can reuse the same shape parsing and comparison implementation as
the discovery engine. Browser-only comparison code can import the lightweight
`circuit-json-to-footprinter/compare` entry point without bundling the discovery
engine or `@tscircuit/footprinter`.

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
exits non-zero for parts below 95% copper IoU. See the
[JLC top-stock footprint audit](docs/jlc-top-stock-audit.md) for the latest
snapshot and proposed footprinter additions.

## License

MIT
