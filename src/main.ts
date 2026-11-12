import type { PoseLandmarker } from "@mediapipe/tasks-vision";
import { Beeper, SlouchAlarm } from "./alarm";
import { deviation, measure, thresholdRange, units, type Mode, type Pose } from "./metrics";
import { createLandmarker, toPose } from "./pose";

const HOLD_MS = 3000;
const REPEAT_MS = 5000;
const SMOOTHING = 0.2;
const MIN_VISIBILITY = 0.5;
const STORAGE_KEY = "posture-guard:v1";

interface Settings {
  mode: Mode;
  thresholds: Record<Mode, number>;
  baselines: Partial<Record<Mode, number>>;
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`missing element #${id}`);
  return element as T;
}

const video = byId<HTMLVideoElement>("video");
const overlay = byId<HTMLCanvasElement>("overlay");
const status = byId<HTMLDivElement>("status");
const startButton = byId<HTMLButtonElement>("start");
const calibrateButton = byId<HTMLButtonElement>("calibrate");
const modeSelect = byId<HTMLSelectElement>("mode");
const thresholdInput = byId<HTMLInputElement>("threshold");
const thresholdValue = byId<HTMLOutputElement>("thresholdValue");
const currentOutput = byId<HTMLOutputElement>("current");
const baselineOutput = byId<HTMLOutputElement>("baseline");
const slouchOutput = byId<HTMLOutputElement>("slouch");
const context = overlay.getContext("2d");

function loadSettings(): Settings {
  const defaults: Settings = {
    mode: "side",
    thresholds: { side: thresholdRange.side.initial, front: thresholdRange.front.initial },
    baselines: {},
  };
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? { ...defaults, ...(JSON.parse(stored) as Partial<Settings>) } : defaults;
  } catch {
    return defaults;
  }
}

function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable, settings last for this session only
  }
}

const settings = loadSettings();
const beeper = new Beeper();
const alarm = new SlouchAlarm(beeper, HOLD_MS, REPEAT_MS);
let landmarker: PoseLandmarker | undefined;
let smoothed: number | undefined;
let lastVideoTime = -1;

function setStatus(text: string, kind: "idle" | "good" | "bad"): void {
  status.textContent = text;
  status.className = `status ${kind}`;
}

function formatValue(mode: Mode, value: number | undefined): string {
  if (value === undefined) return "-";
  return mode === "side" ? `${value.toFixed(1)}°` : value.toFixed(2);
}

function syncControls(): void {
  const range = thresholdRange[settings.mode];
  modeSelect.value = settings.mode;
  thresholdInput.min = String(range.min);
  thresholdInput.max = String(range.max);
  thresholdInput.value = String(settings.thresholds[settings.mode]);
  thresholdValue.textContent = `${settings.thresholds[settings.mode]}${units[settings.mode]}`;
  baselineOutput.textContent = formatValue(settings.mode, settings.baselines[settings.mode]);
}

function isVisible(mode: Mode, pose: Pose): boolean {
  const left = Math.min(pose.leftEar.visibility, pose.leftShoulder.visibility);
  const right = Math.min(pose.rightEar.visibility, pose.rightShoulder.visibility);
  return mode === "side" ? Math.max(left, right) >= MIN_VISIBILITY : Math.min(left, right) >= MIN_VISIBILITY;
}

function draw(pose: Pose | undefined, bad: boolean): void {
  if (!context) return;
  overlay.width = video.videoWidth;
  overlay.height = video.videoHeight;
  context.clearRect(0, 0, overlay.width, overlay.height);
  if (!pose) return;
  const color = bad ? "#d64545" : "#3ddc84";
  const at = (p: { x: number; y: number }) => [p.x * overlay.width, p.y * overlay.height] as const;
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 4;
  for (const [ear, shoulder] of [
    [pose.leftEar, pose.leftShoulder],
    [pose.rightEar, pose.rightShoulder],
  ] as const) {
    context.beginPath();
    context.moveTo(...at(ear));
    context.lineTo(...at(shoulder));
    context.stroke();
  }
  context.beginPath();
  context.moveTo(...at(pose.leftShoulder));
  context.lineTo(...at(pose.rightShoulder));
  context.stroke();
  for (const p of [pose.leftEar, pose.rightEar, pose.leftShoulder, pose.rightShoulder]) {
    context.beginPath();
    context.arc(...at(p), 7, 0, Math.PI * 2);
    context.fill();
  }
}

function tick(): void {
  requestAnimationFrame(tick);
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const result = landmarker.detectForVideo(video, performance.now());
  const pose = result.landmarks[0] && toPose(result.landmarks[0]);
  const mode = settings.mode;

  if (!pose || !isVisible(mode, pose)) {
    alarm.update(false, performance.now());
    draw(undefined, false);
    smoothed = undefined;
    currentOutput.textContent = "-";
    slouchOutput.textContent = "-";
    setStatus("Can't see you clearly", "idle");
    return;
  }

  const raw = measure(mode, pose, { width: video.videoWidth, height: video.videoHeight });
  smoothed = smoothed === undefined ? raw : smoothed + SMOOTHING * (raw - smoothed);
  currentOutput.textContent = formatValue(mode, smoothed);

  const baseline = settings.baselines[mode];
  if (baseline === undefined) {
    draw(pose, false);
    setStatus("Sit straight, then press Calibrate", "idle");
    return;
  }

  const slouch = deviation(mode, baseline, smoothed);
  slouchOutput.textContent = `${slouch.toFixed(1)}${units[mode]}`;
  const bad = slouch > settings.thresholds[mode];
  const alarming = alarm.update(bad, performance.now());
  draw(pose, bad);
  setStatus(alarming ? "Sit up!" : bad ? "Slouching..." : "Good posture", bad ? "bad" : "good");
}

async function start(): Promise<void> {
  startButton.disabled = true;
  setStatus("Loading model...", "idle");
  beeper.unlock();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    video.srcObject = stream;
    await video.play();
    landmarker = await createLandmarker();
    calibrateButton.disabled = false;
    await navigator.wakeLock?.request("screen").catch(() => undefined);
    setStatus("Sit straight, then press Calibrate", "idle");
  } catch (error) {
    startButton.disabled = false;
    setStatus(error instanceof Error ? error.message : "Could not start", "bad");
  }
}

startButton.addEventListener("click", () => void start());

calibrateButton.addEventListener("click", () => {
  if (smoothed === undefined) return;
  settings.baselines[settings.mode] = smoothed;
  saveSettings();
  syncControls();
});

modeSelect.addEventListener("change", () => {
  settings.mode = modeSelect.value as Mode;
  smoothed = undefined;
  saveSettings();
  syncControls();
});

thresholdInput.addEventListener("input", () => {
  settings.thresholds[settings.mode] = Number(thresholdInput.value);
  saveSettings();
  syncControls();
});

syncControls();
requestAnimationFrame(tick);
