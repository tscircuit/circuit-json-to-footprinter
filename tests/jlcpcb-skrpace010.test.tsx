import { expect, test } from "bun:test"
import {
  expectFootprintRecovery,
  renderFootprintToCircuitJson,
} from "./fixture/jlcpcb-reproduction-utils.js"

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

test("renders C139797 TSX to Circuit JSON with core", async () => {
  expect(await renderFootprintToCircuitJson(SKRPACE010)).toHaveLength(4)
})

test("recovers C139797 SKRPACE010", async () => {
  await expectFootprintRecovery({
    FootprintComponent: SKRPACE010,
    sourceHints: ["C139797 SKRPACE010 SMD tactile switch 4 pad"],
  })
})
