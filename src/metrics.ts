export type Mode = "angled" | "side" | "front";

export interface Point {
  x: number;
  y: number;
  visibility: number;
}

export interface Frame {
  width: number;
  height: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface WorldPose {
  leftEar: Point3D;
  rightEar: Point3D;
  leftShoulder: Point3D;
  rightShoulder: Point3D;
}

export interface Pose {
  leftEar: Point;
  rightEar: Point;
  leftShoulder: Point;
  rightShoulder: Point;
  world: WorldPose;
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

export function angledAngle(world: WorldPose): number {
  const mid = (a: Point3D, b: Point3D): Point3D => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
  });
  const ear = mid(world.leftEar, world.rightEar);
  const shoulder = mid(world.leftShoulder, world.rightShoulder);
  const axisX = world.rightShoulder.x - world.leftShoulder.x;
  const axisZ = world.rightShoulder.z - world.leftShoulder.z;
  const axisLength = Math.hypot(axisX, axisZ);
  const forward = Math.abs(((ear.x - shoulder.x) * -axisZ + (ear.z - shoulder.z) * axisX) / axisLength);
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
    case "angled":
      return angledAngle(pose.world);
    case "side":
      return sideAngle(pose, frame);
    case "front":
      return frontRatio(pose, frame);
  }
}

export function deviation(mode: Mode, baseline: number, current: number): number {
  switch (mode) {
    case "angled":
    case "side":
      return current - baseline;
    case "front":
      return ((baseline - current) / baseline) * 100;
  }
}

export const units: Record<Mode, string> = { angled: "°", side: "°", front: "%" };

export const thresholdRange: Record<Mode, { min: number; max: number; initial: number }> = {
  angled: { min: 5, max: 40, initial: 15 },
  side: { min: 5, max: 40, initial: 15 },
  front: { min: 5, max: 50, initial: 20 },
};
