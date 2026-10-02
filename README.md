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
geometry scores, copper/hole IoU, pin matching metrics, optimized parameters,
and search diagnostics. `pinMatchRate`, `pinsMatch`, and `pinMismatches` compare
numeric and ball-coordinate `port_hints` on position-matched pads. When both
are present on both pads, both must agree. Coordinate-only targets use
coordinate-only candidates; they do not silently gain numeric aliases. Pin
mismatches reduce a candidate's ranking score. When a
match requires rotation, its string includes a `pin1location(...)` modifier; no
separate `pcbRotation` is emitted. The modifier names the edge containing pin 1,
then its alignment along that edge. For example, `pin1location(leftside,top)` means
pin 1 is on the left edge near the top, as in JLCPCB's RP2040 footprint. The base
QFN string above already has that orientation, so it needs no modifier. This is
different from `pin1location(topside,left)`, which places pin 1 on the top edge near
the left and cannot be produced from the RP2040 orientation by rotation alone. The
input must contain at least one `pcb_smtpad` or `pcb_plated_hole` element.

BGA discovery measures the occupied grid, including missing balls, and tries
`pinnumbering(rowmajor)`, `pinnumbering(columnmajor)`, and
`pinnumbering(ballcoords)` with each origin. Explicit conventions use package
row letters that skip I, O, Q, S, X, and Z, extending through AA and beyond.
Legacy row labels remain available for targets that use them. For example, the
624-ball i.MX6 footprint can be represented as
`bga624_grid25x25_p0.8mm_pad0.4mm_missing(1)_blorigin_pinnumbering(columnmajor)`.

Ambiguous two-pad components use a neutral `smdpads2_...` candidate with family
`passive` rather than implying that the component is a resistor. Explicit source
component types and reliable domain hints still select typed passive families such as
`res`, `cap`, or `diode`. When a standard package size is also known, an explicit
resistor or capacitor hint can select names such as `res0402` or `cap0402`; a bare
size such as `0402` remains neutral when the component type is unknown.

The package also exports `circuitJsonToFootprint`, `footprinterStringToFootprint`,
`compareFootprints`, `summarizeCopperComparison`, and `getFootprintBounds` so
applications can reuse the same shape parsing and comparison implementation as
the discovery engine. Browser-only comparison code can import the lightweight
`circuit-json-to-footprinter/compare` entry point without bundling the discovery
engine or `@tscircuit/footprinter`.

Copper and hole IoU scores use `@tscircuit/manifold-2d` boolean intersections
and unions, so scores do not depend on a raster resolution. `compareFootprints`
still returns a raster occupancy map for rendering a visual diff heatmap; that
map does not affect any comparison metric or discovery ranking.

`Footprint.pads` contains the original `PcbSmtPad | PcbPlatedHole` elements,
`Footprint.holes` contains the original `PcbHole` elements, and
`Footprint.vias` contains the original `PcbVia` elements from
[`circuit-json`](https://github.com/tscircuit/circuit-json). Via annuli contribute
to copper IoU and via drills contribute to hole IoU without changing pad counts.
The converter does not expose custom pad, hole, or via types.

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
