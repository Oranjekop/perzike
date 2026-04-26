!ifndef BUILD_UNINSTALLER

!macro customHeader
  Var PerzikeHadDesktopShortcut
  Var PerzikeHadExistingInstall
  Var PerzikeServiceWasRunning
!macroend

!macro ServiceOutputContains NEEDLE RESULT
  StrCpy ${RESULT} "false"
  StrCpy $R5 0
  StrLen $R6 $R3
  StrLen $R8 "${NEEDLE}"
  ${Do}
    StrCpy $R9 $R3 $R8 $R5
    ${If} $R9 == "${NEEDLE}"
      StrCpy ${RESULT} "true"
      ${Break}
    ${EndIf}
    IntOp $R5 $R5 + 1
  ${LoopUntil} $R5 >= $R6
!macroend

!macro QueryPerzikeServiceState RESULT
  nsExec::ExecToStack '"$SYSDIR\sc.exe" query SparkleService'
  Pop $R2
  Pop $R3

  StrCpy ${RESULT} "not-installed"
  ${If} $R2 == 0
    !insertmacro ServiceOutputContains "RUNNING" $R4
    ${If} $R4 == "true"
      StrCpy ${RESULT} "running"
    ${Else}
      !insertmacro ServiceOutputContains "STOP_PENDING" $R4
      ${If} $R4 == "true"
        StrCpy ${RESULT} "stop-pending"
      ${Else}
        !insertmacro ServiceOutputContains "STOPPED" $R4
        ${If} $R4 == "true"
          StrCpy ${RESULT} "stopped"
        ${Else}
          StrCpy ${RESULT} "unknown"
        ${EndIf}
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro WaitPerzikeServiceStopped
  StrCpy $R0 0
  ${Do}
    !insertmacro QueryPerzikeServiceState $R1
    ${If} $R1 == "stopped"
    ${OrIf} $R1 == "not-installed"
      ${Break}
    ${EndIf}
    Sleep 500
    IntOp $R0 $R0 + 1
  ${LoopUntil} $R0 >= 30

  !insertmacro QueryPerzikeServiceState $R1
  ${If} $R1 != "stopped"
  ${AndIf} $R1 != "not-installed"
    MessageBox MB_ICONSTOP "Perzike service is still running. Please stop the service and run the installer again."
    Abort
  ${EndIf}
!macroend

!macro StopPerzikeServiceIfRunning
  !insertmacro QueryPerzikeServiceState $R1

  ${If} $R1 != "stopped"
  ${AndIf} $R1 != "not-installed"
    StrCpy $PerzikeServiceWasRunning "true"
    DetailPrint "Stopping Perzike service"
    nsExec::ExecToStack '"$SYSDIR\sc.exe" stop SparkleService'
    Pop $R2
    Pop $R3
    !insertmacro WaitPerzikeServiceStopped
  ${EndIf}
!macroend

!macro GrantPerzikeSidecarAccess DIR
  DetailPrint "Granting Perzike sidecar access: ${DIR}\resources\sidecar"
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "${DIR}\resources\sidecar" /inheritance:e /grant *S-1-5-32-544:(OI)(CI)F *S-1-5-18:(OI)(CI)F *S-1-5-32-545:(OI)(CI)RX /T /C'
  Pop $R2
  ${If} $R2 != 0
    DetailPrint "Grant sidecar access exited with code $R2"
  ${EndIf}
!macroend

!macro ResetPerzikeSidecarAccess DIR
  DetailPrint "Taking ownership of old Perzike sidecar: ${DIR}\resources\sidecar"
  nsExec::ExecToLog '"$SYSDIR\takeown.exe" /F "${DIR}\resources\sidecar" /A /R /D Y'
  Pop $R2
  ${If} $R2 != 0
    DetailPrint "Take ownership exited with code $R2"
  ${EndIf}

  DetailPrint "Resetting old Perzike sidecar ACL: ${DIR}\resources\sidecar"
  nsExec::ExecToLog '"$SYSDIR\icacls.exe" "${DIR}\resources\sidecar" /reset /T /C'
  Pop $R2
  ${If} $R2 != 0
    DetailPrint "Reset sidecar ACL exited with code $R2"
  ${EndIf}

  !insertmacro GrantPerzikeSidecarAccess "${DIR}"
!macroend

!macro RemovePerzikeSidecar DIR
  ${If} "${DIR}" != ""
    !insertmacro ResetPerzikeSidecarAccess "${DIR}"
    DetailPrint "Removing old Perzike sidecar: ${DIR}\resources\sidecar"
    nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path -LiteralPath '${DIR}\resources\sidecar') { Remove-Item -LiteralPath '${DIR}\resources\sidecar' -Recurse -Force -ErrorAction Stop }"`
    Pop $R2
    ${If} $R2 != 0
      MessageBox MB_ICONSTOP "Failed to remove old Perzike sidecar directory: ${DIR}\resources\sidecar. Please close Perzike and run the installer as administrator."
      Abort
    ${EndIf}
  ${EndIf}
!macroend

!macro customInit
  StrCpy $PerzikeServiceWasRunning "false"
  !insertmacro StopPerzikeServiceIfRunning

  ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ShortcutName
  ${if} $0 == ""
    StrCpy $0 "${PRODUCT_FILENAME}"
  ${endif}

  ReadRegStr $1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCpy $PerzikeHadExistingInstall "false"
  ${if} $1 != ""
    StrCpy $PerzikeHadExistingInstall "true"
    !insertmacro RemovePerzikeSidecar "$1"
  ${endif}
  !insertmacro RemovePerzikeSidecar "$INSTDIR"

  StrCpy $PerzikeHadDesktopShortcut "false"
  ${if} ${FileExists} "$DESKTOP\$0.lnk"
  ${orIf} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
    StrCpy $PerzikeHadDesktopShortcut "true"
  ${endif}
!macroend

!macro customInstall
  !insertmacro GrantPerzikeSidecarAccess "$INSTDIR"

  ${If} $PerzikeServiceWasRunning == "true"
    StrCpy $R1 "$INSTDIR\resources\files\perzike-service.exe"
    ${If} ${FileExists} "$R1"
      DetailPrint "Starting Perzike service: $R1"
      nsExec::ExecToLog '"$R1" service start'
      Pop $R2
      ${If} $R2 != 0
        DetailPrint "Perzike service start exited with code $R2"
      ${EndIf}
    ${EndIf}
  ${EndIf}

  ${if} $PerzikeHadDesktopShortcut != "true"
    ${if} ${isUpdated}
    ${orIf} $PerzikeHadExistingInstall == "true"
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
    ${endif}
  ${endif}
!macroend
!endif
