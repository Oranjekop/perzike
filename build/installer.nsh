!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK perzikeDoStopProcess
    Quit

    perzikeDoStopProcess:
      DetailPrint "$(appClosing)"
      ${nsProcess::CloseProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      Sleep 1000
      StrCpy $R1 0

    perzikeCheckProcessLoop:
      IntOp $R1 $R1 + 1
      ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
      ${if} $R0 == 0
        ${nsProcess::KillProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        Sleep 1000
        ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
        ${if} $R0 == 0
          DetailPrint `Waiting for "${PRODUCT_NAME}" to close.`
          Sleep 2000
        ${else}
          Goto perzikeProcessNotRunning
        ${endIf}
      ${else}
        Goto perzikeProcessNotRunning
      ${endIf}

      ${if} $R1 > 1
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY perzikeCheckProcessLoop
        Quit
      ${else}
        Goto perzikeCheckProcessLoop
      ${endIf}

    perzikeProcessNotRunning:
  ${endIf}
!macroend

!macro customInstall
  ${ifNot} ${isUpdated}
    CreateShortcut "$DESKTOP\${PRODUCT_FILENAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe"
  ${endIf}
!macroend
