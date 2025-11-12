# CMIP6 Coverage Explorer (D3.js)

An interactive D3.js visualization to explore coverage of CMIP6 Zarr stores across models, experiments, and variables.

**Live URL (after you enable GitHub Pages):** `https://<your-username>.github.io/<your-repo>/`

## Repo Layout
```
project-root/
  index.html
  styles.css
  script.js
  data/
    cmip6_subset.csv
    cmip6_summary_by_var.csv
    cmip6_summary_matrix.csv
    cmip6_year_hist.csv
```

## How to Publish on GitHub Pages
1. Create a public repository and push all files from this folder.
2. In the repository settings → **Pages**, set:
   - **Source**: Deploy from a branch
   - **Branch**: `main` (or `master`), folder: `/ (root)`
3. Wait for Pages to build. Your site will be at the URL shown at the top of the Pages settings.

## Local Testing
Use a simple static server (to avoid CORS issues), e.g.:
```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Data
We ship a small subset of the public CMIP6 Zarr store catalog filtered to common variables (tas, pr, etc.) and experiments (historical, ssp126/245/370/585). The `version` field is used as a year proxy for the histogram.

## Course Write-up
A full write-up is embedded in `index.html` under the **Write-up** section. Replace the template development-process paragraph with your team-specific details.
