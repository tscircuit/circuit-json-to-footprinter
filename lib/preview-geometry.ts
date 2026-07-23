import {
  getBoundsFromPoints,
  type Bounds as MathBounds,
  type Point,
} from "@tscircuit/math-utils"
import type { PreviewPad } from "./circuit-json-preview.js"

export type PreviewShape = Pick<
  PreviewPad,
  | "cornerRadius"
  | "height"
  | "points"
  | "rotation"
  | "shape"
  | "width"
  | "x"
  | "y"
>

export interface Bounds extends MathBounds {
  height: number
  width: number
}

export const toRadians = (degrees: number) => (degrees * Math.PI) / 180

export const rotatePoint = (x: number, y: number, radians: number) => ({
  x: x * Math.cos(radians) - y * Math.sin(radians),
  y: x * Math.sin(radians) + y * Math.cos(radians),
})

const getSizedBounds = (points: readonly Point[]): Bounds => {
  const bounds = getBoundsFromPoints([...points])
  if (!bounds) {
    throw new Error("Cannot calculate bounds for an empty point list")
  }

  return {
    ...bounds,
    height: bounds.maxY - bounds.minY,
    width: bounds.maxX - bounds.minX,
  }
}

export const getPolygonArea = (points: readonly Point[]) => {
  let doubledArea = 0
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const next = points[(index + 1) % points.length]
    doubledArea += current.x * next.y - next.x * current.y
  }
  return Math.abs(doubledArea) / 2
}

export const getPolygonWorldPoints = (shape: PreviewShape): Point[] => {
  if (shape.shape !== "polygon" || !shape.points) {
    throw new Error("Polygon preview shapes require points")
  }
  const radians = toRadians(shape.rotation)
  return shape.points.map((point) => {
    const rotated = rotatePoint(point.x, point.y, radians)
    return { x: rotated.x + shape.x, y: rotated.y + shape.y }
  })
}

export const getShapeBounds = (shape: PreviewShape): Bounds => {
  if (shape.shape === "polygon") {
    if (!shape.points || shape.points.length < 3) {
      throw new Error("Polygon preview shapes require at least three points")
    }
    return getSizedBounds(getPolygonWorldPoints(shape))
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
  return getSizedBounds(corners)
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
  return getSizedBounds(
    bounds.flatMap((bound) => [
      { x: bound.minX, y: bound.minY },
      { x: bound.maxX, y: bound.maxY },
    ]),
  )
}
