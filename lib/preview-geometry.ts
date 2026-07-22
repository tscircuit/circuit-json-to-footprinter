import type { PreviewPoint, PreviewShape } from "./circuit-json-preview.js"

export interface Bounds {
  height: number
  maxX: number
  maxY: number
  minX: number
  minY: number
  width: number
}

export const toRadians = (degrees: number) => (degrees * Math.PI) / 180

export const rotatePoint = (x: number, y: number, radians: number) => ({
  x: x * Math.cos(radians) - y * Math.sin(radians),
  y: x * Math.sin(radians) + y * Math.cos(radians),
})

export const getPointBounds = (points: readonly PreviewPoint[]): Bounds => {
  if (points.length === 0) {
    throw new Error("Cannot calculate bounds for an empty point list")
  }

  let minX = points[0].x
  let maxX = points[0].x
  let minY = points[0].y
  let maxY = points[0].y
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  return {
    height: maxY - minY,
    maxX,
    maxY,
    minX,
    minY,
    width: maxX - minX,
  }
}

export const getPolygonArea = (points: readonly PreviewPoint[]) => {
  let doubledArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    doubledArea += current.x * next.y - next.x * current.y
  }
  return Math.abs(doubledArea) / 2
}

type PreviewPolygonShape = Extract<PreviewShape, { shape: "polygon" }>

export const getPolygonWorldPoints = (
  shape: PreviewPolygonShape,
): PreviewPoint[] => {
  const radians = toRadians(shape.rotation)
  return shape.points.map((point) => {
    const rotated = rotatePoint(point.x, point.y, radians)
    return { x: rotated.x + shape.x, y: rotated.y + shape.y }
  })
}

export const getShapeBounds = (shape: PreviewShape): Bounds => {
  if (shape.shape === "polygon") {
    if (shape.points.length < 3) {
      throw new Error("Polygon preview shapes require at least three points")
    }
    return getPointBounds(getPolygonWorldPoints(shape))
  }

  const halfWidth = shape.width / 2
  const halfHeight = shape.height / 2
  const radians = toRadians(shape.rotation)
  const corners = [
    rotatePoint(-halfWidth, -halfHeight, radians),
    rotatePoint(halfWidth, -halfHeight, radians),
    rotatePoint(halfWidth, halfHeight, radians),
    rotatePoint(-halfWidth, halfHeight, radians),
  ].map((corner) => ({
    x: corner.x + shape.x,
    y: corner.y + shape.y,
  }))
  return getPointBounds(corners)
}

export const getFootprintBounds = (shapes: readonly PreviewShape[]): Bounds => {
  if (shapes.length === 0) {
    return {
      height: 1,
      maxX: 0.5,
      maxY: 0.5,
      minX: -0.5,
      minY: -0.5,
      width: 1,
    }
  }

  const bounds = shapes.map(getShapeBounds)
  const minX = Math.min(...bounds.map((bound) => bound.minX))
  const minY = Math.min(...bounds.map((bound) => bound.minY))
  const maxX = Math.max(...bounds.map((bound) => bound.maxX))
  const maxY = Math.max(...bounds.map((bound) => bound.maxY))

  return {
    height: maxY - minY,
    maxX,
    maxY,
    minX,
    minY,
    width: maxX - minX,
  }
}
