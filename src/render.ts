import { PoseLandmarker, type NormalizedLandmark } from "@mediapipe/tasks-vision";

export interface SilhouetteMask {
  width: number;
  height: number;
  values: Float32Array;
}

export interface Scene {
  landmarks?: NormalizedLandmark[];
  mask?: SilhouetteMask;
  bad: boolean;
}

type Part = "head" | "torso" | "leftArm" | "rightArm" | "leftLeg" | "rightLeg";

const COLORS: Record<Part, string> = {
  head: "#f5c542",
  torso: "#4ecdc4",
  leftArm: "#7aa2ff",
  rightArm: "#c58bff",
  leftLeg: "#5fd38d",
  rightLeg: "#ffa94d",
};

const BAD_COLOR = "#ff4d4d";
const SILHOUETTE_RGB = [58, 71, 92] as const;
const MIN_VISIBILITY = 0.5;
const LEFT_EAR = 7;
const RIGHT_EAR = 8;
const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;

const maskCanvas = document.createElement("canvas");

function partOf(index: number): Part {
  if (index <= 10) return "head";
  switch (index) {
    case 11:
    case 12:
    case 23:
    case 24:
      return "torso";
    case 13:
    case 15:
    case 17:
    case 19:
    case 21:
      return "leftArm";
    case 14:
    case 16:
    case 18:
    case 20:
    case 22:
      return "rightArm";
    case 25:
    case 27:
    case 29:
    case 31:
      return "leftLeg";
    default:
      return "rightLeg";
  }
}

function connectionPart(start: number, end: number): Part {
  const first = partOf(start);
  return first === "torso" ? partOf(end) : first;
}

function drawMask(context: CanvasRenderingContext2D, target: HTMLCanvasElement, mask: SilhouetteMask): void {
  if (maskCanvas.width !== mask.width || maskCanvas.height !== mask.height) {
    maskCanvas.width = mask.width;
    maskCanvas.height = mask.height;
  }
  const maskContext = maskCanvas.getContext("2d");
  if (!maskContext) return;
  const image = maskContext.createImageData(mask.width, mask.height);
  const [red, green, blue] = SILHOUETTE_RGB;
  for (let i = 0; i < mask.values.length; i++) {
    const offset = i * 4;
    image.data[offset] = red;
    image.data[offset + 1] = green;
    image.data[offset + 2] = blue;
    image.data[offset + 3] = Math.round((mask.values[i] ?? 0) * 255);
  }
  maskContext.putImageData(image, 0, 0);
  context.drawImage(maskCanvas, 0, 0, target.width, target.height);
}

function drawSkeleton(
  context: CanvasRenderingContext2D,
  target: HTMLCanvasElement,
  landmarks: NormalizedLandmark[],
  bad: boolean,
): void {
  const visible = (index: number) => {
    const landmark = landmarks[index];
    return landmark && (landmark.visibility ?? 0) >= MIN_VISIBILITY ? landmark : undefined;
  };
  const colorOf = (part: Part) => (bad && (part === "head" || part === "torso") ? BAD_COLOR : COLORS[part]);
  const line = (start: number, end: number, part: Part) => {
    const from = visible(start);
    const to = visible(end);
    if (!from || !to) return;
    context.strokeStyle = colorOf(part);
    context.beginPath();
    context.moveTo(from.x * target.width, from.y * target.height);
    context.lineTo(to.x * target.width, to.y * target.height);
    context.stroke();
  };

  context.lineWidth = 6;
  context.lineCap = "round";
  for (const { start, end } of PoseLandmarker.POSE_CONNECTIONS) {
    line(start, end, connectionPart(start, end));
  }
  line(LEFT_EAR, LEFT_SHOULDER, "head");
  line(RIGHT_EAR, RIGHT_SHOULDER, "head");

  landmarks.forEach((landmark, index) => {
    if (!visible(index)) return;
    context.fillStyle = colorOf(partOf(index));
    context.beginPath();
    context.arc(landmark.x * target.width, landmark.y * target.height, 6, 0, Math.PI * 2);
    context.fill();
  });
}

export function render(context: CanvasRenderingContext2D, target: HTMLCanvasElement, scene: Scene): void {
  context.clearRect(0, 0, target.width, target.height);
  if (scene.mask) drawMask(context, target, scene.mask);
  if (scene.landmarks) drawSkeleton(context, target, scene.landmarks, scene.bad);
}
