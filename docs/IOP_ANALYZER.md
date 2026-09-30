# IOP analyzer (research)

`/iop` measures the five frontal-eye features of Al-Oudat et al.,
*A smart intraocular pressure risk assessment framework using frontal eye image
analysis*, EURASIP JIVP 2018:90, from an uploaded photo. It runs entirely in the
browser on the CPU, and the photo is never uploaded.

It is a research instrument, not a diagnostic. The paper's accuracy (96%) comes
from one private dataset of 400 images and has not been independently
replicated. The paper also did not record whether high-IOP patients were on
eye drops, and those drops change sclera redness and pupil size.

## Pipeline (`lib/iop/`)

| Step | Paper (MATLAB) | Here |
|---|---|---|
| Find the eye | Haar face + eye cascade | 1) MediaPipe Face Landmarker, IMAGE mode, CPU (`landmarker.ts`) for face photos. 2) No face (an eye close-up, the paper's own capture): the close-up detector (`closeUpDetector.ts`, see below). 3) Only if both fail, six clicked points (`eyeGeometry.ts`) |
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

## Close-up detector

Used for photos of one eye, where there is no face for MediaPipe to find. It
runs only on the CPU, in about 0.1–0.3 s. It follows the paper's order,
iris first and then the eyelids:

1. **Iris** (`irisSearch.ts`): search the whole image for a dark disc whose
   left and right edges are measured separately. The score is the weaker
   edge plus half the stronger one. The search image is the min channel
   after white balance: an iris of any colour is dark in at least one
   channel (blue in R, brown in B), while the sclera is bright in all three.
   If a concentric circle 1.6–5× larger scores nearly as well, the first
   disc was the pupil.
2. **Lid edges** (`lidEdges.ts`): per column beside the iris, walk from the
   sclera up and down while pixels stay close to that column's sclera in
   brightness and in whiteness. Everything is relative to the same
   white-balanced crop, because under warm light a sclera can read more
   orange than the skin.
3. **Eyelids** (`lidFit.ts`): one circle per lid, as in the paper's Fig. 6.
   Each is seeded by RANSAC near the iris and extended outward while the
   points stay on the curve. The corners are where the two circles meet,
   within 3.5 iris radii.

The detector would rather refuse than measure the wrong thing. It gives up,
and the page asks for six clicks with the reason shown, when:

- there is no dark pupil inside the iris candidate (edge contrast under
  12/255; true eyes in the set score 24–38, and a striped flag behind a
  portrait that passed every other check scored 5);

- no side of the iris shows sclera;
- the sclera is not the brightest thing around the iris (the signature of a
  pupil mistaken for the iris);
- the lids cannot be fitted;
- the opening is narrower than 3 iris radii.

Evaluation set: 10 open-licence eye photos from Wikimedia Commons plus 5
size, flip and padding variants of a user photo, with hand-marked iris and
eyelid points. A pass means the iris centre and radius are within 15% of
the radius, and the lid points are within 45%.

- 4 of the 5 frontal eyes, and all 5 variants, are located; one variant
  (padded) is off at one corner.
- The 4 side-gaze or macro photos are all refused.
- No photo gets a confident wrong outline.
- The failures are a hooded red eye and a warm-lit eye with a wet, bright
  lower lid margin. Both are refused and fall back to manual points.

## Visualisations

Every analysed eye is followed by its analysis, laid out like
the analysis notebook: numbered blocks, each with a short explanation, its
figures drawn large, and an **Out** cell of printed values. A block index at
the top jumps to each step. Every figure has a PNG download, and
**Download report (PNG)** exports all blocks as one tall image; the charts
are interactive SVG and appear only on the page.

The figures are drawn from the original photo, at up to 3× the normalised
scale (`lib/iop/viz/display.ts`). The geometry is scaled exactly, and the
sclera and reddish-pixel masks are rebuilt per pixel with the same rules.
The printed values are the ones measured at the normalised scale (iris
radius 50 px).

| # | Block | Figures | Out |
|---|---|---|---|
| 1 | Input: normalised eye crop | crop | how the eye was located, iris radius in the photo, rescale factor |
| 2 | Segmentation masks | labelled regions, label map (+ colour key) | pupil / iris / sclera area shares (notebook cell 36) and pixel areas |
| 3 | Sclera segmentation | segmented sclera, what was excluded | sclera pixels, share excluded (canthi + glare) |
| 4 | Sclera contour | sclera with Chan-Vese boundary, contour against mask | Contour Area, Contour Height |
| 5 | Red pixels: RAP and MRL | reddish pixels, their mask (P in Eq. 7), redness map; Eq. 6 and Eq. 7; red-lead histogram with the RAP threshold | RAP, MRL |
| 6 | Inverted red pixel mask | non-reddish sclera, as photo and mask (the notebook's cell 26) | 1 − RAP |
| 7 | Vessel network (reference) | vessels (black top-hat, green channel), sclera minus vessels | vessel coverage |
| 8 | Iris (segmented) | iris and pupil circles, iris ring | iris radius |
| 9 | Pupil and pupil / iris ratio | red layer, highlights removed in the pupil-search square, pupil; radial brightness profile | pupil radius, edge contrast, ratio |
| 10 | Eyelid localisation | lid edges and fitted lid circles (close-ups) or landmarks, sclera mask | outline source |
| 11 | Summary | this eye against the paper's Table 4 class distributions | all five features (notebook cell 37) |

Region colours are the first three slots of the reference categorical
palette. They were validated on the page's dark surface (all-pairs CVD
ΔE 9.4, normal-vision ΔE 20.9, ≥ 3:1 contrast), and every region is also
named in text.

## Quality flags (`quality.ts`)

- **low_resolution**: the iris radius in the photo is under 30 px. A face
  photo from a laptop webcam or a small portrait typically gives 8–15 px.
- **eye_not_open**
- **iris_refine_failed**
- **pupil_low_contrast**: common with dark irises under visible light.
- **glare**: more than 10% of the would-be sclera (after the canthal trim) is glare.
- **small_sclera**

The training script can drop rows that carry a quality flag.

## Training a model

The page measures features only; it does not collect labels. To enable the
normal/high verdict:

1. Assemble a CSV of labelled eyes. It needs one row per eye with the five
   feature columns (`pupilIrisRatio`, `rap`, `mrl`, `contourArea`,
   `contourHeight`) and `label` (`normal`/`high`; above 20 mmHg counts as
   high, as in the paper). Optional columns: `participant_id` (keeps both
   eyes of a person in the same fold), `on_eye_drops`, `quality_flags`.
2. Run
   `python3 train_iop_mlp.py features.csv --out model.json [--drop-flagged]`.
   The script lives in the separate `iop_estimation` folder. It reports
   participant-grouped, repeated cross-validated accuracy, sensitivity,
   specificity and AUC. When eye-drop use is recorded, it also splits these
   by it.
3. Copy the output to `public/iop/model.json` and deploy. The page then shows
   a normal/high output per eye.

The TypeScript forward pass reproduces sklearn's `predict_proba` to 6 decimal
places.
