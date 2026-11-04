# Keep electron-builder's stock installer and signed-uninstaller build path.
# NSIS searches its working directory before include directories, so switch only
# the compiler's directory to our reviewed uninstaller override. Stock includes
# continue to resolve from the pinned dependency's templates directory.
!addincludedir "${PROJECT_DIR}/node_modules/app-builder-lib/templates/nsis"
!cd "${PROJECT_DIR}/desktop/nsis"

# Fail the build if a future NSIS search-path change bypasses the override.
!macro customUnInstall
  !ifndef STATI_REVIEWED_UNINSTALLER
    !error "Stați reviewed uninstaller was not selected; refusing an unverified installer."
  !endif
!macroend
