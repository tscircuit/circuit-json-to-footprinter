import { expect, test } from "bun:test"
import {
  expectFootprintRecovery,
  renderFootprintToCircuitJson,
} from "./jlcpcb-reproduction-utils.js"

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

test("renders C23380830 TSX to Circuit JSON with core", async () => {
  expect(await renderFootprintToCircuitJson(AP2112K)).toHaveLength(5)
})

test.failing("recovers C23380830 AP2112K_3_3TRG1", async () => {
  await expectFootprintRecovery({
    name: "C23380830 AP2112K_3_3TRG1",
    FootprintComponent: AP2112K,
    sourceHints: ["C23380830 AP2112K-3.3TRG1 SOT-23-5"],
  })
})
