export type LandmarkName =
  | "nose"
  | "leftEar"
  | "rightEar"
  | "leftShoulder"
  | "rightShoulder"
  | "leftHip"
  | "rightHip";

export interface Point {
  x: number;
  y: number;
  visibility: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface Pose {
  image: Record<LandmarkName, Point>;
  world: Record<LandmarkName, Point3D>;
}

export type MetricId = "forwardHead" | "slouch" | "headDown";
export type Reading = Partial<Record<MetricId, number>>;

export const METRIC_IDS: MetricId[] = ["forwardHead", "slouch", "headDown"];

export const METRICS: Record<MetricId, { label: string; min: number; max: number; initial: number }> = {
  forwardHead: { label: "Forward head", min: 3, max: 40, initial: 12 },
  slouch: { label: "Slouch (needs hips in view)", min: 3, max: 40, initial: 10 },
  headDown: { label: "Head down (neck flexion)", min: 3, max: 40, initial: 15 },
};

export const MIN_VISIBILITY = 0.5;

const RAD_TO_DEG = 180 / Math.PI;

interface Horizontal {
  x: number;
  z: number;
}

function mid(a: Point3D, b: Point3D): Point3D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
}

function ahead(from: Point3D, to: Point3D, direction: Horizontal): number {
  return (to.x - from.x) * direction.x + (to.z - from.z) * direction.z;
}

function facing(world: Pose["world"]): Horizontal {
  const axisX = world.rightShoulder.x - world.leftShoulder.x;
  const axisZ = world.rightShoulder.z - world.leftShoulder.z;
  const length = Math.hypot(axisX, axisZ);
  const forward = { x: -axisZ / length, z: axisX / length };
  const noseIsAhead = ahead(mid(world.leftEar, world.rightEar), world.nose, forward) >= 0;
  return noseIsAhead ? forward : { x: -forward.x, z: -forward.z };
}

function leanAngle(upper: Point3D, lower: Point3D, direction: Horizontal): number {
  return Math.atan2(ahead(lower, upper, direction), lower.y - upper.y) * RAD_TO_DEG;
}

export function canSee(pose: Pose): boolean {
  const { leftEar, rightEar, leftShoulder, rightShoulder } = pose.image;
  const left = Math.min(leftEar.visibility, leftShoulder.visibility);
  const right = Math.min(rightEar.visibility, rightShoulder.visibility);
  return Math.max(left, right) >= MIN_VISIBILITY;
}

export function measure(pose: Pose): Reading {
  const { world, image } = pose;
  const direction = facing(world);
  const ear = mid(world.leftEar, world.rightEar);
  const shoulder = mid(world.leftShoulder, world.rightShoulder);
  const reading: Reading = {
    forwardHead: leanAngle(ear, shoulder, direction),
    headDown: Math.atan2(world.nose.y - ear.y, ahead(ear, world.nose, direction)) * RAD_TO_DEG,
  };
  if (Math.min(image.leftHip.visibility, image.rightHip.visibility) >= MIN_VISIBILITY) {
    reading.slouch = leanAngle(shoulder, mid(world.leftHip, world.rightHip), direction);
  }
  return reading;
}
