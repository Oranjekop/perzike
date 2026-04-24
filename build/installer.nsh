!ifndef BUILD_UNINSTALLER
Var PerzikeHadDesktopShortcut
Var PerzikeHadExistingInstall

!macro customInit
  ReadRegStr $0 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ShortcutName
  ${if} $0 == ""
    StrCpy $0 "${PRODUCT_FILENAME}"
  ${endif}

  ReadRegStr $1 SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
  StrCpy $PerzikeHadExistingInstall "false"
  ${if} $1 != ""
    StrCpy $PerzikeHadExistingInstall "true"
  ${endif}

  StrCpy $PerzikeHadDesktopShortcut "false"
  ${if} ${FileExists} "$DESKTOP\$0.lnk"
  ${orIf} ${FileExists} "$DESKTOP\${SHORTCUT_NAME}.lnk"
    StrCpy $PerzikeHadDesktopShortcut "true"
  ${endif}
!macroend

!macro customInstall
  ${if} $PerzikeHadDesktopShortcut != "true"
    ${if} ${isUpdated}
    ${orIf} $PerzikeHadExistingInstall == "true"
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
    ${endif}
  ${endif}
!macroend
!endif
