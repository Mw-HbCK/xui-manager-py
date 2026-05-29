; XUI Manager - NSIS Installer Script
; Usage: makensis installer.nsi (after PyInstaller build completes)
; Requires: dist\XUI-Manager\ from PyInstaller

Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

!define PRODUCT_NAME "XUI Manager"
!define PRODUCT_PUBLISHER "XUI Manager"
!define PRODUCT_VERSION "1.0.0"
!define PRODUCT_UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCT_NAME}"

Name "${PRODUCT_NAME} ${PRODUCT_VERSION}"
OutFile "XUI-Manager-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\XUI-Manager"
RequestExecutionLevel user
SetCompressor lzma
ShowInstDetails show

; ── Modern UI Settings ──
!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "license.txt"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\XUI-Manager.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch XUI Manager"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"

; ── Main Program Section (Required) ──
Section "!XUI Manager" SecMain
    SectionIn RO

    SetOutPath "$INSTDIR"
    File /r "dist\XUI-Manager\*"

    CreateDirectory "$INSTDIR\data"

    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayName" "${PRODUCT_NAME}"
    WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "UninstallString" "$INSTDIR\uninstall.exe"
    WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "DisplayVersion" "${PRODUCT_VERSION}"
    WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "Publisher" "${PRODUCT_PUBLISHER}"
    WriteRegStr HKCU "${PRODUCT_UNINST_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegDWORD HKCU "${PRODUCT_UNINST_KEY}" "EstimatedSize" "$0"
    WriteRegDWORD HKCU "${PRODUCT_UNINST_KEY}" "NoModify" 1
    WriteRegDWORD HKCU "${PRODUCT_UNINST_KEY}" "NoRepair" 1

    WriteUninstaller "$INSTDIR\uninstall.exe"
SectionEnd

; ── Start Menu Shortcuts ──
Section "Start Menu Shortcuts" SecStartMenu
    CreateDirectory "$SMPROGRAMS\${PRODUCT_NAME}"
    CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\XUI Manager.lnk" "$INSTDIR\XUI-Manager.exe"
    CreateShortCut "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall XUI Manager.lnk" "$INSTDIR\uninstall.exe"
SectionEnd

; ── Desktop Shortcut ──
Section "Desktop Shortcut" SecDesktop
    CreateShortCut "$DESKTOP\XUI Manager.lnk" "$INSTDIR\XUI-Manager.exe"
SectionEnd

; ── Component Descriptions ──
LangString DESC_SecMain ${LANG_SIMPCHINESE} "XUI Manager application and runtime files (required)"
LangString DESC_SecStartMenu ${LANG_SIMPCHINESE} "Add XUI Manager shortcuts to the Start Menu"
LangString DESC_SecDesktop ${LANG_SIMPCHINESE} "Create a shortcut on the desktop"

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} $(DESC_SecMain)
    !insertmacro MUI_DESCRIPTION_TEXT ${SecStartMenu} $(DESC_SecStartMenu)
    !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktop} $(DESC_SecDesktop)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ── Uninstaller ──
Section "Uninstall"
    Delete "$DESKTOP\XUI Manager.lnk"
    Delete "$SMPROGRAMS\${PRODUCT_NAME}\XUI Manager.lnk"
    Delete "$SMPROGRAMS\${PRODUCT_NAME}\Uninstall XUI Manager.lnk"
    RMDir "$SMPROGRAMS\${PRODUCT_NAME}"

    RMDir /r "$INSTDIR"

    DeleteRegKey HKCU "${PRODUCT_UNINST_KEY}"
SectionEnd
