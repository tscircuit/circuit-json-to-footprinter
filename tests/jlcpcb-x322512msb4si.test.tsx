import { expect, test } from "bun:test"
import {
  expectFootprintRecovery,
  renderFootprintToCircuitJson,
} from "./fixture/jlcpcb-reproduction-utils.js"

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

test("renders C9002 TSX to Circuit JSON with core", async () => {
  expect(await renderFootprintToCircuitJson(X322512MSB4SI)).toHaveLength(4)
})

test("recovers C9002 X322512MSB4SI", async () => {
  await expectFootprintRecovery({
    FootprintComponent: X322512MSB4SI,
    sourceHints: ["C9002 X322512MSB4SI 3225 crystal 4 pad"],
  })
})
