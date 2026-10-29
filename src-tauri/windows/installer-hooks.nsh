!define HELIOS_HOOK_DIR "${__FILEDIR__}"

!macro NSIS_HOOK_PREINSTALL
  DetailPrint "Stopping Helios download engine..."
  File /oname=$PLUGINSDIR\stop-aria2.ps1 "${HELIOS_HOOK_DIR}\stop-aria2.ps1"
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-aria2.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP|MB_OK "Helios could not stop its aria2 engine. Close Helios and retry the installation."
    Abort
  ${EndIf}
!macroend
