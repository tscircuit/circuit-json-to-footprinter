import { expect, test } from "bun:test"
import {
  expectFootprintRecovery,
  renderFootprintToCircuitJson,
} from "./fixture/jlcpcb-reproduction-utils.js"

const BME280 = () => (
  <chip
    name="U1"
    footprint={
      <footprint>
        <smtpad
          portHints={["pin4"]}
          pcbX="1.25857mm"
          pcbY="-0.975106mm"
          width="0.7670038mm"
          height="0.3640074mm"
          radius="0.1820037mm"
          shape="pill"
        />
        <smtpad
          portHints={["pin3"]}
          pcbX="1.25857mm"
          pcbY="-0.324866mm"
          width="0.7670038mm"
          height="0.3640074mm"
          radius="0.1820037mm"
          shape="pill"
        />
        <smtpad
          portHints={["pin2"]}
          pcbX="1.25857mm"
          pcbY="0.32512mm"
          width="0.7670038mm"
          height="0.3640074mm"
          radius="0.1820037mm"
          shape="pill"
        />
        <smtpad
          portHints={["pin1"]}
          pcbX="1.25857mm"
          pcbY="0.975106mm"
          width="0.7670038mm"
          height="0.3640074mm"
          radius="0.1820037mm"
          shape="pill"
        />
        <smtpad
          portHints={["pin8"]}
          pcbX="-1.25857mm"
          pcbY="0.975106mm"
          width="0.7670038mm"
          height="0.3640074mm"
          radius="0.1820037mm"
          shape="pill"
        />
        <smtpad
          portHints={["pin7"]}
          pcbX="-1.25857mm"
          pcbY="0.32512mm"
          width="0.7670038mm"
          height="0.3640074mm"
          radius="0.1820037mm"
          shape="pill"
        />
        <smtpad
          portHints={["pin6"]}
          pcbX="-1.25857mm"
          pcbY="-0.324866mm"
          width="0.7670038mm"
          height="0.3640074mm"
          radius="0.1820037mm"
          shape="pill"
        />
        <smtpad
          portHints={["pin5"]}
          pcbX="-1.25857mm"
          pcbY="-0.975106mm"
          width="0.7670038mm"
          height="0.3640074mm"
          radius="0.1820037mm"
          shape="pill"
        />
      </footprint>
    }
  />
)

test("renders C92489 BME280 TSX to Circuit JSON with core", async () => {
  expect(await renderFootprintToCircuitJson(BME280)).toHaveLength(8)
})

test("recovers C92489 BME280 with pill-shaped LGA pads", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: BME280,
    // Rounding each 0.364 mm pad dimension to 10 µm slightly lowers IoU.
    minimumCopperIntersectionOverUnion: 0.988,
    sourceHints: ["C92489 BME280 LGA-8(2.5x2.5)"],
  })

  expect(result.best?.family).toBe("lga")
  expect(result.best?.footprinterString).toContain("_pillpads")
})
