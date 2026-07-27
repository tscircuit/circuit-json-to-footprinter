import { expect, test } from "bun:test"
import type { PcbSmtPad } from "circuit-json"
import { circuitJsonToFootprinter } from "../lib/index.js"

const rectPad = (
  pin: number,
  x: number,
  y: number,
  width: number,
  height: number,
): PcbSmtPad => ({
  type: "pcb_smtpad",
  pcb_smtpad_id: `pad_${pin}`,
  layer: "top",
  shape: "rect",
  port_hints: [`pin${pin}`],
  x,
  y,
  width,
  height,
})

const cases: Array<{
  jlcpcbPartNumber: string
  manufacturerPartNumber: string
  packageName: string
  mountingPadsOnTop: boolean
  signalPinCount: number
  pads: PcbSmtPad[]
}> = [
  {
    jlcpcbPartNumber: "C265108",
    manufacturerPartNumber: "SM02B-SFHLS-TF(LF)(SN)",
    packageName: "SMD,P=1.8mm,卧贴",
    mountingPadsOnTop: false,
    signalPinCount: 2,
    pads: [
      rectPad(1, -2.100072, 2.250059, 1.2999974, 1.999996),
      rectPad(2, 2.100072, 2.250059, 1.2999974, 1.999996),
      rectPad(3, 2.199894, -2.250059, 1.0999978, 1.999996),
      rectPad(4, -2.199894, -2.250059, 1.0999978, 1.999996),
    ],
  },
  {
    jlcpcbPartNumber: "C265440",
    manufacturerPartNumber: "B5B-ZR-SM4-TF(LF)(SN)",
    packageName: "SMD,P=1.5mm",
    mountingPadsOnTop: true,
    signalPinCount: 5,
    pads: [
      rectPad(1, -2.999994, -0.25006935, 0.6999986, 4.99999),
      rectPad(2, -1.49987, -0.25006935, 0.6999986, 4.99999),
      rectPad(3, 0, -0.25006935, 0.6999986, 4.99999),
      rectPad(4, 1.500124, -0.25006935, 0.6999986, 4.99999),
      rectPad(5, 2.999994, -0.25006935, 0.6999986, 4.99999),
      rectPad(6, 5.050028, 1.60006665, 1.499997, 2.2999954),
      rectPad(7, -5.050028, 1.60006665, 1.499997, 2.2999954),
    ],
  },
  {
    jlcpcbPartNumber: "C160354",
    manufacturerPartNumber: "B4B-PH-SM4-TB(LF)(SN)",
    packageName: "SMD,P=2mm",
    mountingPadsOnTop: false,
    signalPinCount: 4,
    pads: [
      rectPad(1, 2.996946, 0.5079873, 0.999998, 5.999988),
      rectPad(2, 0.99695, 0.5079873, 0.999998, 5.999988),
      rectPad(3, -1.003046, 0.5079873, 0.999998, 5.999988),
      rectPad(4, -3.000502, 0.5079873, 0.999998, 5.999988),
      rectPad(5, -5.348986, -1.8079847, 1.7999964, 3.3999932),
      rectPad(6, 5.348986, -1.8079847, 1.7999964, 3.3999932),
    ],
  },
  {
    jlcpcbPartNumber: "C405941",
    manufacturerPartNumber: "X3025WRS-03D-LPSW",
    packageName: "SMD,P=3mm,卧贴",
    mountingPadsOnTop: false,
    signalPinCount: 3,
    pads: [
      rectPad(4, -6.860032, -3.04000535, 3.499993, 1.6999966),
      rectPad(5, 6.860032, -3.04000535, 3.499993, 1.6999966),
      rectPad(1, 2.999994, 2.39000665, 1.2999974, 2.999994),
      rectPad(2, 0, 2.39000665, 1.2999974, 2.999994),
      rectPad(3, -2.999994, 2.39000665, 1.2999974, 2.999994),
    ],
  },
  {
    jlcpcbPartNumber: "C7429680",
    manufacturerPartNumber: "ZX-XH2.54-2PLT",
    packageName: "SMD,P=2.5mm",
    mountingPadsOnTop: false,
    signalPinCount: 2,
    pads: [
      rectPad(4, -4.350004, -2.50002675, 1.499997, 2.999994),
      rectPad(3, 4.350004, -2.50002675, 1.499997, 2.999994),
      rectPad(2, 1.249934, 1.25002925, 1.1999976, 5.499989),
      rectPad(1, -1.249934, 1.25002925, 1.1999976, 5.499989),
    ],
  },
  {
    jlcpcbPartNumber: "C7429671",
    manufacturerPartNumber: "ZX-XH2.54-2PWT",
    packageName: "SMD,P=2.5mm,卧贴",
    mountingPadsOnTop: false,
    signalPinCount: 2,
    pads: [
      rectPad(3, -4.230243, -3.699891, 1.499997, 3.499993),
      rectPad(2, 1.250061, 3.699891, 1.499997, 3.499993),
      rectPad(1, -1.250061, 3.700145, 1.499997, 3.499993),
      rectPad(4, 4.230243, -3.700145, 1.499997, 3.499993),
    ],
  },
  {
    jlcpcbPartNumber: "C2765055",
    manufacturerPartNumber: "2060-452/998-404",
    packageName: "SMD,P=4mm",
    mountingPadsOnTop: false,
    signalPinCount: 2,
    pads: [
      rectPad(2, 5.25030065, -1.999996, 3.499993, 1.999996),
      rectPad(3, -4.00030315, -1.999996, 5.999988, 1.999996),
      rectPad(1, 5.25030065, 1.999996, 3.499993, 1.999996),
      rectPad(4, -4.00030315, 1.999996, 5.999988, 1.999996),
    ],
  },
]

for (const {
  jlcpcbPartNumber,
  manufacturerPartNumber,
  mountingPadsOnTop,
  packageName,
  pads,
  signalPinCount,
} of cases) {
  test(`recovers ${jlcpcbPartNumber} ${manufacturerPartNumber} as jst_smd`, () => {
    const result = circuitJsonToFootprinter(pads, {
      maxCandidates: 3,
      sourceHints: [jlcpcbPartNumber, manufacturerPartNumber, packageName],
    })

    expect(result.best?.family).toBe("jst")
    expect(result.best?.footprinterString).toStartWith(
      `jst${signalPinCount}_smd`,
    )
    if (mountingPadsOnTop) {
      expect(result.best?.footprinterString).toContain("_mounttop")
    } else {
      expect(result.best?.footprinterString).not.toContain("_mounttop")
    }
    expect(result.best?.copperIntersectionOverUnion).toBeGreaterThanOrEqual(
      0.99,
    )
  })
}
