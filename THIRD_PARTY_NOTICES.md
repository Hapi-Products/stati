# Third-party notices

The Apache 2.0 license applies to Hapi Products' Stați source. It does not replace the licenses of dependencies or bundled upstream material.

- `vendor/propresenter-7.11/`: unofficial ProPresenter protobuf schemas, MIT. The upstream repository and pinned revision are recorded in `SOURCE.md`; retain `LICENSE`. These schemas do not imply endorsement by Renewed Vision or guarantee compatibility with a physical ProPresenter installation.
- `vendor/tesseract-data/`: pinned English and Romanian OCR language data; retain `LICENSE` and `SOURCE.json`.
- `desktop/nsis/`: upstream NSIS supporting files; retain `LICENSE`, `README.md` and `SOURCE.json`.
- `tests/fixtures/media-OGV-LICENSE.txt`: MIT notice for the upstream file-type OGV detection sample. Other media fixtures are synthetic; provenance is in `docs/media-fixtures-source.md`.
- JavaScript dependencies are pinned in `package-lock.json`; their licenses remain in their installed packages. `scripts/prepare-desktop-assets.mjs` copies OCR/PDF runtime licenses into generated desktop assets. Preserve those notices when redistributing builds.
- Android Browser Helper is declared in `android/app/build.gradle` and retains its upstream license and transitive notices.

Uploaded song lyrics, files and media are user content, are not included in this repository, and are not relicensed by the source license. Review applicable upstream licenses and distribution obligations when shipping a modified binary.
