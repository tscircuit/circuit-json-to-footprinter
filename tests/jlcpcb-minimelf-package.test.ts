import { expect, test } from "bun:test"
import { fp } from "@tscircuit/footprinter"
import type { PcbSmtPad } from "circuit-json"
import { circuitJsonToFootprinter } from "../lib/index.js"

const pads: Extract<PcbSmtPad, { shape: "rect" }>[] = [1, 2].map((pin) => ({
  type: "pcb_smtpad",
  pcb_smtpad_id: `pad_${pin}`,
  layer: "top",
  shape: "rect",
  port_hints: [`pin${pin}`],
  x: pin === 1 ? -1.765046 : 1.765046,
  y: 0,
  width: 1.4400022,
  height: 1.620012,
}))

test("recovers C68883 with supported MiniMELF package semantics", () => {
  for (const packageName of ["MiniMELF", "Mini-MELF", "Mini MELF", "SOD-80"]) {
    const result = circuitJsonToFootprinter(pads, {
      maxCandidates: 1,
      sourceHints: [packageName, "LL4148-GS08", "diode"],
    })

    expect(result.best?.family).toBe("sod80")
    expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.9999)
    expect(result.best?.pinsMatch).toBe(true)
    const parsed = fp
      .string(result.best!.footprinterString)
      .json() as unknown as {
      fn: string
      p: string
      pl: string
      pw: string
    }
    expect(parsed.fn).toBe("sod80")
    expect(Number.parseFloat(parsed.p)).toBeCloseTo(3.530092, 4)
    expect(Number.parseFloat(parsed.pl)).toBeCloseTo(1.4400022, 4)
    expect(Number.parseFloat(parsed.pw)).toBeCloseTo(1.620012, 4)
  }
})

test("preserves rotated pad geometry and pin identity", () => {
  const rotatedPads = pads.map((pad) => ({
    ...pad,
    x: 0,
    y: pad.x,
    width: pad.height,
    height: pad.width,
  }))
  const result = circuitJsonToFootprinter(rotatedPads, {
    sourceHints: ["MiniMELF"],
  })

  expect(result.best?.family).toBe("sod80")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.9999)
  expect(result.best?.pinsMatch).toBe(true)
  expect(result.best?.footprinterString).toContain("pin1location(")
})

test("does not infer MiniMELF from a part number or a different package", () => {
  for (const sourceHints of [
    [],
    ["diode", "LL4148-GS08"],
    ["MicroMELF"],
    ["SOD-803"],
  ]) {
    const result = circuitJsonToFootprinter(pads, { sourceHints })
    expect(result.best?.family).not.toBe("minimelf")
    expect(result.best?.family).not.toBe("sod80")
  }
})
