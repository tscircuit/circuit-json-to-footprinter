import { expect, test } from "bun:test"
import type { PcbSmtPad } from "circuit-json"
import {
  circuitJsonToFootprint,
  compareFootprints,
  summarizeCopperComparison,
} from "../lib/index.js"

const pad = (id: string, x: number, pin: number): PcbSmtPad => ({
  height: 1,
  layer: "top",
  pcb_smtpad_id: id,
  port_hints: [`pin${pin}`],
  shape: "rect",
  type: "pcb_smtpad",
  width: 1,
  x,
  y: 0,
})

test("identical copper with swapped pin 1 and pin 2 reports pin mismatches", () => {
  const left = circuitJsonToFootprint([
    pad("left_1", -1, 1),
    pad("left_2", 1, 2),
  ])
  const right = circuitJsonToFootprint([
    pad("right_2", -1, 2),
    pad("right_1", 1, 1),
  ])

  const summary = summarizeCopperComparison(left, right)
  expect(summary.copperIntersectionOverUnion).toBe(1)
  expect(summary.pinMatchRate).toBe(0)
  expect(summary.pinsMatch).toBe(false)
  expect(summary.pinMismatches).toEqual([
    {
      leftPadIndex: 0,
      leftPinNumbers: [1],
      leftPortHints: ["pin1"],
      rightPadIndex: 0,
      rightPinNumbers: [2],
      rightPortHints: ["pin2"],
    },
    {
      leftPadIndex: 1,
      leftPinNumbers: [2],
      leftPortHints: ["pin2"],
      rightPadIndex: 1,
      rightPinNumbers: [1],
      rightPortHints: ["pin1"],
    },
  ])

  const comparison = compareFootprints(left, right, 8)
  expect(comparison.iou).toBe(1)
  expect(comparison.pinMatchRate).toBe(0)
  expect(comparison.pinsMatch).toBe(false)
  expect(comparison.pinMismatches).toEqual(summary.pinMismatches)
})
