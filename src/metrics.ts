export type Mode = "side" | "front";

export interface Point {
  x: number;
  y: number;
  visibility: number;
}

export interface Frame {
  width: number;
  height: number;
}

export interface Pose {
  leftEar: Point;
  rightEar: Point;
  leftShoulder: Point;
  rightShoulder: Point;
}

const RAD_TO_DEG = 180 / Math.PI;

function toPixels(p: Point, frame: Frame): Point {
  return { x: p.x * frame.width, y: p.y * frame.height, visibility: p.visibility };
}

export function sideAngle(pose: Pose, frame: Frame): number {
  const useLeft = pose.leftEar.visibility + pose.leftShoulder.visibility >=
    pose.rightEar.visibility + pose.rightShoulder.visibility;
  const ear = toPixels(useLeft ? pose.leftEar : pose.rightEar, frame);
  const shoulder = toPixels(useLeft ? pose.leftShoulder : pose.rightShoulder, frame);
  const forward = Math.abs(ear.x - shoulder.x);
  const up = shoulder.y - ear.y;
  return Math.atan2(forward, up) * RAD_TO_DEG;
}

export function frontRatio(pose: Pose, frame: Frame): number {
  const leftEar = toPixels(pose.leftEar, frame);
  const rightEar = toPixels(pose.rightEar, frame);
  const leftShoulder = toPixels(pose.leftShoulder, frame);
  const rightShoulder = toPixels(pose.rightShoulder, frame);
  const earY = (leftEar.y + rightEar.y) / 2;
  const shoulderY = (leftShoulder.y + rightShoulder.y) / 2;
  const shoulderWidth = Math.hypot(leftShoulder.x - rightShoulder.x, leftShoulder.y - rightShoulder.y);
  return (shoulderY - earY) / shoulderWidth;
}

export function measure(mode: Mode, pose: Pose, frame: Frame): number {
  switch (mode) {
    case "side":
      return sideAngle(pose, frame);
    case "front":
      return frontRatio(pose, frame);
  }
}

export function deviation(mode: Mode, baseline: number, current: number): number {
  switch (mode) {
    case "side":
      return current - baseline;
    case "front":
      return ((baseline - current) / baseline) * 100;
  }
}

export const units: Record<Mode, string> = { side: "°", front: "%" };

export const thresholdRange: Record<Mode, { min: number; max: number; initial: number }> = {
  side: { min: 5, max: 40, initial: 15 },
  front: { min: 5, max: 50, initial: 20 },
};
