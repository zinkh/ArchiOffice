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
; vc_redist.x64.exe itself requires elevation to install its system-wide
; DLLs. A plain ExecWait here previously failed silently (0xC0000135
; persisted even after switching to ExecShellWait "runas" — electron-builder
; bundles its own patched, independently-versioned NSIS build, and there's no
; way to confirm from this sandbox whether its runas support genuinely
; matches upstream NSIS 3.08+ behavior). electron-builder.yml now sets
; perMachine: true, so the whole installer already runs elevated by the time
; this macro executes — plain ExecWait inherits that, no special-casing needed.
!macro customInstall
  DetailPrint "Installation du runtime Microsoft Visual C++ (requis par PostgREST)..."
  ExecWait '"$INSTDIR\resources\vc_redist.x64.exe" /install /quiet /norestart'
!macroend
