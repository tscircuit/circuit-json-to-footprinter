import { expect, test } from "bun:test"
import type { PcbSmtPad } from "circuit-json"
import {
  circuitJsonToFootprinter,
  footprinterStringToFootprint,
  summarizeCopperComparison,
} from "../lib/index.js"
import imx6 from "./fixture/imx6-bga624.json"

test.each(["rowmajor", "columnmajor", "ballcoords"])(
  "discovers %s BGA numbering with an asymmetric missing-ball mask",
  (numbering) => {
    const source = footprinterStringToFootprint(
      `bga9_grid4x3_p0.8_pad0.4_missing(A1,B3,C4)_brorigin_pinnumbering(${numbering})`,
    )
    const result = circuitJsonToFootprinter(source.pads)
    expect(result.best?.pinsMatch).toBe(true)
    expect(result.best?.copperIntersectionOverUnion).toBe(1)
    const generated = footprinterStringToFootprint(
      result.best!.footprinterString,
    )
    expect(summarizeCopperComparison(generated, source).pinsMatch).toBe(true)
    if (numbering === "ballcoords") {
      expect(result.best?.footprinterString).toContain(
        "pinnumbering(ballcoords)",
      )
      expect(generated.pads.every((pad) => pad.port_hints?.length === 1)).toBe(
        true,
      )
    }
  },
)

test.each(["tl", "bl", "tr", "br"])(
  "preserves the missing corner and column-major IDs with %s origin",
  (origin) => {
    const source = footprinterStringToFootprint(
      `bga11_grid4x3_p0.8_pad0.4_missing(A1)_${origin}origin_pinnumbering(columnmajor)`,
    )
    const result = circuitJsonToFootprinter(source.pads)
    expect(result.best?.pinsMatch).toBe(true)
    expect(result.best?.copperIntersectionOverUnion).toBe(1)
  },
)

test("recovers all 624 i.MX6 contacts from independent supplier geometry", () => {
  const pads: PcbSmtPad[] = imx6.contacts.map(([pin, _ball, x, y, radius]) => ({
    type: "pcb_smtpad",
    shape: "circle",
    pcb_smtpad_id: `pad_${pin}`,
    layer: "top",
    x: Number(x),
    y: Number(y),
    radius: Number(radius),
    port_hints: [`pin${pin}`],
  }))
  const result = circuitJsonToFootprinter(pads, { sourceHints: ["BGA-624"] })
  expect(result.best?.pinsMatch).toBe(true)
  expect(result.best?.pinMatchRate).toBe(1)
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.999)
  expect(result.best?.footprinterString).toContain("pinnumbering(columnmajor)")
  expect(result.best?.footprinterString).toContain("_blorigin")
  expect(result.best?.footprinterString).toContain("_missing(1)")
  const generated = footprinterStringToFootprint(result.best!.footprinterString)
  expect(generated.pads).toHaveLength(624)
  for (const [pin, ball, x, y] of imx6.contacts) {
    const pad = generated.pads.find((pad) =>
      pad.port_hints?.includes(String(pin)),
    )!
    expect(pad.type).toBe("pcb_smtpad")
    if (pad.type !== "pcb_smtpad" || pad.shape !== "circle")
      throw new Error("Expected a circular BGA pad")
    expect(pad.port_hints).toEqual([String(pin), String(ball)])
    expect(Math.hypot(pad.x - Number(x), pad.y - Number(y))).toBeLessThan(0.003)
  }
}, 60_000)

test("ball-coordinate mismatches count even when numeric IDs agree", () => {
  const original = footprinterStringToFootprint(
    "bga6_grid3x2_pinnumbering(rowmajor)",
  )
  const changed = {
    ...original,
    pads: original.pads.map((pad, index) =>
      index === 0
        ? {
            ...pad,
            port_hints: [pad.port_hints![0]!, "C1"],
          }
        : pad,
    ),
  }
  const comparison = summarizeCopperComparison(original, changed)
  expect(comparison.copperIntersectionOverUnion).toBe(1)
  expect(comparison.pinsMatch).toBe(false)
  expect(comparison.pinMismatches).toHaveLength(1)
})

test("coordinate-only pins cannot silently receive numeric IDs", () => {
  const original = footprinterStringToFootprint(
    "bga6_grid3x2_pinnumbering(ballcoords)",
  )
  const numbered = footprinterStringToFootprint(
    "bga6_grid3x2_pinnumbering(rowmajor)",
  )
  expect(summarizeCopperComparison(original, numbered).pinsMatch).toBe(false)
})

test("preserves skipped row letters and extended coordinate-only labels", () => {
  const source = footprinterStringToFootprint(
    "bga83_grid2x42_p0.8_pad0.4_missing(1)_blorigin_pinnumbering(ballcoords)",
  )
  const result = circuitJsonToFootprinter(source.pads)
  const generated = footprinterStringToFootprint(result.best!.footprinterString)
  expect(result.best?.pinsMatch).toBe(true)
  expect(result.best?.footprinterString).toContain("pinnumbering(ballcoords)")
  expect(generated.pads.flatMap((pad) => pad.port_hints ?? [])).toContain("BB2")
  expect(
    summarizeCopperComparison(generated, source).copperIntersectionOverUnion,
  ).toBe(1)
})

test("keeps legacy row labels when they are present in the target", () => {
  const source = footprinterStringToFootprint("bga54_grid2x27_p0.8_pad0.4")
  const result = circuitJsonToFootprinter(source.pads)
  expect(result.best?.pinsMatch).toBe(true)
  expect(result.best?.footprinterString).not.toContain("_pinnumbering(")
})

test("reports unmatched numeric identities instead of inventing a pin map", () => {
  const source = footprinterStringToFootprint("bga6_grid3x2_p0.8_pad0.4")
  const pads = source.pads.map((pad, index) => ({
    ...pad,
    port_hints: [`pin${index + 1001}`],
  }))
  const result = circuitJsonToFootprinter(pads)
  expect(result.best?.copperIntersectionOverUnion).toBe(1)
  expect(result.best?.pinsMatch).toBe(false)
  expect(result.best?.pinMatchRate).toBe(0)
})
