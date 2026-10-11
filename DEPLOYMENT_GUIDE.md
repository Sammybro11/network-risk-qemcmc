# Deployment & Execution Guide: Vercel & Qollab.xyz

This project supports two primary deployment and execution targets:
1. **Vercel** — Host the interactive scientific web platform (Contagion Atlas V2) globally with zero configuration.
2. **Qollab.xyz** — Run the interactive web app or pure-Python quantum experiments with IonQ simulator backends in Qollab.

---

## 1. Hosting on Vercel

The interactive dashboard in `webapp/` is a 100% client-side web application built with vanilla modern ES modules. It has zero backend dependencies and runs entirely in the browser.

### Option A: Automatic Deployment via Git (Recommended)
1. Push your changes to GitHub: `git push origin main`.
2. Go to [vercel.com](https://vercel.com) and log in.
3. Click **Add New... > Project** and import the `network-risk-qemcmc` repository.
4. **Zero-Config Deployment**: The repository includes a root [`vercel.json`](./vercel.json) that automatically configures `"outputDirectory": "webapp"`.
   - Leave **Framework Preset** as *Other*.
   - Leave **Root Directory** as `./` (or optionally set to `webapp/`).
   - Leave build command and output directory as default.
5. Click **Deploy**. Vercel will publish the site in seconds with a public `.vercel.app` URL.

### Option B: Deploying via Vercel CLI
If you have Node.js and the Vercel CLI installed:
```bash
# From the repository root:
npx vercel deploy --prod
```
The CLI detects `vercel.json` and immediately publishes the webapp.

---

## 2. Running on Qollab (qollab.xyz)

Qollab supports both **Python projects** (with IonQ simulator hardware backend) and **JavaScript projects** (interactive HTML/JS).

We provide a helper script to build one-click ready upload bundles:
```bash
uv run python scripts/package_qollab.py
```
This produces two deployment archives in `dist/`:

### Mode A: Qollab Python Lab (`dist/qollab_lab.zip`)
*Best for: Running the core quantum algorithm on Qollab's Pyodide runtime with the injected IonQ QPU / local simulator backend and auto-generated settings form.*

1. Go to [qollab.xyz](https://qollab.xyz) and sign in.
2. Click **New Project > Upload your own files**.
3. Select and upload `dist/qollab_lab.zip` (or drag and drop it).
4. In the Qollab IDE:
   - Select your quantum simulator in the **Select QPU** dialog (the local simulator is recommended).
   - Qollab auto-generates the **Run Settings** form (`method`: finance/traffic, `budget`, `steps`, `beta`, `lam`).
5. Click **Run**.
   - Output includes the MCMC diagnostic tables (Spearman rank correlation, $\chi$ relative error, acceptance rates) and SVG plots (convergence traces, ranking bars, regret curves).

### Mode B: Qollab Interactive Web App (`dist/qollab_webapp.zip`)
*Best for: Running the interactive Contagion Atlas dashboard directly inside Qollab's browser canvas.*

1. In Qollab, create a new project with **Upload your own files**.
2. Select and upload `dist/qollab_webapp.zip`.
3. Qollab will detect `index.html` and `main.js` and categorize it as a **JavaScript project**.
4. Click **Run**.
   - The interactive canvas will render above the console, allowing you to switch between the four recorded showcase scenarios (three interbank contagion networks and a rush-hour road grid), re-run the QeMCMC-vs-Metropolis race live, and score your own intervention against the exact optimum.

---

## 3. Local Development & Testing

- **Run Webapp Locally**:
  ```bash
  python3 -m http.server 8000 --directory webapp
  # Open http://localhost:8000
  ```

- **Run Python Experiments**:
  ```bash
  uv run python experiments/financial_contagion.py
  uv run python experiments/report_plots.py
  uv run python experiments/visualize_results.py
  ```

- **Run Test Suite**:
  ```bash
  uv run pytest
  ```
