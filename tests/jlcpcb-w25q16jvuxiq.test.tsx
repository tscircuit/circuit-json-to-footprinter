import { expect, test } from "bun:test"
import {
  expectFootprintRecovery,
  renderFootprintToCircuitJson,
} from "./fixture/jlcpcb-reproduction-utils.js"

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

test("renders C2843335 TSX to Circuit JSON with core", async () => {
  expect(await renderFootprintToCircuitJson(W25Q16JVUXIQ)).toHaveLength(9)
})

test("recovers C2843335 W25Q16JVUXIQ", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: W25Q16JVUXIQ,
    sourceHints: ["C2843335 W25Q16JVUXIQ USON-8 exposed pad"],
  })

  expect(result.best?.family).toBe("wson")
  expect(result.best?.footprinterString).toBe("wson")
})
