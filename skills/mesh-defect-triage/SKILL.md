---
name: mesh-defect-triage
description: Triage geometry defects in image-to-3D meshes by matching the user's marked view, comparing decoded geometry with the export, and locating the first affected stage. Use when debugging a suspected hole, unwanted opening, dent, tunnel, or missing surface in a generated mesh.
---

# Mesh Defect Triage

Interpret the user's reference before diagnosing the mesh. A **recess** is a dent with mesh behind it. An **opening** is a marked sightline into or through a region where the user expects a surface. A fix to a nearby recess does not count as closing the opening.

Uderstand whether the generator left that space empty during shape sampling or lost the surface during mesh decoding.

Stay within the user's requested scope. If they ask for synthesis only, summarize the existing evidence and identify what remains unverified. Do not start diagnostics or run the workflow below without authorization.

## Triage in order

1. **Reproduce the marked sightline.** Use the user's exact view and contrast insert (for example, red and white). Hold the camera and insert fixed when comparing the export with the raw, geometry-only decoded mesh captured **before** surface rebuild, decimation, or texturing. Judge the marked spot, not a similar-looking nearby feature.
2. **Locate the first affected stage.** If the opening is already visible in the raw decode, it predates surface rebuild, decimation, and texturing. Otherwise, compare intermediate outputs in pipeline order at the same view. Report the earliest stage where the defect is observed, and note any missing captures rather than assigning a cause to an unobserved stage. Inspect the marked geometry to distinguish an open boundary edge from a tunnel lined by a continuous surface or a gap between disjoint surfaces where a bridge is expected. Do not infer topology or cause from renders alone: a watertight result or a report of no open edges does not rule out a tunnel or a missing bridge between closed parts.
3. **Verify the smallest local fix.** Work on a copy and leave decimation settings unchanged. Restore the expected surface at the marked spot rather than hiding the insert behind another part. Check the original view with the insert still in place, then check an adjacent angle to confirm the surface itself was restored.
4. **Establish fast repeatability before changing the generator.** Hold inputs and settings fixed across quick runs. Use a faster proxy only if it reproduces the exact marked defect; if it does not, its results are not evidence about that defect. Treat the local fix as a one-asset repair, not proof that future generations will avoid the defect. Try generator changes only after the baseline is repeatable. Return to high fidelity once results are consistent, using the raw mesh's detail and visual fidelity as the quality target when appropriate.

## Do not trade consistency for one-case-fix

If the your approach to addressing an issue, like closing the opening the mesh where I marked marked, do not attempt to producce a watertight result as proof that the opening is gone at the cost of regressing the overall workflow production. The highest priority here is understanding our limitations and cut loss for a consistent model generation across various reference images of objects and styles. If the findings and tests yield significantly positive results for one object over another, like character vs props, this could be noted as a new configuration options, parameter, or notes for a different workflow.

## Defect Localization and Temporary Mesh Repair

**Objective:** Locate unintended surface openings, characterize their geometry, and apply localized, non-destructive temporary repairs.

### 1. Establish Baseline
- Align the saved mesh, raw decode, and original export at the same scale and orientation.
- Preserve all source files and generation/decimation settings.
- Use the existing marker (Quadsphere insert) as a visual reference.

### 2. Localize the Defect
- Reconstruct the provided screenshot's viewpoint using surrounding geometric landmarks.
- Render the baseline geometry from the reconstructed viewpoint and nearby angles.
- Confirm marker visibility and identify the spatial boundaries of the opening.
- Cross-reference the raw decode and original export to determine whether the defect predates decimation.

### 3. Diagnose the Geometry
- Perform sightline checks to distinguish a through-hole from an exposed cavity or surface depression.
- Inspect mesh topology for exposed edges, boundary loops, and existing surface connectivity.
- Determine the appropriate repair based on geometric evidence rather than visual appearance alone.

### 4. Apply Temporary Repair
- Work exclusively on a separate geometry-only copy.
- Fit a minimal connecting surface across the identified opening, respecting adjacent geometry.
- Avoid global remeshing, re-decimation, or unrelated surface modifications.
- Join the repair to the copied mesh and retain the original as the baseline.

### 5. Verify Repair
- Compare before-and-after renders using identical viewpoints, scale, and marker placement.
- Perform dense sightline checks across the original and neighboring viewing angles.
- Confirm that adjacent features remain unobstructed.
- Validate mesh closure, manifoldness, face orientation, and absence of unintended intersections.
- Quantify changed triangles and confirm modifications remain localized.

## 6. Iterate and Accept
- If residual marker visibility or geometric inconsistencies remain, refine the repair and repeat verification.
- Do not classify partial visual coverage as a successful repair.
- Accept the temporary repair only when all verification criteria pass.
- Retain the repaired mesh separately and document the defect location, repair method, and validation results.

**Constraints:** No source overwrites, generation reruns, decimation changes, or unrelated geometry modifications.