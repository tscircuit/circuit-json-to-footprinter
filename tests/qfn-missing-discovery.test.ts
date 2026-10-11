import { expect, test } from "bun:test"
import { fp } from "@tscircuit/footprinter"
import type { AnyCircuitElement, PcbSmtPad } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { getTransformedPcbPadGeometry } from "../lib/footprint-geometry.js"
import {
  circuitJsonToFootprint,
  circuitJsonToFootprinter,
  footprinterStringToFootprint,
} from "../lib/index.js"
import { getQfnGridSeeds } from "../lib/qfn-grid-seeds.js"
import imx6 from "./fixture/imx6-bga624.json"
import source from "./fixture/qfn-nrf52840-source.json"

const sourcePads: Array<Extract<PcbSmtPad, { shape: "circle" | "rect" }>> =
  source.expectedCopper.map((pad, index) => ({
    type: "pcb_smtpad",
    pcb_smtpad_id: `source_${index}`,
    pcb_component_id: "source_component",
    layer: "top",
    x: pad.x,
    y: pad.y,
    port_hints: pad.pin === "EP" ? ["EP", "thermalpad"] : [pad.pin],
    ...(pad.radius !== undefined
      ? { shape: "circle", radius: pad.radius }
      : { shape: "rect", width: pad.width!, height: pad.height! }),
  }))

const assertExactRoundtrip = (
  elements: AnyCircuitElement[],
  snapshot?: string,
) => {
  const target = circuitJsonToFootprint(elements)
  const result = circuitJsonToFootprinter(elements)
  expect(result.best).not.toBeNull()
  expect(result.best!.family).toBe("qfn")
  expect(result.best!.copperIntersectionOverUnion).toBeCloseTo(1, 8)
  expect(result.best!.holeIntersectionOverUnion).toBe(1)
  const recovered = footprinterStringToFootprint(result.best!.footprinterString)
  expect(recovered.pads).toHaveLength(target.pads.length)
  expect(recovered.holes).toHaveLength(target.holes.length)
  expect(recovered.vias).toHaveLength(target.vias.length)
  for (const pad of target.pads) {
    const owner = pad.port_hints![0].replace(/^pin/, "")
    const match = recovered.pads.find(
      (candidate) => candidate.port_hints?.[0] === owner,
    )
    expect(match).toBeDefined()
    const expected = getTransformedPcbPadGeometry(pad, target)
    const actual = getTransformedPcbPadGeometry(match!, recovered)
    expect(actual.drill).toEqual(expected.drill)
    expect(actual.copper.shape).toBe(expected.copper.shape)
    expect(actual.copper.x).toBeCloseTo(expected.copper.x, 7)
    expect(actual.copper.y).toBeCloseTo(expected.copper.y, 7)
    expect(actual.copper.width).toBeCloseTo(expected.copper.width, 7)
    expect(actual.copper.height).toBeCloseTo(expected.copper.height, 7)
    expect(actual.copper.cornerRadius ?? 0).toBeCloseTo(
      expected.copper.cornerRadius ?? 0,
      7,
    )
  }
  if (snapshot)
    expect(
      convertCircuitJsonToPcbSvg(
        fp.string(result.best!.footprinterString).circuitJson(),
      ),
    ).toMatchSvgSnapshot(import.meta.path, snapshot)
  return result.best!
}

test("discovers 73 manufacturer-coordinate QFN contacts and EP from independently retained datasheet geometry", () => {
  const result = assertExactRoundtrip(
    sourcePads,
    "nrf52840-qfn-missing-recovered",
  )
  expect(result.footprinterString).toStartWith(
    "qfn88_grid12x12_rows2_staggered",
  )
  expect(result.footprinterString).toContain("_circularpads")
  expect(result.footprinterString).toContain("_pinnumbering(ballcoords)")
  expect(result.footprinterString).toContain("_rowspan6.5mm_rowgap0.5mm")
  const omitted = result.footprinterString
    .match(/_missing\(([^)]+)\)/)![1]
    .split(",")
  expect(omitted).toHaveLength(15)
  expect(omitted.toSorted()).toEqual(
    "A2,A4,A6,E1,AA1,AC1,C24,G24,B21,AC3,AC7,V2,K23,M23,AB23"
      .split(",")
      .toSorted(),
  )
}, 30_000)

test("discovers an unrelated rectangular staggered QFN with numeric omissions and independent pitches", () => {
  const elements = fp
    .string(
      "qfn48_grid8x6_rows2_staggered_px0.6mm_py0.4mm_rowspan4mm_rowgap0.5mm_w5.4mm_h4.4mm_pw0.2mm_pl0.3mm_missing(3,47)",
    )
    .circuitJson()
  const result = assertExactRoundtrip(
    elements,
    "rectangular-two-row-numeric-missing-recovered",
  )
  expect(result.footprinterString).toStartWith("qfn48_grid8x6_rows2_staggered")
  expect(result.footprinterString).toContain("_px0.6mm_py0.4mm")
  expect(result.footprinterString).toContain("_missing(3,47)")
}, 30_000)

test("discovers rectangular unstaggered rows and package-coordinate omissions", () => {
  const elements = fp
    .string(
      "qfn48_grid8x6_rows2_px0.6mm_py0.4mm_rowgap0.5mm_w5.4mm_h4.4mm_pw0.2mm_pl0.3mm_pinnumbering(ballcoords)_missing(A2,C2)",
    )
    .circuitJson()
  const result = assertExactRoundtrip(elements)
  expect(result.footprinterString).toStartWith("qfn48_grid8x6_rows2_rowgap")
  expect(result.footprinterString).toContain("_missing(A2,C2)")
}, 30_000)

test("discovers ordinary single-row QFN omissions without renumbering surviving pins", () => {
  const elements = fp
    .string(
      "qfn16_grid4x4_px0.5mm_py0.7mm_pw0.25mm_pl0.65mm_w4mm_h4.8mm_thermalpad1.5x1.3mm_missing(2,7)",
    )
    .circuitJson()
  const result = assertExactRoundtrip(
    elements,
    "single-row-qfn-missing-recovered",
  )
  expect(result.footprinterString).toStartWith("qfn16_grid4x4")
  expect(result.footprinterString).toContain("_missing(2,7)")
  expect(result.footprinterString).not.toContain("rows2")
}, 30_000)

test("QFN fitting ignores input order, package translation, source names and functional aliases", () => {
  const original = circuitJsonToFootprint(sourcePads)
  const translated = circuitJsonToFootprint(
    sourcePads.toReversed().map((pad) => ({
      ...pad,
      x: pad.x + 12,
      y: pad.y - 7,
      port_hints: [...pad.port_hints!, "GND"],
    })),
    { title: "unrelated-name", sourceHints: ["not-a-package"] },
  )
  expect(getQfnGridSeeds(translated)).toEqual(getQfnGridSeeds(original))
})

test("rejects off-lattice geometry, conflicting physical ownership, mismatched dimensions and drills", () => {
  const target = circuitJsonToFootprint(sourcePads)
  const altered = (index: number, changes: Partial<PcbSmtPad>) =>
    circuitJsonToFootprint(
      sourcePads.map((pad, i) =>
        i === index ? ({ ...pad, ...changes } as PcbSmtPad) : pad,
      ),
    )
  expect(getQfnGridSeeds(altered(0, { x: sourcePads[0].x + 0.031 }))).toEqual(
    [],
  )
  expect(
    getQfnGridSeeds(altered(0, { port_hints: sourcePads[1].port_hints })),
  ).toEqual([])
  expect(
    getQfnGridSeeds(altered(0, { radius: 0.2 } as Partial<PcbSmtPad>)),
  ).toEqual([])
  expect(
    getQfnGridSeeds({
      ...target,
      holes: [
        {
          type: "pcb_hole",
          pcb_hole_id: "extra",
          hole_shape: "circle",
          hole_diameter: 0.5,
          x: 0,
          y: 0,
        },
      ],
    }),
  ).toEqual([])
})

test("discovers quarter-turn numeric QFN footprints with the original physical pin ownership", () => {
  const base =
    "qfn48_grid8x6_rows2_staggered_px0.6mm_py0.4mm_rowspan5mm_rowgap0.5mm_w5.6mm_h5.6mm_pw0.2mm_pl0.3mm_missing(3,47)"
  for (const location of [
    "bottomside,left",
    "rightside,bottom",
    "topside,right",
  ]) {
    const elements = fp
      .string(`${base}_pin1location(${location})`)
      .circuitJson()
    const result = assertExactRoundtrip(elements)
    expect(result.footprinterString).toContain(`_pin1location(${location})`)
  }
}, 30_000)

test("malformed and huge physical IDs cannot expand the nominal-lattice search", () => {
  const oversizedNumbers = sourcePads.map((pad, i) => ({
    ...pad,
    port_hints:
      pad.port_hints?.[0] === "EP"
        ? ["EP", "thermalpad"]
        : [String(2147483647 + i)],
  }))
  expect(getQfnGridSeeds(circuitJsonToFootprint(oversizedNumbers))).toEqual([])
  for (const owner of ["A2147483647", `${"A".repeat(100)}2`, "I2"]) {
    const pads = sourcePads.map((pad, i) =>
      i === 0 ? { ...pad, port_hints: [owner] } : pad,
    )
    expect(getQfnGridSeeds(circuitJsonToFootprint(pads))).toEqual([])
  }
})

test("rejects a large populated BGA before searching QFN nominal layouts", () => {
  const pads: PcbSmtPad[] = imx6.contacts.map(([pin, _ball, x, y, radius]) => ({
    type: "pcb_smtpad",
    shape: "circle",
    pcb_smtpad_id: `bga_${pin}`,
    layer: "top",
    x: Number(x),
    y: Number(y),
    radius: Number(radius),
    port_hints: [`pin${pin}`],
  }))
  expect(getQfnGridSeeds(circuitJsonToFootprint(pads))).toEqual([])
})

test("preserves rounded copper corners and rejects incompatible mixed radii", () => {
  const elements = fp
    .string(
      "qfn16_grid4x4_px0.5mm_py0.7mm_pw0.25mm_pl0.65mm_w4mm_h4.8mm_thermalpad1.5x1.3mm_missing(2,7)_rounded0.1mm",
    )
    .circuitJson()
  const result = assertExactRoundtrip(elements)
  expect(result.footprinterString).toContain("_rounded0.1mm")
  const mixed = elements.map((element) =>
    element.type === "pcb_smtpad" && element.port_hints?.[0] === "1"
      ? { ...element, corner_radius: 0.04 }
      : element,
  )
  expect(getQfnGridSeeds(circuitJsonToFootprint(mixed))).toEqual([])
})
