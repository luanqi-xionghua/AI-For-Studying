Unicode true
RequestExecutionLevel user
; 显示名「阅迁星穹」；安装目录与 EXE 文件名沿用 KaizhiPython，更新器和已有安装都靠它识别。
; 文件存成带 BOM 的 UTF-8，makensis 才会按 UTF-8 读中文。
Name "阅迁星穹"
OutFile "..\dist\KaizhiPython-0.10.54-setup.exe"
InstallDir "$LOCALAPPDATA\KaizhiPython\App"
Section
  SetOutPath "$INSTDIR"
  File "..\dist\KaizhiPython.exe"
  WriteUninstaller "$INSTDIR\Uninstall-KaizhiPython.exe"
  Delete "$SMPROGRAMS\Kaizhi Python.lnk"
  CreateShortcut "$SMPROGRAMS\阅迁星穹.lnk" "$INSTDIR\KaizhiPython.exe"
SectionEnd
Function .onInstSuccess
  Exec '"$INSTDIR\KaizhiPython.exe"'
FunctionEnd
Section "Uninstall"
  Delete "$SMPROGRAMS\阅迁星穹.lnk"
  Delete "$SMPROGRAMS\Kaizhi Python.lnk"
  Delete "$INSTDIR\KaizhiPython.exe"
  Delete "$INSTDIR\Uninstall-KaizhiPython.exe"
  RMDir "$INSTDIR"
SectionEnd
