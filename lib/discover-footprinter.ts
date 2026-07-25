import { getFootprintNames, getFootprintSizes } from "@tscircuit/footprinter"
import {
  type FootprintPreview,
  footprinterStringToPreview,
  type PreviewPad,
} from "./circuit-json-preview.js"
import { summarizeCopperComparison } from "./compare-copper.js"
import {
  type Bounds,
  getFootprintBounds,
  getPolygonWorldPoints,
} from "./preview-geometry.js"

const SEARCH_GRID_SIZE = 112
const MAX_OPTIMIZED_SEEDS = 10
const OPTIMIZATION_STEPS = 16
const NUMERIC_PARAMETERS = [
  "p",
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
  thermalPad?: {
    height: number
    width: number
  }
  topology: Topology
  verticalSidePadCount: number
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

interface SeedCandidate {
  family: string
  footprinterString: string
  geometryScore: number
  searchRotation: FootprintRotation
  preview: FootprintPreview
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
  preview: FootprintPreview
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
  target: FootprintPreview
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

const getPadBounds = (pad: PreviewPad): Bounds => getFootprintBounds([pad])

const getBounds = (pads: PreviewPad[]): Bounds => getFootprintBounds(pads)

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

const getPitchEstimate = (pads: PreviewPad[], tolerance: number) => {
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
  target: FootprintPreview,
  alongAxis: "x" | "y",
): FpcAnalysis | undefined => {
  const acrossAxis = alongAxis === "x" ? "y" : "x"
  if (
    target.pads.length < 4 ||
    target.pads.some(
      (pad) =>
        pad.kind !== "smt" ||
        pad.hole ||
        (pad.shape !== "rect" && pad.shape !== "pill"),
    )
  ) {
    return undefined
  }

  const entries = target.pads.map((pad) => {
    const bounds = getPadBounds(pad)
    const alongSize = alongAxis === "x" ? bounds.width : bounds.height
    const acrossSize = alongAxis === "x" ? bounds.height : bounds.width
    return {
      across: pad[acrossAxis],
      acrossSize,
      along: pad[alongAxis],
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

const analyzeFpc = (target: FootprintPreview) =>
  analyzeFpcAxis(target, "x") ?? analyzeFpcAxis(target, "y")

const analyzeTarget = (target: FootprintPreview): TargetAnalysis => {
  const bounds = getBounds(target.pads)
  const padBounds = target.pads.map(getPadBounds)
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
  const thermalPadEntry = target.pads
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
    ? target.pads.filter((pad) => pad !== thermalPadEntry.pad)
    : target.pads
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
  const leftSidePadCount = topologyPadEntries.filter(
    ({ bounds: bound, pad }) =>
      Math.abs(pad.x - minPadCenterX) <= edgeToleranceX &&
      bound.width >= bound.height * 0.95,
  ).length
  const rightSidePadCount = topologyPadEntries.filter(
    ({ bounds: bound, pad }) =>
      Math.abs(pad.x - maxPadCenterX) <= edgeToleranceX &&
      bound.width >= bound.height * 0.95,
  ).length
  const bottomSidePadCount = topologyPadEntries.filter(
    ({ bounds: bound, pad }) =>
      Math.abs(pad.y - minPadCenterY) <= edgeToleranceY &&
      bound.height >= bound.width * 0.95,
  ).length
  const topSidePadCount = topologyPadEntries.filter(
    ({ bounds: bound, pad }) =>
      Math.abs(pad.y - maxPadCenterY) <= edgeToleranceY &&
      bound.height >= bound.width * 0.95,
  ).length
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

  const pitch = getPitchEstimate(target.pads, tolerance)
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
    target.pads.flatMap((pad) =>
      pad.hole ? [Math.sqrt(pad.hole.width * pad.hole.height)] : [],
    ),
  )
  const platedHoleCount = target.pads.filter(
    (pad) => pad.kind === "plated-hole",
  ).length
  const insetQuadAdjustment = topology === "four-sided" ? 0.2 : 0

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
      pw: medianPadShortSide,
      w: bounds.width + insetQuadAdjustment,
    },
    horizontalSidePadCount: Math.max(leftSidePadCount, rightSidePadCount),
    lgaPadLength: leftRightEdgePads.length
      ? median(leftRightEdgePads.map(({ bounds: bound }) => bound.width))
      : median(topBottomEdgePads.map(({ bounds: bound }) => bound.height)),
    lgaPadWidth: leftRightEdgePads.length
      ? median(leftRightEdgePads.map(({ bounds: bound }) => bound.height))
      : median(topBottomEdgePads.map(({ bounds: bound }) => bound.width)),
    perimeterPadCount: sidePads.length,
    platedHoleCount,
    thermalPad: thermalPadEntry
      ? {
          height: thermalPadEntry.bound.height,
          width: thermalPadEntry.bound.width,
        }
      : undefined,
    topology,
    verticalSidePadCount: Math.max(bottomSidePadCount, topSidePadCount),
  }
}

const normalizePads = (pads: PreviewPad[]) => {
  const bounds = getBounds(pads)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2
  return pads.map((pad) => ({
    ...pad,
    x: pad.x - centerX,
    y: pad.y - centerY,
  }))
}

const rotateFootprint = (
  footprint: FootprintPreview,
  rotation: FootprintRotation,
): FootprintPreview => {
  if (rotation === 0) return footprint
  const radians = (rotation * Math.PI) / 180
  return {
    ...footprint,
    pads: footprint.pads.map((pad) => ({
      ...pad,
      hole: pad.hole
        ? {
            ...pad.hole,
            offsetX:
              pad.hole.offsetX * Math.cos(radians) -
              pad.hole.offsetY * Math.sin(radians),
            offsetY:
              pad.hole.offsetX * Math.sin(radians) +
              pad.hole.offsetY * Math.cos(radians),
            rotation: (pad.hole.rotation + rotation) % 360,
          }
        : undefined,
      rotation: (pad.rotation + rotation) % 360,
      x: pad.x * Math.cos(radians) - pad.y * Math.sin(radians),
      y: pad.x * Math.sin(radians) + pad.y * Math.cos(radians),
    })),
  }
}

const getOrientedPadSize = (pad: PreviewPad) => {
  const bounds = getPadBounds({ ...pad, x: 0, y: 0 })
  return { height: bounds.height, width: bounds.width }
}

const matchPadsByPosition = (left: PreviewPad[], right: PreviewPad[]) => {
  const availableRight = new Set(right.map((_, index) => index))
  return left.map((leftPad) => {
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (const rightIndex of availableRight) {
      const rightPad = right[rightIndex]
      const distance = Math.hypot(
        leftPad.x - rightPad.x,
        leftPad.y - rightPad.y,
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

const getGeometryLoss = (
  candidate: FootprintPreview,
  target: FootprintPreview,
) => {
  if (candidate.pads.length !== target.pads.length) return 1_000

  const candidatePads = normalizePads(candidate.pads)
  const targetPads = normalizePads(target.pads)
  const targetBounds = getBounds(targetPads)
  const positionScale = Math.max(
    Math.hypot(targetBounds.width, targetBounds.height),
    0.1,
  )
  const pairs = matchPadsByPosition(candidatePads, targetPads)
  let loss = 0

  for (const [candidatePad, targetPad] of pairs) {
    const candidateSize = getOrientedPadSize(candidatePad)
    const targetSize = getOrientedPadSize(targetPad)
    const dx = (candidatePad.x - targetPad.x) / positionScale
    const dy = (candidatePad.y - targetPad.y) / positionScale
    const dw =
      (candidateSize.width - targetSize.width) /
      Math.max(targetSize.width, 0.05)
    const dh =
      (candidateSize.height - targetSize.height) /
      Math.max(targetSize.height, 0.05)

    loss += dx * dx * 4 + dy * dy * 4 + dw * dw + dh * dh
    if (candidatePad.kind !== targetPad.kind) loss += 4
    if (candidatePad.shape !== targetPad.shape) loss += 0.08
    if (Boolean(candidatePad.hole) !== Boolean(targetPad.hole)) {
      loss += 4
    } else if (candidatePad.hole && targetPad.hole) {
      const holeWidthScale = Math.max(targetPad.hole.width, 0.05)
      const holeHeightScale = Math.max(targetPad.hole.height, 0.05)
      const holeWidthDifference =
        (candidatePad.hole.width - targetPad.hole.width) / holeWidthScale
      const holeHeightDifference =
        (candidatePad.hole.height - targetPad.hole.height) / holeHeightScale
      const holeOffsetXDifference =
        (candidatePad.hole.offsetX - targetPad.hole.offsetX) / positionScale
      const holeOffsetYDifference =
        (candidatePad.hole.offsetY - targetPad.hole.offsetY) / positionScale

      loss +=
        holeWidthDifference * holeWidthDifference +
        holeHeightDifference * holeHeightDifference +
        holeOffsetXDifference * holeOffsetXDifference * 4 +
        holeOffsetYDifference * holeOffsetYDifference * 4
      if (candidatePad.hole.shape !== targetPad.hole.shape) loss += 0.08
    }
    if (
      targetPad.portHints.length > 0 &&
      !candidatePad.portHints.some((hint) => targetPad.portHints.includes(hint))
    ) {
      loss += 0.04
    }
  }

  return loss / pairs.length
}

const getGeometryScore = (
  candidate: FootprintPreview,
  target: FootprintPreview,
) => 1 / (1 + getGeometryLoss(candidate, target))

const getDomainScore = (target: FootprintPreview, family: string) => {
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
    return footprinterStringToPreview(footprinterString)
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

const geometrySignature = (preview: FootprintPreview) =>
  preview.pads
    .map((pad) => {
      const holeSignature = pad.hole
        ? [
            pad.hole.shape,
            pad.hole.offsetX,
            pad.hole.offsetY,
            pad.hole.width,
            pad.hole.height,
            pad.hole.rotation,
          ].join(":")
        : "no-hole"
      const pointSignature =
        pad.shape === "polygon"
          ? pad.points?.map((point) => `${point.x}:${point.y}`).join(",")
          : "no-points"
      return [
        pad.kind,
        pad.shape,
        pad.x,
        pad.y,
        pad.width,
        pad.height,
        pad.rotation,
        pointSignature,
        holeSignature,
      ]
        .map(String)
        .join(":")
    })
    .join("|")

const padShapeSignature = (preview: FootprintPreview) =>
  preview.pads
    .map((pad) => `${pad.kind}:${pad.shape}`)
    .toSorted()
    .join("|")

const areClose = (left: number, right: number) =>
  Math.abs(left - right) <= 0.00001

const areSamePoint = (
  left: { x: number; y: number },
  right: { x: number; y: number },
) => areClose(left.x, right.x) && areClose(left.y, right.y)

const haveSamePolygon = (left: PreviewPad, right: PreviewPad) => {
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

const haveSameOrientedPads = (
  left: FootprintPreview,
  right: FootprintPreview,
) => {
  if (left.pads.length !== right.pads.length) return false

  return left.pads.every((leftPad, index) => {
    const rightPad = right.pads[index]
    if (!rightPad) return false
    const leftSize = getOrientedPadSize(leftPad)
    const rightSize = getOrientedPadSize(rightPad)
    const holesMatch =
      !leftPad.hole && !rightPad.hole
        ? true
        : Boolean(leftPad.hole && rightPad.hole) &&
          leftPad.hole?.shape === rightPad.hole?.shape &&
          areClose(leftPad.hole?.offsetX ?? 0, rightPad.hole?.offsetX ?? 0) &&
          areClose(leftPad.hole?.offsetY ?? 0, rightPad.hole?.offsetY ?? 0) &&
          areClose(leftPad.hole?.width ?? 0, rightPad.hole?.width ?? 0) &&
          areClose(leftPad.hole?.height ?? 0, rightPad.hole?.height ?? 0) &&
          // Rotation has no geometric meaning for a circular drill.
          (leftPad.hole?.shape === "circle" ||
            areClose(leftPad.hole?.rotation ?? 0, rightPad.hole?.rotation ?? 0))
    return (
      leftPad.kind === rightPad.kind &&
      leftPad.shape === rightPad.shape &&
      leftPad.portHints.join("|") === rightPad.portHints.join("|") &&
      areClose(leftPad.x, rightPad.x) &&
      areClose(leftPad.y, rightPad.y) &&
      areClose(leftSize.width, rightSize.width) &&
      areClose(leftSize.height, rightSize.height) &&
      haveSamePolygon(leftPad, rightPad) &&
      holesMatch
    )
  })
}

const encodeOrientationInFootprinterString = (
  footprinterString: string,
  searchRotation: FootprintRotation,
  orientedPreview: FootprintPreview,
) => {
  if (searchRotation === 0) return footprinterString

  for (const [side, alignment] of PIN1_LOCATIONS) {
    const orientedString = `${footprinterString}_pin1location(${side},${alignment})`
    const preview = tryBuild(orientedString)
    if (preview && haveSameOrientedPads(preview, orientedPreview)) {
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

const generateSeeds = (target: FootprintPreview, analysis: TargetAnalysis) => {
  const padCount = target.pads.length
  const seeds = new Set<string>()

  for (const family of getFootprintNames()) {
    seeds.add(`${family}${padCount}`)
    // Mid-mount USB-C variants are named by their explicit 16-pin form.
    if (family !== "usbcmidmount") seeds.add(family)
  }

  if (
    analysis.platedHoleCount === padCount &&
    target.pads.every(
      (pad) => pad.shape === "circle" && pad.hole?.shape === "circle",
    )
  ) {
    seeds.add(`dip${padCount}_nosquareplating`)
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
      seeds.add(`${family}${analysis.perimeterPadCount}_thermalpad`)
      for (const thermalPadDimensions of thermalPadDimensionOptions) {
        seeds.add(
          `${family}${analysis.perimeterPadCount}_thermalpad${thermalPadDimensions}`,
        )
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
    const padBounds = target.pads.map(getPadBounds)
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

  if (target.pads.some((pad) => pad.shape === "pill")) {
    for (const seed of [...seeds]) {
      const pillPadSeed = `${seed}_pillpads`
      const preview = tryBuild(pillPadSeed)
      if (
        preview?.pads.length === padCount &&
        preview.pads.some((pad) => pad.shape === "pill")
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
  target: FootprintPreview,
) => {
  const selected = new Map<string, SeedCandidate>()
  const targetPadShapeSignature = padShapeSignature(target)
  const selectedShapeFamilies = new Set<string>()

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

  if (target.pads.some((pad) => pad.shape === "pill")) {
    for (const candidate of candidates) {
      if (padShapeSignature(candidate.preview) !== targetPadShapeSignature) {
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
  const baseSignature = geometrySignature(seed.preview)
  const heuristics = getOrientedHeuristics(seed, analysis)

  for (const parameter of NUMERIC_PARAMETERS) {
    const heuristic = Math.max(heuristics[parameter], 0.05)
    const preview = tryBuild(
      buildParameterizedString(seed.footprinterString, {
        [parameter]: heuristic,
      }),
    )
    const orientedPreview = preview
      ? rotateFootprint(preview, seed.searchRotation)
      : null
    if (
      orientedPreview &&
      orientedPreview.pads.length === seed.preview.pads.length &&
      geometrySignature(orientedPreview) !== baseSignature
    ) {
      active.push(parameter)
    }
  }

  return active
}

const optimizeSeed = (
  seed: SeedCandidate,
  target: FootprintPreview,
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
    const unrotatedPreview = tryBuild(footprinterString)
    if (!unrotatedPreview) return null
    const preview = rotateFootprint(unrotatedPreview, seed.searchRotation)
    if (preview.pads.length !== target.pads.length) {
      return null
    }
    return {
      footprinterString,
      loss: getGeometryLoss(preview, target),
      parameters: { ...parameters },
      preview,
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
  const bestSignature = geometrySignature(best.preview)
  for (const parameter of activeParameters) {
    const withoutParameter = { ...simplifiedParameters }
    delete withoutParameter[parameter]
    const simplifiedPreview = tryBuild(
      buildParameterizedString(seed.footprinterString, withoutParameter),
    )
    const orientedSimplifiedPreview = simplifiedPreview
      ? rotateFootprint(simplifiedPreview, seed.searchRotation)
      : null
    if (
      orientedSimplifiedPreview &&
      geometrySignature(orientedSimplifiedPreview) === bestSignature
    ) {
      delete simplifiedParameters[parameter]
    }
  }
  const simplifiedString = buildParameterizedString(
    seed.footprinterString,
    simplifiedParameters,
  )
  const unrotatedSimplifiedPreview = tryBuild(simplifiedString)
  const simplifiedPreview = unrotatedSimplifiedPreview
    ? rotateFootprint(unrotatedSimplifiedPreview, seed.searchRotation)
    : best.preview

  return {
    family: seed.family,
    footprinterString: simplifiedString,
    geometryScore: 1 / (1 + best.loss),
    optimizedParameters: simplifiedParameters,
    searchRotation: seed.searchRotation,
    preview: simplifiedPreview,
  }
}

export const discoverFootprinterString = (
  target: FootprintPreview,
  maxCandidates = 5,
): FootprinterDiscoveryResult => {
  const analysis = analyzeTarget(target)
  const rawSeeds = generateSeeds(target, analysis)
  const seedCandidates = rawSeeds.flatMap((footprinterString) => {
    const unrotatedPreview = tryBuild(footprinterString)
    if (
      !unrotatedPreview ||
      unrotatedPreview.pads.length !== target.pads.length
    ) {
      return []
    }

    return FOOTPRINT_ROTATIONS.flatMap((searchRotation): SeedCandidate[] => {
      const preview = rotateFootprint(unrotatedPreview, searchRotation)
      const platedHoleCount = preview.pads.filter(
        (pad) => pad.kind === "plated-hole",
      ).length
      if (platedHoleCount !== analysis.platedHoleCount) return []

      return [
        {
          family: getFamily(footprinterString),
          footprinterString,
          geometryScore: getGeometryScore(preview, target),
          preview,
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
  const targetPadShapeSignature = padShapeSignature(target)
  const allCandidates = [...optimized, ...seedCandidates]
    .map((candidate): RankedDiscoveryCandidate => {
      const { copperIntersectionOverUnion, holeIntersectionOverUnion } =
        summarizeCopperComparison(candidate.preview, target, SEARCH_GRID_SIZE)
      const domainScore = getDomainScore(target, candidate.family)
      const shapesMatch =
        padShapeSignature(candidate.preview) === targetPadShapeSignature
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
        preview: candidate.preview,
        // Package-name hints can disambiguate equivalent geometry, but should
        // not outrank a shape-exact candidate.
        rankingScore:
          copperIntersectionOverUnion +
          (holeIntersectionOverUnion - 1) * 0.12 +
          domainScore * (shapesMatch ? 0.08 : 0.01),
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
      candidate.preview,
    )
    if (!orientedString || seenStrings.has(orientedString)) continue
    seenStrings.add(orientedString)
    const {
      preview: _preview,
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
