; PostgREST's Windows binary dynamically links against the Microsoft Visual
; C++ runtime. On a machine that doesn't already have it, spawning it fails
; immediately with exit code 0xC0000135 (STATUS_DLL_NOT_FOUND) and no other
; diagnostic output, since the OS loader kills the process before it can
; print anything — confirmed on a real Windows install. electron-builder.yml
; ships vendor/vc_redist.x64.exe as resources\vc_redist.x64.exe; this runs it
; after the app's own files are extracted. /install /quiet /norestart is safe
; to re-run on every (re)install: it no-ops if an equal-or-newer version is
; already present.
;
; This app installs per-user (no admin rights needed), but vc_redist.x64.exe
; itself requires elevation to install its system-wide DLLs. Plain ExecWait
; calls CreateProcess directly, which silently ignores the target exe's own
; elevation manifest — the redistributable would just fail to install with
; no error and no UAC prompt (confirmed: still 0xC0000135 after a first
; attempt using ExecWait). ExecShellWait with the "runas" verb goes through
; ShellExecuteEx instead, which does honor it, showing a single UAC consent
; prompt for just this step.
!macro customInstall
  DetailPrint "Installation du runtime Microsoft Visual C++ (requis par PostgREST)..."
  ExecShellWait "runas" "$INSTDIR\resources\vc_redist.x64.exe" "/install /quiet /norestart"
!macroend
