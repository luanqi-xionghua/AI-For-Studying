Unicode true
RequestExecutionLevel user
Name "Kaizhi Python"
OutFile "..\dist\KaizhiPython-0.10.54-setup.exe"
InstallDir "$LOCALAPPDATA\KaizhiPython\App"
Section
  SetOutPath "$INSTDIR"
  File "..\dist\KaizhiPython.exe"
  WriteUninstaller "$INSTDIR\Uninstall-KaizhiPython.exe"
  CreateShortcut "$SMPROGRAMS\Kaizhi Python.lnk" "$INSTDIR\KaizhiPython.exe"
SectionEnd
Function .onInstSuccess
  Exec '"$INSTDIR\KaizhiPython.exe"'
FunctionEnd
Section "Uninstall"
  Delete "$SMPROGRAMS\Kaizhi Python.lnk"
  Delete "$INSTDIR\KaizhiPython.exe"
  Delete "$INSTDIR\Uninstall-KaizhiPython.exe"
  RMDir "$INSTDIR"
SectionEnd
