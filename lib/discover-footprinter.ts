import { getFootprintNames, getFootprintSizes } from "@tscircuit/footprinter"
import { summarizeCopperComparison } from "./compare-copper.js"
import { type Footprint, footprinterStringToFootprint } from "./footprint.js"
import {
  type Bounds,
  getPolygonWorldPoints,
  getShapeListBounds,
  getTransformedPcbHoleGeometry,
  getTransformedPcbPadGeometry,
  type PcbPadGeometry,
  rotatePoint,
  type ShapeGeometry,
} from "./footprint-geometry.js"

const MAX_OPTIMIZED_SEEDS = 10
const OPTIMIZATION_STEPS = 16
const NUMERIC_PARAMETERS = [
  "p",
  "px",
  "py",
  "w",
  "h",
  "pw",
  "ph",
  "pl",
  "pad",
  "ball",
  "od",
  "id",
] as const

type NumericParameter = (typeof NUMERIC_PARAMETERS)[number]
type Topology = "four-sided" | "grid" | "irregular" | "linear" | "two-sided"
type FootprintRotation = 0 | 90 | 180 | 270
type Pin1Location =
  | readonly ["bottomside" | "topside", "left" | "right"]
  | readonly ["leftside" | "rightside", "bottom" | "top"]

const FOOTPRINT_ROTATIONS: FootprintRotation[] = [0, 90, 180, 270]
const PIN1_LOCATIONS: Pin1Location[] = [
  ["leftside", "top"],
  ["leftside", "bottom"],
  ["rightside", "top"],
  ["rightside", "bottom"],
  ["topside", "left"],
  ["topside", "right"],
  ["bottomside", "left"],
  ["bottomside", "right"],
]
const DIODE_FABRICATION_NOTE_FAMILIES = new Set([
  "diode",
  "melf",
  "micromelf",
  "minimelf",
  "sma",
  "smb",
  "smbf",
  "smc",
  "smf",
  "sod80",
  "sod110",
  "sod123",
  "sod123f",
  "sod123fl",
  "sod123w",
  "sod128",
  "sod323",
  "sod323f",
  "sod323fl",
  "sod323w",
  "sod523",
  "sod723",
  "sod882",
  "sod882d",
  "sod923",
])

interface TargetAnalysis {
  bounds: Bounds
  dpak?: DpakAnalysis
  fpc?: FpcAnalysis
  jstThroughHole?: JstThroughHoleAnalysis
  jstSmd?: JstSmdAnalysis
  gridColumns: number
  gridRows: number
  heuristics: Record<NumericParameter, number>
  horizontalSidePadCount: number
  lgaPadLength: number
  lgaPadWidth: number
  perimeterPadCount: number
  platedHoleCount: number
  potentiometer?: PotentiometerAnalysis
  quadPadDimensions?: QuadPadDimensions
  quadSidePadCounts: QuadSidePadCounts
  rj45?: Rj45Analysis
  smdPushButton?: SmdPushButtonAnalysis
  smdSlideSwitch?: SmdSlideSwitchAnalysis
  sparsePinGrid?: SparsePinGridAnalysis
  usbCMidMount?: UsbCMidMountAnalysis
  thermalPad?: {
    height: number
    width: number
    xOffset: number
    yOffset: number
  }
  topology: Topology
  twoPadSmd?: TwoPadSmdAnalysis
  verticalSidePadCount: number
}

interface QuadSidePadCounts {
  left: number
  top: number
  right: number
  bottom: number
}

interface QuadPadDimensions {
  leftRightLength: number
  leftRightWidth: number
  topBottomLength: number
  topBottomWidth: number
}

interface DpakAnalysis {
  family: "d2pak" | "dpak"
  numberOfPads: 3 | 6
  p: number
  pl: number
  pw: number
  span: number
  tabh: number
  tabw: number
}

interface Rj45Analysis {
  firstPinLeft: boolean
  firstPinTop: boolean
  holeDiameter: number
  holeX: number
  holeY: number
  id: number
  ledPins: boolean
  ledPitch?: number
  ledX?: number
  ledY?: number
  od: number
  p: number
  py: number
  shieldId: number
  shieldOd: number
  shieldX: number
  shieldY: number
}

interface SparsePinGridAnalysis {
  columns: number
  missingPositions: number[]
  pitchX: number
  pitchY: number
  rows: number
}

interface FpcAnalysis {
  bottomPadLength: number
  mountingPadLength: number
  mountingPadPitch: number
  mountingPadRowDistance: number
  mountingPadWidth: number
  mountingPadsOnTop: boolean
  padLength: number
  padPitch: number
  padWidth: number
  pinCount: number
  reverse: boolean
  rowPitch: number
  staggered: boolean
  topPadLength: number
}

interface JstSmdAnalysis {
  fitScore: number
  mountingPadLength: number
  mountingPadPitch: number
  mountingPadRowDistance: number
  mountingPadWidth: number
  mountingPadsOnTop: boolean
  padLength: number
  padPitch: number
  padWidth: number
  pinCount: number
}

interface JstThroughHoleAnalysis {
  id: number
  padLength: number
  padPitch: number
  padWidth: number
  pinCount: number
}

interface TwoPadSmdAnalysis {
  padHeight: number
  pin1Offset: number
  pin1Width: number
  pin2Offset: number
  pin2Width: number
}

interface PotentiometerAnalysis {
  h: number
  id: number
  od: number
  p: number
}

interface SmdPushButtonAnalysis {
  padHeight: number
  padWidth: number
  pitchX: number
  pitchY: number
}

interface SmdSlideSwitchAnalysis {
  fitScore: number
  holeDiameter?: number
  holeX?: number
  holeY?: number
  missingColumns: number[]
  mountY: number
  mountingPadPitchX: number
  mountingPadPitchY: number
  mountingPadLength: number
  mountingPadWidth: number
  noHoles: boolean
  padLength: number
  padPitch: number
  padWidth: number
  signalColumnCount: number
}

interface UsbCMidMountAnalysis {
  bottomHoleHeight: number
  bottomHoleWidth: number
  bottomRing: number
  bottomY: number
  holeDiameter?: number
  holeX?: number
  holeY?: number
  noHoles: boolean
  powerPadWidth: number
  powerX: number
  rowY: number
  shellX: number
  signalPadHeight: number
  signalPadWidth: number
  topHoleHeight: number
  topHoleWidth: number
  topRing: number
  topY: number
}

interface SeedCandidate {
  family: string
  footprinterString: string
  geometryScore: number
  searchRotation: FootprintRotation
  footprint: Footprint
}

export interface FootprinterDiscoveryCandidate {
  copperIntersectionOverUnion: number
  domainScore: number
  family: string
  footprinterString: string
  geometryScore: number
  holeIntersectionOverUnion: number
  optimizedParameters: Partial<Record<NumericParameter, number>>
  rankingScore: number
}

interface RankedDiscoveryCandidate extends FootprinterDiscoveryCandidate {
  footprint: Footprint
  searchRotation: FootprintRotation
}

export interface FootprinterDiscoveryResult {
  best: FootprinterDiscoveryCandidate | null
  candidates: FootprinterDiscoveryCandidate[]
  diagnostics: {
    evaluatedSeeds: number
    optimizedSeeds: number
    targetPadCount: number
    topology: Topology
  }
  target: Footprint
}

const getOrientedHeuristics = (
  seed: SeedCandidate,
  analysis: TargetAnalysis,
): Record<NumericParameter, number> => {
  if (seed.family === "dip") {
    const isQuarterTurn =
      seed.searchRotation === 90 || seed.searchRotation === 270
    const orientedOuterSpan = isQuarterTurn
      ? analysis.bounds.height
      : analysis.bounds.width
    return {
      ...analysis.heuristics,
      // DIP w is the distance between pad centers, while the target bounds
      // include the outer copper diameter on both edges.
      w: Math.max(orientedOuterSpan - analysis.heuristics.od, 0.05),
    }
  }

  const heuristics =
    seed.family === "lga"
      ? {
          ...analysis.heuristics,
          h: analysis.bounds.height,
          pl: analysis.lgaPadLength,
          pw: analysis.lgaPadWidth,
          w: analysis.bounds.width,
        }
      : analysis.heuristics
  if (seed.searchRotation !== 90 && seed.searchRotation !== 270) {
    return heuristics
  }

  return {
    ...heuristics,
    h: heuristics.w,
    px: heuristics.py,
    py: heuristics.px,
    w: heuristics.h,
  }
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

const median = (values: number[]) => {
  if (!values.length) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
}

const getRepeatedSidePitch = (
  sides: ShapeGeometry[][],
  axis: "x" | "y",
  fallback: number,
) => {
  const differences = sides.flatMap((side) => {
    const coordinates = side
      .map((pad) => pad[axis])
      .toSorted((left, right) => left - right)
    return coordinates
      .slice(1)
      .map((coordinate, index) => coordinate - coordinates[index])
      .filter((difference) => difference > 0.015)
  })
  return differences.length ? median(differences) : fallback
}

const getPadBounds = (pad: ShapeGeometry): Bounds => getShapeListBounds([pad])

const getBounds = (pads: ShapeGeometry[]): Bounds => getShapeListBounds(pads)

const getPadGeometries = (footprint: Footprint) =>
  footprint.pads.map((pad) => getTransformedPcbPadGeometry(pad, footprint))

const getHoleGeometries = (footprint: Footprint) =>
  footprint.holes.map((hole) => getTransformedPcbHoleGeometry(hole, footprint))

const getCopperShapes = (footprint: Footprint) =>
  getPadGeometries(footprint).map(({ copper }) => copper)

const clusterCoordinates = (values: number[], tolerance: number) => {
  const sorted = [...values].sort((left, right) => left - right)
  const clusters: number[][] = []

  for (const value of sorted) {
    const cluster = clusters.at(-1)
    if (!cluster || Math.abs(value - median(cluster)) > tolerance) {
      clusters.push([value])
    } else {
      cluster.push(value)
    }
  }

  return clusters.map(median)
}

const getPitchEstimate = (pads: ShapeGeometry[], tolerance: number) => {
  const medianPadArea = median(pads.map((pad) => pad.width * pad.height))
  const regularPads = pads.filter(
    (pad) => pad.width * pad.height <= medianPadArea * 2.5,
  )
  const differences: number[] = []

  for (const [fixedAxis, movingAxis] of [
    ["x", "y"],
    ["y", "x"],
  ] as const) {
    const fixedCoordinates = clusterCoordinates(
      regularPads.map((pad) => pad[fixedAxis]),
      tolerance,
    )
    for (const fixedCoordinate of fixedCoordinates) {
      const movingCoordinates = clusterCoordinates(
        regularPads
          .filter(
            (pad) => Math.abs(pad[fixedAxis] - fixedCoordinate) <= tolerance,
          )
          .map((pad) => pad[movingAxis]),
        tolerance,
      )
      differences.push(
        ...movingCoordinates
          .slice(1)
          .map((coordinate, index) => coordinate - movingCoordinates[index])
          .filter((difference) => difference > tolerance),
      )
    }
  }

  if (!differences.length) return Math.max(tolerance * 2, 1)
  // Two-sided packages contribute both the lead pitch and the much larger
  // distance between rows. Prefer the lower quartile so the row span does not
  // pull the pitch estimate away from the repeated lead spacing.
  const sortedDifferences = differences.toSorted((left, right) => left - right)
  return sortedDifferences[Math.floor((sortedDifferences.length - 1) * 0.25)]
}

const analyzeFpcAxis = (
  target: Footprint,
  alongAxis: "x" | "y",
): FpcAnalysis | undefined => {
  const acrossAxis = alongAxis === "x" ? "y" : "x"
  const pads = getPadGeometries(target)
  if (
    pads.length < 4 ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_smtpad" ||
        drill ||
        (copper.shape !== "rect" && copper.shape !== "pill"),
    )
  ) {
    return undefined
  }

  const entries = pads.map((pad) => {
    const bounds = getPadBounds(pad.copper)
    const alongSize = alongAxis === "x" ? bounds.width : bounds.height
    const acrossSize = alongAxis === "x" ? bounds.height : bounds.width
    return {
      across: pad.copper[acrossAxis],
      acrossSize,
      along: pad.copper[alongAxis],
      alongSize,
      area: bounds.width * bounds.height,
      pad,
    }
  })
  const mountingPads = entries
    .toSorted((left, right) => right.area - left.area)
    .slice(0, 2)
    .toSorted((left, right) => left.along - right.along)
  const mountingPadSet = new Set(mountingPads.map(({ pad }) => pad))
  const contactPads = entries
    .filter(({ pad }) => !mountingPadSet.has(pad))
    .toSorted((left, right) => left.along - right.along)
  if (contactPads.length < 2) return undefined

  const contactDifferences = contactPads
    .slice(1)
    .map((entry, index) => entry.along - contactPads[index].along)
  const padPitch = median(contactDifferences)
  const pitchTolerance = Math.max(0.025, padPitch * 0.08)
  if (
    padPitch <= 0.08 ||
    contactDifferences.some(
      (difference) =>
        difference <= 0 || Math.abs(difference - padPitch) > pitchTolerance,
    )
  ) {
    return undefined
  }

  const firstContact = contactPads[0]
  const lastContact = contactPads.at(-1)!
  const mountingMargin = Math.max(0.05, padPitch * 0.1)
  if (
    mountingPads[0].along >= firstContact.along - mountingMargin ||
    mountingPads[1].along <= lastContact.along + mountingMargin
  ) {
    return undefined
  }

  const contactCenter = (firstContact.along + lastContact.along) / 2
  const mountingCenter = (mountingPads[0].along + mountingPads[1].along) / 2
  if (
    Math.abs(contactCenter - mountingCenter) > Math.max(0.08, padPitch * 0.3)
  ) {
    return undefined
  }

  const mountingAreaRatio =
    median(mountingPads.map(({ area }) => area)) /
    Math.max(median(contactPads.map(({ area }) => area)), 0.0001)
  const description = `${target.title} ${target.subtitle} ${
    target.sourceHints?.join(" ") ?? ""
  }`.toLowerCase()
  const hasFpcHint =
    description.includes("fpc") ||
    description.includes("ffc") ||
    description.includes("flat flexible")
  // Two-contact SMD connectors and some compact LEDs use the same mechanical
  // pattern as a two-pin FPC: two central contacts and two outboard mounts.
  const hasTwoContactWithMountsTopology = contactPads.length === 2
  if (
    !hasFpcHint &&
    !hasTwoContactWithMountsTopology &&
    (contactPads.length < 5 || mountingAreaRatio < 1.35)
  ) {
    return undefined
  }
  if (mountingAreaRatio < 1.15) return undefined

  const mountingPadAreaDifference =
    Math.abs(mountingPads[0].area - mountingPads[1].area) /
    Math.max(mountingPads[0].area, mountingPads[1].area)
  if (mountingPadAreaDifference > 0.3) return undefined

  const contactAcrossTolerance = Math.max(
    0.035,
    median(contactPads.map(({ acrossSize }) => acrossSize)) * 0.08,
  )
  const rows = clusterCoordinates(
    contactPads.map(({ across }) => across),
    contactAcrossTolerance,
  )
  if (rows.length < 1 || rows.length > 2) return undefined

  const staggered = rows.length === 2
  const rowIndex = (across: number) =>
    Math.abs(across - rows[0]) <= Math.abs(across - rows[1]) ? 0 : 1
  if (
    staggered &&
    contactPads
      .slice(1)
      .some(
        (entry, index) =>
          rowIndex(entry.across) === rowIndex(contactPads[index].across),
      )
  ) {
    return undefined
  }

  const lowerRow = staggered
    ? contactPads.filter(({ across }) => rowIndex(across) === 0)
    : contactPads
  const upperRow = staggered
    ? contactPads.filter(({ across }) => rowIndex(across) === 1)
    : contactPads
  const contactRowCenter = staggered ? (rows[0] + rows[1]) / 2 : rows[0]
  const mountingRowCenter = median(mountingPads.map(({ across }) => across))
  const mountingPadRowDistance = Math.abs(mountingRowCenter - contactRowCenter)
  if (
    Math.abs(mountingPads[0].across - mountingPads[1].across) >
    Math.max(
      0.1,
      median(mountingPads.map(({ acrossSize }) => acrossSize)) * 0.2,
    )
  ) {
    return undefined
  }

  return {
    bottomPadLength: median(lowerRow.map(({ acrossSize }) => acrossSize)),
    mountingPadLength: median(mountingPads.map(({ acrossSize }) => acrossSize)),
    mountingPadPitch: mountingPads[1].along - mountingPads[0].along,
    mountingPadRowDistance,
    mountingPadWidth: median(mountingPads.map(({ alongSize }) => alongSize)),
    mountingPadsOnTop:
      mountingPadRowDistance >= 0.005 && mountingRowCenter > contactRowCenter,
    padLength: median(contactPads.map(({ acrossSize }) => acrossSize)),
    padPitch,
    padWidth: median(contactPads.map(({ alongSize }) => alongSize)),
    pinCount: contactPads.length,
    reverse: staggered && rowIndex(firstContact.across) === 1,
    rowPitch: staggered ? rows[1] - rows[0] : 0,
    staggered,
    topPadLength: median(upperRow.map(({ acrossSize }) => acrossSize)),
  }
}

const analyzeFpc = (target: Footprint) =>
  analyzeFpcAxis(target, "x") ?? analyzeFpcAxis(target, "y")

const analyzeJstSmdAxis = (
  target: Footprint,
  alongAxis: "x" | "y",
): JstSmdAnalysis | undefined => {
  const description = `${target.title} ${target.subtitle} ${
    target.sourceHints?.join(" ") ?? ""
  }`.toLowerCase()
  if (
    !/\bjst\b/.test(description) &&
    !/wire[- ]?to[- ]?board/.test(description) &&
    !/\bsmd\s*,?\s*p\s*=/.test(description)
  ) {
    return undefined
  }

  const acrossAxis = alongAxis === "x" ? "y" : "x"
  const pads = getPadGeometries(target)
  if (
    pads.length < 4 ||
    pads.length > 14 ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_smtpad" ||
        drill ||
        (copper.shape !== "rect" && copper.shape !== "pill"),
    )
  ) {
    return undefined
  }

  const entries = pads.map((pad) => {
    const bounds = getPadBounds(pad.copper)
    return {
      across: pad.copper[acrossAxis],
      acrossSize: alongAxis === "x" ? bounds.height : bounds.width,
      along: pad.copper[alongAxis],
      alongSize: alongAxis === "x" ? bounds.width : bounds.height,
      pad,
    }
  })
  const relativeSpread = (values: number[]) => {
    const middle = Math.max(median(values), 0.0001)
    return (Math.max(...values) - Math.min(...values)) / middle
  }
  const pinNumber = ({ pad }: (typeof entries)[number]) => {
    for (const hint of pad.element.port_hints ?? []) {
      const match = hint.trim().match(/^(?:pin)?(\d+)$/i)
      if (match?.[1]) return Number.parseInt(match[1], 10)
    }
    return undefined
  }

  let best: JstSmdAnalysis | undefined
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < entries.length;
      rightIndex += 1
    ) {
      const mountingPads = [entries[leftIndex], entries[rightIndex]].toSorted(
        (left, right) => left.along - right.along,
      )
      const contacts = entries
        .filter((_, index) => index !== leftIndex && index !== rightIndex)
        .toSorted((left, right) => left.along - right.along)
      if (contacts.length < 2) continue

      const contactAlongSpread = relativeSpread(
        contacts.map(({ alongSize }) => alongSize),
      )
      const contactAcrossSpread = relativeSpread(
        contacts.map(({ acrossSize }) => acrossSize),
      )
      const mountingAlongSpread = relativeSpread(
        mountingPads.map(({ alongSize }) => alongSize),
      )
      const mountingAcrossSpread = relativeSpread(
        mountingPads.map(({ acrossSize }) => acrossSize),
      )
      if (
        contactAlongSpread > 0.12 ||
        contactAcrossSpread > 0.12 ||
        mountingAlongSpread > 0.15 ||
        mountingAcrossSpread > 0.15
      ) {
        continue
      }

      const contactAcrossSize = median(
        contacts.map(({ acrossSize }) => acrossSize),
      )
      const contactRowCenter = median(contacts.map(({ across }) => across))
      if (
        contacts.some(
          ({ across }) =>
            Math.abs(across - contactRowCenter) >
            Math.max(0.04, contactAcrossSize * 0.08),
        )
      ) {
        continue
      }

      const differences = contacts
        .slice(1)
        .map((entry, index) => entry.along - contacts[index].along)
      const padPitch = median(differences)
      if (
        padPitch <= 0.08 ||
        differences.some(
          (difference) =>
            Math.abs(difference - padPitch) > Math.max(0.04, padPitch * 0.08),
        )
      ) {
        continue
      }

      const mountingPadWidth = median(
        mountingPads.map(({ alongSize }) => alongSize),
      )
      const mountingPadLength = median(
        mountingPads.map(({ acrossSize }) => acrossSize),
      )
      const mountingRowCenter = median(mountingPads.map(({ across }) => across))
      if (
        Math.abs(mountingPads[0].across - mountingPads[1].across) >
        Math.max(0.06, mountingPadLength * 0.1)
      ) {
        continue
      }

      const contactCenter = (contacts[0].along + contacts.at(-1)!.along) / 2
      const mountingCenter = (mountingPads[0].along + mountingPads[1].along) / 2
      if (
        Math.abs(contactCenter - mountingCenter) >
        Math.max(0.08, padPitch * 0.25)
      ) {
        continue
      }

      const mountingPadRowDistance = Math.abs(
        mountingRowCenter - contactRowCenter,
      )
      if (
        mountingPadRowDistance <=
        Math.max(0.05, Math.min(contactAcrossSize, mountingPadLength) * 0.1)
      ) {
        continue
      }

      const contactPinNumbers = contacts
        .map(pinNumber)
        .filter((value): value is number => value !== undefined)
        .toSorted((left, right) => left - right)
      const signalsNumberedFirst =
        contactPinNumbers.length === contacts.length &&
        contactPinNumbers.every((value, index) => value === index + 1)
      const fitScore =
        (signalsNumberedFirst ? 0 : 10) +
        contactAlongSpread +
        contactAcrossSpread +
        mountingAlongSpread +
        mountingAcrossSpread +
        Math.abs(contactCenter - mountingCenter) / Math.max(padPitch, 0.0001)

      if (best && best.fitScore <= fitScore) continue
      best = {
        fitScore,
        mountingPadLength,
        mountingPadPitch: mountingPads[1].along - mountingPads[0].along,
        mountingPadRowDistance,
        mountingPadWidth,
        mountingPadsOnTop: mountingRowCenter > contactRowCenter,
        padLength: contactAcrossSize,
        padPitch,
        padWidth: median(contacts.map(({ alongSize }) => alongSize)),
        pinCount: contacts.length,
      }
    }
  }

  return best
}

const analyzeJstSmd = (target: Footprint) => {
  const analyses = [
    analyzeJstSmdAxis(target, "x"),
    analyzeJstSmdAxis(target, "y"),
  ].filter((analysis): analysis is JstSmdAnalysis => analysis !== undefined)
  return analyses.toSorted((left, right) => left.fitScore - right.fitScore)[0]
}

const analyzeJstThroughHole = (
  target: Footprint,
): JstThroughHoleAnalysis | undefined => {
  const pads = getPadGeometries(target)
  if (
    pads.length < 2 ||
    pads.length > 16 ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_plated_hole" ||
        !drill ||
        (copper.shape !== "rect" && copper.shape !== "pill"),
    ) ||
    pads.filter(({ copper }) => copper.shape === "rect").length !== 1 ||
    pads.filter(({ copper }) => copper.shape === "pill").length !==
      pads.length - 1
  ) {
    return undefined
  }

  const xSpread =
    Math.max(...pads.map(({ copper }) => copper.x)) -
    Math.min(...pads.map(({ copper }) => copper.x))
  const ySpread =
    Math.max(...pads.map(({ copper }) => copper.y)) -
    Math.min(...pads.map(({ copper }) => copper.y))
  const alongAxis = xSpread >= ySpread ? "x" : "y"
  const acrossAxis = alongAxis === "x" ? "y" : "x"
  const entries = pads
    .map((pad) => ({
      across: pad.copper[acrossAxis],
      along: pad.copper[alongAxis],
      bounds: getPadBounds(pad.copper),
      pad,
    }))
    .toSorted((left, right) => left.along - right.along)
  const padWidth = median(
    entries.map(({ bounds }) =>
      alongAxis === "x" ? bounds.width : bounds.height,
    ),
  )
  const padLength = median(
    entries.map(({ bounds }) =>
      alongAxis === "x" ? bounds.height : bounds.width,
    ),
  )
  const tolerance = Math.max(0.03, Math.min(padWidth, padLength) * 0.08)
  const rowCenter = median(entries.map(({ across }) => across))
  if (
    entries.some(
      ({ across, bounds }) =>
        Math.abs(across - rowCenter) > tolerance ||
        Math.abs(
          (alongAxis === "x" ? bounds.width : bounds.height) - padWidth,
        ) > tolerance ||
        Math.abs(
          (alongAxis === "x" ? bounds.height : bounds.width) - padLength,
        ) > tolerance,
    )
  ) {
    return undefined
  }

  const differences = entries
    .slice(1)
    .map((entry, index) => entry.along - entries[index]!.along)
  const padPitch = median(differences)
  if (
    padPitch <= tolerance ||
    differences.some(
      (difference) => Math.abs(difference - padPitch) > tolerance,
    )
  ) {
    return undefined
  }

  return {
    id: median(
      entries.map(({ pad }) => Math.min(pad.drill!.width, pad.drill!.height)),
    ),
    padLength,
    padPitch,
    padWidth,
    pinCount: pads.length,
  }
}

const analyzeTwoPadSmd = (target: Footprint): TwoPadSmdAnalysis | undefined => {
  const pads = getPadGeometries(target)
  if (
    pads.length !== 2 ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_smtpad" || drill || copper.shape !== "rect",
    )
  ) {
    return undefined
  }

  const getPin = (pinNumber: number) =>
    pads.find(({ element }) =>
      element.port_hints?.some((hint) => {
        const normalizedHint = hint.trim().toLowerCase()
        return (
          normalizedHint === String(pinNumber) ||
          normalizedHint === `pin${pinNumber}`
        )
      }),
    )
  const pin1 = getPin(1)
  const pin2 = getPin(2)
  if (!pin1 || !pin2) return undefined

  const horizontal =
    Math.abs(pin2.copper.x - pin1.copper.x) >=
    Math.abs(pin2.copper.y - pin1.copper.y)
  const pin1Bounds = getPadBounds(pin1.copper)
  const pin2Bounds = getPadBounds(pin2.copper)
  const center = horizontal
    ? (Math.min(pin1Bounds.minX, pin2Bounds.minX) +
        Math.max(pin1Bounds.maxX, pin2Bounds.maxX)) /
      2
    : (Math.min(pin1Bounds.minY, pin2Bounds.minY) +
        Math.max(pin1Bounds.maxY, pin2Bounds.maxY)) /
      2
  const pin1Height = horizontal ? pin1Bounds.height : pin1Bounds.width
  const pin2Height = horizontal ? pin2Bounds.height : pin2Bounds.width
  if (Math.abs(pin1Height - pin2Height) > Math.max(0.03, pin1Height * 0.05)) {
    return undefined
  }

  return {
    padHeight: median([pin1Height, pin2Height]),
    pin1Offset: pin1.copper[horizontal ? "x" : "y"] - center,
    pin1Width: horizontal ? pin1Bounds.width : pin1Bounds.height,
    pin2Offset: pin2.copper[horizontal ? "x" : "y"] - center,
    pin2Width: horizontal ? pin2Bounds.width : pin2Bounds.height,
  }
}

const analyzePotentiometer = (
  target: Footprint,
): PotentiometerAnalysis | undefined => {
  const description = `${target.title} ${target.subtitle} ${
    target.sourceHints?.join(" ") ?? ""
  }`.toLowerCase()
  if (!/(?:potentiometer|trimmer|\b3362)/.test(description)) return undefined

  const pads = getPadGeometries(target)
  if (
    pads.length !== 3 ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_plated_hole" ||
        copper.shape !== "circle" ||
        drill?.shape !== "circle",
    )
  ) {
    return undefined
  }

  const pairs = [
    [0, 1],
    [0, 2],
    [1, 2],
  ] as const
  const [firstIndex, secondIndex] = pairs.toSorted(([a1, a2], [b1, b2]) => {
    const a = pads[a1]!.copper
    const b = pads[a2]!.copper
    const c = pads[b1]!.copper
    const d = pads[b2]!.copper
    return Math.hypot(d.x - c.x, d.y - c.y) - Math.hypot(b.x - a.x, b.y - a.y)
  })[0]!
  const thirdIndex = [0, 1, 2].find(
    (index) => index !== firstIndex && index !== secondIndex,
  )!
  const first = pads[firstIndex]!.copper
  const second = pads[secondIndex]!.copper
  const third = pads[thirdIndex]!.copper
  const baseDx = second.x - first.x
  const baseDy = second.y - first.y
  const baseLength = Math.hypot(baseDx, baseDy)
  if (baseLength <= 0.1) return undefined
  const midpoint = {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  }
  const alongOffset =
    ((third.x - midpoint.x) * baseDx + (third.y - midpoint.y) * baseDy) /
    baseLength
  const height =
    Math.abs(baseDx * (third.y - first.y) - baseDy * (third.x - first.x)) /
    baseLength
  if (
    height <= 0.1 ||
    Math.abs(alongOffset) > Math.max(0.05, baseLength * 0.05)
  ) {
    return undefined
  }

  return {
    h: height,
    id: median(pads.map(({ drill }) => drill!.width)),
    od: median(pads.map(({ copper }) => copper.width)),
    p: baseLength / 2,
  }
}

interface LatticeAxisFit {
  coordinates: number[]
  count: number
  indices: number[]
  pitch: number
}

const fitLatticeAxis = (
  values: number[],
  clusterTolerance: number,
  fitTolerance: number,
): LatticeAxisFit | undefined => {
  const coordinates = clusterCoordinates(values, clusterTolerance)
  if (coordinates.length < 2) return undefined

  const minimum = coordinates[0]
  const maximum = coordinates.at(-1)!
  const span = maximum - minimum
  let best:
    | (LatticeAxisFit & {
        score: number
      })
    | undefined

  for (
    let count = coordinates.length;
    count <= Math.min(coordinates.length + 10, 16);
    count += 1
  ) {
    const pitch = span / (count - 1)
    if (pitch <= fitTolerance) continue
    const indices = coordinates.map((coordinate) =>
      Math.round((coordinate - minimum) / pitch),
    )
    if (new Set(indices).size !== indices.length) continue
    const maximumError = Math.max(
      ...coordinates.map((coordinate, index) =>
        Math.abs(coordinate - (minimum + indices[index] * pitch)),
      ),
    )
    if (maximumError > fitTolerance) continue

    // Prefer the smallest low-error lattice so arbitrary coordinates do not
    // get explained by an unnecessarily dense grid.
    const score =
      maximumError + (count - coordinates.length) * fitTolerance * 0.02
    if (!best || score < best.score) {
      best = { coordinates, count, indices, pitch, score }
    }
  }

  if (!best) return undefined
  const { score: _score, ...fit } = best
  return fit
}

const analyzeSmdSlideSwitchAxis = (
  target: Footprint,
  alongAxis: "x" | "y",
): SmdSlideSwitchAnalysis | undefined => {
  const description = `${target.title} ${target.subtitle} ${
    target.sourceHints?.join(" ") ?? ""
  }`.toLowerCase()
  if (
    !/slide[- ]?switch/.test(description) &&
    !/\bmsk[-_ ]?\d/.test(description)
  ) {
    return undefined
  }

  const pads = getPadGeometries(target)
  const holes = getHoleGeometries(target)
  if (
    pads.length !== 7 ||
    (holes.length !== 0 && holes.length !== 2) ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_smtpad" ||
        drill ||
        (copper.shape !== "rect" && copper.shape !== "pill"),
    ) ||
    holes.some((hole) => hole.shape !== "circle")
  ) {
    return undefined
  }

  const acrossAxis = alongAxis === "x" ? "y" : "x"
  const entries = pads.map((pad, index) => {
    const bounds = getPadBounds(pad.copper)
    return {
      across: pad.copper[acrossAxis],
      acrossSize: alongAxis === "x" ? bounds.height : bounds.width,
      along: pad.copper[alongAxis],
      alongSize: alongAxis === "x" ? bounds.width : bounds.height,
      index,
      pad,
    }
  })
  const relativeSpread = (values: number[]) => {
    const middle = Math.max(median(values), 0.0001)
    return (Math.max(...values) - Math.min(...values)) / middle
  }
  const pinNumber = ({ pad }: (typeof entries)[number]) => {
    for (const hint of pad.element.port_hints ?? []) {
      const match = hint.trim().match(/^(?:pin)?(\d+)$/i)
      if (match?.[1]) return Number.parseInt(match[1], 10)
    }
    return undefined
  }

  const signalIndexSets: number[][] = []
  for (let first = 0; first < entries.length - 2; first += 1) {
    for (let second = first + 1; second < entries.length - 1; second += 1) {
      for (let third = second + 1; third < entries.length; third += 1) {
        signalIndexSets.push([first, second, third])
      }
    }
  }

  let best: SmdSlideSwitchAnalysis | undefined
  for (const signalIndices of signalIndexSets) {
    const signalIndexSet = new Set(signalIndices)
    const signals = entries
      .filter(({ index }) => signalIndexSet.has(index))
      .toSorted((left, right) => left.along - right.along)
    const mounts = entries.filter(({ index }) => !signalIndexSet.has(index))
    const signalAlongSpread = relativeSpread(
      signals.map(({ alongSize }) => alongSize),
    )
    const signalAcrossSpread = relativeSpread(
      signals.map(({ acrossSize }) => acrossSize),
    )
    if (signalAlongSpread > 0.12 || signalAcrossSpread > 0.12) continue

    const signalRowCenter = median(signals.map(({ across }) => across))
    const signalAcrossSize = median(signals.map(({ acrossSize }) => acrossSize))
    const rowTolerance = Math.max(0.04, signalAcrossSize * 0.08)
    if (
      signals.some(
        ({ across }) => Math.abs(across - signalRowCenter) > rowTolerance,
      )
    ) {
      continue
    }

    const signalAlongSize = median(signals.map(({ alongSize }) => alongSize))
    const lattice = fitLatticeAxis(
      signals.map(({ along }) => along),
      Math.max(0.015, signalAlongSize * 0.04),
      Math.max(0.025, signalAlongSize * 0.08),
    )
    if (!lattice || lattice.count > 6) continue
    const missingColumns = Array.from(
      { length: lattice.count },
      (_, index) => index + 1,
    ).filter((column) => !lattice.indices.includes(column - 1))
    if (missingColumns.length > 3) continue

    const mountAlongSpread = relativeSpread(
      mounts.map(({ alongSize }) => alongSize),
    )
    const mountAcrossSpread = relativeSpread(
      mounts.map(({ acrossSize }) => acrossSize),
    )
    if (mountAlongSpread > 0.15 || mountAcrossSpread > 0.15) continue

    const mountAlongSize = median(mounts.map(({ alongSize }) => alongSize))
    const mountAcrossSize = median(mounts.map(({ acrossSize }) => acrossSize))
    const mountAlongTolerance = Math.max(0.04, mountAlongSize * 0.1)
    const mountAcrossTolerance = Math.max(0.04, mountAcrossSize * 0.1)
    const mountColumns = clusterCoordinates(
      mounts.map(({ along }) => along),
      mountAlongTolerance,
    )
    const mountRows = clusterCoordinates(
      mounts.map(({ across }) => across),
      mountAcrossTolerance,
    )
    if (mountColumns.length !== 2 || mountRows.length !== 2) continue
    if (
      mountColumns.some(
        (column) =>
          mounts.filter(
            ({ along }) => Math.abs(along - column) <= mountAlongTolerance,
          ).length !== 2,
      ) ||
      mountRows.some(
        (row) =>
          mounts.filter(
            ({ across }) => Math.abs(across - row) <= mountAcrossTolerance,
          ).length !== 2,
      )
    ) {
      continue
    }

    const signalLatticeCenter =
      lattice.coordinates[0] + ((lattice.count - 1) * lattice.pitch) / 2
    const mountColumnCenter = (mountColumns[0] + mountColumns[1]) / 2
    const centerError = Math.abs(signalLatticeCenter - mountColumnCenter)
    if (centerError > Math.max(0.06, lattice.pitch * 0.12)) continue

    const mountCenter = (mountRows[0] + mountRows[1]) / 2
    const mountingPadPitchX = mountColumns[1] - mountColumns[0]
    const mountingPadPitchY = mountRows[1] - mountRows[0]
    if (
      mountingPadPitchX <= mountAlongSize ||
      mountingPadPitchY <= mountAcrossSize
    ) {
      continue
    }

    let holeDiameter: number | undefined
    let holeX: number | undefined
    let holeY: number | undefined
    let holeFitError = 0
    if (holes.length === 2) {
      const holeEntries = holes
        .map((hole) => ({
          across: hole[acrossAxis],
          along: hole[alongAxis],
          diameter: (hole.width + hole.height) / 2,
        }))
        .toSorted((left, right) => left.along - right.along)
      holeDiameter = median(holeEntries.map(({ diameter }) => diameter))
      const holeAcrossDifference = Math.abs(
        holeEntries[1].across - holeEntries[0].across,
      )
      if (holeAcrossDifference > Math.max(0.04, holeDiameter * 0.08)) continue
      const holeCenter = (holeEntries[0].along + holeEntries[1].along) / 2
      holeFitError = Math.abs(holeCenter - signalLatticeCenter)
      if (holeFitError > Math.max(0.05, holeDiameter * 0.1)) continue
      holeX = (holeEntries[1].along - holeEntries[0].along) / 2
      holeY =
        (holeEntries[0].across + holeEntries[1].across) / 2 - signalRowCenter
    }

    const signalPinNumbers = signals
      .map(pinNumber)
      .filter((value): value is number => value !== undefined)
      .toSorted((left, right) => left - right)
    const signalsNumberedFirst =
      signalPinNumbers.length === signals.length &&
      signalPinNumbers.every((value, index) => value === index + 1)
    const fitScore =
      (signalsNumberedFirst ? 0 : 5) +
      signalAlongSpread +
      signalAcrossSpread +
      mountAlongSpread +
      mountAcrossSpread +
      centerError / Math.max(lattice.pitch, 0.0001) +
      holeFitError / Math.max(holeDiameter ?? 1, 0.0001)
    if (best && best.fitScore <= fitScore) continue

    best = {
      fitScore,
      holeDiameter,
      holeX,
      holeY,
      missingColumns,
      mountY: mountCenter - signalRowCenter,
      mountingPadLength: mountAcrossSize,
      mountingPadPitchX,
      mountingPadPitchY,
      mountingPadWidth: mountAlongSize,
      noHoles: holes.length === 0,
      padLength: signalAcrossSize,
      padPitch: lattice.pitch,
      padWidth: signalAlongSize,
      signalColumnCount: lattice.count,
    }
  }

  return best
}

const analyzeSmdSlideSwitch = (target: Footprint) => {
  const analyses = [
    analyzeSmdSlideSwitchAxis(target, "x"),
    analyzeSmdSlideSwitchAxis(target, "y"),
  ].filter(
    (analysis): analysis is SmdSlideSwitchAnalysis => analysis !== undefined,
  )
  return analyses.toSorted((left, right) => left.fitScore - right.fitScore)[0]
}

const analyzeSmdPushButton = (
  target: Footprint,
): SmdPushButtonAnalysis | undefined => {
  const description = `${target.title} ${target.subtitle} ${
    target.sourceHints?.join(" ") ?? ""
  }`.toLowerCase()
  const pads = getPadGeometries(target)
  if (
    pads.length !== 4 ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_smtpad" || drill || copper.shape !== "rect",
    )
  ) {
    return undefined
  }

  const padBounds = pads.map(({ copper }) => getPadBounds(copper))
  const padWidths = padBounds.map(({ width }) => width)
  const padHeights = padBounds.map(({ height }) => height)
  const padWidth = median(padWidths)
  const padHeight = median(padHeights)
  if (
    (Math.max(...padWidths) - Math.min(...padWidths)) /
      Math.max(padWidth, 0.0001) >
      0.12 ||
    (Math.max(...padHeights) - Math.min(...padHeights)) /
      Math.max(padHeight, 0.0001) >
      0.12
  ) {
    return undefined
  }

  const xTolerance = Math.max(0.04, padWidth * 0.1)
  const yTolerance = Math.max(0.04, padHeight * 0.1)
  const columns = clusterCoordinates(
    pads.map(({ copper }) => copper.x),
    xTolerance,
  )
  const rows = clusterCoordinates(
    pads.map(({ copper }) => copper.y),
    yTolerance,
  )
  if (columns.length !== 2 || rows.length !== 2) return undefined

  for (const column of columns) {
    for (const row of rows) {
      const matchingPads = pads.filter(
        ({ copper }) =>
          Math.abs(copper.x - column) <= xTolerance &&
          Math.abs(copper.y - row) <= yTolerance,
      )
      if (matchingPads.length !== 1) return undefined
    }
  }

  const pitchX = columns[1] - columns[0]
  const pitchY = rows[1] - rows[0]
  if (pitchX <= padWidth || pitchY <= padHeight) return undefined

  const hasSwitchHint =
    /(?:push\s*button|tactile\s*switch)/.test(description) ||
    /\b(?:ts[-_ ]?\d{4}[a-z]?|skrp[a-z0-9]*)\b/.test(description)
  const hasLargeSwitchGeometry =
    pitchX >= 10 && pitchY >= 4 && padWidth >= 2 && padHeight >= 1
  if (!hasSwitchHint && !hasLargeSwitchGeometry) return undefined

  return { padHeight, padWidth, pitchX, pitchY }
}

const analyzeSparsePinGrid = (
  target: Footprint,
  clusterTolerance: number,
  medianPadShortSide: number,
): SparsePinGridAnalysis | undefined => {
  const pads = getPadGeometries(target)
  if (
    pads.length < 4 ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_plated_hole" ||
        copper.shape !== "circle" ||
        drill?.shape !== "circle",
    )
  ) {
    return undefined
  }

  const fitTolerance = Math.max(0.025, medianPadShortSide * 0.07)
  const xFit = fitLatticeAxis(
    pads.map(({ copper }) => copper.x),
    clusterTolerance,
    fitTolerance,
  )
  const yFit = fitLatticeAxis(
    pads.map(({ copper }) => copper.y),
    clusterTolerance,
    fitTolerance,
  )
  if (!xFit || !yFit) return undefined

  const gridPositionCount = xFit.count * yFit.count
  if (
    gridPositionCount <= pads.length ||
    gridPositionCount > 32 ||
    xFit.count < 2 ||
    yFit.count < 2
  ) {
    return undefined
  }

  const findClusterIndex = (coordinate: number, clusters: number[]) => {
    let bestIndex = 0
    let bestDistance = Number.POSITIVE_INFINITY
    for (const [index, cluster] of clusters.entries()) {
      const distance = Math.abs(coordinate - cluster)
      if (distance < bestDistance) {
        bestIndex = index
        bestDistance = distance
      }
    }
    return bestIndex
  }

  const occupiedPositions = new Set<number>()
  for (const { copper } of pads) {
    const xClusterIndex = findClusterIndex(copper.x, xFit.coordinates)
    const yClusterIndex = findClusterIndex(copper.y, yFit.coordinates)
    const column = xFit.indices[xClusterIndex]
    // Footprinter grids enumerate rows from top to bottom.
    const row = yFit.count - 1 - yFit.indices[yClusterIndex]
    const position = row * xFit.count + column + 1
    if (occupiedPositions.has(position)) return undefined
    occupiedPositions.add(position)
  }

  const missingPositions = Array.from(
    { length: gridPositionCount },
    (_, index) => index + 1,
  ).filter((position) => !occupiedPositions.has(position))

  return {
    columns: xFit.count,
    missingPositions,
    pitchX: xFit.pitch,
    pitchY: yFit.pitch,
    rows: yFit.count,
  }
}

const getUsbCMidMountGeometry = (
  target: Footprint,
): UsbCMidMountAnalysis | undefined => {
  const pads = getPadGeometries(target)
  const shellTabs = pads.filter(
    ({ copper, drill, element }) =>
      element.type === "pcb_plated_hole" &&
      copper.shape === "pill" &&
      drill?.shape === "pill",
  )
  const contacts = pads.filter(({ element }) => element.type === "pcb_smtpad")

  // The existing usbcmidmount16 footprint has four plated shell slots and
  // twelve SMT contacts. Require that complete topology before extracting its
  // parameters so unrelated connectors continue through generic discovery.
  if (
    target.pads.length !== 16 ||
    shellTabs.length !== 4 ||
    contacts.length !== 12
  ) {
    return undefined
  }

  const topTabs = shellTabs.filter(({ copper }) => copper.y > 0)
  const bottomTabs = shellTabs.filter(({ copper }) => copper.y < 0)
  if (topTabs.length !== 2 || bottomTabs.length !== 2) return undefined

  const shellX = median(shellTabs.map(({ copper }) => Math.abs(copper.x)))
  const shellTolerance = Math.max(0.04, shellX * 0.015)
  const hasMirroredShellPair = (tabs: PcbPadGeometry[]) => {
    const xs = tabs.map(({ copper }) => copper.x)
    return (
      xs.some((x) => x > 0) &&
      xs.some((x) => x < 0) &&
      tabs.every(
        ({ copper }) => Math.abs(Math.abs(copper.x) - shellX) <= shellTolerance,
      )
    )
  }
  if (!hasMirroredShellPair(topTabs) || !hasMirroredShellPair(bottomTabs)) {
    return undefined
  }

  const contactEntries = contacts.map((pad) => ({
    bounds: getPadBounds(pad.copper),
    pad,
  }))
  const rowY = median(contactEntries.map(({ pad }) => pad.copper.y))
  if (
    Math.abs(rowY) < 0.05 ||
    contactEntries.some(({ pad }) => Math.abs(pad.copper.y - rowY) > 0.04)
  ) {
    return undefined
  }

  const contactsByWidth = [...contactEntries].sort(
    (left, right) => right.bounds.width - left.bounds.width,
  )
  const powerContacts = contactsByWidth.slice(0, 4)
  const signalContacts = contactsByWidth.slice(4)
  const powerPadWidth = median(powerContacts.map(({ bounds }) => bounds.width))
  const signalPadWidth = median(
    signalContacts.map(({ bounds }) => bounds.width),
  )
  const signalPadHeight = median(
    signalContacts.map(({ bounds }) => bounds.height),
  )
  if (powerPadWidth <= signalPadWidth * 1.5) return undefined

  const powerX = Math.max(
    ...powerContacts.map(({ pad }) => Math.abs(pad.copper.x)),
  )
  const expectedInnerPowerX = powerX - 0.8
  if (
    !powerContacts.some(
      ({ pad }) =>
        Math.abs(Math.abs(pad.copper.x) - expectedInnerPowerX) <= 0.06,
    ) ||
    signalContacts.some(
      ({ pad }) => Math.abs(pad.copper.x) >= expectedInnerPowerX - 0.06,
    )
  ) {
    return undefined
  }

  const getTabDimensions = (tabs: PcbPadGeometry[]) => ({
    height: median(tabs.map(({ drill }) => drill?.height ?? 0)),
    ring: median(
      tabs.map(({ copper, drill }) =>
        drill ? (copper.width - drill.width) / 2 : 0,
      ),
    ),
    width: median(tabs.map(({ drill }) => drill?.width ?? 0)),
    y: median(tabs.map(({ copper }) => Math.abs(copper.y))),
  })
  const top = getTabDimensions(topTabs)
  const bottom = getTabDimensions(bottomTabs)

  const locatorHoles = getHoleGeometries(target)
  if (locatorHoles.length !== 0 && locatorHoles.length !== 2) return undefined
  if (
    locatorHoles.length === 2 &&
    (locatorHoles.some((hole) => hole.shape !== "circle") ||
      Math.abs(locatorHoles[0].y - locatorHoles[1].y) > 0.04 ||
      Math.abs(Math.abs(locatorHoles[0].x) - Math.abs(locatorHoles[1].x)) >
        0.04 ||
      !locatorHoles.some((hole) => hole.x > 0) ||
      !locatorHoles.some((hole) => hole.x < 0))
  ) {
    return undefined
  }

  return {
    bottomHoleHeight: bottom.height,
    bottomHoleWidth: bottom.width,
    bottomRing: bottom.ring,
    bottomY: bottom.y,
    holeDiameter:
      locatorHoles.length === 2
        ? median(locatorHoles.map((hole) => hole.width))
        : undefined,
    holeX:
      locatorHoles.length === 2
        ? median(locatorHoles.map((hole) => Math.abs(hole.x)))
        : undefined,
    holeY:
      locatorHoles.length === 2
        ? median(locatorHoles.map((hole) => hole.y))
        : undefined,
    noHoles: locatorHoles.length === 0,
    powerPadWidth,
    powerX,
    rowY,
    shellX,
    signalPadHeight,
    signalPadWidth,
    topHoleHeight: top.height,
    topHoleWidth: top.width,
    topRing: top.ring,
    topY: top.y,
  }
}

const analyzeRj45 = (target: Footprint): Rj45Analysis | undefined => {
  const pads = getPadGeometries(target)
  if (
    (pads.length !== 10 && pads.length !== 14) ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_plated_hole" ||
        copper.shape !== "circle" ||
        drill?.shape !== "circle",
    )
  ) {
    return undefined
  }

  const locatorHoles = getHoleGeometries(target)
  if (
    locatorHoles.length !== 2 ||
    locatorHoles.some((hole) => hole.shape !== "circle")
  ) {
    return undefined
  }

  const entries = pads
    .map((pad) => ({
      id: pad.drill?.width ?? 0,
      od: pad.copper.width,
      pad,
    }))
    .toSorted((left, right) => right.od - left.od)
  const shieldPins = entries.slice(0, 2)
  const contactPins = entries.slice(2)
  const contactOd = median(contactPins.map(({ od }) => od))
  if (
    contactPins.length !== (pads.length === 14 ? 12 : 8) ||
    shieldPins.some(({ od }) => od < contactOd * 1.25) ||
    contactPins.some(
      ({ od }) => Math.abs(od - contactOd) > Math.max(0.04, contactOd * 0.08),
    )
  ) {
    return undefined
  }

  const rowTolerance = Math.max(0.04, contactOd * 0.06)
  const rowYs = clusterCoordinates(
    contactPins.map(({ pad }) => pad.copper.y),
    rowTolerance,
  )
  const rows = rowYs
    .map((y) => ({
      pins: contactPins.filter(
        ({ pad }) => Math.abs(pad.copper.y - y) <= rowTolerance,
      ),
      y,
    }))
    .filter(({ pins }) => pins.length === 4)
  if (rows.length < 2) return undefined

  let signalRows:
    | {
        p: number
        rows: [(typeof rows)[number], (typeof rows)[number]]
        score: number
      }
    | undefined
  for (let leftIndex = 0; leftIndex < rows.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < rows.length;
      rightIndex += 1
    ) {
      const pair = [rows[leftIndex], rows[rightIndex]] as [
        (typeof rows)[number],
        (typeof rows)[number],
      ]
      const xs = pair
        .flatMap(({ pins }) => pins.map(({ pad }) => pad.copper.x))
        .toSorted((left, right) => left - right)
      const differences = xs.slice(1).map((x, index) => x - xs[index])
      const p = median(differences)
      if (p <= 0.2) continue
      const score = Math.max(
        ...differences.map((difference) => Math.abs(difference - p)),
      )
      if (score > Math.max(0.06, p * 0.08)) continue
      if (!signalRows || score < signalRows.score) {
        signalRows = { p, rows: pair, score }
      }
    }
  }
  if (!signalRows) return undefined

  const signalPins = signalRows.rows.flatMap(({ pins }) => pins)
  const signalPinSet = new Set(signalPins.map(({ pad }) => pad))
  const ledPins = contactPins.filter(({ pad }) => !signalPinSet.has(pad))
  if (ledPins.length !== (pads.length === 14 ? 4 : 0)) return undefined

  const signalXs = signalPins.map(({ pad }) => pad.copper.x)
  const signalCenterX = (Math.min(...signalXs) + Math.max(...signalXs)) / 2
  const signalCenterY = (signalRows.rows[0].y + signalRows.rows[1].y) / 2
  const py = Math.abs(signalRows.rows[1].y - signalRows.rows[0].y)
  if (py <= signalRows.p * 0.6) return undefined

  const shieldCenterY = median(shieldPins.map(({ pad }) => pad.copper.y))
  const shieldXs = shieldPins.map(({ pad }) => pad.copper.x - signalCenterX)
  const shieldTolerance = Math.max(0.06, contactOd * 0.08)
  if (
    Math.abs(shieldPins[0].pad.copper.y - shieldPins[1].pad.copper.y) >
      shieldTolerance ||
    !shieldXs.some((x) => x < 0) ||
    !shieldXs.some((x) => x > 0) ||
    Math.abs(Math.abs(shieldXs[0]) - Math.abs(shieldXs[1])) > shieldTolerance
  ) {
    return undefined
  }

  const holeCenterY = median(locatorHoles.map((hole) => hole.y))
  const holeXs = locatorHoles.map((hole) => hole.x - signalCenterX)
  if (
    Math.abs(locatorHoles[0].y - locatorHoles[1].y) > shieldTolerance ||
    !holeXs.some((x) => x < 0) ||
    !holeXs.some((x) => x > 0) ||
    Math.abs(Math.abs(holeXs[0]) - Math.abs(holeXs[1])) > shieldTolerance
  ) {
    return undefined
  }

  let ledX: number | undefined
  let ledPitch: number | undefined
  let ledY: number | undefined
  if (ledPins.length === 4) {
    const sortedLedXs = ledPins
      .map(({ pad }) => pad.copper.x - signalCenterX)
      .toSorted((left, right) => left - right)
    const ledRowY = median(ledPins.map(({ pad }) => pad.copper.y))
    if (
      ledPins.some(
        ({ pad }) => Math.abs(pad.copper.y - ledRowY) > rowTolerance,
      ) ||
      Math.abs(sortedLedXs[0] + sortedLedXs[3]) > shieldTolerance ||
      Math.abs(sortedLedXs[1] + sortedLedXs[2]) > shieldTolerance
    ) {
      return undefined
    }
    ledX = Math.abs(sortedLedXs[1])
    ledPitch = Math.abs(sortedLedXs[0]) - ledX
    ledY = ledRowY - signalCenterY
    if (ledPitch <= 0.2) return undefined
  }

  const pin1 = signalPins.find(({ pad }) =>
    (pad.element.port_hints ?? []).some((hint) =>
      /^(?:pin)?1$/i.test(hint.trim()),
    ),
  )?.pad.copper
  const lowerRow = signalRows.rows.toSorted(
    (left, right) => left.y - right.y,
  )[0]
  const lowerRowXs = lowerRow.pins.map(
    ({ pad }) => pad.copper.x - signalCenterX,
  )
  const lowerRowExtendsRight =
    Math.max(...lowerRowXs) > Math.abs(Math.min(...lowerRowXs))

  return {
    firstPinLeft: pin1 ? pin1.x < signalCenterX : false,
    firstPinTop: pin1 ? pin1.y > signalCenterY : !lowerRowExtendsRight,
    holeDiameter: median(locatorHoles.map((hole) => hole.width)),
    holeX: median(holeXs.map(Math.abs)),
    holeY: holeCenterY - signalCenterY,
    id: median(contactPins.map(({ id }) => id)),
    ledPins: ledPins.length === 4,
    ledPitch,
    ledX,
    ledY,
    od: contactOd,
    p: signalRows.p,
    py,
    shieldId: median(shieldPins.map(({ id }) => id)),
    shieldOd: median(shieldPins.map(({ od }) => od)),
    shieldX: median(shieldXs.map(Math.abs)),
    shieldY: shieldCenterY - signalCenterY,
  }
}

const analyzeDpak = (target: Footprint): DpakAnalysis | undefined => {
  const pads = getPadGeometries(target)
  if (
    (pads.length !== 3 && pads.length !== 6) ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_smtpad" || drill || copper.shape !== "rect",
    )
  ) {
    return undefined
  }

  const entries = pads
    .map((pad) => {
      const bounds = getPadBounds(pad.copper)
      return {
        area: bounds.width * bounds.height,
        bounds,
        pad,
      }
    })
    .toSorted((left, right) => right.area - left.area)
  const tab = entries[0]
  const leads = entries.slice(1)
  const medianLeadArea = median(leads.map(({ area }) => area))
  if (tab.area < medianLeadArea * 3.5) return undefined

  const medianLeadWidth = median(leads.map(({ bounds }) => bounds.width))
  const medianLeadHeight = median(leads.map(({ bounds }) => bounds.height))
  const dimensionTolerance = 0.08
  if (
    leads.some(
      ({ bounds }) =>
        Math.abs(bounds.width - medianLeadWidth) >
          Math.max(0.03, medianLeadWidth * dimensionTolerance) ||
        Math.abs(bounds.height - medianLeadHeight) >
          Math.max(0.03, medianLeadHeight * dimensionTolerance),
    )
  ) {
    return undefined
  }

  const leadXs = leads.map(({ pad }) => pad.copper.x)
  const leadYs = leads.map(({ pad }) => pad.copper.y)
  const xSpread = Math.max(...leadXs) - Math.min(...leadXs)
  const ySpread = Math.max(...leadYs) - Math.min(...leadYs)
  const leadsAreVertical = xSpread <= ySpread
  const alongCoordinates = leadsAreVertical ? leadYs : leadXs
  const acrossCoordinates = leadsAreVertical ? leadXs : leadYs
  const alongSize = leadsAreVertical ? medianLeadHeight : medianLeadWidth
  const acrossSize = leadsAreVertical ? medianLeadWidth : medianLeadHeight
  const collinearityTolerance = Math.max(0.04, alongSize * 0.12)
  if (
    Math.max(...acrossCoordinates) - Math.min(...acrossCoordinates) >
    collinearityTolerance
  ) {
    return undefined
  }

  const sortedAlongCoordinates = alongCoordinates.toSorted(
    (left, right) => left - right,
  )
  const differences = sortedAlongCoordinates
    .slice(1)
    .map((coordinate, index) => coordinate - sortedAlongCoordinates[index])
  const repeatedPitch = median(differences)
  if (
    repeatedPitch <= 0.05 ||
    (pads.length === 6 &&
      differences.some(
        (difference) =>
          Math.abs(difference - repeatedPitch) >
          Math.max(0.04, repeatedPitch * 0.08),
      ))
  ) {
    return undefined
  }

  const leadAlongCenter = median(alongCoordinates)
  const leadAcrossCenter = median(acrossCoordinates)
  const tabAlongCenter = leadsAreVertical ? tab.pad.copper.y : tab.pad.copper.x
  const tabAcrossCenter = leadsAreVertical ? tab.pad.copper.x : tab.pad.copper.y
  if (
    Math.abs(tabAlongCenter - leadAlongCenter) >
    Math.max(0.06, repeatedPitch * 0.15)
  ) {
    return undefined
  }
  const span = Math.abs(tabAcrossCenter - leadAcrossCenter)
  if (span <= acrossSize) return undefined

  const tabw = leadsAreVertical ? tab.bounds.width : tab.bounds.height
  const tabh = leadsAreVertical ? tab.bounds.height : tab.bounds.width
  return {
    family: Math.max(tabw, tabh) >= 7.5 ? "d2pak" : "dpak",
    numberOfPads: pads.length,
    // Three-pad DPAKs omit the center lead, so pins 1 and 3 are two pitch
    // intervals apart. Five-lead variants use every adjacent position.
    p: pads.length === 3 ? repeatedPitch / 2 : repeatedPitch,
    pl: acrossSize,
    pw: alongSize,
    span,
    tabh,
    tabw,
  }
}

const analyzeTarget = (target: Footprint): TargetAnalysis => {
  const pads = getCopperShapes(target)
  const bounds = getBounds(pads)
  const padBounds = pads.map(getPadBounds)
  const medianPadWidth = median(padBounds.map((bound) => bound.width))
  const medianPadHeight = median(padBounds.map((bound) => bound.height))
  const tolerance = Math.max(
    Math.min(medianPadWidth, medianPadHeight) * 0.22,
    0.015,
  )
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  const medianPadArea = median(
    padBounds.map((bound) => bound.width * bound.height),
  )
  const thermalPadEntry = pads
    .map((pad) => ({ bound: getPadBounds(pad), pad }))
    .filter(
      ({ bound, pad }) =>
        Math.abs(pad.x - centerX) <= medianPadWidth &&
        Math.abs(pad.y - centerY) <= medianPadHeight &&
        bound.width * bound.height > medianPadArea * 2.5,
    )
    .sort(
      (left, right) =>
        right.bound.width * right.bound.height -
        left.bound.width * left.bound.height,
    )[0]
  // The exposed center pad describes heat transfer, not the lead topology.
  const topologyPads = thermalPadEntry
    ? pads.filter((pad) => pad !== thermalPadEntry.pad)
    : pads
  const topologyBounds = getBounds(topologyPads)
  const topologyCenterX = (topologyBounds.minX + topologyBounds.maxX) / 2
  const topologyCenterY = (topologyBounds.minY + topologyBounds.maxY) / 2
  const xCoordinates = clusterCoordinates(
    topologyPads.map((pad) => pad.x),
    tolerance,
  )
  const yCoordinates = clusterCoordinates(
    topologyPads.map((pad) => pad.y),
    tolerance,
  )
  const edgeToleranceX = Math.max(
    medianPadWidth * 0.75,
    topologyBounds.width * 0.08,
  )
  const edgeToleranceY = Math.max(
    medianPadHeight * 0.75,
    topologyBounds.height * 0.08,
  )
  const sidePads = topologyPads.filter(
    (pad) =>
      Math.abs(pad.x - (topologyBounds.minX + medianPadWidth / 2)) <=
        edgeToleranceX ||
      Math.abs(pad.x - (topologyBounds.maxX - medianPadWidth / 2)) <=
        edgeToleranceX ||
      Math.abs(pad.y - (topologyBounds.minY + medianPadHeight / 2)) <=
        edgeToleranceY ||
      Math.abs(pad.y - (topologyBounds.maxY - medianPadHeight / 2)) <=
        edgeToleranceY,
  )
  const minPadCenterX = Math.min(...topologyPads.map((pad) => pad.x))
  const maxPadCenterX = Math.max(...topologyPads.map((pad) => pad.x))
  const minPadCenterY = Math.min(...topologyPads.map((pad) => pad.y))
  const maxPadCenterY = Math.max(...topologyPads.map((pad) => pad.y))
  const topologyPadEntries = topologyPads.map((pad) => ({
    bounds: getPadBounds(pad),
    pad,
  }))
  const leftRightEdgePads = topologyPadEntries.filter(
    ({ pad }) =>
      Math.abs(pad.x - minPadCenterX) <= tolerance ||
      Math.abs(pad.x - maxPadCenterX) <= tolerance,
  )
  const topBottomEdgePads = topologyPadEntries.filter(
    ({ pad }) =>
      Math.abs(pad.y - minPadCenterY) <= tolerance ||
      Math.abs(pad.y - maxPadCenterY) <= tolerance,
  )
  const leftSidePads = topologyPadEntries.filter(
    ({ bounds: bound, pad }) =>
      Math.abs(pad.x - minPadCenterX) <= edgeToleranceX &&
      bound.width >= bound.height * 0.95,
  )
  const rightSidePads = topologyPadEntries.filter(
    ({ bounds: bound, pad }) =>
      Math.abs(pad.x - maxPadCenterX) <= edgeToleranceX &&
      bound.width >= bound.height * 0.95,
  )
  const bottomSidePads = topologyPadEntries.filter(
    ({ bounds: bound, pad }) =>
      Math.abs(pad.y - minPadCenterY) <= edgeToleranceY &&
      bound.height >= bound.width * 0.95,
  )
  const topSidePads = topologyPadEntries.filter(
    ({ bounds: bound, pad }) =>
      Math.abs(pad.y - maxPadCenterY) <= edgeToleranceY &&
      bound.height >= bound.width * 0.95,
  )
  const quadSidePadCounts: QuadSidePadCounts = {
    left: leftSidePads.length,
    top: topSidePads.length,
    right: rightSidePads.length,
    bottom: bottomSidePads.length,
  }
  const leftRightSidePads = [...leftSidePads, ...rightSidePads]
  const topBottomSidePads = [...topSidePads, ...bottomSidePads]
  const quadPadDimensions =
    leftRightSidePads.length > 0 && topBottomSidePads.length > 0
      ? {
          leftRightLength: median(
            leftRightSidePads.map(({ bounds: bound }) => bound.width),
          ),
          leftRightWidth: median(
            leftRightSidePads.map(({ bounds: bound }) => bound.height),
          ),
          topBottomLength: median(
            topBottomSidePads.map(({ bounds: bound }) => bound.height),
          ),
          topBottomWidth: median(
            topBottomSidePads.map(({ bounds: bound }) => bound.width),
          ),
        }
      : undefined
  const gridOccupancy =
    topologyPads.length / Math.max(xCoordinates.length * yCoordinates.length, 1)
  const hasPadsOnFourSides =
    sidePads.filter(
      (pad) => Math.abs(pad.x - topologyCenterX) > topologyBounds.width * 0.3,
    ).length >= 4 &&
    sidePads.filter(
      (pad) => Math.abs(pad.y - topologyCenterY) > topologyBounds.height * 0.3,
    ).length >= 4

  let topology: Topology = "irregular"
  if (xCoordinates.length === 1 || yCoordinates.length === 1) {
    topology = "linear"
  } else if (xCoordinates.length <= 2 || yCoordinates.length <= 2) {
    topology = "two-sided"
  } else if (
    topologyPads.length >= 4 &&
    xCoordinates.length >= 2 &&
    yCoordinates.length >= 2 &&
    gridOccupancy >= 0.68
  ) {
    topology = "grid"
  } else if (hasPadsOnFourSides && topologyPads.length >= 8) {
    topology = "four-sided"
  }

  const pitch = getPitchEstimate(pads, tolerance)
  const horizontalSidePitch = getRepeatedSidePitch(
    [topSidePads.map(({ pad }) => pad), bottomSidePads.map(({ pad }) => pad)],
    "x",
    pitch,
  )
  const verticalSidePitch = getRepeatedSidePitch(
    [leftSidePads.map(({ pad }) => pad), rightSidePads.map(({ pad }) => pad)],
    "y",
    pitch,
  )
  const medianPadLongSide = median(
    padBounds.map((bound) => Math.max(bound.width, bound.height)),
  )
  const medianPadShortSide = median(
    padBounds.map((bound) => Math.min(bound.width, bound.height)),
  )
  const medianPadDiameter = median(
    padBounds.map((bound) => Math.sqrt(bound.width * bound.height)),
  )
  const medianHoleDiameter = median(
    getPadGeometries(target).flatMap((pad) =>
      pad.drill ? [Math.sqrt(pad.drill.width * pad.drill.height)] : [],
    ),
  )
  const platedHoleCount = target.pads.filter(
    (pad) => pad.type === "pcb_plated_hole",
  ).length
  const insetQuadAdjustment = topology === "four-sided" ? 0.2 : 0
  const sparsePinGrid = analyzeSparsePinGrid(
    target,
    tolerance,
    medianPadShortSide,
  )
  const dpak = analyzeDpak(target)
  const rj45 = analyzeRj45(target)

  return {
    bounds,
    dpak,
    fpc: analyzeFpc(target),
    jstThroughHole: analyzeJstThroughHole(target),
    jstSmd: analyzeJstSmd(target),
    gridColumns: xCoordinates.length,
    gridRows: yCoordinates.length,
    heuristics: {
      ball: medianPadDiameter,
      h: bounds.height + insetQuadAdjustment,
      id: medianHoleDiameter || medianPadDiameter * 0.6,
      od: medianPadDiameter,
      p: pitch,
      pad: medianPadDiameter,
      ph: medianPadHeight,
      pl: medianPadLongSide,
      px: horizontalSidePitch,
      py: verticalSidePitch,
      pw: medianPadShortSide,
      w: bounds.width + insetQuadAdjustment,
    },
    horizontalSidePadCount: Math.max(
      quadSidePadCounts.left,
      quadSidePadCounts.right,
    ),
    lgaPadLength: leftRightEdgePads.length
      ? median(leftRightEdgePads.map(({ bounds: bound }) => bound.width))
      : median(topBottomEdgePads.map(({ bounds: bound }) => bound.height)),
    lgaPadWidth: leftRightEdgePads.length
      ? median(leftRightEdgePads.map(({ bounds: bound }) => bound.height))
      : median(topBottomEdgePads.map(({ bounds: bound }) => bound.width)),
    perimeterPadCount: sidePads.length,
    platedHoleCount,
    potentiometer: analyzePotentiometer(target),
    quadPadDimensions,
    quadSidePadCounts,
    rj45,
    smdPushButton: analyzeSmdPushButton(target),
    smdSlideSwitch: analyzeSmdSlideSwitch(target),
    sparsePinGrid,
    thermalPad: thermalPadEntry
      ? {
          height: thermalPadEntry.bound.height,
          width: thermalPadEntry.bound.width,
          xOffset: thermalPadEntry.pad.x - topologyCenterX,
          yOffset: thermalPadEntry.pad.y - topologyCenterY,
        }
      : undefined,
    topology,
    twoPadSmd: analyzeTwoPadSmd(target),
    usbCMidMount: getUsbCMidMountGeometry(target),
    verticalSidePadCount: Math.max(
      quadSidePadCounts.bottom,
      quadSidePadCounts.top,
    ),
  }
}

const normalizePads = (pads: PcbPadGeometry[]) => {
  const bounds = getBounds(pads.map(({ copper }) => copper))
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return pads.map((pad) => ({
    ...pad,
    copper: {
      ...pad.copper,
      x: pad.copper.x - centerX,
      y: pad.copper.y - centerY,
    },
    drill: pad.drill
      ? {
          ...pad.drill,
          x: pad.drill.x - centerX,
          y: pad.drill.y - centerY,
        }
      : undefined,
  }))
}

export const rotateFootprint = (
  footprint: Footprint,
  rotation: FootprintRotation,
): Footprint => {
  if (rotation === 0) return footprint
  const offset = rotatePoint(
    footprint.x ?? 0,
    footprint.y ?? 0,
    (rotation * Math.PI) / 180,
  )

  return {
    holes: footprint.holes,
    pads: footprint.pads,
    rotation: ((footprint.rotation ?? 0) + rotation) % 360,
    sourceHints: footprint.sourceHints,
    subtitle: footprint.subtitle,
    title: footprint.title,
    vias: footprint.vias,
    x: offset.x,
    y: offset.y,
  }
}

const getOrientedPadSize = (pad: PcbPadGeometry) => {
  const bounds = getShapeListBounds([{ ...pad.copper, x: 0, y: 0 }])
  return { height: bounds.height, width: bounds.width }
}

const matchPadsByPosition = (
  left: PcbPadGeometry[],
  right: PcbPadGeometry[],
) => {
  const availableRight = new Set(right.map((_, index) => index))
  return left.map((leftPad) => {
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (const rightIndex of availableRight) {
      const rightPad = right[rightIndex]
      const distance = Math.hypot(
        leftPad.copper.x - rightPad.copper.x,
        leftPad.copper.y - rightPad.copper.y,
      )
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = rightIndex
      }
    }
    availableRight.delete(bestIndex)
    return [leftPad, right[bestIndex]] as const
  })
}

const normalizePortHint = (hint: string) => {
  const trimmed = hint.trim()
  const numericPin = trimmed.match(/^(?:pin)?(\d+)$/i)
  return numericPin ? `pin${numericPin[1]}` : trimmed
}

const getPortHints = ({ element }: PcbPadGeometry) =>
  (element.port_hints ?? []).map(normalizePortHint)

const getPin1PolarityModifier = (
  target: Footprint,
): "anodepin1" | "cathodepin1" | null => {
  const pin1Pad = getPadGeometries(target).find((pad) =>
    getPortHints(pad).includes("pin1"),
  )
  if (!pin1Pad) return null

  const hints = new Set(
    getPortHints(pin1Pad).map((hint) =>
      hint.toLowerCase().replace(/[^a-z0-9+-]/g, ""),
    ),
  )
  const isAnode = ["a", "anode", "pos", "+"].some((hint) => hints.has(hint))
  const isCathode = ["c", "k", "cathode", "neg", "-"].some((hint) =>
    hints.has(hint),
  )

  if (isAnode === isCathode) return null
  return isAnode ? "anodepin1" : "cathodepin1"
}

const getGeometryLoss = (candidate: Footprint, target: Footprint) => {
  if (candidate.pads.length !== target.pads.length) return 1_000

  const candidatePads = normalizePads(getPadGeometries(candidate))
  const targetPads = normalizePads(getPadGeometries(target))
  const targetBounds = getBounds(targetPads.map(({ copper }) => copper))
  const positionScale = Math.max(
    Math.hypot(targetBounds.width, targetBounds.height),
    0.1,
  )
  const pairs = matchPadsByPosition(candidatePads, targetPads)
  let loss = 0

  for (const [candidatePad, targetPad] of pairs) {
    const candidateSize = getOrientedPadSize(candidatePad)
    const targetSize = getOrientedPadSize(targetPad)
    const dx = (candidatePad.copper.x - targetPad.copper.x) / positionScale
    const dy = (candidatePad.copper.y - targetPad.copper.y) / positionScale
    const dw =
      (candidateSize.width - targetSize.width) /
      Math.max(targetSize.width, 0.05)
    const dh =
      (candidateSize.height - targetSize.height) /
      Math.max(targetSize.height, 0.05)

    loss += dx * dx * 4 + dy * dy * 4 + dw * dw + dh * dh
    if (candidatePad.element.type !== targetPad.element.type) loss += 4
    if (candidatePad.copper.shape !== targetPad.copper.shape) loss += 0.08
    if (Boolean(candidatePad.drill) !== Boolean(targetPad.drill)) {
      loss += 4
    } else if (candidatePad.drill && targetPad.drill) {
      const holeWidthScale = Math.max(targetPad.drill.width, 0.05)
      const holeHeightScale = Math.max(targetPad.drill.height, 0.05)
      const holeWidthDifference =
        (candidatePad.drill.width - targetPad.drill.width) / holeWidthScale
      const holeHeightDifference =
        (candidatePad.drill.height - targetPad.drill.height) / holeHeightScale
      const holeOffsetXDifference =
        (candidatePad.drill.x -
          candidatePad.copper.x -
          (targetPad.drill.x - targetPad.copper.x)) /
        positionScale
      const holeOffsetYDifference =
        (candidatePad.drill.y -
          candidatePad.copper.y -
          (targetPad.drill.y - targetPad.copper.y)) /
        positionScale

      loss +=
        holeWidthDifference * holeWidthDifference +
        holeHeightDifference * holeHeightDifference +
        holeOffsetXDifference * holeOffsetXDifference * 4 +
        holeOffsetYDifference * holeOffsetYDifference * 4
      if (candidatePad.drill.shape !== targetPad.drill.shape) loss += 0.08
    }
    const targetPortHints = getPortHints(targetPad)
    if (
      targetPortHints.length > 0 &&
      !getPortHints(candidatePad).some((hint) => targetPortHints.includes(hint))
    ) {
      loss += 0.04
    }
  }

  return loss / pairs.length
}

const getGeometryScore = (candidate: Footprint, target: Footprint) =>
  1 / (1 + getGeometryLoss(candidate, target))

const getDomainScore = (target: Footprint, family: string) => {
  const description = `${target.title} ${target.subtitle} ${
    target.sourceHints?.join(" ") ?? ""
  }`.toLowerCase()
  const aliases: Record<string, string[]> = {
    cap: ["capacitor", "cap"],
    d2pak: ["d2pak", "to-263", "to263"],
    dfn: ["dfn"],
    dpak: ["dpak", "to-252", "to252"],
    fpc: ["fpc", "ffc", "flat flexible"],
    jst: ["jst", "smd p=", "smd,p=", "wire-to-board", "wire to board"],
    lga: ["lga"],
    qfn: ["qfn"],
    res: ["resistor", "res"],
    soic: ["soic", "so-"],
    ssop: ["ssop"],
    tssop: ["tssop"],
    usbcmidmount: ["usb-c", "usb c", "type-c", "type c", "usbc"],
    rj45: ["rj45", "ethernet", "8p8c"],
    smdpushbutton: ["push button", "pushbutton", "tactile switch"],
    smdslideswitch: ["slide switch", "slideswitch", "msk12"],
  }
  const terms = aliases[family] ?? [family]
  return terms.some((term) => description.includes(term)) ? 1 : 0
}

const getFamily = (footprinterString: string) => {
  if (/^\d{4,5}(?:_|$)/.test(footprinterString)) return "res"
  return (
    [...getFootprintNames()]
      .sort((left, right) => right.length - left.length)
      .find(
        (family) =>
          footprinterString === family ||
          new RegExp(`^${family}(?:\\d|_)`).test(footprinterString),
      ) ??
    footprinterString.match(/^[a-z]+/i)?.[0] ??
    footprinterString
  )
}

const tryBuild = (footprinterString: string) => {
  try {
    return footprinterStringToFootprint(footprinterString)
  } catch {
    return null
  }
}

const roundToFiveMicrometers = (value: number) =>
  Number((Math.round(value * 200) / 200).toFixed(3))

const roundToTenMicrometers = (value: number) =>
  Number((Math.round(value * 100) / 100).toFixed(2))

const usesFiveMicrometerPrecision = (parameter: NumericParameter) =>
  parameter === "p" ||
  parameter === "px" ||
  parameter === "py" ||
  parameter === "pad"

const roundOptimizedParameter = (parameter: NumericParameter, value: number) =>
  usesFiveMicrometerPrecision(parameter)
    ? roundToFiveMicrometers(value)
    : roundToTenMicrometers(value)

export const formatLength = (value: number) => {
  const millimeters = roundToTenMicrometers(value)
  if (millimeters > 0 && millimeters < 0.1) {
    return `${Math.round(millimeters * 1_000)}um`
  }
  return `${millimeters}mm`
}

const formatPitchLength = (value: number) => {
  const millimeters = roundToFiveMicrometers(value)
  if (millimeters > 0 && millimeters < 0.1) {
    return `${Math.round(millimeters * 1_000)}um`
  }
  return `${millimeters}mm`
}

const formatPreciseLength = (value: number) => `${Number(value.toFixed(4))}mm`

const buildParameterizedString = (
  seed: string,
  parameters: Partial<Record<NumericParameter, number>>,
) => {
  const suffix = NUMERIC_PARAMETERS.flatMap((parameter) => {
    const value = parameters[parameter]
    if (value === undefined) return []
    const formattedValue = usesFiveMicrometerPrecision(parameter)
      ? formatPitchLength(value)
      : formatLength(value)
    return [`${parameter}${formattedValue}`]
  }).join("_")
  return suffix ? `${seed}_${suffix}` : seed
}

const addThermalPadOffsetForRotation = (
  footprinterString: string,
  thermalPad: TargetAnalysis["thermalPad"],
  searchRotation: FootprintRotation,
) => {
  if (!thermalPad || !footprinterString.includes("_thermalpad")) {
    return footprinterString
  }

  const sourceOffset =
    searchRotation === 0
      ? { x: thermalPad.xOffset, y: thermalPad.yOffset }
      : searchRotation === 90
        ? { x: thermalPad.yOffset, y: -thermalPad.xOffset }
        : searchRotation === 180
          ? { x: -thermalPad.xOffset, y: -thermalPad.yOffset }
          : { x: -thermalPad.yOffset, y: thermalPad.xOffset }
  const roundedXOffset = roundToFiveMicrometers(sourceOffset.x)
  const roundedYOffset = roundToFiveMicrometers(sourceOffset.y)
  const offsetSuffix = [
    roundedXOffset !== 0
      ? `thermalpadcenteroffsetx${formatPitchLength(roundedXOffset)}`
      : "",
    roundedYOffset !== 0
      ? `thermalpadcenteroffsety${formatPitchLength(roundedYOffset)}`
      : "",
  ]
    .filter(Boolean)
    .join("_")

  return offsetSuffix
    ? `${footprinterString}_${offsetSuffix}`
    : footprinterString
}

const geometrySignature = (footprint: Footprint) => {
  const padSignature = getPadGeometries(footprint)
    .map(({ copper, drill, element }) => {
      const holeSignature = drill
        ? [
            drill.shape,
            drill.x - copper.x,
            drill.y - copper.y,
            drill.width,
            drill.height,
            drill.rotation,
          ].join(":")
        : "no-hole"
      const pointSignature =
        copper.shape === "polygon"
          ? copper.points?.map((point) => `${point.x}:${point.y}`).join(",")
          : "no-points"
      return [
        element.type,
        copper.shape,
        copper.x,
        copper.y,
        copper.width,
        copper.height,
        copper.rotation,
        pointSignature,
        holeSignature,
      ]
        .map(String)
        .join(":")
    })
    .join("|")
  const holeSignature = getHoleGeometries(footprint)
    .map((hole) =>
      [hole.shape, hole.x, hole.y, hole.width, hole.height, hole.rotation].join(
        ":",
      ),
    )
    .join("|")
  return `${padSignature}#${holeSignature}`
}

const padShapeSignature = (footprint: Footprint) =>
  getPadGeometries(footprint)
    .map(({ copper, element }) => `${element.type}:${copper.shape}`)
    .toSorted()
    .join("|")

const areClose = (left: number, right: number) =>
  Math.abs(left - right) <= 0.00001

const areSamePoint = (
  left: { x: number; y: number },
  right: { x: number; y: number },
) => areClose(left.x, right.x) && areClose(left.y, right.y)

const haveSamePolygon = (left: ShapeGeometry, right: ShapeGeometry) => {
  if (left.shape !== "polygon" && right.shape !== "polygon") return true
  if (left.shape !== "polygon" || right.shape !== "polygon") return false
  const leftPoints = getPolygonWorldPoints(left)
  const rightPoints = getPolygonWorldPoints(right)
  if (leftPoints.length !== rightPoints.length) return false

  const matchesFrom = (startIndex: number, direction: 1 | -1) =>
    leftPoints.every((leftPoint, index) => {
      const rightIndex =
        (startIndex + direction * index + rightPoints.length) %
        rightPoints.length
      return areSamePoint(leftPoint, rightPoints[rightIndex])
    })

  return rightPoints.some(
    (rightPoint, startIndex) =>
      areSamePoint(leftPoints[0], rightPoint) &&
      (matchesFrom(startIndex, 1) || matchesFrom(startIndex, -1)),
  )
}

const haveSamePadPlacement = (left: Footprint, right: Footprint) => {
  if (
    left.pads.length !== right.pads.length ||
    left.holes.length !== right.holes.length
  ) {
    return false
  }

  const leftPads = getPadGeometries(left)
  const rightPads = getPadGeometries(right)
  const padsMatch = leftPads.every((leftPad, index) => {
    const rightPad = rightPads[index]
    if (!rightPad) return false
    const leftSize = getOrientedPadSize(leftPad)
    const rightSize = getOrientedPadSize(rightPad)
    const drillsMatch =
      !leftPad.drill && !rightPad.drill
        ? true
        : Boolean(leftPad.drill && rightPad.drill) &&
          leftPad.drill?.shape === rightPad.drill?.shape &&
          areClose(
            (leftPad.drill?.x ?? 0) - leftPad.copper.x,
            (rightPad.drill?.x ?? 0) - rightPad.copper.x,
          ) &&
          areClose(
            (leftPad.drill?.y ?? 0) - leftPad.copper.y,
            (rightPad.drill?.y ?? 0) - rightPad.copper.y,
          ) &&
          areClose(leftPad.drill?.width ?? 0, rightPad.drill?.width ?? 0) &&
          areClose(leftPad.drill?.height ?? 0, rightPad.drill?.height ?? 0) &&
          // Rotation has no geometric meaning for a circular drill.
          (leftPad.drill?.shape === "circle" ||
            areClose(
              leftPad.drill?.rotation ?? 0,
              rightPad.drill?.rotation ?? 0,
            ))
    return (
      leftPad.element.type === rightPad.element.type &&
      leftPad.copper.shape === rightPad.copper.shape &&
      getPortHints(leftPad).join("|") === getPortHints(rightPad).join("|") &&
      areClose(leftPad.copper.x, rightPad.copper.x) &&
      areClose(leftPad.copper.y, rightPad.copper.y) &&
      areClose(leftSize.width, rightSize.width) &&
      areClose(leftSize.height, rightSize.height) &&
      haveSamePolygon(leftPad.copper, rightPad.copper) &&
      drillsMatch
    )
  })
  if (!padsMatch) return false

  const leftHoles = getHoleGeometries(left)
  const rightHoles = getHoleGeometries(right)
  return leftHoles.every((leftHole, index) => {
    const rightHole = rightHoles[index]
    if (!rightHole) return false
    const leftSize = getShapeListBounds([{ ...leftHole, x: 0, y: 0 }])
    const rightSize = getShapeListBounds([{ ...rightHole, x: 0, y: 0 }])
    return (
      leftHole.shape === rightHole.shape &&
      areClose(leftHole.x, rightHole.x) &&
      areClose(leftHole.y, rightHole.y) &&
      areClose(leftSize.width, rightSize.width) &&
      areClose(leftSize.height, rightSize.height) &&
      (leftHole.shape === "circle" ||
        areClose(leftHole.rotation, rightHole.rotation))
    )
  })
}

const encodeOrientationInFootprinterString = (
  footprinterString: string,
  searchRotation: FootprintRotation,
  orientedFootprint: Footprint,
) => {
  if (searchRotation === 0) return footprinterString

  for (const [side, alignment] of PIN1_LOCATIONS) {
    const orientedString = `${footprinterString}_pin1location(${side},${alignment})`
    const footprint = tryBuild(orientedString)
    if (footprint && haveSamePadPlacement(footprint, orientedFootprint)) {
      return orientedString
    }
  }

  return null
}

const isLed2835Target = (
  target: Footprint,
  analysis: TargetAnalysis,
): analysis is TargetAnalysis & { twoPadSmd: TwoPadSmdAnalysis } =>
  Boolean(analysis.twoPadSmd) &&
  `${target.title} ${target.subtitle} ${target.sourceHints?.join(" ") ?? ""}`
    .toLowerCase()
    .includes("2835")

const getPreferredFamilies = (target: Footprint, analysis: TargetAnalysis) => {
  if (analysis.dpak) return new Set([analysis.dpak.family])
  if (analysis.smdPushButton) return new Set(["smdpushbutton"])
  if (analysis.smdSlideSwitch) return new Set(["smdslideswitch"])
  if (analysis.jstSmd) return new Set(["jst"])
  if (analysis.jstThroughHole) return new Set(["jst"])
  if (isLed2835Target(target, analysis)) return new Set(["led2835"])
  if (analysis.potentiometer) return new Set(["potentiometer"])
  if (analysis.fpc) return new Set(["fpc"])
  if (analysis.rj45) return new Set(["rj45"])
  if (analysis.platedHoleCount > analysis.perimeterPadCount / 2) {
    return new Set([
      "dip",
      "electrolytic",
      "jst",
      "pinrow",
      "radial",
      "to220",
      "to92",
      "usbcmidmount",
    ])
  }
  if (analysis.topology === "grid") return new Set(["bga"])
  if (analysis.topology === "four-sided") {
    return new Set(["lga", "lqfp", "mlp", "qfn", "qfp", "quad", "tqfp"])
  }
  if (analysis.topology === "two-sided") {
    return new Set([
      "lga",
      "soic",
      "sop8",
      "tssop",
      "ssop",
      "msop",
      "vssop",
      "dfn",
      "son",
      "sot",
    ])
  }
  if (analysis.topology === "linear" && analysis.perimeterPadCount === 2) {
    return new Set(["res", "cap", "diode", "led", "melf", "axial"])
  }
  return new Set<string>()
}

const QUAD_SIDE_PIN_FAMILIES = [
  "lqfp",
  "mlp",
  "qfn",
  "qfp",
  "quad",
  "tqfp",
] as const

const getQuadSidePinSuffix = (analysis: TargetAnalysis) => {
  if (analysis.topology !== "four-sided") return undefined

  const { bottom, left, right, top } = analysis.quadSidePadCounts
  const counts = [left, top, right, bottom]
  if (
    counts.some((count) => !Number.isInteger(count) || count < 1) ||
    counts.reduce((sum, count) => sum + count, 0) !==
      analysis.perimeterPadCount ||
    new Set(counts).size === 1
  ) {
    return undefined
  }

  return [
    `leftpins${left}`,
    `toppins${top}`,
    `rightpins${right}`,
    `bottompins${bottom}`,
  ].join("_")
}

const getAsymmetricQfnSeed = (target: Footprint, analysis: TargetAnalysis) => {
  const description = `${target.title} ${target.subtitle} ${
    target.sourceHints?.join(" ") ?? ""
  }`.toLowerCase()
  const sidePinSuffix = getQuadSidePinSuffix(analysis)
  const dimensions = analysis.quadPadDimensions
  if (
    !description.includes("qfn") ||
    !sidePinSuffix ||
    !dimensions ||
    analysis.topology !== "four-sided"
  ) {
    return undefined
  }

  const { leftRightLength, leftRightWidth, topBottomLength, topBottomWidth } =
    dimensions
  if (
    Math.abs(leftRightLength - topBottomLength) < 0.01 &&
    Math.abs(leftRightWidth - topBottomWidth) < 0.01
  ) {
    return undefined
  }

  const parameters = [
    `px${formatPitchLength(analysis.heuristics.px)}`,
    ...(analysis.quadSidePadCounts.left > 1 ||
    analysis.quadSidePadCounts.right > 1
      ? [`py${formatPitchLength(analysis.heuristics.py)}`]
      : []),
    `w${formatPreciseLength(analysis.heuristics.w)}`,
    `h${formatPreciseLength(analysis.heuristics.h)}`,
    `pw${formatPreciseLength(topBottomWidth)}`,
    `pl${formatPreciseLength(topBottomLength)}`,
    `lrpw${formatPreciseLength(leftRightWidth)}`,
    `lrpl${formatPreciseLength(leftRightLength)}`,
  ]
  const hasSquarePads = getPadGeometries(target).every(
    ({ copper }) => copper.shape === "rect" && !copper.cornerRadius,
  )

  return `qfn${analysis.perimeterPadCount}_${sidePinSuffix}_${parameters.join("_")}${hasSquarePads ? "_rounded0" : ""}`
}

const getSot223Seed = (target: Footprint) => {
  const pads = getPadGeometries(target)
  if (
    pads.length !== 4 ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_smtpad" || drill || copper.shape !== "rect",
    )
  ) {
    return undefined
  }

  for (const [crossAxis, alongAxis] of [
    ["x", "y"],
    ["y", "x"],
  ] as const) {
    const sortedPads = [...pads].toSorted(
      (left, right) => left.copper[crossAxis] - right.copper[crossAxis],
    )
    const leadCandidates = [sortedPads.slice(0, 3), sortedPads.slice(1)]

    for (const leads of leadCandidates) {
      const tab = sortedPads.find((pad) => !leads.includes(pad))
      if (!tab) continue

      const leadCross = median(leads.map((lead) => lead.copper[crossAxis]))
      const crossTolerance = 0.025
      if (
        leads.some(
          (lead) =>
            Math.abs(lead.copper[crossAxis] - leadCross) > crossTolerance,
        )
      ) {
        continue
      }

      const leadBounds = leads.map((lead) => getPadBounds(lead.copper))
      const tabBounds = getPadBounds(tab.copper)
      const leadCrossSize = median(
        leadBounds.map(
          (bounds) => bounds[crossAxis === "x" ? "width" : "height"],
        ),
      )
      const leadAlongSize = median(
        leadBounds.map(
          (bounds) => bounds[alongAxis === "x" ? "width" : "height"],
        ),
      )
      const tabCrossSize = tabBounds[crossAxis === "x" ? "width" : "height"]
      const tabAlongSize = tabBounds[alongAxis === "x" ? "width" : "height"]
      if (
        leads.some((_, index) => {
          const bounds = leadBounds[index]!
          const crossSize = bounds[crossAxis === "x" ? "width" : "height"]
          const alongSize = bounds[alongAxis === "x" ? "width" : "height"]
          return (
            Math.abs(crossSize - leadCrossSize) > 0.025 ||
            Math.abs(alongSize - leadAlongSize) > 0.025
          )
        }) ||
        tabCrossSize * tabAlongSize <= leadCrossSize * leadAlongSize ||
        tabAlongSize <= leadAlongSize
      ) {
        continue
      }

      const alongCoordinates = leads
        .map((lead) => lead.copper[alongAxis])
        .toSorted((left, right) => left - right)
      const pitch = median([
        alongCoordinates[1]! - alongCoordinates[0]!,
        alongCoordinates[2]! - alongCoordinates[1]!,
      ])
      if (
        pitch <= 0.05 ||
        Math.abs(alongCoordinates[1]! - alongCoordinates[0]! - pitch) > 0.025 ||
        Math.abs(alongCoordinates[2]! - alongCoordinates[1]! - pitch) > 0.025
      ) {
        continue
      }

      const leadDistance = Math.abs(leadCross)
      const tabDistance = Math.abs(tab.copper[crossAxis])
      if (leadDistance <= 0.05 || tabDistance <= 0.05) continue

      return [
        "sot223",
        `w${formatPreciseLength(2 * (leadDistance + 1.1))}`,
        `p${formatPreciseLength(pitch)}`,
        `pl${formatPreciseLength(leadCrossSize)}`,
        `pw${formatPreciseLength(leadAlongSize)}`,
        `tabpl${formatPreciseLength(tabCrossSize)}`,
        `tabpw${formatPreciseLength(tabAlongSize)}`,
        `taboffset${formatPreciseLength(tabDistance - leadDistance)}`,
        "rounded0",
      ].join("_")
    }
  }

  return undefined
}

const getBgaGridSeed = (target: Footprint) => {
  const pads = getPadGeometries(target)
  if (
    pads.length < 4 ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_smtpad" || drill || copper.shape !== "rect",
    )
  ) {
    return undefined
  }

  const bounds = pads.map(({ copper }) => getPadBounds(copper))
  const pad = median(bounds.map(({ width, height }) => (width + height) / 2))
  const tolerance = Math.max(0.005, pad * 0.08)
  if (
    bounds.some(
      ({ width, height }) =>
        Math.abs(width - height) > tolerance ||
        Math.abs(width - pad) > tolerance ||
        Math.abs(height - pad) > tolerance,
    )
  ) {
    return undefined
  }

  const columns = clusterCoordinates(
    pads.map(({ copper }) => copper.x),
    tolerance,
  )
  const rows = clusterCoordinates(
    pads.map(({ copper }) => copper.y),
    tolerance,
  )
  if (
    columns.length < 2 ||
    rows.length < 2 ||
    columns.length * rows.length !== pads.length
  ) {
    return undefined
  }

  const columnPitches = columns
    .slice(1)
    .map((coordinate, index) => coordinate - columns[index]!)
  const rowPitches = rows
    .slice(1)
    .map((coordinate, index) => coordinate - rows[index]!)
  const pitch = median([...columnPitches, ...rowPitches])
  if (
    pitch <= pad ||
    [...columnPitches, ...rowPitches].some(
      (candidate) => Math.abs(candidate - pitch) > tolerance,
    )
  ) {
    return undefined
  }

  for (const column of columns) {
    for (const row of rows) {
      if (
        pads.filter(
          ({ copper }) =>
            Math.abs(copper.x - column) <= tolerance &&
            Math.abs(copper.y - row) <= tolerance,
        ).length !== 1
      ) {
        return undefined
      }
    }
  }

  return `bga${pads.length}_grid${columns.length}x${rows.length}_p${formatPreciseLength(pitch)}_pad${formatPreciseLength(pad)}`
}

const getStaggeredSmdPinHeaderSeed = (target: Footprint) => {
  const description = `${target.title} ${target.subtitle} ${
    target.sourceHints?.join(" ") ?? ""
  }`.toLowerCase()
  if (!description.includes("staggered") && !description.includes("交错")) {
    return undefined
  }

  const pads = getPadGeometries(target)
  if (
    pads.length < 3 ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_smtpad" || drill || copper.shape !== "rect",
    )
  ) {
    return undefined
  }

  const bounds = pads.map(({ copper }) => getPadBounds(copper))
  const medianWidth = median(bounds.map(({ width }) => width))
  const medianHeight = median(bounds.map(({ height }) => height))
  const tolerance = Math.max(0.005, Math.min(medianWidth, medianHeight) * 0.05)
  if (
    bounds.some(
      ({ width, height }) =>
        Math.abs(width - medianWidth) > tolerance ||
        Math.abs(height - medianHeight) > tolerance,
    )
  ) {
    return undefined
  }

  for (const [alongAxis, crossAxis] of [
    ["x", "y"],
    ["y", "x"],
  ] as const) {
    const sortedPads = [...pads].sort(
      (left, right) => left.copper[alongAxis] - right.copper[alongAxis],
    )
    const pitches = sortedPads
      .slice(1)
      .map(
        ({ copper }, index) =>
          copper[alongAxis] - sortedPads[index]!.copper[alongAxis],
      )
    const pitch = median(pitches)
    if (
      pitch <= tolerance ||
      pitches.some((candidate) => Math.abs(candidate - pitch) > tolerance)
    ) {
      continue
    }

    const rows = clusterCoordinates(
      pads.map(({ copper }) => copper[crossAxis]),
      tolerance,
    )
    if (rows.length !== 2) continue

    const rowIndexes = sortedPads.map(({ copper }) =>
      Math.abs(copper[crossAxis] - rows[0]!) <= tolerance ? 0 : 1,
    )
    const firstRowIndex = rowIndexes[0]!
    if (
      rowIndexes.some(
        (rowIndex, index) =>
          rowIndex !== (index % 2 === 0 ? firstRowIndex : 1 - firstRowIndex),
      )
    ) {
      continue
    }

    const padWidth = alongAxis === "x" ? medianWidth : medianHeight
    const padHeight = alongAxis === "x" ? medianHeight : medianWidth
    return [
      `smdpinheader${pads.length}`,
      `p${formatPitchLength(pitch)}`,
      `py${formatPitchLength(Math.abs(rows[1]! - rows[0]!))}`,
      `pw${formatPreciseLength(padWidth)}`,
      `ph${formatPreciseLength(padHeight)}`,
    ].join("_")
  }

  return undefined
}

const getTwoSidedDfnSeed = (target: Footprint) => {
  const pads = getPadGeometries(target)
  if (
    pads.length < 4 ||
    pads.length % 2 !== 0 ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_smtpad" || drill || copper.shape !== "rect",
    )
  ) {
    return undefined
  }

  for (const [crossAxis, alongAxis] of [
    ["x", "y"],
    ["y", "x"],
  ] as const) {
    const bounds = pads.map(({ copper }) => getPadBounds(copper))
    const padLength = median(
      bounds.map((bound) => bound[crossAxis === "x" ? "width" : "height"]),
    )
    const padWidth = median(
      bounds.map((bound) => bound[alongAxis === "x" ? "width" : "height"]),
    )
    const tolerance = Math.max(0.01, Math.min(padLength, padWidth) * 0.1)
    const padLengthOutliers = bounds.filter(
      (bound) =>
        Math.abs(bound[crossAxis === "x" ? "width" : "height"] - padLength) >
        tolerance,
    ).length
    const hasPadWidthOutlier = bounds.some(
      (bound) =>
        Math.abs(bound[alongAxis === "x" ? "width" : "height"] - padWidth) >
        tolerance,
    )
    // Pin 1 is sometimes deliberately longer than the remaining pads. The
    // family can still reproduce the shared pad geometry accurately.
    if (padLengthOutliers > 1 || hasPadWidthOutlier) {
      continue
    }

    const regularLengthPads = pads.filter((_, index) => {
      const bound = bounds[index]!
      return (
        Math.abs(bound[crossAxis === "x" ? "width" : "height"] - padLength) <=
        tolerance
      )
    })
    const crossCoordinates = clusterCoordinates(
      regularLengthPads.map(({ copper }) => copper[crossAxis]),
      tolerance,
    )
    const alongCoordinates = clusterCoordinates(
      pads.map(({ copper }) => copper[alongAxis]),
      tolerance,
    )
    if (
      crossCoordinates.length !== 2 ||
      alongCoordinates.length !== pads.length / 2
    ) {
      continue
    }

    if (
      crossCoordinates.some(
        (crossCoordinate) =>
          pads.filter(({ copper }, index) => {
            const bound = bounds[index]!
            const length = bound[crossAxis === "x" ? "width" : "height"]
            const centerTolerance =
              tolerance + Math.max(0, Math.abs(length - padLength) / 2)
            return (
              Math.abs(copper[crossAxis] - crossCoordinate) <= centerTolerance
            )
          }).length !==
          pads.length / 2,
      )
    ) {
      continue
    }

    const pitches = alongCoordinates
      .slice(1)
      .map((coordinate, index) => coordinate - alongCoordinates[index]!)
    const pitch = median(pitches)
    if (
      pitch <= padWidth ||
      pitches.some((candidate) => Math.abs(candidate - pitch) > tolerance)
    ) {
      continue
    }

    const width =
      Math.abs(crossCoordinates[1]! - crossCoordinates[0]!) + padLength
    return `dfn${pads.length}_p${formatPreciseLength(pitch)}_w${formatPreciseLength(width)}_pw${formatPreciseLength(padWidth)}_pl${formatPreciseLength(padLength)}`
  }

  return undefined
}

const getTwoLeadThermalQfnSeed = (
  target: Footprint,
  analysis: TargetAnalysis,
) => {
  if (!analysis.thermalPad) return undefined

  const pads = getPadGeometries(target)
  if (
    pads.length !== 3 ||
    pads.some(
      ({ copper, drill, element }) =>
        element.type !== "pcb_smtpad" || drill || copper.shape !== "rect",
    )
  ) {
    return undefined
  }

  const entries = pads
    .map((pad) => {
      const bounds = getPadBounds(pad.copper)
      return { area: bounds.width * bounds.height, bounds, pad }
    })
    .toSorted((left, right) => right.area - left.area)
  const thermalPad = entries[0]!
  const leads = entries.slice(1)
  if (thermalPad.area <= Math.max(...leads.map(({ area }) => area)) * 2) {
    return undefined
  }

  const dx = Math.abs(leads[1]!.pad.copper.x - leads[0]!.pad.copper.x)
  const dy = Math.abs(leads[1]!.pad.copper.y - leads[0]!.pad.copper.y)
  const separatedVertically = dy >= dx
  const separation = Math.max(dx, dy)
  const crossOffset = Math.min(dx, dy)
  const leadWidth = median(leads.map(({ bounds }) => bounds.width))
  const leadHeight = median(leads.map(({ bounds }) => bounds.height))
  const padWidth = separatedVertically ? leadHeight : leadWidth
  const padLength = separatedVertically ? leadWidth : leadHeight
  if (
    separation <= 0.05 ||
    crossOffset > Math.max(0.02, Math.min(leadWidth, leadHeight) * 0.1)
  ) {
    return undefined
  }

  const sourceThermalPadWidth = separatedVertically
    ? thermalPad.bounds.width
    : thermalPad.bounds.height
  const sourceThermalPadHeight = separatedVertically
    ? thermalPad.bounds.height
    : thermalPad.bounds.width
  return [
    "qfn2",
    `thermalpad${formatPreciseLength(sourceThermalPadWidth)}x${formatPreciseLength(sourceThermalPadHeight)}`,
    `p${formatPreciseLength(separation * 2)}`,
    `w${formatPreciseLength(padLength + 0.2)}`,
    `pw${formatPreciseLength(padWidth)}`,
    `pl${formatPreciseLength(padLength)}`,
  ].join("_")
}

const generateSeeds = (target: Footprint, analysis: TargetAnalysis) => {
  const padCount = target.pads.length
  const seeds = new Set<string>()
  const quadSidePinSuffix = getQuadSidePinSuffix(analysis)

  for (const family of getFootprintNames()) {
    seeds.add(`${family}${padCount}`)
    // Mid-mount USB-C variants are named by their explicit 16-pin form.
    if (family !== "usbcmidmount") seeds.add(family)
  }

  const bgaGridSeed = getBgaGridSeed(target)
  if (bgaGridSeed) seeds.add(bgaGridSeed)

  const staggeredSmdPinHeaderSeed = getStaggeredSmdPinHeaderSeed(target)
  if (staggeredSmdPinHeaderSeed) seeds.add(staggeredSmdPinHeaderSeed)

  const twoSidedDfnSeed = getTwoSidedDfnSeed(target)
  if (twoSidedDfnSeed) seeds.add(twoSidedDfnSeed)

  const twoLeadThermalQfnSeed = getTwoLeadThermalQfnSeed(target, analysis)
  if (twoLeadThermalQfnSeed) seeds.add(twoLeadThermalQfnSeed)

  const asymmetricQfnSeed = getAsymmetricQfnSeed(target, analysis)
  if (asymmetricQfnSeed) seeds.add(asymmetricQfnSeed)

  if (isLed2835Target(target, analysis)) {
    const { padHeight, pin1Offset, pin1Width, pin2Offset, pin2Width } =
      analysis.twoPadSmd
    seeds.add(
      [
        "led2835",
        `p1w${formatPreciseLength(pin1Width)}`,
        `p2w${formatPreciseLength(pin2Width)}`,
        `ph${formatPreciseLength(padHeight)}`,
        `p1x${formatPreciseLength(pin1Offset)}`,
        `p2x${formatPreciseLength(pin2Offset)}`,
      ].join("_"),
    )
  }

  if (analysis.dpak) {
    const { family, numberOfPads, p, pl, pw, span, tabh, tabw } = analysis.dpak
    seeds.add(
      [
        `${family}${numberOfPads}`,
        `p${formatPreciseLength(p)}`,
        `pw${formatPreciseLength(pw)}`,
        `pl${formatPreciseLength(pl)}`,
        `tabw${formatPreciseLength(tabw)}`,
        `tabh${formatPreciseLength(tabh)}`,
        `span${formatPreciseLength(span)}`,
      ].join("_"),
    )
  }

  if (analysis.jstSmd) {
    const {
      mountingPadLength,
      mountingPadPitch,
      mountingPadRowDistance,
      mountingPadWidth,
      mountingPadsOnTop,
      padLength,
      padPitch,
      padWidth,
      pinCount,
    } = analysis.jstSmd
    const flags = ["smd", mountingPadsOnTop ? "mounttop" : ""].filter(Boolean)
    const parameters = [
      `p${formatPreciseLength(padPitch)}`,
      `pw${formatPreciseLength(padWidth)}`,
      `pl${formatPreciseLength(padLength)}`,
      `mpx${formatPreciseLength(mountingPadPitch)}`,
      `mpy${formatPreciseLength(mountingPadRowDistance)}`,
      `mpw${formatPreciseLength(mountingPadWidth)}`,
      `mpl${formatPreciseLength(mountingPadLength)}`,
    ]
    seeds.add(`jst${pinCount}_${[...flags, ...parameters].join("_")}`)
  }

  if (analysis.jstThroughHole) {
    const { id, padLength, padPitch, padWidth, pinCount } =
      analysis.jstThroughHole
    seeds.add(
      [
        `jst${pinCount}`,
        "zh",
        `p${formatPreciseLength(padPitch)}`,
        `pw${formatPreciseLength(padWidth)}`,
        `pl${formatPreciseLength(padLength)}`,
        `id${formatPreciseLength(id)}`,
      ].join("_"),
    )
  }

  if (analysis.potentiometer) {
    const { h, id, od, p } = analysis.potentiometer
    seeds.add(
      [
        "potentiometer",
        `p${formatPreciseLength(p)}`,
        `h${formatPreciseLength(h)}`,
        `od${formatPreciseLength(od)}`,
        `id${formatPreciseLength(id)}`,
      ].join("_"),
    )
  }

  if (analysis.smdSlideSwitch) {
    const {
      holeDiameter,
      holeX,
      holeY,
      missingColumns,
      mountY,
      mountingPadLength,
      mountingPadPitchX,
      mountingPadPitchY,
      mountingPadWidth,
      noHoles,
      padLength,
      padPitch,
      padWidth,
      signalColumnCount,
    } = analysis.smdSlideSwitch
    const parameters = [
      signalColumnCount === 3 ? "" : `signalcols${signalColumnCount}`,
      missingColumns.length ? `missing(${missingColumns.join(",")})` : "",
      `p${formatPreciseLength(padPitch)}`,
      `pw${formatPreciseLength(padWidth)}`,
      `pl${formatPreciseLength(padLength)}`,
      `mounty${formatPreciseLength(mountY)}`,
      `mpx${formatPreciseLength(mountingPadPitchX)}`,
      `mpy${formatPreciseLength(mountingPadPitchY)}`,
      `mpw${formatPreciseLength(mountingPadWidth)}`,
      `mpl${formatPreciseLength(mountingPadLength)}`,
      noHoles ? "noholes" : "",
      !noHoles && holeX !== undefined
        ? `holex${formatPreciseLength(holeX)}`
        : "",
      !noHoles && holeY !== undefined
        ? `holey${formatPreciseLength(holeY)}`
        : "",
      !noHoles && holeDiameter !== undefined
        ? `holed${formatPreciseLength(holeDiameter)}`
        : "",
    ].filter(Boolean)
    seeds.add(`smdslideswitch7_${parameters.join("_")}`)
  }

  if (analysis.smdPushButton) {
    const { padHeight, padWidth, pitchX, pitchY } = analysis.smdPushButton
    seeds.add(
      [
        "smdpushbutton4",
        `px${formatLength(pitchX)}`,
        `py${formatLength(pitchY)}`,
        `pw${formatLength(padWidth)}`,
        `ph${formatLength(padHeight)}`,
      ].join("_"),
    )
  }

  if (analysis.rj45) {
    const {
      firstPinLeft,
      firstPinTop,
      holeDiameter,
      holeX,
      holeY,
      id,
      ledPins,
      ledPitch,
      ledX,
      ledY,
      od,
      p,
      py,
      shieldId,
      shieldOd,
      shieldX,
      shieldY,
    } = analysis.rj45
    const parameters = [
      ledPins ? "ledpins" : "",
      firstPinLeft ? "firstpinleft" : "",
      firstPinTop ? "firstpintop" : "",
      `p${formatPreciseLength(p)}`,
      `py${formatPreciseLength(py)}`,
      `id${formatPreciseLength(id)}`,
      `od${formatPreciseLength(od)}`,
      `shieldx${formatPreciseLength(shieldX)}`,
      `shieldy${formatPreciseLength(shieldY)}`,
      `shieldid${formatPreciseLength(shieldId)}`,
      `shieldod${formatPreciseLength(shieldOd)}`,
      `holex${formatPreciseLength(holeX)}`,
      `holey${formatPreciseLength(holeY)}`,
      `holed${formatPreciseLength(holeDiameter)}`,
      ledPins && ledX !== undefined ? `ledx${formatPreciseLength(ledX)}` : "",
      ledPins && ledPitch !== undefined
        ? `ledp${formatPreciseLength(ledPitch)}`
        : "",
      ledPins && ledY !== undefined ? `ledy${formatPreciseLength(ledY)}` : "",
    ].filter(Boolean)
    seeds.add(`rj45_${parameters.join("_")}`)
  }
  const targetPads = getPadGeometries(target)
  const dfnCornerPads = targetPads.filter(
    ({ copper, drill, element }) =>
      element.type === "pcb_smtpad" && !drill && copper.shape === "polygon",
  )
  const dfnExposedPad = targetPads.find(
    ({ copper, drill, element }) =>
      element.type === "pcb_smtpad" && !drill && copper.shape === "rect",
  )
  if (targetPads.length === 5 && dfnCornerPads.length === 4 && dfnExposedPad) {
    const exposedPadBounds = getPadBounds(dfnExposedPad.copper)
    for (const [crossAxis, alongAxis] of [
      ["x", "y"],
      ["y", "x"],
    ] as const) {
      const crossSizeKey = crossAxis === "x" ? "width" : "height"
      const alongSizeKey = alongAxis === "x" ? "width" : "height"
      const cornerPadBounds = dfnCornerPads.map(({ copper }) =>
        getPadBounds(copper),
      )
      const padLength = median(
        cornerPadBounds.map((bounds) => bounds[crossSizeKey]),
      )
      const padWidth = median(
        cornerPadBounds.map((bounds) => bounds[alongSizeKey]),
      )
      const crossCenters = cornerPadBounds.map(
        (bounds) => (bounds.minX + bounds.maxX) / 2,
      )
      const alongCenters = cornerPadBounds.map(
        (bounds) => (bounds.minY + bounds.maxY) / 2,
      )
      const selectedCrossCenters =
        crossAxis === "x" ? crossCenters : alongCenters
      const selectedAlongCenters =
        alongAxis === "x" ? crossCenters : alongCenters
      const width =
        2 * (median(selectedCrossCenters.map(Math.abs)) + padLength / 2)
      const pitch = 2 * median(selectedAlongCenters.map(Math.abs))
      const cutLengths = dfnCornerPads.flatMap(({ copper }, index) => {
        if (copper.shape !== "polygon") return []
        const bounds = cornerPadBounds[index]!
        const centerX = (bounds.minX + bounds.maxX) / 2
        const centerY = (bounds.minY + bounds.maxY) / 2
        const crossCenter = crossAxis === "x" ? centerX : centerY
        const alongCenter = alongAxis === "x" ? centerX : centerY
        const innerCross =
          crossCenter - (Math.sign(crossCenter) * bounds[crossSizeKey]) / 2
        const innerAlong =
          alongCenter - (Math.sign(alongCenter) * bounds[alongSizeKey]) / 2
        const distances = getPolygonWorldPoints(copper)
          .flatMap((point) => [
            Math.abs(point[crossAxis] - innerCross) < 0.01
              ? Math.abs(point[alongAxis] - innerAlong)
              : undefined,
            Math.abs(point[alongAxis] - innerAlong) < 0.01
              ? Math.abs(point[crossAxis] - innerCross)
              : undefined,
          ])
          .filter(
            (distance): distance is number =>
              distance !== undefined && distance > 0.01,
          )
        return distances.length ? [Math.min(...distances)] : []
      })
      const cornerPadCut = median(cutLengths)
      if (
        !Number.isFinite(cornerPadCut) ||
        cornerPadCut <= 0 ||
        cornerPadCut > Math.min(padLength, padWidth)
      ) {
        continue
      }
      seeds.add(
        [
          "dfn4",
          `w${formatPreciseLength(width)}`,
          `p${formatPreciseLength(pitch)}`,
          `pl${formatPreciseLength(padLength)}`,
          `pw${formatPreciseLength(padWidth)}`,
          "cornerpads",
          `cornerpadcutlength${formatPreciseLength(cornerPadCut)}`,
          `thermalpad${formatPreciseLength(exposedPadBounds.width)}x${formatPreciseLength(exposedPadBounds.height)}`,
          "rounded0",
        ].join("_"),
      )
    }
  }

  const sot223Seed = getSot223Seed(target)
  if (sot223Seed) seeds.add(sot223Seed)

  if (analysis.usbCMidMount && !analysis.usbCMidMount.noHoles) {
    const {
      bottomHoleHeight,
      bottomHoleWidth,
      bottomRing,
      bottomY,
      holeDiameter,
      holeX,
      holeY,
      powerPadWidth,
      powerX,
      rowY,
      shellX,
      signalPadHeight,
      signalPadWidth,
      topHoleHeight,
      topHoleWidth,
      topRing,
      topY,
    } = analysis.usbCMidMount
    const parameters = [
      `tophw${formatPreciseLength(topHoleWidth)}`,
      `bottomhw${formatPreciseLength(bottomHoleWidth)}`,
      `tophh${formatPreciseLength(topHoleHeight)}`,
      `bottomhh${formatPreciseLength(bottomHoleHeight)}`,
      `topring${formatPreciseLength(topRing)}`,
      `bottomring${formatPreciseLength(bottomRing)}`,
      `rowy${formatPreciseLength(rowY)}`,
      `ph${formatPreciseLength(signalPadHeight)}`,
      `pw${formatPreciseLength(signalPadWidth)}`,
      `powerpw${formatPreciseLength(powerPadWidth)}`,
      `powerx${formatPreciseLength(powerX)}`,
      `shellx${formatPreciseLength(shellX)}`,
      `topy${formatPreciseLength(topY)}`,
      `bottomy${formatPreciseLength(bottomY)}`,
    ]
    if (
      holeDiameter !== undefined &&
      holeX !== undefined &&
      holeY !== undefined
    ) {
      parameters.push(
        `holex${formatPreciseLength(holeX)}`,
        `holey${formatPreciseLength(holeY)}`,
        `holed${formatPreciseLength(holeDiameter)}`,
      )
    }
    seeds.add(`usbcmidmount16_${parameters.join("_")}`)
  }

  const hasOnlyRoundPlatedHoles =
    analysis.platedHoleCount === padCount &&
    getPadGeometries(target).every(
      ({ copper, drill }) =>
        copper.shape === "circle" && drill?.shape === "circle",
    )

  if (hasOnlyRoundPlatedHoles) {
    seeds.add(`dip${padCount}_nosquareplating`)
    if (analysis.topology === "linear") {
      seeds.add(`pinrow${padCount}_nosquareplating`)
    }
  }

  if (analysis.sparsePinGrid) {
    const { columns, missingPositions, pitchX, pitchY, rows } =
      analysis.sparsePinGrid
    seeds.add(
      [
        `pinrow${padCount}`,
        `rows${rows}`,
        `cols${columns}`,
        `p${formatLength(pitchX)}`,
        `py${formatLength(pitchY)}`,
        `missing(${missingPositions.join(",")})`,
        "nosquareplating",
        `od${formatLength(analysis.heuristics.od)}`,
        `id${formatLength(analysis.heuristics.id)}`,
      ].join("_"),
    )
  }

  if (analysis.fpc) {
    const {
      bottomPadLength,
      mountingPadLength,
      mountingPadPitch,
      mountingPadRowDistance,
      mountingPadWidth,
      mountingPadsOnTop,
      padLength,
      padPitch,
      padWidth,
      pinCount,
      reverse,
      rowPitch,
      staggered,
      topPadLength,
    } = analysis.fpc
    const flags = [
      staggered ? "staggered" : "",
      reverse ? "reverse" : "",
      mountingPadsOnTop ? "mounttop" : "",
    ].filter(Boolean)
    const parameters = [
      `p${formatLength(padPitch)}`,
      `pw${formatLength(padWidth)}`,
      `pl${formatLength(padLength)}`,
      ...(staggered
        ? [
            `py${formatLength(rowPitch)}`,
            `toppl${formatLength(topPadLength)}`,
            `bottompl${formatLength(bottomPadLength)}`,
          ]
        : []),
      `mpx${formatLength(mountingPadPitch)}`,
      `mpy${formatLength(mountingPadRowDistance)}`,
      `mpw${formatLength(mountingPadWidth)}`,
      `mpl${formatLength(mountingPadLength)}`,
    ]
    seeds.add(`fpc${pinCount}_${[...flags, ...parameters].join("_")}`)
  }

  if (quadSidePinSuffix) {
    for (const family of QUAD_SIDE_PIN_FAMILIES) {
      seeds.add(`${family}${analysis.perimeterPadCount}_${quadSidePinSuffix}`)
    }
  }

  if (analysis.thermalPad && analysis.perimeterPadCount > 0) {
    // A 90-degree candidate rotation also rotates a non-square thermal pad.
    // Generate both source orientations so one remains aligned to the target.
    const thermalPadDimensionOptions = new Set([
      `${formatLength(analysis.thermalPad.width)}x${formatLength(
        analysis.thermalPad.height,
      )}`,
      `${formatLength(analysis.thermalPad.height)}x${formatLength(
        analysis.thermalPad.width,
      )}`,
    ])
    const thermalPadFamilies =
      analysis.topology === "two-sided"
        ? ["dfn", "msop", "soic", "ssop", "tssop", "vssop"]
        : ["mlp", "qfn", "quad"]
    for (const family of thermalPadFamilies) {
      const familySeed = `${family}${analysis.perimeterPadCount}${
        quadSidePinSuffix ? `_${quadSidePinSuffix}` : ""
      }`
      seeds.add(`${familySeed}_thermalpad`)
      for (const thermalPadDimensions of thermalPadDimensionOptions) {
        seeds.add(`${familySeed}_thermalpad${thermalPadDimensions}`)
      }
    }
  }

  if (analysis.topology === "grid") {
    seeds.add(`bga${padCount}_grid${analysis.gridColumns}x${analysis.gridRows}`)
  }

  if (
    analysis.topology === "four-sided" &&
    2 * (analysis.horizontalSidePadCount + analysis.verticalSidePadCount) ===
      analysis.perimeterPadCount
  ) {
    seeds.add(
      `lga${analysis.perimeterPadCount}_grid${analysis.horizontalSidePadCount}x${analysis.verticalSidePadCount}`,
    )
  }

  const hasLgaHint = target.sourceHints?.some((hint) =>
    hint.toLowerCase().includes("lga"),
  )
  if (analysis.topology === "two-sided" && hasLgaHint) {
    const padsPerSide = analysis.perimeterPadCount / 2
    if (Number.isInteger(padsPerSide)) {
      const grid =
        analysis.gridColumns <= 2 ? `${padsPerSide}x0` : `0x${padsPerSide}`
      seeds.add(`lga${analysis.perimeterPadCount}_grid${grid}`)
    }
  }

  if (analysis.topology === "two-sided" && padCount % 2 === 1) {
    for (
      let missingPosition = 1;
      missingPosition <= padCount + 1;
      missingPosition += 1
    ) {
      seeds.add(`dfn${padCount + 1}_missing(${missingPosition})`)
    }
  }

  if (padCount === 2 && analysis.platedHoleCount === 0) {
    const padBounds = getCopperShapes(target).map(getPadBounds)
    const passiveDimensions = `p${formatLength(
      analysis.heuristics.p,
    )}_pw${formatLength(
      median(padBounds.map((bound) => bound.width)),
    )}_ph${formatLength(median(padBounds.map((bound) => bound.height)))}`
    seeds.add(`res_${passiveDimensions}`)
    seeds.add(`cap_${passiveDimensions}`)
    for (const size of getFootprintSizes()) {
      seeds.add(size.imperial)
      seeds.add(`cap${size.imperial}`)
      seeds.add(`res${size.imperial}`)
    }
  }

  if (getCopperShapes(target).some((pad) => pad.shape === "pill")) {
    for (const seed of [...seeds]) {
      const pillPadSeed = `${seed}_pillpads`
      const footprint = tryBuild(pillPadSeed)
      if (
        footprint?.pads.length === padCount &&
        getCopperShapes(footprint).some((pad) => pad.shape === "pill")
      ) {
        seeds.add(pillPadSeed)
      }
    }
  }

  return [...seeds]
}

const selectSeedsToOptimize = (
  candidates: SeedCandidate[],
  analysis: TargetAnalysis,
  target: Footprint,
) => {
  const selected = new Map<string, SeedCandidate>()
  const targetPadShapeSignature = padShapeSignature(target)
  const selectedShapeFamilies = new Set<string>()

  if (analysis.thermalPad) {
    const selectedThermalPadFamilies = new Set<string>()
    for (const candidate of candidates) {
      const isQuarterTurn =
        candidate.searchRotation === 90 || candidate.searchRotation === 270
      const sourceWidth = isQuarterTurn
        ? analysis.thermalPad.height
        : analysis.thermalPad.width
      const sourceHeight = isQuarterTurn
        ? analysis.thermalPad.width
        : analysis.thermalPad.height
      const orientedThermalPadParameter = `_thermalpad${formatLength(
        sourceWidth,
      )}x${formatLength(sourceHeight)}`

      if (
        selectedThermalPadFamilies.has(candidate.family) ||
        !candidate.footprinterString.includes(orientedThermalPadParameter) ||
        padShapeSignature(candidate.footprint) !== targetPadShapeSignature
      ) {
        continue
      }
      selectedThermalPadFamilies.add(candidate.family)
      selected.set(
        `${candidate.footprinterString}:${candidate.searchRotation}`,
        candidate,
      )
    }
  }

  if (analysis.topology === "four-sided" || analysis.topology === "two-sided") {
    const lgaGridCandidate = candidates.find(
      (candidate) =>
        candidate.family === "lga" &&
        candidate.footprinterString.includes("_grid") &&
        candidate.searchRotation === 0,
    )
    if (lgaGridCandidate) {
      selected.set(
        `${lgaGridCandidate.footprinterString}:${lgaGridCandidate.searchRotation}`,
        lgaGridCandidate,
      )
    }
  }

  if (getCopperShapes(target).some((pad) => pad.shape === "pill")) {
    for (const candidate of candidates) {
      if (padShapeSignature(candidate.footprint) !== targetPadShapeSignature) {
        continue
      }
      if (selectedShapeFamilies.has(candidate.family)) continue
      selectedShapeFamilies.add(candidate.family)
      selected.set(
        `${candidate.footprinterString}:${candidate.searchRotation}`,
        candidate,
      )
      if (selected.size >= 4) break
    }
  }

  for (const candidate of candidates.slice(0, 4)) {
    selected.set(
      `${candidate.footprinterString}:${candidate.searchRotation}`,
      candidate,
    )
  }

  const preferredFamilies = getPreferredFamilies(target, analysis)
  for (const family of preferredFamilies) {
    const candidate =
      (analysis.thermalPad
        ? candidates.find(
            (entry) =>
              entry.family === family &&
              entry.footprinterString.includes("_thermalpad"),
          )
        : undefined) ??
      (family === "dfn"
        ? candidates.find(
            (entry) =>
              entry.family === family &&
              entry.footprinterString.includes("_missing("),
          )
        : undefined) ??
      (family === "lga"
        ? candidates.find(
            (entry) =>
              entry.family === family &&
              entry.footprinterString.includes("_grid"),
          )
        : undefined) ??
      candidates.find(
        (entry) =>
          entry.family === family && entry.footprinterString === family,
      ) ??
      candidates.find((entry) => entry.family === family)
    if (candidate) {
      selected.set(
        `${candidate.footprinterString}:${candidate.searchRotation}`,
        candidate,
      )
    }
    if (selected.size >= MAX_OPTIMIZED_SEEDS) break
  }

  return [...selected.values()].slice(0, MAX_OPTIMIZED_SEEDS)
}

const findActiveParameters = (
  seed: SeedCandidate,
  analysis: TargetAnalysis,
) => {
  // FPC analysis emits a complete parameterization from the repeated contact
  // and mounting-pad geometry; appending duplicate generic parameters would
  // only make the result less readable.
  if (
    seed.family === "fpc" ||
    (seed.family === "jst" &&
      (seed.footprinterString.includes("_smd") ||
        seed.footprinterString.includes("_zh")))
  ) {
    return []
  }

  const active: NumericParameter[] = []
  const baseSignature = geometrySignature(seed.footprint)
  const heuristics = getOrientedHeuristics(seed, analysis)
  const hasExplicitQuadSidePins = seed.footprinterString.includes("_leftpins")

  for (const parameter of NUMERIC_PARAMETERS) {
    if (
      (parameter === "px" || parameter === "py") &&
      !hasExplicitQuadSidePins
    ) {
      continue
    }
    const heuristic = Math.max(heuristics[parameter], 0.05)
    const footprint = tryBuild(
      buildParameterizedString(seed.footprinterString, {
        [parameter]: heuristic,
      }),
    )
    const orientedFootprint = footprint
      ? rotateFootprint(footprint, seed.searchRotation)
      : null
    if (
      orientedFootprint &&
      orientedFootprint.pads.length === seed.footprint.pads.length &&
      geometrySignature(orientedFootprint) !== baseSignature
    ) {
      active.push(parameter)
    }
  }

  return active
}

const optimizeSeed = (
  seed: SeedCandidate,
  target: Footprint,
  analysis: TargetAnalysis,
) => {
  const activeParameters = findActiveParameters(seed, analysis)
  if (!activeParameters.length) {
    return {
      ...seed,
      optimizedParameters: {} as Partial<Record<NumericParameter, number>>,
    }
  }

  const values: Partial<Record<NumericParameter, number>> = {}
  const heuristics = getOrientedHeuristics(seed, analysis)
  for (const parameter of activeParameters) {
    values[parameter] = Math.max(heuristics[parameter], 0.05)
  }

  const evaluate = (parameters: Partial<Record<NumericParameter, number>>) => {
    const footprinterString = buildParameterizedString(
      seed.footprinterString,
      parameters,
    )
    const unrotatedFootprint = tryBuild(footprinterString)
    if (!unrotatedFootprint) return null
    const footprint = rotateFootprint(unrotatedFootprint, seed.searchRotation)
    if (footprint.pads.length !== target.pads.length) {
      return null
    }
    return {
      footprinterString,
      loss: getGeometryLoss(footprint, target),
      parameters: { ...parameters },
      footprint,
    }
  }

  let current = evaluate(values)
  let best = current
  const firstMoments: Partial<Record<NumericParameter, number>> = {}
  const secondMoments: Partial<Record<NumericParameter, number>> = {}

  for (let iteration = 1; iteration <= OPTIMIZATION_STEPS; iteration += 1) {
    if (!current) break
    const gradients: Partial<Record<NumericParameter, number>> = {}

    for (const parameter of activeParameters) {
      const value = values[parameter] ?? 0.05
      const delta = Math.max(value * 0.035, 0.0125)
      const lowerValues = {
        ...values,
        [parameter]: Math.max(value - delta, 0.025),
      }
      const upperValues = { ...values, [parameter]: value + delta }
      const lower = evaluate(lowerValues)
      const upper = evaluate(upperValues)
      if (!lower || !upper) continue
      gradients[parameter] = (upper.loss - lower.loss) / (2 * delta)
    }

    for (const parameter of activeParameters) {
      const gradient = gradients[parameter]
      if (gradient === undefined || !Number.isFinite(gradient)) continue
      const firstMoment = 0.9 * (firstMoments[parameter] ?? 0) + 0.1 * gradient
      const secondMoment =
        0.999 * (secondMoments[parameter] ?? 0) + 0.001 * gradient * gradient
      firstMoments[parameter] = firstMoment
      secondMoments[parameter] = secondMoment
      const correctedFirstMoment = firstMoment / (1 - 0.9 ** iteration)
      const correctedSecondMoment = secondMoment / (1 - 0.999 ** iteration)
      const stepScale = Math.max(heuristics[parameter] * 0.075, 0.025)
      const currentValue = values[parameter] ?? 0.05
      const upperBound =
        Math.max(
          analysis.bounds.width,
          analysis.bounds.height,
          heuristics[parameter],
        ) * 3
      values[parameter] = clamp(
        currentValue -
          (stepScale * correctedFirstMoment) /
            (Math.sqrt(correctedSecondMoment) + 1e-8),
        0.025,
        Math.max(upperBound, 0.1),
      )
    }

    current = evaluate(values)
    if (current && (!best || current.loss < best.loss)) best = current
  }

  // Pitch parameters support 0.005 mm precision, so the continuous gradient
  // search above can stop next to the best representable footprint. Other
  // dimensions retain the stable 0.01 mm optimizer grid. No emitted parameter
  // uses sub-5-micrometer precision.
  if (best) {
    type EvaluatedSeed = NonNullable<ReturnType<typeof evaluate>>
    let refined: EvaluatedSeed | null = evaluate(
      Object.fromEntries(
        Object.entries(best.parameters).map(([parameter, value]) => {
          const numericParameter = parameter as NumericParameter
          return [
            numericParameter,
            roundOptimizedParameter(numericParameter, value),
          ]
        }),
      ) as Partial<Record<NumericParameter, number>>,
    )

    for (let iteration = 0; iteration < 3; iteration += 1) {
      const round = refined
      if (!round) break
      let improved = false
      for (const parameter of activeParameters) {
        const baseline = refined
        if (!baseline) break
        const currentValue = baseline.parameters[parameter] ?? 0.05
        let bestForParameter = baseline

        for (const delta of [-0.02, -0.01, 0.01, 0.02]) {
          const candidate = evaluate({
            ...baseline.parameters,
            [parameter]: Math.max(
              roundOptimizedParameter(parameter, currentValue + delta),
              0.025,
            ),
          })
          if (candidate && candidate.loss < bestForParameter.loss) {
            bestForParameter = candidate
          }
        }

        if (bestForParameter !== baseline) {
          refined = bestForParameter
          improved = true
        }
      }
      if (!improved) break
    }

    if (refined && refined.loss < best.loss) best = refined
  }

  if (!best || seed.geometryScore >= 1 / (1 + best.loss)) {
    return {
      ...seed,
      optimizedParameters: {} as Partial<Record<NumericParameter, number>>,
    }
  }

  const simplifiedParameters = Object.fromEntries(
    Object.entries(best.parameters).map(([parameter, value]) => {
      const numericParameter = parameter as NumericParameter
      return [
        numericParameter,
        roundOptimizedParameter(numericParameter, value),
      ]
    }),
  ) as Partial<Record<NumericParameter, number>>
  const bestSignature = geometrySignature(best.footprint)
  for (const parameter of activeParameters) {
    const withoutParameter = { ...simplifiedParameters }
    delete withoutParameter[parameter]
    const simplifiedFootprint = tryBuild(
      buildParameterizedString(seed.footprinterString, withoutParameter),
    )
    const orientedSimplifiedFootprint = simplifiedFootprint
      ? rotateFootprint(simplifiedFootprint, seed.searchRotation)
      : null
    if (
      orientedSimplifiedFootprint &&
      geometrySignature(orientedSimplifiedFootprint) === bestSignature
    ) {
      delete simplifiedParameters[parameter]
    }
  }
  const simplifiedString = buildParameterizedString(
    seed.footprinterString,
    simplifiedParameters,
  )
  const unrotatedSimplifiedFootprint = tryBuild(simplifiedString)
  const simplifiedFootprint = unrotatedSimplifiedFootprint
    ? rotateFootprint(unrotatedSimplifiedFootprint, seed.searchRotation)
    : best.footprint

  return {
    family: seed.family,
    footprinterString: simplifiedString,
    geometryScore: 1 / (1 + best.loss),
    optimizedParameters: simplifiedParameters,
    searchRotation: seed.searchRotation,
    footprint: simplifiedFootprint,
  }
}

export const discoverFootprinterString = (
  target: Footprint,
  maxCandidates = 5,
): FootprinterDiscoveryResult => {
  const analysis = analyzeTarget(target)
  const rawSeeds = generateSeeds(target, analysis)
  const seedCandidates = rawSeeds.flatMap((footprinterString) => {
    const baseUnrotatedFootprint = tryBuild(footprinterString)
    if (
      !baseUnrotatedFootprint ||
      baseUnrotatedFootprint.pads.length !== target.pads.length
    ) {
      return []
    }

    return FOOTPRINT_ROTATIONS.flatMap((searchRotation): SeedCandidate[] => {
      const offsetFootprinterString = addThermalPadOffsetForRotation(
        footprinterString,
        analysis.thermalPad,
        searchRotation,
      )
      const unrotatedFootprint =
        offsetFootprinterString === footprinterString
          ? baseUnrotatedFootprint
          : tryBuild(offsetFootprinterString)
      if (!unrotatedFootprint) return []
      const footprint = rotateFootprint(unrotatedFootprint, searchRotation)
      const platedHoleCount = footprint.pads.filter(
        (pad) => pad.type === "pcb_plated_hole",
      ).length
      if (platedHoleCount !== analysis.platedHoleCount) return []

      return [
        {
          family: getFamily(footprinterString),
          footprinterString: offsetFootprinterString,
          geometryScore: getGeometryScore(footprint, target),
          footprint,
          searchRotation,
        },
      ]
    })
  })
  seedCandidates.sort(
    (left, right) =>
      right.geometryScore - left.geometryScore ||
      left.searchRotation - right.searchRotation,
  )

  const selectedSeeds = selectSeedsToOptimize(seedCandidates, analysis, target)
  const optimized = selectedSeeds.map((seed) =>
    optimizeSeed(seed, target, analysis),
  )
  const allCandidates = [...optimized, ...seedCandidates]
    .map((candidate): RankedDiscoveryCandidate => {
      const { copperIntersectionOverUnion, holeIntersectionOverUnion } =
        summarizeCopperComparison(candidate.footprint, target)
      const domainScore = getDomainScore(target, candidate.family)
      return {
        copperIntersectionOverUnion,
        domainScore,
        family: candidate.family,
        footprinterString: candidate.footprinterString,
        geometryScore: candidate.geometryScore,
        holeIntersectionOverUnion,
        optimizedParameters:
          "optimizedParameters" in candidate
            ? (candidate.optimizedParameters as Partial<
                Record<NumericParameter, number>
              >)
            : {},
        footprint: candidate.footprint,
        // Package-name hints disambiguate equivalent geometry through the
        // domainScore sort tie-breaker below. They must not outrank a candidate
        // with better copper overlap.
        rankingScore:
          copperIntersectionOverUnion + (holeIntersectionOverUnion - 1) * 0.12,
        searchRotation: candidate.searchRotation,
      }
    })
    .sort(
      (left, right) =>
        right.rankingScore - left.rankingScore ||
        right.copperIntersectionOverUnion - left.copperIntersectionOverUnion ||
        right.holeIntersectionOverUnion - left.holeIntersectionOverUnion ||
        right.domainScore - left.domainScore ||
        right.geometryScore - left.geometryScore ||
        left.searchRotation - right.searchRotation ||
        left.footprinterString.length - right.footprinterString.length,
    )

  const uniqueCandidates: FootprinterDiscoveryCandidate[] = []
  const seenStrings = new Set<string>()
  const pin1PolarityModifier = getPin1PolarityModifier(target)
  for (const candidate of allCandidates) {
    const orientedString = encodeOrientationInFootprinterString(
      candidate.footprinterString,
      candidate.searchRotation,
      candidate.footprint,
    )
    if (!orientedString) continue
    const outputString =
      pin1PolarityModifier &&
      DIODE_FABRICATION_NOTE_FAMILIES.has(candidate.family)
        ? `${orientedString}_${pin1PolarityModifier}`
        : orientedString
    if (seenStrings.has(outputString)) continue
    seenStrings.add(outputString)
    const {
      footprint: _footprint,
      searchRotation: _searchRotation,
      ...publicData
    } = candidate
    uniqueCandidates.push({
      ...publicData,
      footprinterString: outputString,
    })
    if (uniqueCandidates.length >= clamp(maxCandidates, 1, 10)) break
  }

  return {
    best: uniqueCandidates[0] ?? null,
    candidates: uniqueCandidates,
    diagnostics: {
      evaluatedSeeds: rawSeeds.length,
      optimizedSeeds: selectedSeeds.length,
      targetPadCount: target.pads.length,
      topology: analysis.topology,
    },
    target,
  }
}
