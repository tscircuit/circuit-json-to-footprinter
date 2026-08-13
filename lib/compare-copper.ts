import {
  getManifoldModule,
  type CrossSection as ManifoldCrossSection,
  type SimplePolygon,
} from "@tscircuit/manifold-2d"
import { getBoundsCenter, isPointInsidePolygon } from "@tscircuit/math-utils"
import type { Point } from "circuit-json"
import type { Footprint } from "./footprint.js"
import {
  type Bounds,
  getShapeListBounds,
  getTransformedPcbHoleGeometry,
  getTransformedPcbPadGeometry,
  getTransformedPcbViaGeometry,
  type PcbPadGeometry,
  rotatePoint,
  type ShapeGeometry,
  toRadians,
} from "./footprint-geometry.js"

export type { Bounds } from "./footprint-geometry.js"
export { getFootprintBounds } from "./footprint-geometry.js"

const DEFAULT_GRID_SIZE = 320
const CURVE_SEGMENTS = 64
const MANIFOLD_COORDINATE_SCALE = 1_000_000
const { CrossSection } = await getManifoldModule()

export interface PinMismatchDetail {
  leftPadIndex: number | null
  leftPinNumbers: number[]
  leftPortHints: string[]
  rightPadIndex: number | null
  rightPinNumbers: number[]
  rightPortHints: string[]
}

export interface PinComparisonSummary {
  pinMatchRate: number
  pinMismatches: PinMismatchDetail[]
  pinsMatch: boolean
}

export interface CopperComparisonSummary extends PinComparisonSummary {
  copperIntersectionOverUnion: number
  holeIntersectionOverUnion: number
}

/**
 * Comparison metrics are calculated with Manifold boolean operations. The
 * raster fields are retained for the Fast Footprint Compare heatmap.
 */
export interface RasterComparison extends PinComparisonSummary {
  coverageLeft: number
  coverageRight: number
  gridSize: number
  iou: number
  leftOnlyRatio: number
  normalizedLeft: Footprint
  normalizedRight: Footprint
  occupancy: Uint8Array
  padCountMatch: boolean
  rightOnlyRatio: number
}

interface BooleanShapeComparison {
  coverageLeft: number
  coverageRight: number
  iou: number
  leftOnlyRatio: number
  rightOnlyRatio: number
}

const addPadding = (bounds: Bounds): Bounds => {
  const padX = Math.max(bounds.width * 0.18, 0.65)
  const padY = Math.max(bounds.height * 0.18, 0.65)

  return {
    height: bounds.height + padY * 2,
    maxX: bounds.maxX + padX,
    maxY: bounds.maxY + padY,
    minX: bounds.minX - padX,
    minY: bounds.minY - padY,
    width: bounds.width + padX * 2,
  }
}

const translateFootprint = (
  footprint: Footprint,
  deltaX: number,
  deltaY: number,
): Footprint => {
  return {
    holes: footprint.holes,
    pads: footprint.pads,
    rotation: footprint.rotation,
    sourceHints: footprint.sourceHints,
    subtitle: footprint.subtitle,
    title: footprint.title,
    vias: footprint.vias,
    x: (footprint.x ?? 0) + deltaX,
    y: (footprint.y ?? 0) + deltaY,
  }
}

const centerFootprint = (footprint: Footprint): Footprint => {
  const bounds = getShapeListBounds(getCopperShapes(footprint))
  const center = getBoundsCenter(bounds)
  return translateFootprint(footprint, -center.x, -center.y)
}

const getCopperShapes = (footprint: Footprint): ShapeGeometry[] => [
  ...footprint.pads.map(
    (pad) => getTransformedPcbPadGeometry(pad, footprint).copper,
  ),
  ...footprint.vias.map(
    (via) => getTransformedPcbViaGeometry(via, footprint).copper,
  ),
]

const getHoleShapes = (footprint: Footprint): ShapeGeometry[] => [
  ...footprint.pads.flatMap((pad) => {
    const drill = getTransformedPcbPadGeometry(pad, footprint).drill
    return drill ? [drill] : []
  }),
  ...footprint.holes.map((hole) =>
    getTransformedPcbHoleGeometry(hole, footprint),
  ),
  ...footprint.vias.map(
    (via) => getTransformedPcbViaGeometry(via, footprint).drill,
  ),
]

interface IndexedPadGeometry extends PcbPadGeometry {
  padIndex: number
}

const getIndexedPadGeometries = (footprint: Footprint): IndexedPadGeometry[] =>
  footprint.pads.map((pad, padIndex) => ({
    ...getTransformedPcbPadGeometry(pad, footprint),
    padIndex,
  }))

const getNumericPinNumbers = (pad: IndexedPadGeometry | null) => [
  ...new Set(
    (pad?.element.port_hints ?? []).flatMap((hint) => {
      const match = hint.trim().match(/^(?:pin)?(\d+)$/i)
      return match?.[1] ? [Number.parseInt(match[1], 10)] : []
    }),
  ),
]

const matchPadsByPosition = (
  leftPads: IndexedPadGeometry[],
  rightPads: IndexedPadGeometry[],
) => {
  const availableRight = new Set(rightPads.map((_, index) => index))
  const pairs: Array<
    readonly [IndexedPadGeometry | null, IndexedPadGeometry | null]
  > = []

  for (const leftPad of leftPads) {
    let bestIndex = -1
    let bestDistance = Number.POSITIVE_INFINITY
    for (const rightIndex of availableRight) {
      const rightPad = rightPads[rightIndex]
      const distance = Math.hypot(
        leftPad.copper.x - rightPad.copper.x,
        leftPad.copper.y - rightPad.copper.y,
      )
      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = rightIndex
      }
    }

    if (bestIndex === -1) {
      pairs.push([leftPad, null])
      continue
    }
    availableRight.delete(bestIndex)
    pairs.push([leftPad, rightPads[bestIndex]])
  }

  for (const rightIndex of availableRight) {
    pairs.push([null, rightPads[rightIndex]])
  }
  return pairs
}

const comparePinHints = (
  left: Footprint,
  right: Footprint,
): PinComparisonSummary => {
  const pairs = matchPadsByPosition(
    getIndexedPadGeometries(left),
    getIndexedPadGeometries(right),
  )
  const pinMismatches: PinMismatchDetail[] = []
  let comparedPinCount = 0
  let matchedPinCount = 0

  for (const [leftPad, rightPad] of pairs) {
    const leftPinNumbers = getNumericPinNumbers(leftPad)
    const rightPinNumbers = getNumericPinNumbers(rightPad)
    if (leftPinNumbers.length === 0 && rightPinNumbers.length === 0) continue

    comparedPinCount += 1
    if (
      leftPinNumbers.some((pinNumber) => rightPinNumbers.includes(pinNumber))
    ) {
      matchedPinCount += 1
      continue
    }

    pinMismatches.push({
      leftPadIndex: leftPad?.padIndex ?? null,
      leftPinNumbers,
      leftPortHints: leftPad?.element.port_hints ?? [],
      rightPadIndex: rightPad?.padIndex ?? null,
      rightPinNumbers,
      rightPortHints: rightPad?.element.port_hints ?? [],
    })
  }

  return {
    pinMatchRate:
      comparedPinCount === 0 ? 1 : matchedPinCount / comparedPinCount,
    pinMismatches,
    pinsMatch: pinMismatches.length === 0,
  }
}

const pointInShape = (x: number, y: number, shape: ShapeGeometry) => {
  const dx = x - shape.x
  const dy = y - shape.y
  const local = rotatePoint(dx, dy, -toRadians(shape.rotation))
  const halfWidth = shape.width / 2
  const halfHeight = shape.height / 2

  if (shape.shape === "polygon") {
    if (!shape.points || shape.points.length < 3) {
      throw new Error("Polygon footprint shapes require at least three points")
    }
    return isPointInsidePolygon(local, shape.points)
  }

  if (shape.shape === "circle") {
    return Math.hypot(local.x, local.y) <= Math.min(halfWidth, halfHeight)
  }

  if (shape.shape === "ellipse") {
    if (halfWidth === 0 || halfHeight === 0) return false
    return (
      (local.x * local.x) / (halfWidth * halfWidth) +
        (local.y * local.y) / (halfHeight * halfHeight) <=
      1
    )
  }

  if (shape.shape === "rect") {
    const cornerRadius = Math.max(
      0,
      Math.min(shape.cornerRadius ?? 0, halfWidth, halfHeight),
    )

    if (cornerRadius === 0) {
      return Math.abs(local.x) <= halfWidth && Math.abs(local.y) <= halfHeight
    }

    const absX = Math.abs(local.x)
    const absY = Math.abs(local.y)
    const innerHalfWidth = halfWidth - cornerRadius
    const innerHalfHeight = halfHeight - cornerRadius

    if (absX <= innerHalfWidth && absY <= halfHeight) return true
    if (absX <= halfWidth && absY <= innerHalfHeight) return true

    const cornerDx = absX - innerHalfWidth
    const cornerDy = absY - innerHalfHeight

    return (
      cornerDx >= 0 &&
      cornerDy >= 0 &&
      cornerDx * cornerDx + cornerDy * cornerDy <= cornerRadius * cornerRadius
    )
  }

  if (shape.width >= shape.height) {
    const capsuleLength = halfWidth - halfHeight
    if (Math.abs(local.x) <= capsuleLength && Math.abs(local.y) <= halfHeight) {
      return true
    }

    return (
      Math.hypot(local.x - capsuleLength, local.y) <= halfHeight ||
      Math.hypot(local.x + capsuleLength, local.y) <= halfHeight
    )
  }

  const capsuleLength = halfHeight - halfWidth
  if (Math.abs(local.y) <= capsuleLength && Math.abs(local.x) <= halfWidth) {
    return true
  }

  return (
    Math.hypot(local.x, local.y - capsuleLength) <= halfWidth ||
    Math.hypot(local.x, local.y + capsuleLength) <= halfWidth
  )
}

const mergeBounds = (left: Bounds, right: Bounds): Bounds => {
  const minX = Math.min(left.minX, right.minX)
  const minY = Math.min(left.minY, right.minY)
  const maxX = Math.max(left.maxX, right.maxX)
  const maxY = Math.max(left.maxY, right.maxY)

  return {
    height: maxY - minY,
    maxX,
    maxY,
    minX,
    minY,
    width: maxX - minX,
  }
}

const getComparisonBounds = (
  left: readonly ShapeGeometry[],
  right: readonly ShapeGeometry[],
) => {
  if (!left.length) return addPadding(getShapeListBounds(right))
  if (!right.length) return addPadding(getShapeListBounds(left))
  return addPadding(
    mergeBounds(getShapeListBounds(left), getShapeListBounds(right)),
  )
}

const rasterizeOccupancy = (
  left: readonly ShapeGeometry[],
  right: readonly ShapeGeometry[],
  gridSize: number,
) => {
  const bounds = getComparisonBounds(left, right)
  const cellWidth = bounds.width / gridSize
  const cellHeight = bounds.height / gridSize
  const occupancy = new Uint8Array(gridSize * gridSize)

  for (let row = 0; row < gridSize; row += 1) {
    const sampleY = bounds.maxY - (row + 0.5) * cellHeight

    for (let column = 0; column < gridSize; column += 1) {
      const sampleX = bounds.minX + (column + 0.5) * cellWidth
      const inLeft = left.some((shape) => pointInShape(sampleX, sampleY, shape))
      const inRight = right.some((shape) =>
        pointInShape(sampleX, sampleY, shape),
      )
      const index = row * gridSize + column
      occupancy[index] = inLeft && inRight ? 3 : inLeft ? 1 : inRight ? 2 : 0
    }
  }

  return occupancy
}

const getEllipsePoints = (halfWidth: number, halfHeight: number): Point[] =>
  Array.from({ length: CURVE_SEGMENTS }, (_, index) => {
    const angle = (index / CURVE_SEGMENTS) * Math.PI * 2
    return {
      x: Math.cos(angle) * halfWidth,
      y: Math.sin(angle) * halfHeight,
    }
  })

const getRoundedRectPoints = (
  halfWidth: number,
  halfHeight: number,
  requestedRadius: number,
): Point[] => {
  const radius = Math.max(0, Math.min(requestedRadius, halfWidth, halfHeight))
  if (radius === 0) {
    return [
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
    ]
  }

  const segmentsPerCorner = CURVE_SEGMENTS / 4
  const corners = [
    {
      startAngle: -Math.PI / 2,
      x: halfWidth - radius,
      y: -halfHeight + radius,
    },
    { startAngle: 0, x: halfWidth - radius, y: halfHeight - radius },
    { startAngle: Math.PI / 2, x: -halfWidth + radius, y: halfHeight - radius },
    { startAngle: Math.PI, x: -halfWidth + radius, y: -halfHeight + radius },
  ]

  return corners.flatMap((corner) =>
    Array.from({ length: segmentsPerCorner }, (_, index) => {
      const angle =
        corner.startAngle + (index / segmentsPerCorner) * (Math.PI / 2)
      return {
        x: corner.x + Math.cos(angle) * radius,
        y: corner.y + Math.sin(angle) * radius,
      }
    }),
  )
}

const getShapeLocalPoints = (shape: ShapeGeometry): Point[] => {
  if (shape.width <= 0 || shape.height <= 0) return []

  if (shape.shape === "polygon") {
    if (!shape.points || shape.points.length < 3) {
      throw new Error("Polygon footprint shapes require at least three points")
    }
    return shape.points
  }

  const halfWidth = shape.width / 2
  const halfHeight = shape.height / 2
  if (shape.shape === "circle") {
    const radius = Math.min(halfWidth, halfHeight)
    return getEllipsePoints(radius, radius)
  }
  if (shape.shape === "ellipse") {
    return getEllipsePoints(halfWidth, halfHeight)
  }

  const cornerRadius =
    shape.shape === "pill"
      ? Math.min(halfWidth, halfHeight)
      : (shape.cornerRadius ?? 0)
  return getRoundedRectPoints(halfWidth, halfHeight, cornerRadius)
}

const getSignedArea = (polygon: SimplePolygon) => {
  let doubledArea = 0
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]
    const next = polygon[(index + 1) % polygon.length]
    doubledArea += current[0] * next[1] - next[0] * current[1]
  }
  return doubledArea / 2
}

const shapeToManifoldPolygon = (shape: ShapeGeometry): SimplePolygon => {
  const radians = toRadians(shape.rotation)
  const polygon: SimplePolygon = []

  for (const point of getShapeLocalPoints(shape)) {
    const rotated = rotatePoint(point.x, point.y, radians)
    const scaledPoint: [number, number] = [
      Math.round((rotated.x + shape.x) * MANIFOLD_COORDINATE_SCALE),
      Math.round((rotated.y + shape.y) * MANIFOLD_COORDINATE_SCALE),
    ]
    const previous = polygon[polygon.length - 1]
    if (
      !previous ||
      previous[0] !== scaledPoint[0] ||
      previous[1] !== scaledPoint[1]
    ) {
      polygon.push(scaledPoint)
    }
  }

  const first = polygon[0]
  const last = polygon[polygon.length - 1]
  if (first && last && first[0] === last[0] && first[1] === last[1]) {
    polygon.pop()
  }
  if (polygon.length < 3 || Math.abs(getSignedArea(polygon)) < 1) return []
  return getSignedArea(polygon) < 0 ? polygon.reverse() : polygon
}

const createCrossSection = (
  shapes: readonly ShapeGeometry[],
): ManifoldCrossSection | null => {
  const polygons = shapes
    .map(shapeToManifoldPolygon)
    .filter((polygon) => polygon.length >= 3)
  return polygons.length === 0
    ? null
    : CrossSection.ofPolygons(polygons, "Positive")
}

const clampRatio = (ratio: number) => Math.max(0, Math.min(1, ratio))

const compareShapesWithManifold = (
  left: readonly ShapeGeometry[],
  right: readonly ShapeGeometry[],
): BooleanShapeComparison => {
  let leftSection: ManifoldCrossSection | null = null
  let rightSection: ManifoldCrossSection | null = null
  let intersection: ManifoldCrossSection | null = null

  try {
    leftSection = createCrossSection(left)
    rightSection = createCrossSection(right)
    const leftArea = Math.abs(leftSection?.area() ?? 0)
    const rightArea = Math.abs(rightSection?.area() ?? 0)

    if (leftSection && rightSection) {
      intersection = leftSection.intersect(rightSection)
    }
    const intersectionArea = Math.min(
      Math.abs(intersection?.area() ?? 0),
      leftArea,
      rightArea,
    )
    const unionArea = Math.max(leftArea + rightArea - intersectionArea, 0)

    return {
      coverageLeft:
        leftArea === 0 ? 0 : clampRatio(intersectionArea / leftArea),
      coverageRight:
        rightArea === 0 ? 0 : clampRatio(intersectionArea / rightArea),
      iou: unionArea === 0 ? 0 : clampRatio(intersectionArea / unionArea),
      leftOnlyRatio:
        unionArea === 0
          ? 0
          : clampRatio((leftArea - intersectionArea) / unionArea),
      rightOnlyRatio:
        unionArea === 0
          ? 0
          : clampRatio((rightArea - intersectionArea) / unionArea),
    }
  } finally {
    intersection?.delete()
    leftSection?.delete()
    rightSection?.delete()
  }
}

const compareNormalizedFootprints = (left: Footprint, right: Footprint) => {
  const normalizedLeft = centerFootprint(left)
  const normalizedRight = centerFootprint(right)
  const leftCopper = getCopperShapes(normalizedLeft)
  const rightCopper = getCopperShapes(normalizedRight)
  const comparison = compareShapesWithManifold(leftCopper, rightCopper)
  const pinComparison = comparePinHints(normalizedLeft, normalizedRight)

  return {
    comparison,
    leftCopper,
    normalizedLeft,
    normalizedRight,
    pinComparison,
    rightCopper,
  }
}

export const compareFootprints = (
  left: Footprint,
  right: Footprint,
  gridSize = DEFAULT_GRID_SIZE,
): RasterComparison => {
  const {
    comparison,
    leftCopper,
    normalizedLeft,
    normalizedRight,
    pinComparison,
    rightCopper,
  } = compareNormalizedFootprints(left, right)

  return {
    coverageLeft: comparison.coverageLeft,
    coverageRight: comparison.coverageRight,
    gridSize,
    iou: comparison.iou,
    leftOnlyRatio: comparison.leftOnlyRatio,
    normalizedLeft,
    normalizedRight,
    occupancy: rasterizeOccupancy(leftCopper, rightCopper, gridSize),
    padCountMatch: normalizedLeft.pads.length === normalizedRight.pads.length,
    ...pinComparison,
    rightOnlyRatio: comparison.rightOnlyRatio,
  }
}

export const summarizeCopperComparison = (
  left: Footprint,
  right: Footprint,
  _gridSize = DEFAULT_GRID_SIZE,
): CopperComparisonSummary => {
  const { comparison, normalizedLeft, normalizedRight, pinComparison } =
    compareNormalizedFootprints(left, right)
  const leftHoles = getHoleShapes(normalizedLeft)
  const rightHoles = getHoleShapes(normalizedRight)
  const holeIntersectionOverUnion =
    leftHoles.length === 0 && rightHoles.length === 0
      ? 1
      : compareShapesWithManifold(leftHoles, rightHoles).iou

  return {
    copperIntersectionOverUnion: comparison.iou,
    holeIntersectionOverUnion,
    ...pinComparison,
  }
}
