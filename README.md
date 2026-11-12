# Posture Guard

Browser slouch detector. Static app, no backend. The camera video stays on your device.

MediaPipe Pose finds ear and shoulder landmarks. You calibrate a good posture once, then it beeps when you slouch for 3 seconds.

- Side view (recommended): angle of the ear-shoulder line from vertical. A phone on a stand works, open the page on it.
- Front view (webcam): ear-to-shoulder height relative to shoulder width. Less accurate.

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
