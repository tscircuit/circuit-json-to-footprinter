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

const SEARCH_GRID_SIZE = 112
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

interface TargetAnalysis {
  bounds: Bounds
  fpc?: FpcAnalysis
  gridColumns: number
  gridRows: number
  heuristics: Record<NumericParameter, number>
  horizontalSidePadCount: number
  lgaPadLength: number
  lgaPadWidth: number
  perimeterPadCount: number
  platedHoleCount: number
  quadSidePadCounts: QuadSidePadCounts
  sparsePinGrid?: SparsePinGridAnalysis
  usbCMidMount?: UsbCMidMountAnalysis
  thermalPad?: {
    height: number
    width: number
  }
  topology: Topology
  verticalSidePadCount: number
}

interface QuadSidePadCounts {
  left: number
  top: number
  right: number
  bottom: number
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

  return {
    bounds,
    fpc: analyzeFpc(target),
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
    quadSidePadCounts,
    sparsePinGrid,
    thermalPad: thermalPadEntry
      ? {
          height: thermalPadEntry.bound.height,
          width: thermalPadEntry.bound.width,
        }
      : undefined,
    topology,
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
    dfn: ["dfn"],
    fpc: ["fpc", "ffc", "flat flexible"],
    lga: ["lga"],
    qfn: ["qfn"],
    res: ["resistor", "res"],
    soic: ["soic", "so-"],
    ssop: ["ssop"],
    tssop: ["tssop"],
    usbcmidmount: ["usb-c", "usb c", "type-c", "type c", "usbc"],
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

const roundToTenMicrometers = (value: number) =>
  Number((Math.round(value * 100) / 100).toFixed(2))

export const formatLength = (value: number) => {
  const millimeters = roundToTenMicrometers(value)
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
    return value === undefined ? [] : [`${parameter}${formatLength(value)}`]
  }).join("_")
  return suffix ? `${seed}_${suffix}` : seed
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

const getPreferredFamilies = (analysis: TargetAnalysis) => {
  if (analysis.fpc) return new Set(["fpc"])
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

const generateSeeds = (target: Footprint, analysis: TargetAnalysis) => {
  const padCount = target.pads.length
  const seeds = new Set<string>()
  const quadSidePinSuffix = getQuadSidePinSuffix(analysis)

  for (const family of getFootprintNames()) {
    seeds.add(`${family}${padCount}`)
    // Mid-mount USB-C variants are named by their explicit 16-pin form.
    if (family !== "usbcmidmount") seeds.add(family)
  }

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

  const preferredFamilies = getPreferredFamilies(analysis)
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
  if (seed.family === "fpc") return []

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

  if (!best || seed.geometryScore >= 1 / (1 + best.loss)) {
    return {
      ...seed,
      optimizedParameters: {} as Partial<Record<NumericParameter, number>>,
    }
  }

  const simplifiedParameters = Object.fromEntries(
    Object.entries(best.parameters).map(([parameter, value]) => [
      parameter,
      roundToTenMicrometers(value),
    ]),
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
    const unrotatedFootprint = tryBuild(footprinterString)
    if (
      !unrotatedFootprint ||
      unrotatedFootprint.pads.length !== target.pads.length
    ) {
      return []
    }

    return FOOTPRINT_ROTATIONS.flatMap((searchRotation): SeedCandidate[] => {
      const footprint = rotateFootprint(unrotatedFootprint, searchRotation)
      const platedHoleCount = footprint.pads.filter(
        (pad) => pad.type === "pcb_plated_hole",
      ).length
      if (platedHoleCount !== analysis.platedHoleCount) return []

      return [
        {
          family: getFamily(footprinterString),
          footprinterString,
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
        summarizeCopperComparison(candidate.footprint, target, SEARCH_GRID_SIZE)
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
  for (const candidate of allCandidates) {
    const orientedString = encodeOrientationInFootprinterString(
      candidate.footprinterString,
      candidate.searchRotation,
      candidate.footprint,
    )
    if (!orientedString || seenStrings.has(orientedString)) continue
    seenStrings.add(orientedString)
    const {
      footprint: _footprint,
      searchRotation: _searchRotation,
      ...publicData
    } = candidate
    uniqueCandidates.push({
      ...publicData,
      footprinterString: orientedString,
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
