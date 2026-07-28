import { expect, test } from "bun:test"
import type { AnyCircuitElement, PcbSmtPad } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import {
  circuitJsonToFootprint,
  circuitJsonToFootprinter,
  footprinterStringToFootprint,
  summarizeCopperComparison,
} from "../lib/index.js"

const pad = (pin: number, x: number, y: number): PcbSmtPad => ({
  type: "pcb_smtpad",
  pcb_smtpad_id: `pad_${pin}`,
  layer: "top",
  shape: "rect",
  port_hints: [`pin${pin}`],
  x,
  y,
  width: 0.6500114,
  height: 0.6500114,
})

test("recovers C2906282 TS3735A as an SMD pushbutton", () => {
  const circuitJson: AnyCircuitElement[] = [
    pad(1, -1.599946, 1.35001),
    pad(2, 1.599946, 1.35001),
    pad(3, -1.599946, -1.35001),
    pad(4, 1.599946, -1.35001),
  ]
  const result = circuitJsonToFootprinter(circuitJson, {
    maxCandidates: 5,
    sourceHints: ["C2906282", "TS3735A 250gf 030", "SMD-4P,3.7x3.7mm"],
  })

  expect(result.best?.family).toBe("smdpushbutton")
  expect(result.best?.footprinterString).toBe(
    "smdpushbutton4_px3.2mm_py2.7mm_pw0.65mm_ph0.65mm",
  )

  const recovered = footprinterStringToFootprint(result.best!.footprinterString)
  const target = circuitJsonToFootprint(circuitJson)
  expect(
    summarizeCopperComparison(recovered, target).copperIntersectionOverUnion,
  ).toBeGreaterThanOrEqual(0.999)
  expect(convertCircuitJsonToPcbSvg(recovered.pads)).toMatchSvgSnapshot(
    import.meta.path,
    "C2906282",
  )
})
