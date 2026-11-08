# Bridge Load Test

An offline field app for bridge live-load tests with BDI strain gauges and deflection transducers.
It runs in Safari on an iPad (or any browser) and needs no internet once it is installed.

- Imports BDI STS-Live **.tdms** files directly, one file per pass. No Excel add-in step.
- Gauge map keyed by BDI serial number: span, girder, section, top/bottom, transverse offset. Sort and group by any of these. Mark bad gauges, or record a swapped gauge with **Replaces**.
- Linear drift zeroing between the first and last readings.
- Truck position from the marks recorded in the file (first mark position plus spacing, or a list of mark positions). Without marks, enter or tap the times the truck enters and leaves the bridge.
- Strain/stress/deflection plotted against time or truck position. Drag to zoom, tap to read values.
- Load distribution for each vehicle: bottom-flange strains at one section (girder bridges), or equivalent strip width (slab bridges).
- Load vehicles with axle spacing, weights, track width and tire width, with a drawn diagram.
- Load paths drawn on the bridge cross-section.
- Field log: time-stamped notes, **Pass start/end** buttons, and photos with a required tag.
- One-tap Word (.docx) report with figures, tables, field log and photographs.
- Backup and restore of a whole test (data and photos) as a single file.

All data stays on the device (browser storage). The web page holds only the app code.

## Put it on GitHub Pages (one time)

1. Sign in at github.com and click **New repository**. Name it, for example `loadtest`, and make it **Public** (GitHub Pages is free for public repositories; your test data is never uploaded).
2. On the new repository page, click **uploading an existing file**. Drag in **everything inside this folder** (`index.html`, `styles.css`, `sw.js`, `manifest.webmanifest`, and the `js`, `vendor` and `icons` folders), then click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
4. After a minute the page shows your address, e.g. `https://yourname.github.io/loadtest/`.

## Install on the iPad

1. While online, open the address in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open it once from the Home Screen while still online. This caches the app for offline use.

From then on it works with no signal. Home Screen apps keep their storage. Even so, use **More → Export backup file** after each test day and save the backup to Files or Box.

## Field workflow

1. **New test** → fill in **Bridge** (spans, deck width, girder lines, Edge A/B labels).
2. **Vehicles** → enter each truck's axles and weights.
3. **Load paths** → one row per load case, with the transverse position from Edge A.
4. Run each pass. Use **Pass start / Pass end**, **＋ Note** and **📷 Photo** as you go.
5. Copy the .tdms files from the laptop to the iPad. With no signal at the bridge, use a USB-C (or Lightning) flash drive: it shows up in the iPad file picker. With signal, a Box folder works too. On **Data & plots**, tap **Import .tdms files**. You can select several files at once.
6. On **Gauges**, assign girder/section/location, tick **Dist.** for the distribution gauges (or use **Pick distribution gauges…**), and mark any bad gauges.
7. Check the plots and distribution for each pass. Then go to **Report → Create Word report**.

Notes and photos are matched to passes by clock time. Keep the laptop and iPad clocks in sync.

## Updating the app

Edit the files and upload them to the repository again. Also change the `VERSION` line at the top of `sw.js` (e.g. `loadtest-v2`); otherwise iPads keep the cached copy. The iPad picks up the new version the next time the app is opened online, and shows it on the launch after that.

## Files

| File | Purpose |
|---|---|
| `index.html`, `styles.css` | App shell and styling |
| `js/tdms.js` | TDMS file reader (BDI STS-Live format, including mark/"SoftClick" times) |
| `js/calc.js` | Zeroing, truck position, peaks, load distribution, strip width |
| `js/plot.js`, `js/draw.js` | Plots, cross-section and truck diagrams |
| `js/setup.js`, `js/passes.js`, `js/log.js` | Screens |
| `js/report.js` | Word report |
| `js/state.js`, `js/db.js`, `js/ui.js`, `js/app.js` | Data model, storage, helpers, start-up |
| `vendor/docx.umd.js` | [docx](https://github.com/dolanmiu/docx) 8.5.0 (MIT license), used to write .docx files |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and Home Screen install |
