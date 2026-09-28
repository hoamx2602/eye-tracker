# IOP analyzer (research)

`/iop` measures the five frontal-eye features of Al-Oudat et al.,
*A smart intraocular pressure risk assessment framework using frontal eye image
analysis*, EURASIP JIVP 2018:90, from an uploaded photo. It runs entirely in the
browser on the CPU. The photo is never uploaded; only the numbers leave, and
only when a researcher exports them.

It is a research instrument, not a diagnostic. The paper's accuracy (96%) comes
from one private dataset of 400 images and has not been independently
replicated. The paper also did not record whether high-IOP patients were on
eye drops, and those drops change sclera redness and pupil size.

## Pipeline (`lib/iop/`)

| Step | Paper (MATLAB) | Here |
|---|---|---|
| Find the eye | Haar face + eye cascade | MediaPipe Face Landmarker, IMAGE mode, CPU (`landmarker.ts`). For eye close-ups with no face, the researcher clicks six points instead (`eyeGeometry.ts`) |
| Normalise | Crop to height:width 1:1.8, resize | Crop around the eye, rescale so the iris radius is 50 px (`pipeline.ts`) |
| Iris, pupil | Red layer → morphological reconstruction (removes glare) → adaptive threshold → Canny → circular Hough | Red layer → the same reconstruction (`removeHighlights`) → Daugman integro-differential circle search (`circleSearch.ts`). The iris fit uses only the lateral arcs, so the eyelids do not bias it |
| Eyelids | Two circles found with Hough on edge images | MediaPipe's 16-point lid outline, or circles through the clicked points |
| Sclera | Inside both lid circles, outside the iris | The same, minus specular glare and minus 10% of the eye length at each canthus (see below) |
| MRL | Eq. 6 over sclera pixels | Same (`features.ts`) |
| RAP | Reddish pixels / sclera pixels; the reddish rule has no published thresholds | R leads G and B by 12%, and \|G−B\| < 0.3·R (`RED_DOMINANCE`, `MAX_GB_SPREAD`) |
| Contour area and height | `activecontour` (Chan-Vese) seeded with the sclera mask, then `regionprops` | Chan-Vese with Gaussian-smoothed level set (`chanVese.ts`), largest component, ratios to the mask |
| Classifier | MLP 5-10-1, sigmoid, output ≥ 0.5 means high | The same forward pass (`classifier.ts`), with weights from `public/iop/model.json` when that file exists |

These choices are ours, because the paper does not specify them. They are all
named constants:

- `CANTHUS_TRIM`: the caruncle and lid margin are pink in every eye and
  otherwise dominate RAP.
- `RED_DOMINANCE` and `MAX_GB_SPREAD`: the thresholds for a "reddish" pixel.
- `NORMALISED_IRIS_RADIUS`.
- The Chan-Vese iteration count and smoothing.

Because of these choices, RAP and the contour features are on a different
scale from the paper's Table 4. The UI shows Table 4 for orientation only.

## Quality flags (`quality.ts`)

- **low_resolution**: the iris radius in the photo is under 30 px. A face
  photo from a laptop webcam or a small portrait typically gives 8–15 px.
- **eye_not_open**
- **iris_refine_failed**
- **pupil_low_contrast**: common with dark irises under visible light.
- **glare**: more than 10% of the sclera is glare.
- **small_sclera**

Flags are exported with each row. The training script can drop flagged rows.

## Training a model

1. Collect labelled eyes in `/iop`. For each eye, record the
   participant ID, the tonometer IOP in mmHg (above 20 counts as high, as in
   the paper), and whether the participant uses eye drops.
2. Click **Export CSV**. The rows live in this browser's `localStorage` until
   exported.
3. Run
   `python3 train_iop_mlp.py iop-features.csv --out model.json [--drop-flagged]`.
   The script lives in the separate `iop_estimation` folder. It reports
   participant-grouped, repeated cross-validated accuracy, sensitivity,
   specificity and AUC. When enough rows exist, it also splits these by
   eye-drop use.
4. Copy the output to `public/iop/model.json` and deploy. The page then shows
   a normal/high output per eye.

The TypeScript forward pass reproduces sklearn's `predict_proba` to 6 decimal
places.
