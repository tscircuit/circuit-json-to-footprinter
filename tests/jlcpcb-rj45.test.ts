import { expect, test } from "bun:test"
import type {
  AnyCircuitElement,
  PcbHoleCircle,
  PcbPlatedHole,
} from "circuit-json"
import { circuitJsonToFootprinter } from "../lib/index.js"

const platedHole = (
  pin: number,
  x: number,
  y: number,
  outerDiameter = 1.524,
  holeDiameter = 0.9144,
): PcbPlatedHole => ({
  type: "pcb_plated_hole",
  pcb_plated_hole_id: `pad_${pin}`,
  shape: "circle",
  x,
  y,
  hole_diameter: holeDiameter,
  outer_diameter: outerDiameter,
  pcb_port_id: "",
  layers: ["top", "bottom"],
  port_hints: [`pin${pin}`],
})

const locatorHole = (
  x: number,
  y: number,
  diameter: number,
): PcbHoleCircle => ({
  type: "pcb_hole",
  pcb_hole_id: "",
  pcb_component_id: "",
  hole_shape: "circle",
  hole_diameter: diameter,
  x,
  y,
})

const cases: Array<{
  expectedFlags: string[]
  forbiddenFlags: string[]
  manufacturerPartNumber: string
  partNumber: string
  circuitJson: AnyCircuitElement[]
}> = [
  {
    partNumber: "C386756",
    manufacturerPartNumber: "R-RJ45R08P-B000",
    expectedFlags: [],
    forbiddenFlags: ["ledpins", "firstpinleft", "firstpintop"],
    circuitJson: [
      locatorHole(6.35, -2.516016, 3.2499808),
      locatorHole(-6.35, -2.516016, 3.2499808),
      platedHole(10, 8.130032, 1.044048, 2.499995, 1.7999964),
      platedHole(9, -8.130032, 1.044048, 2.499995, 1.7999964),
      platedHole(8, -3.56997, 1.804016),
      platedHole(7, -2.549906, 0.023984),
      platedHole(6, -1.530096, 1.804016),
      platedHole(5, -0.510032, 0.023984),
      platedHole(4, 0.510032, 1.804016),
      platedHole(3, 1.530096, 0.023984),
      platedHole(2, 2.549906, 1.804016),
      platedHole(1, 3.56997, 0.023984),
    ],
  },
  {
    partNumber: "C386757",
    manufacturerPartNumber: "R-RJ45R08P-C000",
    expectedFlags: ["ledpins"],
    forbiddenFlags: ["firstpinleft", "firstpintop"],
    circuitJson: [
      locatorHole(-6.35, -4.921015, 3.3000188),
      locatorHole(6.35, -4.921015, 3.3000188),
      platedHole(14, -8.130032, -1.360951, 2.499995, 1.9000216),
      platedHole(13, 8.130032, -1.360951, 2.499995, 1.9000216),
      platedHole(12, 6.860032, 4.209015),
      platedHole(11, 4.569968, 4.209015),
      platedHole(10, -4.569968, 4.209015),
      platedHole(9, -6.860032, 4.209015),
      platedHole(8, -3.56997, -0.600983),
      platedHole(7, -2.549906, -2.381015),
      platedHole(6, -1.530096, -0.600983),
      platedHole(5, -0.510032, -2.381015),
      platedHole(4, 0.510032, -0.600983),
      platedHole(3, 1.530096, -2.381015),
      platedHole(2, 2.549906, -0.600983),
      platedHole(1, 3.56997, -2.381015),
    ],
  },
  {
    partNumber: "C386758",
    manufacturerPartNumber: "R-RJ45R10P-B000",
    expectedFlags: ["firstpintop"],
    forbiddenFlags: ["ledpins", "firstpinleft"],
    circuitJson: [
      locatorHole(5.715, 2.67598525, 3.1999936),
      locatorHole(-5.715, 2.67598525, 3.1999936),
      platedHole(9, 7.750048, 5.72601725, 2.499995, 1.5999968),
      platedHole(10, -7.750048, 5.72601725, 2.499995, 1.5999968),
      platedHole(8, -4.445, -6.21401475),
      platedHole(7, -3.175, -3.67401475),
      platedHole(6, -1.905, -6.21401475),
      platedHole(5, -0.635, -3.67401475),
      platedHole(4, 0.635, -6.21401475),
      platedHole(3, 1.905, -3.67401475),
      platedHole(2, 3.175, -6.21401475),
      platedHole(1, 4.445, -3.67401475),
    ],
  },
  {
    partNumber: "C386764",
    manufacturerPartNumber: "R-RJ45S08P-C000",
    expectedFlags: ["ledpins", "firstpinleft"],
    forbiddenFlags: ["firstpintop"],
    circuitJson: [
      locatorHole(5.715, -2.390013, 3.3000188),
      locatorHole(-5.715, -2.390013, 3.3000188),
      platedHole(14, 7.914894, 1.459865, 2.499995, 1.700022),
      platedHole(13, -7.914894, 1.459865, 2.499995, 1.700022),
      platedHole(12, 6.409944, -6.499987),
      platedHole(11, 3.869944, -6.499987),
      platedHole(10, -3.869944, -6.499987, 1.524, 0.9139936),
      platedHole(9, -6.409944, -6.499987),
      platedHole(8, 4.445, 6.499987),
      platedHole(7, 3.175, 3.959987),
      platedHole(6, 1.905, 6.499987),
      platedHole(5, 0.635, 3.959987),
      platedHole(4, -0.635, 6.499987),
      platedHole(3, -1.905, 3.959987),
      platedHole(2, -3.175, 6.499987),
      platedHole(1, -4.445, 3.959987),
    ],
  },
]

for (const {
  circuitJson,
  expectedFlags,
  forbiddenFlags,
  manufacturerPartNumber,
  partNumber,
} of cases) {
  test(`recovers ${partNumber} ${manufacturerPartNumber} as rj45`, () => {
    const result = circuitJsonToFootprinter(circuitJson, {
      maxCandidates: 3,
      sourceHints: [partNumber, manufacturerPartNumber, "RJ45 Ethernet 8P8C"],
    })

    expect(result.best?.family).toBe("rj45")
    for (const flag of expectedFlags) {
      expect(result.best?.footprinterString).toContain(`_${flag}`)
    }
    for (const flag of forbiddenFlags) {
      expect(result.best?.footprinterString).not.toContain(`_${flag}`)
    }
    if (partNumber !== "C386756") {
      expect(result.best?.footprinterString).toContain("_shieldx")
      expect(result.best?.footprinterString).toContain("_holex")
    }
    expect(result.best?.copperIntersectionOverUnion).toBeGreaterThanOrEqual(
      0.99,
    )
    expect(result.best?.holeIntersectionOverUnion).toBeGreaterThanOrEqual(0.99)
  })
}
