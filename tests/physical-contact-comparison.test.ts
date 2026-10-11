import { expect, test } from "bun:test"
import type { PcbSmtPad, PcbSmtPadRect, Point } from "circuit-json"
import {
  circuitJsonToFootprint,
  compareFootprints,
  summarizeCopperComparison,
} from "../lib/index.js"

const rectangle = (
  id: string,
  x: number,
  portHints: string[],
): PcbSmtPadRect => ({
  type: "pcb_smtpad",
  pcb_smtpad_id: id,
  shape: "rect",
  layer: "top",
  x,
  y: 0,
  width: 1,
  height: 1,
  port_hints: portHints,
})

const ring = (sectors: number, portHints: string[]): PcbSmtPad[] => {
  // Every partition uses the same 64 inner/outer perimeter vertices. Only
  // the number of Circuit JSON polygon primitives changes.
  const point = (index: number, radius: number): Point => ({
    x: radius * Math.cos((index * Math.PI) / 32),
    y: radius * Math.sin((index * Math.PI) / 32),
  })
  return Array.from({ length: sectors }, (_, sector) => {
    const start = (sector * 64) / sectors
    const end = ((sector + 1) * 64) / sectors
    const points: Point[] = []
    for (let index = start; index <= end; index++) points.push(point(index, 1))
    for (let index = end; index >= start; index--)
      points.push(point(index, 0.5))
    return {
      type: "pcb_smtpad",
      pcb_smtpad_id: `ring_sector_${sector}`,
      shape: "polygon",
      layer: "top",
      points,
      port_hints: [...portHints],
    }
  })
}

test("compares one annular contact independently of polygon segmentation", () => {
  const left = circuitJsonToFootprint(ring(4, ["3", "GND"]))
  const right = circuitJsonToFootprint(ring(8, ["pin3", "GND"]))
  const summary = summarizeCopperComparison(left, right)
  expect(summary.copperIntersectionOverUnion).toBeCloseTo(1, 10)
  expect(summary.pinsMatch).toBe(true)
  expect(summary.pinMatchRate).toBe(1)
  expect(summary.pinMismatches).toEqual([])

  // Primitive-count diagnostics retain their existing meaning.
  const comparison = compareFootprints(left, right, 8)
  expect(comparison.padCountMatch).toBe(false)
  expect(comparison.pinsMatch).toBe(true)
})

test("reports a sector assigned to an existing different physical pin", () => {
  const left = circuitJsonToFootprint([
    ...ring(4, ["3", "GND"]),
    rectangle("pin2", 3, ["2", "GND"]),
  ])
  const rightRing = ring(8, ["3", "GND"])
  rightRing[0].port_hints = ["2", "GND"]
  const right = circuitJsonToFootprint([
    ...rightRing,
    rectangle("pin2", 3, ["2", "GND"]),
  ])
  const summary = summarizeCopperComparison(left, right)
  expect(summary.copperIntersectionOverUnion).toBeCloseTo(1, 10)
  expect(summary.pinsMatch).toBe(false)
  expect(summary.pinMatchRate).toBeLessThan(1)
  expect(summary.pinMismatches).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        leftPinNumbers: [3],
        leftPadIndices: [0, 1, 2, 3],
      }),
    ]),
  )
})

test("shared ground aliases never combine separately numbered contacts", () => {
  const left = circuitJsonToFootprint([
    rectangle("pin1", -1, ["1", "GND"]),
    rectangle("pin2", 1, ["2", "GND"]),
  ])
  const right = circuitJsonToFootprint([
    rectangle("pin2", -1, ["2", "GND"]),
    rectangle("pin1", 1, ["1", "GND"]),
  ])
  expect(summarizeCopperComparison(left, right)).toMatchObject({
    copperIntersectionOverUnion: 1,
    pinMatchRate: 0,
    pinsMatch: false,
  })
})

test("recognizes semantic EP owners without a synthetic numeric alias", () => {
  const left = circuitJsonToFootprint(ring(4, ["EP", "thermalpad"]))
  const right = circuitJsonToFootprint(ring(8, ["EP", "GND"]))
  expect(summarizeCopperComparison(left, right)).toMatchObject({
    pinMatchRate: 1,
    pinsMatch: true,
    pinMismatches: [],
  })

  const wrong = circuitJsonToFootprint(ring(8, ["SH", "GND"]))
  const summary = summarizeCopperComparison(left, wrong)
  expect(summary.copperIntersectionOverUnion).toBeCloseTo(1, 10)
  expect(summary.pinsMatch).toBe(false)
  expect(summary.pinMismatches).toEqual([
    expect.objectContaining({
      leftPinNumbers: [],
      rightPinNumbers: [],
      leftPortHints: ["EP", "thermalpad"],
      rightPortHints: ["SH", "GND"],
    }),
  ])
})

test("ball-coordinate owners survive segmentation and detect relabeling", () => {
  const left = circuitJsonToFootprint(ring(4, ["AA3", "GND"]))
  const right = circuitJsonToFootprint(ring(8, ["AA3", "GND"]))
  expect(summarizeCopperComparison(left, right).pinsMatch).toBe(true)
  const wrong = circuitJsonToFootprint(ring(8, ["AB3", "GND"]))
  expect(summarizeCopperComparison(left, wrong).pinsMatch).toBe(false)
})

test("ordinary unlabelled geometry retains comparison behavior", () => {
  const left = circuitJsonToFootprint(ring(4, []))
  const right = circuitJsonToFootprint(ring(8, []))
  expect(summarizeCopperComparison(left, right)).toMatchObject({
    pinMatchRate: 1,
    pinsMatch: true,
    pinMismatches: [],
  })
})

test("pad-size differences remain a copper metric rather than a pin mismatch", () => {
  const leftPad = rectangle("left", 0, ["1"])
  const rightPad = { ...rectangle("right", 0, ["pin1"]), width: 1.2 }
  const summary = summarizeCopperComparison(
    circuitJsonToFootprint([leftPad]),
    circuitJsonToFootprint([rightPad]),
  )
  expect(summary.copperIntersectionOverUnion).toBeLessThan(1)
  expect(summary.pinsMatch).toBe(true)
})

const dividedContact = (leftHints: string[], rightHints: string[]) =>
  circuitJsonToFootprint([
    { ...rectangle("left_half", -0.25, leftHints), width: 0.5 },
    { ...rectangle("right_half", 0.25, rightHints), width: 0.5 },
  ])

test("functional aliases do not divide a numeric physical contact", () => {
  const whole = circuitJsonToFootprint([rectangle("whole", 0, ["1"])])
  const divided = dividedContact(["1"], ["1", "GPIO9"])
  for (const [left, right] of [
    [whole, divided],
    [divided, whole],
  ]) {
    expect(summarizeCopperComparison(left, right)).toEqual({
      copperIntersectionOverUnion: 1,
      holeIntersectionOverUnion: 1,
      pinMatchRate: 1,
      pinsMatch: true,
      pinMismatches: [],
    })
  }

  const wrong = circuitJsonToFootprint([rectangle("wrong", 0, ["2"])])
  expect(summarizeCopperComparison(wrong, divided).pinMismatches).toEqual([
    expect.objectContaining({
      rightPinNumbers: [1],
      rightPortHints: ["1", "GPIO9"],
      rightPadIndices: [0, 1],
    }),
  ])
})

test("duplicate coordinate hints do not divide a physical contact", () => {
  const whole = circuitJsonToFootprint([rectangle("whole", 0, ["AA3"])])
  const divided = dividedContact(["AA3"], ["AA3", "AA3"])
  for (const [left, right] of [
    [whole, divided],
    [divided, whole],
  ]) {
    expect(summarizeCopperComparison(left, right)).toEqual({
      copperIntersectionOverUnion: 1,
      holeIntersectionOverUnion: 1,
      pinMatchRate: 1,
      pinsMatch: true,
      pinMismatches: [],
    })
  }
})

test("primary coordinate owners tolerate extra functional aliases", () => {
  const whole = circuitJsonToFootprint([rectangle("whole", 0, ["AA3"])])
  const divided = dividedContact(["AA3"], ["AA3", "GPIO9"])
  expect(summarizeCopperComparison(whole, divided).pinsMatch).toBe(true)
  expect(summarizeCopperComparison(divided, whole).pinsMatch).toBe(true)
})

test("a numeric owner does not hide a changed coordinate claim on one sector", () => {
  const whole = circuitJsonToFootprint([rectangle("whole", 0, ["1", "AA3"])])
  const divided = dividedContact(["1", "AA3"], ["1", "AA4"])
  for (const [left, right] of [
    [whole, divided],
    [divided, whole],
  ]) {
    const summary = summarizeCopperComparison(left, right)
    expect(summary.copperIntersectionOverUnion).toBe(1)
    expect(summary.pinsMatch).toBe(false)
    expect(summary.pinMatchRate).toBe(0)
  }
})
