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

Every analysed eye has a Visualisations panel with three tabs. Every image
tile has a caption with its numbers and a PNG download. **Download figure**
lays out the tab's tiles as one lettered figure (a)–(h) for slides and
papers. All of it runs in the browser (`lib/iop/viz/*`,
`components/iop/viz/*`).

- **Segmentation.** The analysis notebook's figure set, rebuilt from this
  pipeline's masks:
  1. labelled regions over the crop;
  2. segmented sclera;
  3. sclera with the active-contour boundary;
  4. reddish pixels;
  5. their binary mask (P in Eq. 7);
  6. segmented iris;
  7. segmented pupil;
  8. label map.
- **Pipeline.** Each step in order:
  1. normalised crop;
  2. red layer;
  3. highlights removed;
  4. iris and pupil circles;
  5. eyelids, where close-ups show the lid-edge candidates, the points the
     RANSAC fit kept and the two lid circles;
  6. sclera mask;
  7. per-pixel redness heatmap, whose mean is the MRL;
  8. active contour against the sclera mask.
- **Measurements.**
  - *The paper's two classes.* Where this eye's five features fall against
    the Table 4 normal-IOP and high-IOP distributions.
  - *Radial brightness profile.* The profile the circle search
    differentiates, with the pupil and iris edges marked.
  - *RAP histogram.* The sclera's red-lead distribution with the RAP
    threshold marked.

Region colours are the first three slots of the reference categorical
palette. They were validated on the page's dark surface (all-pairs CVD
ΔE 9.4, normal-vision ΔE 20.9, ≥ 3:1 contrast), and every region is also
labelled in text.

## Quality flags (`quality.ts`)

- **low_resolution**: the iris radius in the photo is under 30 px. A face
  photo from a laptop webcam or a small portrait typically gives 8–15 px.
- **eye_not_open**
- **iris_refine_failed**
- **pupil_low_contrast**: common with dark irises under visible light.
- **glare**: more than 10% of the would-be sclera (after the canthal trim) is glare.
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
