import { expect, test } from "bun:test"
import { fp } from "@tscircuit/footprinter"
import type { AnyCircuitElement } from "circuit-json"
import {
  discoverFootprinterString,
  formatLength,
  rotateFootprint,
} from "../lib/discover-footprinter.js"
import {
  circuitJsonToFootprint,
  circuitJsonToFootprinter,
} from "../lib/index.js"

const circuitJsonFromFootprinter = (footprinterString: string) =>
  fp.string(footprinterString).circuitJson()

const circuitJsonWithSourceComponentType = (
  footprinterString: string,
  ftype:
    | "simple_capacitor"
    | "simple_diode"
    | "simple_fuse"
    | "simple_inductor"
    | "simple_resistor",
) => {
  const pcbComponentId = "pcb_component_1"
  const sourceComponentId = "source_component_1"
  return [
    {
      type: "source_component",
      ftype,
      source_component_id: sourceComponentId,
    },
    {
      type: "pcb_component",
      pcb_component_id: pcbComponentId,
      source_component_id: sourceComponentId,
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      layer: "top",
      rotation: 0,
    },
    ...circuitJsonFromFootprinter(footprinterString).map((element) =>
      element.type === "pcb_smtpad" || element.type === "pcb_plated_hole"
        ? { ...element, pcb_component_id: pcbComponentId }
        : element,
    ),
  ] as AnyCircuitElement[]
}

const rotatedCircuitJsonFromFootprinter = (
  footprinterString: string,
  rotation: 90 | 270,
  sourceHints: string[],
) => {
  return rotateFootprint(
    circuitJsonToFootprint(circuitJsonFromFootprinter(footprinterString), {
      sourceHints,
    }),
    rotation,
  )
}

test("recovers a parameterized dual-row footprint", () => {
  const result = circuitJsonToFootprinter(
    circuitJsonFromFootprinter("soic8_p1.1mm_w6.2mm_pw0.55mm_pl1.4mm"),
    { maxCandidates: 3, sourceHints: ["SOIC-8"] },
  )

  expect(result.diagnostics.topology).toBe("two-sided")
  expect(result.best?.family).toBe("soic")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
  expect(result.best?.footprinterString).toContain("p1.1mm")
  expect(result.best?.footprinterString).toContain("w6.2mm")
})

test("preserves pill-shaped pads when the footprint family supports them", () => {
  const source = "soic8_p1.1mm_w6.2mm_pw0.55mm_pl1.4mm_pillpads"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["SOIC-8"],
  })

  expect(result.best?.family).toBe("soic")
  expect(result.best?.footprinterString).toContain("_pillpads")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
})

test("preserves pill-shaped pads for quad footprints", () => {
  const source =
    "qfn32_p0.5mm_w5.8mm_h5.8mm_pw0.28mm_pl0.8mm_thermalpad3.4mmx3.4mm_pillpads"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["QFN-32 exposed pad"],
  })

  expect(result.best?.family).toBe("qfn")
  expect(result.best?.footprinterString).toContain("_pillpads")
  expect(result.best?.footprinterString).toContain("thermalpad3.4mmx3.4mm")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
}, 15_000)

test("infers USB-C mid-mount shell slots and locator holes", () => {
  const source =
    "usbcmidmount16_tophw0.8mm_bottomhw0.8mm_tophh1.6mm_bottomhh1.4mm_topring0.2mm_bottomring0.2mm_rowy2.174mm_ph1.3mm_pw0.3mm_powerpw0.6mm_powerx3.2mm_shellx4.3251mm_topy1.4057mm_bottomy2.7741mm_holex2.8999mm_holey0.9056mm_holed0.75mm"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["TYPE-C-31-M-12"],
  })

  expect(result.best?.family).toBe("usbcmidmount")
  expect(result.best?.footprinterString).toContain("tophw0.8mm")
  expect(result.best?.footprinterString).toContain("bottomhw0.8mm")
  expect(result.best?.footprinterString).toContain("tophh1.6mm")
  expect(result.best?.footprinterString).toContain("bottomhh1.4mm")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
  expect(result.best?.holeIntersectionOverUnion).toBeGreaterThan(0.99)
}, 15_000)

test("infers unequal LGA side counts and continuous dimensions", () => {
  const source = "lga14_grid4x3_p0.5mm_w3.2mm_h2.7mm_pw0.28mm_pl0.675mm"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["LGA-14(2.5x3)"],
  })

  expect(result.diagnostics.topology).toBe("four-sided")
  expect(result.best?.family).toBe("lga")
  expect(result.best?.footprinterString).toMatch(/^lga/)
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
}, 15_000)

test("preserves pill-shaped pads for unequal LGA side counts", () => {
  const source = "lga16_grid5x3_p0.5mm_w3.6mm_h3.6mm_pw0.28mm_pl0.8mm_pillpads"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["LGA-16(3x3)"],
  })

  expect(result.best?.family).toBe("lga")
  expect(result.best?.footprinterString).toContain("lga16_grid5x3")
  expect(result.best?.footprinterString).toContain("_pillpads")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
}, 15_000)

test("recovers a two-sided LGA footprint", () => {
  const source = "lga6_grid3x0_p0.94mm_w1.74mm_pw0.64mm_pl0.57mm"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["LGA-6 microphone"],
  })

  expect(result.diagnostics.topology).toBe("two-sided")
  expect(result.best?.family).toBe("lga")
  expect(result.best?.footprinterString).toContain("lga6_grid3x0")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
}, 15_000)

test("recovers a two-sided footprint with a center thermal pad", () => {
  const source = "soic8_p1.27mm_w6.2mm_pw0.55mm_pl1.4mm_thermalpad2.4x3mm"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 3,
    sourceHints: ["SOIC-8 exposed pad"],
  })

  expect(result.diagnostics.topology).toBe("two-sided")
  expect(result.best?.family).toBe("soic")
  expect(result.best?.footprinterString).toContain("thermalpad2.4mmx3mm")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
})

test("swaps thermal-pad dimensions for a rotated two-sided footprint", () => {
  const source =
    "dfn8_p1.27mm_w7.6mm_pw0.574mm_pl2.038mm_thermalpad3.2x2.4mm_pillpads"
  const result = discoverFootprinterString(
    rotatedCircuitJsonFromFootprinter(source, 90, ["HTSSOP-8 exposed pad"]),
    3,
  )

  expect(result.diagnostics.topology).toBe("two-sided")
  expect(result.best?.family).toBe("dfn")
  expect(result.best?.footprinterString).toContain("thermalpad3.2mmx2.4mm")
  expect(result.best?.footprinterString).toContain("_pillpads")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.99)
})

test("uses micrometer units only for dimensions below 0.1mm", () => {
  expect(formatLength(0.05)).toBe("50um")
  expect(formatLength(0.09)).toBe("90um")
  expect(formatLength(0.1)).toBe("0.1mm")
  expect(formatLength(0.55)).toBe("0.55mm")
  expect(formatLength(1.3)).toBe("1.3mm")
})

test("rounds general dimensions to the nearest 10 micrometers", () => {
  expect(formatLength(0.054)).toBe("50um")
  expect(formatLength(0.056)).toBe("60um")
  expect(formatLength(0.554)).toBe("0.55mm")
  expect(formatLength(0.706)).toBe("0.71mm")
  expect(formatLength(1.304)).toBe("1.3mm")
})

test("encodes a rotated match in the footprinter string", () => {
  const source = "soic8_pin1location(topside,right)"
  const result = discoverFootprinterString(
    rotatedCircuitJsonFromFootprinter("soic8", 270, ["SOIC-8"]),
    3,
  )

  expect(result.best?.footprinterString).toContain("pin1location(")
  expect(result.best).not.toHaveProperty("pcbRotation")
  expect(result.best?.copperIntersectionOverUnion).toBe(1)
  expect(result.best?.pinMatchRate).toBe(1)
  expect(result.best?.pinsMatch).toBe(true)
  expect(circuitJsonFromFootprinter(result.best!.footprinterString)).toEqual(
    circuitJsonFromFootprinter(source),
  )
})

test.each([
  ["anode", "pos", "anodepin1"],
  ["cathode", "neg", "cathodepin1"],
] as const)(
  "adds explicit pin 1 %s polarity to diode footprints",
  (polarity, alias, expectedModifier) => {
    const circuitJson = fp
      .string("sod123w")
      .circuitJson()
      .map((element) =>
        element.type === "pcb_smtpad" && element.port_hints?.includes("1")
          ? {
              ...element,
              port_hints: [...element.port_hints, polarity, alias],
            }
          : element,
      )
    const result = circuitJsonToFootprinter(circuitJson, {
      maxCandidates: 3,
      sourceHints: ["SOD-123W diode"],
    })

    expect(result.best?.family).toBe("sod123w")
    expect(result.best?.footprinterString).toEndWith(`_${expectedModifier}`)
  },
)

test("uses oriented dimensions to recover a rotated dual-row footprint", () => {
  const source = "soic8_p1.27mm_w7.3604mm_pw0.5684mm_pl1.9502mm_pillpads"
  const result = discoverFootprinterString(
    rotatedCircuitJsonFromFootprinter(source, 90, ["SOIC-8"]),
    3,
  )

  expect(result.best?.family).toBe("soic")
  expect(result.best?.footprinterString).toContain(
    "pin1location(leftside,bottom)",
  )
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.997)
})

test("infers a BGA grid and continuous dimensions", () => {
  const result = circuitJsonToFootprinter(
    circuitJsonFromFootprinter("bga16_grid4x4_p0.65mm_pad0.32mm"),
    { maxCandidates: 2 },
  )

  expect(result.diagnostics.topology).toBe("grid")
  expect(result.best?.family).toBe("bga")
  expect(result.best?.footprinterString).toContain("p0.65mm")
  expect(result.best?.footprinterString).toContain("pad0.32mm")
}, 15_000)

test("preserves the C2040-sized thermal pad independently of the body", () => {
  const source = "qfn56_w7_h7_p0.4_pw0.2_pl0.85_thermalpad3.1mmx3.1mm"
  const result = circuitJsonToFootprinter(circuitJsonFromFootprinter(source), {
    maxCandidates: 2,
    sourceHints: ["C2040 QFN-56 exposed pad"],
  })

  expect(result.diagnostics.targetPadCount).toBe(57)
  expect(result.best?.family).toBe("qfn")
  expect(result.best?.footprinterString).toContain("thermalpad3.1mmx3.1mm")
  expect(result.best?.copperIntersectionOverUnion).toBe(1)
}, 15_000)

test("rejects Circuit JSON without PCB pads", () => {
  expect(() =>
    circuitJsonToFootprinter([
      { source_component_id: "source_component_0", type: "source_component" },
    ] as AnyCircuitElement[]),
  ).toThrow("at least one PcbSmtPad or PcbPlatedHole")
})

test("accepts readonly Circuit JSON", () => {
  const circuitJson: readonly AnyCircuitElement[] =
    circuitJsonFromFootprinter("0402")
  const result = circuitJsonToFootprinter(circuitJson, { maxCandidates: 1 })

  expect(result.best).not.toBeNull()
})

test("uses the source component type to distinguish capacitor footprints", () => {
  const result = circuitJsonToFootprinter(
    circuitJsonWithSourceComponentType(
      "res_p1.400048mm_pw0.7999984mm_ph0.8999982mm",
      "simple_capacitor",
    ),
    { maxCandidates: 3 },
  )

  expect(result.best?.family).toBe("cap")
  expect(result.best?.footprinterString).toStartWith("cap_")
  expect(result.best?.footprinterString).not.toStartWith("res_")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.999)
})

test("preserves the resistor family for an explicit resistor source", () => {
  const result = circuitJsonToFootprinter(
    circuitJsonWithSourceComponentType(
      "res_p1.400048mm_pw0.7999984mm_ph0.8999982mm",
      "simple_resistor",
    ),
    { maxCandidates: 3 },
  )

  expect(result.best?.family).toBe("res")
  expect(result.best?.footprinterString).toStartWith("res_")
})

test("builds a dimensioned diode seed for JLCPCB-style pads", () => {
  const result = circuitJsonToFootprinter(
    circuitJsonWithSourceComponentType(
      "res_p2.344928mm_pw0.999998mm_ph0.6999986mm",
      "simple_diode",
    ),
    { maxCandidates: 3 },
  )

  expect(result.best?.family).toBe("diode")
  expect(result.best?.footprinterString).toStartWith("diode_")
  expect(result.best?.footprinterString).not.toStartWith("res_")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.999)
})

test("uses a neutral passive footprint for an inductor", () => {
  const result = circuitJsonToFootprinter(
    circuitJsonWithSourceComponentType(
      "res_p1.400048mm_pw0.7999984mm_ph0.8999982mm",
      "simple_inductor",
    ),
    { maxCandidates: 3 },
  )

  expect(result.best?.family).toBe("passive")
  expect(result.best?.footprinterString).toStartWith("smdpads2_")
  expect(result.best?.footprinterString).not.toStartWith("res_")
  expect(result.best?.footprinterString).not.toStartWith("cap_")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.999)
})

test("does not label a power inductor as a resistor from source hints", () => {
  const result = circuitJsonToFootprinter(
    circuitJsonFromFootprinter("res_p3.2mm_pw1.7mm_ph2mm"),
    {
      maxCandidates: 3,
      sourceHints: ["FNR4018S330MT", "33uH Power Inductor", "SMD,4x4mm"],
    },
  )

  expect(result.best?.family).toBe("passive")
  expect(result.best?.footprinterString).toStartWith("smdpads2_")
  expect(result.best?.footprinterString).not.toContain("_rounded0mm")
  expect(result.best?.footprinterString).not.toStartWith("res_")
})

test("does not imply a resistor when a two-pad type is unknown", () => {
  const result = circuitJsonToFootprinter(
    circuitJsonFromFootprinter("res_p1.400048mm_pw0.7999984mm_ph0.8999982mm"),
    { maxCandidates: 3 },
  )

  expect(result.best?.family).toBe("passive")
  expect(result.best?.footprinterString).toStartWith("smdpads2_")
  expect(result.best?.footprinterString).not.toContain("_rounded0mm")
  expect(result.best?.footprinterString).not.toStartWith("res_")
  expect(result.best?.copperIntersectionOverUnion).toBeGreaterThan(0.999)
})

test("uses a neutral passive fallback for asymmetric two-pad packages", () => {
  const result = circuitJsonToFootprinter(
    [
      {
        ...circuitJsonFromFootprinter("res_p1mm_pw1mm_ph1mm")[0],
        pcb_smtpad_id: "pad_1",
        port_hints: ["pin1"],
        x: -0.4074668,
        width: 0.6199886,
        height: 0.499999,
      },
      {
        ...circuitJsonFromFootprinter("res_p1mm_pw1mm_ph1mm")[1],
        pcb_smtpad_id: "pad_2",
        port_hints: ["pin2"],
        x: 0.4924552,
        width: 0.4500118,
        height: 0.3999992,
      },
    ] as AnyCircuitElement[],
    { maxCandidates: 3 },
  )

  expect(result.best?.family).toBe("passive")
  expect(result.best?.footprinterString).toStartWith("smdpads2_")
  expect(result.best?.footprinterString).not.toContain("_rounded0mm")
  expect(result.best?.footprinterString).not.toStartWith("res_")
})
