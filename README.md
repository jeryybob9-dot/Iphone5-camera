# iPhone 5 Camera

A web app that turns any photo into one that looks like it came off a 2012 iPhone 5.
Pick a photo, choose a look, and save it back to your camera roll. Everything runs in the
browser on your phone. Nothing is uploaded.

## Using it on iPhone

1. Open the GitHub Pages link in Safari.
2. Tap **Share → Add to Home Screen** so it opens full screen like an app (it also works offline after the first visit).
3. Tap **Choose a photo**, pick a look, then **Save photo → Save to Photos**.

On the photo, tap anywhere to put the purple flare there. Press and hold to compare with the original.

## What it reproduces

| iPhone 5 trait | How it's recreated |
| --- | --- |
| Small 8 MP sensor with little dynamic range | Center-weighted auto exposure, hard highlight clipping, and regional contrast that undoes modern HDR flattening |
| Noise reduction plus sharpening | Softened detail with unsharp-mask halos |
| Warm, yellow-leaning colour | Warm white balance, greens pushed toward yellow, blues toward cyan, highlights that clip to white |
| The famous purple flare | Violet haze and beam from light at the edge of the frame, green and purple lens ghosts, purple fringing on edges against bright sky |
| Lens shading | Vignette and a little lateral chromatic aberration |
| Sensor noise | Clumpy luma grain plus colour blotches in the shadows |
| 2012 JPEGs | A real JPEG round trip at adjustable quality |

Saved photos are 3264 × 2448, the iPhone 5's native size (2448 × 2448 for square). With
**Show as iPhone 5 in Photos** on, the file carries iPhone 5 camera details (4.13 mm f/2.4,
33 mm equivalent) and keeps the original photo's date. Location is never written.

Looks: **Classic**, **Sunny** (more bloom and flare), **Cloudy** (muted, white skies),
**Night** (heavy noise, glowing lights), **Flash** (hard on-camera LED falloff).

## Publishing with GitHub Pages

1. In the repository on GitHub, go to **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Choose the branch that has these files and the **/ (root)** folder, then **Save**.
4. After a minute the site is live at `https://<your-username>.github.io/Iphone5-camera/`.

## Files

- `index.html`, `css/style.css`: the page
- `js/engine.js`: the image processing (canvas, no libraries)
- `js/exif.js`: reads the original date, writes the iPhone 5 metadata
- `js/app.js`: interface, preview, saving
- `sw.js`, `manifest.webmanifest`, `icons/`: home screen app and offline support
