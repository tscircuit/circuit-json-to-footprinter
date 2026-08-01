import { expect, test } from "bun:test"
import { Fragment } from "react"
import { expectFootprintRecovery } from "./fixture/jlcpcb-reproduction-utils.js"

const B5psVh = () => (
  <chip
    name="J1"
    footprint={
      <footprint>
        {[-7.92, -3.96, 0, 3.96, 7.92].map((pcbX, index) => (
          <Fragment key={pcbX}>
            <platedhole
              portHints={[`pin${index + 1}`]}
              pcbX={pcbX}
              pcbY={0}
              outerDiameter={2.5}
              holeDiameter={1.8}
              shape="circle"
            />
          </Fragment>
        ))}
      </footprint>
    }
  />
)

const Mmbt3904 = () => (
  <chip
    name="Q1"
    footprint={
      <footprint>
        <smtpad
          portHints={["pin1"]}
          pcbX={0.91}
          pcbY={-0.65}
          width={0.6}
          height={0.4}
          shape="rect"
        />
        <smtpad
          portHints={["pin2"]}
          pcbX={0.91}
          pcbY={0.65}
          width={0.6}
          height={0.4}
          shape="rect"
        />
        <smtpad
          portHints={["pin3"]}
          pcbX={-0.91}
          pcbY={0}
          width={0.6}
          height={0.4}
          shape="rect"
        />
      </footprint>
    }
  />
)

const XlZ1921Rgba = () => (
  <chip
    name="D1"
    footprint={
      <footprint>
        {[
          [-0.83, -0.5],
          [-0.83, 0.5],
          [0.83, 0.5],
          [0.83, -0.5],
        ].map(([pcbX, pcbY], index) => (
          <Fragment key={`${pcbX}-${pcbY}`}>
            <smtpad
              portHints={[`pin${index + 1}`]}
              pcbX={pcbX}
              pcbY={pcbY}
              width={0.66}
              height={0.7}
              shape="rect"
            />
          </Fragment>
        ))}
      </footprint>
    }
  />
)

const Ams1117Sot223 = () => (
  <chip
    name="U1"
    footprint={
      <footprint>
        <smtpad
          portHints={["pin1"]}
          pcbX={2.93}
          pcbY={-2.3}
          width={2.5}
          height={1.1}
          shape="rect"
        />
        <smtpad
          portHints={["pin2"]}
          pcbX={2.93}
          pcbY={0}
          width={2.5}
          height={1.1}
          shape="rect"
        />
        <smtpad
          portHints={["pin3"]}
          pcbX={2.93}
          pcbY={2.3}
          width={2.5}
          height={1.1}
          shape="rect"
        />
        <smtpad
          portHints={["pin4"]}
          pcbX={-3.01}
          pcbY={0}
          width={2.34}
          height={3.6}
          shape="rect"
        />
      </footprint>
    }
  />
)

const Jy1103H330Qx = () => (
  <chip
    name="U1"
    footprint={
      <footprint>
        <smtpad
          portHints={["pin5"]}
          pcbX="0.0044958mm"
          pcbY="0.0003302mm"
          width="0.4800092mm"
          height="0.4800092mm"
          shape="rect"
        />
        <smtpad
          portHints={["pin2"]}
          points={[
            { x: "0.4250182mm", y: "-0.6495796mm" },
            { x: "0.2250186mm", y: "-0.6495796mm" },
            { x: "0.2250186mm", y: "-0.3995674mm" },
            { x: "0.2249932mm", y: "-0.3995674mm" },
            { x: "0.3750056mm", y: "-0.249555mm" },
            { x: "0.4250182mm", y: "-0.249555mm" },
          ]}
          shape="polygon"
        />
        <smtpad
          portHints={["pin1"]}
          points={[
            { x: "-0.2250186mm", y: "-0.400558mm" },
            { x: "-0.2250186mm", y: "-0.6505702mm" },
            { x: "-0.4250182mm", y: "-0.6505702mm" },
            { x: "-0.424942mm", y: "-0.2506726mm" },
            { x: "-0.375031mm", y: "-0.2505456mm" },
          ]}
          shape="polygon"
        />
        <smtpad
          portHints={["pin4"]}
          points={[
            { x: "-0.4250182mm", y: "0.650367mm" },
            { x: "-0.2250186mm", y: "0.650367mm" },
            { x: "-0.2250186mm", y: "0.4003802mm" },
            { x: "-0.2249932mm", y: "0.4003802mm" },
            { x: "-0.3750056mm", y: "0.2503678mm" },
            { x: "-0.4250182mm", y: "0.2503678mm" },
          ]}
          shape="polygon"
        />
        <smtpad
          portHints={["pin3"]}
          points={[
            { x: "0.4250182mm", y: "0.6505702mm" },
            { x: "0.2250186mm", y: "0.6505702mm" },
            { x: "0.2250186mm", y: "0.400558mm" },
            { x: "0.2249932mm", y: "0.400558mm" },
            { x: "0.3750056mm", y: "0.2505964mm" },
            { x: "0.4250182mm", y: "0.2505456mm" },
          ]}
          shape="polygon"
        />
      </footprint>
    }
  />
)

const Tps61046Yffr = () => (
  <chip
    name="U1"
    footprint={
      <footprint>
        {[
          [0.40005, 0.199898],
          [0.40005, -0.199898],
          [0, 0.199898],
          [0, -0.199898],
          [-0.40005, 0.199898],
          [-0.40005, -0.199898],
        ].map(([pcbX, pcbY], index) => (
          <Fragment key={`${pcbX}-${pcbY}`}>
            <smtpad
              portHints={[`pin${index + 1}`]}
              pcbX={pcbX}
              pcbY={pcbY}
              width={0.1839976}
              height={0.1839976}
              shape="rect"
            />
          </Fragment>
        ))}
      </footprint>
    }
  />
)

const Tps7A2012Pycjr = () => (
  <chip
    name="U1"
    footprint={
      <footprint>
        {[
          [-0.175006, 0.175006],
          [0.175006, 0.175006],
          [-0.175006, -0.175006],
          [0.175006, -0.175006],
        ].map(([pcbX, pcbY], index) => (
          <Fragment key={`${pcbX}-${pcbY}`}>
            <smtpad
              portHints={[`pin${index + 1}`]}
              pcbX={pcbX}
              pcbY={pcbY}
              width={0.1649984}
              height={0.1649984}
              shape="rect"
            />
          </Fragment>
        ))}
      </footprint>
    }
  />
)

const Hx12x12x73TpftB = () => (
  <chip
    name="SW1"
    footprint={
      <footprint>
        {[
          [7.499985, -2.499995],
          [-7.499985, -2.499995],
          [7.499985, 2.499995],
          [-7.499985, 2.499995],
        ].map(([pcbX, pcbY], index) => (
          <Fragment key={`${pcbX}-${pcbY}`}>
            <smtpad
              portHints={[`pin${4 - index}`]}
              pcbX={pcbX}
              pcbY={pcbY}
              width={2.999994}
              height={1.999996}
              shape="rect"
            />
          </Fragment>
        ))}
      </footprint>
    }
  />
)

const Q13Mc30610003 = () => (
  <chip
    name="Y1"
    footprint={
      <footprint>
        {[
          [-2.84988, -1.500124],
          [2.84988, -1.500124],
          [2.84988, 1.500124],
          [-2.84988, 1.500124],
        ].map(([pcbX, pcbY], index) => (
          <Fragment key={`${pcbX}-${pcbY}`}>
            <smtpad
              portHints={[`pin${index + 1}`]}
              pcbX={pcbX}
              pcbY={pcbY}
              width={0.8999982}
              height={1.2999974}
              shape="rect"
            />
          </Fragment>
        ))}
      </footprint>
    }
  />
)

test("recovers C157989 all-round pinrow pads", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: B5psVh,
    sourceHints: ["C157989 B5PS-VH(LF)(SN) connector"],
  })

  expect(result.best!.footprinterString).toBe(
    "pinrow5_nosquareplating_p3.96mm_od2.5mm_id1.8mm",
  )
})

test("refines C58011 SOT-323 dimensions at emitted precision", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Mmbt3904,
    sourceHints: ["C58011 MMBT3904WT1G SC-70 SOT-323"],
  })

  expect(result.best!.footprinterString).toBe(
    "sot323_p0.91mm_pw0.4mm_pl0.6mm_pin1location(rightside,bottom)",
  )
})

test("refines C22461785 DFN dimensions at emitted precision", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: XlZ1921Rgba,
    minimumCopperIntersectionOverUnion: 0.98,
    sourceHints: ["C22461785 XL-Z1921RGBA-SG SMD-4P"],
  })

  expect(result.best!.footprinterString).toBe(
    "dfn4_p1mm_w2.32mm_pw0.7mm_pl0.66mm",
  )
})

test("recovers C6186 with generic SOT-223 tab geometry", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Ams1117Sot223,
    sourceHints: ["C6186 AMS1117-3.3 SOT-223"],
  })

  expect(result.best!.footprinterString).toBe(
    "sot223_w8.06mm_p2.3mm_pl2.5mm_pw1.1mm_tabpl2.34mm_tabpw3.6mm_taboffset0.08mm_rounded0_pin1location(rightside,bottom)",
  )
})

test("recovers C3038104 DFN-4-EP corner pads", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Jy1103H330Qx,
    minimumCopperIntersectionOverUnion: 0.98,
    sourceHints: ["C3038104 JY1103-H330QX DFN-4-EP(1x1)"],
  })

  expect(result.best!.footprinterString).toBe(
    "dfn4_w1.3009mm_p0.65mm_pl0.4mm_pw0.2mm_cornerpads_cornerpadcutlength0.15mm_thermalpad0.48mmx0.48mm_rounded0_thermalpadcenteroffsety-0.005mm_pin1location(leftside,bottom)",
  )
})

test("recovers C181551 as a six-pad BGA grid", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Tps61046Yffr,
    sourceHints: ["C181551 TPS61046YFFR DSBGA-6"],
  })

  expect(result.best!.footprinterString).toBe(
    "bga6_grid3x2_p0.4001mm_pad0.184mm_pin1location(rightside,top)",
  )
})

test("recovers C5220159 as a four-pad BGA grid at 5 um pad precision", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Tps7A2012Pycjr,
    sourceHints: ["C5220159 TPS7A2012PYCJR DSBGA-4(0.6x0.6)"],
  })

  expect(result.best!.footprinterString).toBe(
    "bga4_grid2x2_p0.35mm_pad0.165mm_pin1location(leftside,top)",
  )
})

test("recovers C36498966 as a large SMD push button", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Hx12x12x73TpftB,
    sourceHints: ["C36498966 HX 12x12x7.3TPFT-B SMD-4P,11.8x11.8mm"],
  })

  expect(result.best!.footprinterString).toBe(
    "smdpushbutton4_px15mm_py5mm_pw3mm_ph2mm",
  )
})

test("recovers C16320 with a measured DFN-4 seed", async () => {
  const result = await expectFootprintRecovery({
    FootprintComponent: Q13Mc30610003,
    minimumCopperIntersectionOverUnion: 0.989,
    sourceHints: ["C16320 Q13MC30610003 MC-306"],
  })

  expect(result.best!.footprinterString).toBe(
    "dfn4_p3.0002mm_w6.5998mm_pw1.3mm_pl0.9mm",
  )
})
