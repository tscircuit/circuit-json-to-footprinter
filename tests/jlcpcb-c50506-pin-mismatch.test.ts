import { expect, test } from "bun:test"
import type { PcbSmtPad } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  circuitJsonToFootprinter,
  footprinterStringToFootprint,
} from "../lib/index.js"

const signalPadX = [
  -2.275078, -1.625092, -0.975106, -0.324866, 0.32512, 0.975106, 1.625092,
  2.275078,
]

const createSignalPad = (
  pin: number,
  x: number,
  y: number,
  index: number,
): PcbSmtPad => ({
  height: 1.2999974,
  layer: "top",
  pcb_smtpad_id: `c50506_signal_pad_${index}`,
  port_hints: [`pin${pin}`],
  radius: 0.175006,
  shape: "pill",
  type: "pcb_smtpad",
  width: 0.350012,
  x,
  y,
})

// Network-free reproduction of the pads returned by EasyEDA for C50506
// (DRV8833PWP, TSSOP-16 with an exposed pad numbered pin 17).
const c50506CircuitJson: PcbSmtPad[] = [
  ...signalPadX.map((x, index) =>
    createSignalPad(index + 1, x, -2.850007, index + 1),
  ),
  ...signalPadX.map((x, index) =>
    createSignalPad(16 - index, x, 2.850007, index + 9),
  ),
  {
    height: 2.7399996,
    layer: "top",
    pcb_smtpad_id: "c50506_exposed_pad_17",
    port_hints: ["pin17"],
    shape: "rect",
    type: "pcb_smtpad",
    width: 2.7399996,
    x: 0,
    y: 0,
  },
]

test("C50506 exposes its near-perfect copper match with a pin 17 mismatch", () => {
  const discovery = circuitJsonToFootprinter(c50506CircuitJson, {
    maxCandidates: 5,
    sourceHints: [
      "DRV8833PWP",
      "TSSOP-16_L5.0-W4.4-P0.65-LS6.4-BL-EP",
      "Motor Driver ICs",
    ],
    subtitle: "DRV8833PWP",
    title: "C50506",
  })
  const best = discovery.best

  expect(best).not.toBeNull()
  expect(best!.copperIntersectionOverUnion).toBeGreaterThan(0.99)
  expect(best!.pinsMatch).toBe(false)
  expect(best!.pinMatchRate).toBeCloseTo(16 / 17)
  expect(best!.rankingScore).toBeLessThan(best!.copperIntersectionOverUnion)
  expect(best!.pinMismatches).toEqual([
    {
      leftPadIndex: 16,
      leftPinNumbers: [],
      leftPortHints: ["thermalpad"],
      rightPadIndex: 16,
      rightPinNumbers: [17],
      rightPortHints: ["pin17"],
    },
  ])

  const recovered = footprinterStringToFootprint(best!.footprinterString)
  expect(convertCircuitJsonToPcbSvg(recovered.pads)).toMatchSvgSnapshot(
    import.meta.path,
    "C50506",
  )
})
