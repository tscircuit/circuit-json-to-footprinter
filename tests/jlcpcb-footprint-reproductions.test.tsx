import { expect, test } from "bun:test"
import { Circuit } from "@tscircuit/core"
import type { AnyCircuitElement } from "circuit-json"
import { circuitJsonToFootprinter } from "../lib/index.js"

const UsbC16Pin = () => (
  <chip
    name="J1"
    footprint={
      <footprint>
        <platedhole
          pcbX="-2.889885mm"
          pcbY="1.05492555mm"
          holeDiameter="0.700024mm"
          outerDiameter={0.700024}
          shape="circle"
        />
        <platedhole
          pcbX="2.890139mm"
          pcbY="1.05492555mm"
          holeDiameter="0.700024mm"
          outerDiameter={0.700024}
          shape="circle"
        />
        <platedhole
          portHints={["pin13"]}
          pcbX="-4.324985mm"
          pcbY="1.57511755mm"
          holeWidth="0.5999988mm"
          holeHeight="1.499997mm"
          outerWidth="1.0999978mm"
          outerHeight="1.999996mm"
          shape="pill"
        />
        <platedhole
          portHints={["pin14"]}
          pcbX="4.324985mm"
          pcbY="1.57511755mm"
          holeWidth="0.5999988mm"
          holeHeight="1.499997mm"
          outerWidth="1.0999978mm"
          outerHeight="1.999996mm"
          shape="pill"
        />
        <platedhole
          portHints={["pin15"]}
          pcbX="-4.324985mm"
          pcbY="-2.62502645mm"
          holeWidth="0.5999988mm"
          holeHeight="1.1999976mm"
          outerWidth="1.1999976mm"
          outerHeight="1.7999964mm"
          shape="pill"
        />
        <platedhole
          portHints={["pin16"]}
          pcbX="4.324985mm"
          pcbY="-2.62502645mm"
          holeWidth="0.5999988mm"
          holeHeight="1.1999976mm"
          outerWidth="1.1999976mm"
          outerHeight="1.7999964mm"
          shape="pill"
        />
        <smtpad
          portHints={["pin17"]}
          pcbX="-3.200019mm"
          pcbY="2.12502755mm"
          width="0.5500116mm"
          height="1.0999978mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin18"]}
          pcbX="-2.399919mm"
          pcbY="2.12502755mm"
          width="0.5500116mm"
          height="1.0999978mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin19"]}
          pcbX="-1.749933mm"
          pcbY="2.12502755mm"
          width="0.2999994mm"
          height="1.0999978mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin20"]}
          pcbX="-1.249807mm"
          pcbY="2.12502755mm"
          width="0.2999994mm"
          height="1.0999978mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin21"]}
          pcbX="-0.749935mm"
          pcbY="2.12502755mm"
          width="0.2999994mm"
          height="1.0999978mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin22"]}
          pcbX="-0.250063mm"
          pcbY="2.12502755mm"
          width="0.2999994mm"
          height="1.0999978mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin23"]}
          pcbX="0.250063mm"
          pcbY="2.12502755mm"
          width="0.2999994mm"
          height="1.0999978mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin24"]}
          pcbX="0.749935mm"
          pcbY="2.12502755mm"
          width="0.2999994mm"
          height="1.0999978mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin25"]}
          pcbX="1.250061mm"
          pcbY="2.12502755mm"
          width="0.2999994mm"
          height="1.0999978mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin26"]}
          pcbX="1.750187mm"
          pcbY="2.12502755mm"
          width="0.2999994mm"
          height="1.0999978mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin27"]}
          pcbX="2.400173mm"
          pcbY="2.12502755mm"
          width="0.5500116mm"
          height="1.0999978mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin28"]}
          pcbX="3.200019mm"
          pcbY="2.12502755mm"
          width="0.5500116mm"
          height="1.0999978mm"
          shape="rect"
        />
      </footprint>
    }
  />
)

const W25Q16JVUXIQ = () => (
  <chip
    name="U1"
    footprint={
      <footprint>
        <smtpad
          portHints={["pin1"]}
          pcbX="-0.750062mm"
          pcbY="-1.50749mm"
          width="0.2800096mm"
          height="0.5999988mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin2"]}
          pcbX="-0.249936mm"
          pcbY="-1.50749mm"
          width="0.2800096mm"
          height="0.5999988mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin3"]}
          pcbX="0.249936mm"
          pcbY="-1.50749mm"
          width="0.2800096mm"
          height="0.5999988mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin4"]}
          pcbX="0.750062mm"
          pcbY="-1.50749mm"
          width="0.2800096mm"
          height="0.5999988mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin8"]}
          pcbX="-0.750062mm"
          pcbY="1.50749mm"
          width="0.2800096mm"
          height="0.5999988mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin7"]}
          pcbX="-0.249936mm"
          pcbY="1.50749mm"
          width="0.2800096mm"
          height="0.5999988mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin6"]}
          pcbX="0.249936mm"
          pcbY="1.50749mm"
          width="0.2800096mm"
          height="0.5999988mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin5"]}
          pcbX="0.750062mm"
          pcbY="1.50749mm"
          width="0.2800096mm"
          height="0.5999988mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin9"]}
          pcbX="0mm"
          pcbY="0mm"
          width="1.6999966mm"
          height="0.2999994mm"
          shape="rect"
        />
      </footprint>
    }
  />
)

const AP2112K = () => (
  <chip
    name="U1"
    footprint={
      <footprint>
        <smtpad
          portHints={["pin2"]}
          pcbX="1.100074mm"
          pcbY="-0.000127mm"
          width="0.999998mm"
          height="0.5999988mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin3"]}
          pcbX="1.100074mm"
          pcbY="0.949833mm"
          width="0.999998mm"
          height="0.5999988mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin1"]}
          pcbX="1.100074mm"
          pcbY="-0.949833mm"
          width="0.999998mm"
          height="0.5999988mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin4"]}
          pcbX="-1.100074mm"
          pcbY="0.950087mm"
          width="0.999998mm"
          height="0.5999988mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin5"]}
          pcbX="-1.100074mm"
          pcbY="-0.950087mm"
          width="0.999998mm"
          height="0.5999988mm"
          shape="rect"
        />
      </footprint>
    }
  />
)

const X322512MSB4SI = () => (
  <chip
    name="Y1"
    footprint={
      <footprint>
        <smtpad
          portHints={["pin1"]}
          pcbX="-1.100074mm"
          pcbY="-0.850011mm"
          width="1.3999972mm"
          height="1.1999976mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin2"]}
          pcbX="1.100074mm"
          pcbY="-0.850011mm"
          width="1.3999972mm"
          height="1.1999976mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin3"]}
          pcbX="1.100074mm"
          pcbY="0.850011mm"
          width="1.3999972mm"
          height="1.1999976mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin4"]}
          pcbX="-1.100074mm"
          pcbY="0.850011mm"
          width="1.3999972mm"
          height="1.1999976mm"
          shape="rect"
        />
      </footprint>
    }
  />
)

const SKRPACE010 = () => (
  <chip
    name="SW1"
    footprint={
      <footprint>
        <smtpad
          portHints={["pin1"]}
          pcbX="-2.100072mm"
          pcbY="1.074928mm"
          width="1.0500106mm"
          height="0.6999986mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin2"]}
          pcbX="2.100072mm"
          pcbY="1.074928mm"
          width="1.0500106mm"
          height="0.6999986mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin3"]}
          pcbX="-2.100072mm"
          pcbY="-1.074928mm"
          width="1.0500106mm"
          height="0.6999986mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin4"]}
          pcbX="2.100072mm"
          pcbY="-1.074928mm"
          width="1.0500106mm"
          height="0.6999986mm"
          shape="rect"
        />
      </footprint>
    }
  />
)

const renderFootprintToCircuitJson = async (
  FootprintComponent: () => React.JSX.Element,
) => {
  const circuit = new Circuit()
  circuit.add(<FootprintComponent />)
  await circuit.renderUntilSettled()

  return circuit
    .getCircuitJson()
    .filter(
      (element): element is AnyCircuitElement =>
        element.type === "pcb_smtpad" || element.type === "pcb_plated_hole",
    )
}

const reproductions = [
  {
    name: "C2765186 TYPE_C_16PIN_2MD_073_",
    FootprintComponent: UsbC16Pin,
    expectedPadCount: 18,
    sourceHints: ["C2765186 USB Type-C 16 pin connector SMD through-hole"],
  },
  {
    name: "C2843335 W25Q16JVUXIQ",
    FootprintComponent: W25Q16JVUXIQ,
    expectedPadCount: 9,
    sourceHints: ["C2843335 W25Q16JVUXIQ USON-8 exposed pad"],
  },
  {
    name: "C23380830 AP2112K_3_3TRG1",
    FootprintComponent: AP2112K,
    expectedPadCount: 5,
    sourceHints: ["C23380830 AP2112K-3.3TRG1 SOT-23-5"],
  },
  {
    name: "C9002 X322512MSB4SI",
    FootprintComponent: X322512MSB4SI,
    expectedPadCount: 4,
    sourceHints: ["C9002 X322512MSB4SI 3225 crystal 4 pad"],
  },
  {
    name: "C139797 SKRPACE010",
    FootprintComponent: SKRPACE010,
    expectedPadCount: 4,
    sourceHints: ["C139797 SKRPACE010 SMD tactile switch 4 pad"],
  },
]

test("renders JLCPCB TSX reproductions to Circuit JSON with core", async () => {
  for (const reproduction of reproductions) {
    const circuitJson = await renderFootprintToCircuitJson(
      reproduction.FootprintComponent,
    )
    expect(circuitJson).toHaveLength(reproduction.expectedPadCount)
  }
})

// Keep the desired behavior executable without making CI red while these
// converter gaps are still open. A fixed case will fail until `.failing` is
// removed, making the transition to a permanent regression test explicit.
for (const reproduction of reproductions) {
  test.failing(`recovers JLCPCB footprint ${reproduction.name}`, async () => {
    const circuitJson = await renderFootprintToCircuitJson(
      reproduction.FootprintComponent,
    )
    const result = circuitJsonToFootprinter(circuitJson, {
      maxCandidates: 5,
      sourceHints: reproduction.sourceHints,
    })

    expect(result.best).not.toBeNull()
    expect(result.best!.copperIntersectionOverUnion).toBeGreaterThanOrEqual(
      0.99,
    )
  })
}
