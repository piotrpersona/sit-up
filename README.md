# Sit Up (Posture Guard)

Browser slouch detector. Static app, no backend. The camera video stays on your device.

MediaPipe Pose finds ear and shoulder landmarks. You calibrate a good posture once, then it beeps when you slouch for 3 seconds.

Three separate checks, each with its own threshold, all from MediaPipe 3D landmarks so the camera can sit at any angle from the side to about 45°:

- Forward head: how far the ear sits in front of the shoulders.
- Slouch: how far the shoulders sit in front of the hips. Needs the hips in view, otherwise it is skipped.
- Head down (neck flexion): the angle of the ear-to-nose line, grows when the chin tucks or you look down.

All values are compared to your calibrated baseline, so calibrate from the camera position you will actually use.

By default the camera picture is hidden. The stage shows a black background, your body silhouette and a skeleton colored by body part (head, torso, each arm, each leg). Tick "Show camera picture" to see the real video instead.

Keep the tab visible, browsers throttle hidden tabs.

## Run

```
npm install
npm run dev
npm test
npm run build
```

## Deploy

Push to `main`. The workflow in `.github/workflows/deploy.yml` builds and publishes to GitHub Pages. Enable it once in the repo settings: Pages, Source: GitHub Actions.
