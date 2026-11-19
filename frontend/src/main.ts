import './document/map-compat.mjs';
import { isPythonDesktop } from './sdk/python';

if (isPythonDesktop) {
  void import('./desktop-app');
} else {
  document.getElementById('app')!.textContent = '请通过阅迁星穹桌面程序或 Start.cmd 打开阅读器。';
}
