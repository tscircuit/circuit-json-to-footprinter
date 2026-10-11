import { expect, test } from "bun:test"
import { fp } from "@tscircuit/footprinter"
import type { AnyCircuitElement, PcbPlatedHole, PcbSmtPad } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { getTransformedPcbPadGeometry } from "../lib/footprint-geometry.js"
import {
  circuitJsonToFootprint,
  circuitJsonToFootprinter,
  footprinterStringToFootprint,
} from "../lib/index.js"
import { getReleasedConnectorSeeds } from "../lib/released-connector-seeds.js"
import fixtures from "./fixture/released-connectors.json"

// These are independently retained manufacturer PCB layouts, not output from
// Footprinter. Source URLs and the engineered copper dimensions are retained
// alongside each fixture. Contact IDs include each distinct solderable shell.
const sourcePads = (fixture: (typeof fixtures)[number]): AnyCircuitElement[] =>
  fixture.copper.map((pad, index) => {
    const base = { x: pad.x, y: pad.y, port_hints: [pad.pin] }
    if ("hole_diameter" in pad)
      return {
        ...base,
        type: "pcb_plated_hole",
        shape: "circle",
        pcb_plated_hole_id: `source_${index}`,
        layers: ["top", "bottom"],
        hole_diameter: pad.hole_diameter,
        outer_diameter: pad.outer_diameter!,
      } satisfies PcbPlatedHole
    if ("hole_width" in pad && pad.hole_width !== undefined)
      return {
        ...base,
        type: "pcb_plated_hole",
        shape: "pill",
        pcb_plated_hole_id: `source_${index}`,
        layers: ["top", "bottom"],
        hole_width: pad.hole_width,
        hole_height: pad.hole_height!,
        outer_width: pad.outer_width!,
        outer_height: pad.outer_height!,
        ccw_rotation: 0,
      } satisfies PcbPlatedHole
    return {
      ...base,
      type: "pcb_smtpad",
      shape: "rect",
      layer: "top",
      pcb_smtpad_id: `source_${index}`,
      width: "width" in pad ? pad.width! : 0,
      height: "height" in pad ? pad.height! : 0,
    } satisfies PcbSmtPad
  })

const expectExactRoundTrip = (
  circuitJson: AnyCircuitElement[],
  family: string,
) => {
  const result = circuitJsonToFootprinter(circuitJson)
  expect(result.best?.family).toBe(family)
  expect(result.best?.copperIntersectionOverUnion).toBeCloseTo(1, 10)
  expect(result.best?.holeIntersectionOverUnion).toBeCloseTo(1, 10)
  expect(result.best?.pinsMatch).toBe(true)
  const source = circuitJsonToFootprint(circuitJson)
  const generated = footprinterStringToFootprint(result.best!.footprinterString)
  expect(generated.pads).toHaveLength(source.pads.length)
  for (const original of source.pads) {
    const pad = generated.pads.find((pad) =>
      pad.port_hints?.includes(original.port_hints![0].replace(/^pin/i, "")),
    )!
    expect(pad).toBeDefined()
    const left = getTransformedPcbPadGeometry(original, source)
    const right = getTransformedPcbPadGeometry(pad, generated)
    expect(right.copper.x).toBeCloseTo(left.copper.x, 8)
    expect(right.copper.y).toBeCloseTo(left.copper.y, 8)
    const leftSize = [left.copper.width, left.copper.height].toSorted()
    const rightSize = [right.copper.width, right.copper.height].toSorted()
    expect(rightSize[0]).toBeCloseTo(leftSize[0], 8)
    expect(rightSize[1]).toBeCloseTo(leftSize[1], 8)
    expect(right.copper.shape).toBe(left.copper.shape)
    if (left.drill) {
      expect(right.drill?.shape).toBe(left.drill.shape)
      const a = [left.drill.width, left.drill.height].toSorted()
      const b = [right.drill!.width, right.drill!.height].toSorted()
      expect(b[0]).toBeCloseTo(a[0], 8)
      expect(b[1]).toBeCloseTo(a[1], 8)
      expect(right.drill!.x).toBeCloseTo(left.drill.x, 8)
      expect(right.drill!.y).toBeCloseTo(left.drill.y, 8)
    }
  }
  return result.best!
}

for (const [index, family] of ["usbmicro", "usba", "pinrow"].entries()) {
  test(`recovers source geometry and all physical contacts of ${fixtures[index].partNumber}`, () => {
    const source = sourcePads(fixtures[index])
    const best = expectExactRoundTrip(source, family)
    const recovered = fp.string(best.footprinterString).circuitJson()
    expect(convertCircuitJsonToPcbSvg(recovered)).toMatchSvgSnapshot(
      import.meta.path,
      `${fixtures[index].partNumber}-recovered`,
    )
  }, 30_000)
}

test("infers complete odd/even headers at a different pitch and row span", () => {
  const pads: AnyCircuitElement[] = Array.from({ length: 16 }, (_, index) => ({
    type: "pcb_plated_hole",
    shape: "circle",
    layers: ["top", "bottom"],
    pcb_plated_hole_id: `pad_${index}`,
    port_hints: [`pin${index + 1}`],
    x: -7 + Math.floor(index / 2) * 2,
    y: index % 2 ? -1.5 : 1.5,
    hole_diameter: 0.8,
    outer_diameter: 1.4,
  }))
  const best = expectExactRoundTrip(pads, "pinrow")
  expect(best.footprinterString).toContain("pinnumbering(columnmajor)")
  expect(best.footprinterString).toContain("p2mm")
  expect(best.footprinterString).toContain("py3mm")
}, 30_000)

test.each(["rowmajor", "columnmajor"])(
  "preserves %s rectangular three-row header IDs",
  (numbering) => {
    const source = fp
      .string(
        `pinrow12_rows3_cols4_p2mm_py3mm_pinnumbering(${numbering})_id0.8_od1.4`,
      )
      .circuitJson()
    expectExactRoundTrip(source, "pinrow")
  },
  30_000,
)

test("derives a USB-A variant without a part-number hint", () => {
  const source = fp
    .string(
      "usba4_p2.8_centerp2.2_id1_ring0.2_shieldspan14_shieldy-3.4_shieldid2.5_shieldring0.25",
    )
    .circuitJson()
  const best = expectExactRoundTrip(source, "usba")
  expect(best.footprinterString).toContain("centerp2.2mm")
  expect(best.footprinterString).toContain("shieldy-3.4mm")
}, 30_000)

test("derives all Micro-B shell-slot and pad dimensions for a variant", () => {
  const source = fp
    .string(
      "usbmicro5_p0.7_pw0.42_ph1.4_rowy2.9_rearspan5.4_reary3_rearhw0.9_rearhh0.6_rearring0.25_frontspan7.6_fronthw0.55_fronthh1.2_frontpw1.1_frontph1.7_tabspan2.2_tabpw1.4_tabph1.6",
    )
    .circuitJson()
  const best = expectExactRoundTrip(source, "usbmicro")
  expect(best.footprinterString).toContain("rearspan5.4mm")
  expect(best.footprinterString).toContain("fronthh1.2mm")
}, 30_000)

test("does not claim renamed or exchanged mechanical owners match", () => {
  const source = sourcePads(fixtures[1])
  for (const element of source) {
    if (
      element.type === "pcb_plated_hole" &&
      Number(element.port_hints?.[0]) > 4
    )
      element.port_hints = [
        Number(element.port_hints![0]) === 5 ? "SH1" : "SH2",
      ]
  }
  const result = circuitJsonToFootprinter(source)
  expect(result.best?.copperIntersectionOverUnion).toBe(1)
  expect(result.best?.pinsMatch).toBe(false)
  expect(result.best?.pinMatchRate).toBeCloseTo(4 / 6)
}, 30_000)

test("does not seed a complete header for displaced, duplicated or nonuniform contacts", () => {
  const source = sourcePads(fixtures[2])
  const footprint = circuitJsonToFootprint(source)
  const first = footprint.pads[0]
  const second = footprint.pads[2]
  if (first.type !== "pcb_plated_hole" || second.type !== "pcb_plated_hole")
    throw new Error("Expected plated header contacts")
  first.x += 0.1
  expect(getReleasedConnectorSeeds(footprint)).toEqual([])
  first.x -= 0.1
  first.x = second.x
  first.y = second.y
  expect(getReleasedConnectorSeeds(footprint)).toEqual([])
})

test.each([90, 180, 270])(
  "preserves rotated USB-A contacts and drills at %i degrees",
  (rotation) => {
    const source = sourcePads(fixtures[1])
    for (const element of source) {
      if (element.type !== "pcb_plated_hole") continue
      const radians = (rotation * Math.PI) / 180
      const x = element.x
      element.x = x * Math.cos(radians) - element.y * Math.sin(radians)
      element.y = x * Math.sin(radians) + element.y * Math.cos(radians)
    }
    expectExactRoundTrip(source, "usba")
  },
  30_000,
)

test.each([90, 180, 270])(
  "does not claim an exact rotated Micro-B roundtrip at %i degrees",
  (rotation) => {
    // pin1location currently requires an outermost contact. Micro-B's signal
    // contacts are inset from its shell, so that released modifier cannot
    // encode these rotations, even when the recognizer infers the dimensions.
    const source = sourcePads(fixtures[0])
    const radians = (rotation * Math.PI) / 180
    for (const element of source) {
      if (element.type !== "pcb_plated_hole" && element.type !== "pcb_smtpad")
        continue
      if (element.type === "pcb_smtpad" && element.shape === "polygon") continue
      const x = element.x
      element.x = x * Math.cos(radians) - element.y * Math.sin(radians)
      element.y = x * Math.sin(radians) + element.y * Math.cos(radians)
      if (element.type === "pcb_plated_hole") {
        if (element.shape === "pill") element.ccw_rotation = rotation
      } else if (element.shape === "rect") {
        Object.assign(element, {
          shape: "rotated_rect",
          ccw_rotation: rotation,
        })
      }
    }
    expect(
      getReleasedConnectorSeeds(circuitJsonToFootprint(source)).length,
    ).toBeGreaterThan(0)
    const result = circuitJsonToFootprinter(source)
    expect(
      result.candidates.some(
        (candidate) =>
          candidate.pinsMatch &&
          candidate.copperIntersectionOverUnion > 0.999999 &&
          candidate.holeIntersectionOverUnion > 0.999999,
      ),
    ).toBe(false)
  },
  30_000,
)

test("does not emit an unsupported string origin for a translated header", () => {
  const source = sourcePads(fixtures[2])
  for (const element of source) {
    if (element.type !== "pcb_plated_hole") continue
    element.x -= 6.35
    element.y += 1.27
  }
  const result = circuitJsonToFootprinter(source)
  expect(result.best!.footprinterString).not.toContain("origin")
  const recovered = footprinterStringToFootprint(result.best!.footprinterString)
  const pin1 = recovered.pads.find((pad) => pad.port_hints?.includes("1"))!
  const geometry = getTransformedPcbPadGeometry(pin1, recovered)
  // Comparison centers footprints; Footprinter currently exposes this origin
  // through its builder API, but not through a portable string modifier.
  expect(Math.hypot(geometry.copper.x, geometry.copper.y)).toBeGreaterThan(1)
}, 30_000)

test.each([90, 180, 270])(
  "preserves rotated header IDs and drills at %i degrees",
  (rotation) => {
    const source = sourcePads(fixtures[2])
    for (const element of source) {
      if (element.type !== "pcb_plated_hole") continue
      const radians = (rotation * Math.PI) / 180
      const x = element.x
      element.x = x * Math.cos(radians) - element.y * Math.sin(radians)
      element.y = x * Math.sin(radians) + element.y * Math.cos(radians)
    }
    expectExactRoundTrip(source, "pinrow")
  },
  30_000,
)
