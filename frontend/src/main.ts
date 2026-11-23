import './document/map-compat.mjs';
import { invoke, isPythonDesktop } from './sdk/python';
import { installErrorLog, reportClientError } from './ui/error-log.ts';
import { isChunkError, reloadOnce } from './ui/chunk-reload.ts';

if (isPythonDesktop) {
  // 越早挂越好：界面本体还没加载时出的错也要进本机日志。
  installErrorLog(entry => invoke('client_log', entry));
  import('./desktop-app').catch(error => {
    reportClientError('boot', error);
    // 入口 chunk 没取到（多见于刚升级完）：整页刷新一次；仍失败就留一句能看懂的话，而不是一片空白。
    if (isChunkError(error) && reloadOnce('desktop-app')) return;
    const root = document.getElementById('app');
    if (root) {
      root.style.cssText = 'padding:48px 56px;font:15px/1.8 system-ui,sans-serif;color:#8a8780;max-width:640px';
      root.textContent = '界面没能加载出来。请关闭后重新打开阅迁星穹；如果反复出现，请把数据目录 logs\\app.log 发给开发者（%APPDATA%\\com.phydog.reading.python\\logs）。';
    }
  });
} else {
  document.getElementById('app')!.textContent = '请通过阅迁星穹桌面程序或 Start.cmd 打开阅读器。';
}
