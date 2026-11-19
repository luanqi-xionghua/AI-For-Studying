; 阅迁星穹 安装包（NSIS 3，Modern UI 2）。由 scripts\build-windows.ps1 -Installer 调用：
;   makensis /DVERSION=1.2.3 scripts\installer.nsi
; 按用户安装，不需要管理员权限；书库与设置在 %APPDATA%\com.phydog.reading.python，卸载时保留。
; 应用内更新会以 /S 静默运行本安装包：安装到原来的目录，等旧版退出后替换，完成后自动重新打开。
; 文件存成带 BOM 的 UTF-8，makensis 才会按 UTF-8 读中文。
Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!ifndef VERSION
  !error "请用 /DVERSION=x.y.z 指定版本号"
!endif
!define APP "YueqianXingqiong"
!define NAME "阅迁星穹"
!define EXE "${APP}.exe"
!define UNINSTALLER "Uninstall-${APP}.exe"
!define PUBLISHER "luanqi-xionghua"
!define URL "https://github.com/luanqi-xionghua/AI-For-Studying"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP}"
!define DATA_DIR "%APPDATA%\com.phydog.reading.python"

Name "${NAME}"
Caption "${NAME} ${VERSION} 安装"
OutFile "..\dist\${APP}-${VERSION}-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
BrandingText "${NAME} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=2052 "ProductName" "${NAME}"
VIAddVersionKey /LANG=2052 "FileDescription" "${NAME} 安装程序"
VIAddVersionKey /LANG=2052 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=2052 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=2052 "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=2052 "LegalCopyright" "MIT License"

!include "MUI2.nsh"
!include "FileFunc.nsh"

!define MUI_ICON "..\frontend\public\app.ico"
!define MUI_UNICON "..\frontend\public\app.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TEXT "将在这台电脑上安装 ${NAME} ${VERSION}。$\r$\n$\r$\n${NAME} 是一款 Windows 桌面 AI 阅读器：在本地文档库里阅读 PDF、Markdown 和 Word，边读边问阅读助手、随手翻译。$\r$\n$\r$\n只为当前用户安装，不需要管理员权限。安装前请先关闭正在运行的 ${NAME}。"
!define MUI_COMPONENTSPAGE_NODESC
!define MUI_FINISHPAGE_RUN "$INSTDIR\${EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "运行 ${NAME}"
!define MUI_UNCONFIRMPAGE_TEXT_TOP "将从这台电脑上卸载 ${NAME}。$\r$\n文档库、阅读进度、AI 对话和设置保存在 ${DATA_DIR}，不会被删除；原文档也不受影响。需要彻底清除时，可在卸载后手动删除该文件夹。"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "..\LICENSE"
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "SimpChinese"

; 旧版本还开着时，程序文件被占用，无法覆盖。静默更新时程序正在退出，最多等 30 秒；手动安装时请用户先关掉。
Function WaitForApp
  StrCpy $0 0
  retry:
    IfFileExists "$INSTDIR\${EXE}" 0 done
    ClearErrors
    Delete "$INSTDIR\${EXE}"
    IfErrors 0 done
    IfSilent 0 ask
      IntOp $0 $0 + 1
      IntCmp $0 60 give_up
      Sleep 500
      Goto retry
    ask:
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${NAME} 正在运行，请先关闭它，再点「重试」。" IDRETRY retry
    give_up:
      Abort "${NAME} 正在运行，无法覆盖程序文件。"
  done:
FunctionEnd

Section "${NAME}（必需）" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  Call WaitForApp
  File "..\dist\${EXE}"
  File "/oname=LICENSE.txt" "..\LICENSE"
  File "/oname=THIRD_PARTY_NOTICES.md" "..\THIRD_PARTY_NOTICES.md"
  WriteUninstaller "$INSTDIR\${UNINSTALLER}"

  ; 旧名字（开智 / Kaizhi Python）留下的快捷方式一并清掉。
  Delete "$SMPROGRAMS\Kaizhi Python.lnk"
  CreateShortcut "$SMPROGRAMS\${NAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0 SW_SHOWNORMAL "" "${NAME}：桌面 AI 阅读器"

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "${URL}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "HelpLink" "${URL}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${EXE},0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\${UNINSTALLER}"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALLER}" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" "$0"
SectionEnd

Section "桌面快捷方式" SecDesktop
  ; 静默更新不重新创建用户已经删掉的桌面快捷方式。
  IfSilent 0 create
    IfFileExists "$DESKTOP\${NAME}.lnk" 0 skip
  create:
    CreateShortcut "$DESKTOP\${NAME}.lnk" "$INSTDIR\${EXE}" "" "$INSTDIR\${EXE}" 0
  skip:
SectionEnd

; 应用内更新以 /S 运行：装完后重新打开程序（交互安装由完成页的「运行」勾选决定）。
Function .onInstSuccess
  IfSilent 0 +2
    Exec '"$INSTDIR\${EXE}"'
FunctionEnd

Section "Uninstall"
  StrCpy $0 0
  retry:
    ClearErrors
    Delete "$INSTDIR\${EXE}"
    IfErrors 0 removed
    IfSilent 0 ask
      IntOp $0 $0 + 1
      IntCmp $0 60 give_up
      Sleep 500
      Goto retry
    ask:
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "${NAME} 正在运行，请先关闭它，再点「重试」。" IDRETRY retry
    give_up:
      Abort "${NAME} 正在运行，无法卸载。"
  removed:
  Delete "$INSTDIR\LICENSE.txt"
  Delete "$INSTDIR\THIRD_PARTY_NOTICES.md"
  Delete "$INSTDIR\${UNINSTALLER}"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd
