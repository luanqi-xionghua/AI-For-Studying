import { createApp } from 'vue';
import App from './App.vue';
import '@fontsource-variable/source-serif-4/opsz.css';
import './styles/fonts.css';
import './styles.css';
import './styles/liquid-glass.css';
import './styles/select.css';
import './styles/themes.css';
import { installLiquidGlass } from './ui/liquid-glass';
import { installTooltips } from './ui/tooltip';
import { installRefraction } from './ui/refraction';
import { installGlassMotion } from './ui/glass-motion';
import { loadSettings } from './settings';

// The first immediate appearance watcher must see the real settings, not a preview which
// then crossfades into the real theme. Do not gate mounting on the book list or covers.
let startupError = '';
try { await loadSettings(); } catch (error) {
  startupError = error instanceof Error ? error.message : String(error);
}
const app = createApp(App, { startupError });
app.mount('#app');
const disposeGlass = installLiquidGlass(document.getElementById('app')!);
const disposeTooltips = installTooltips(document.getElementById('app')!);
const disposeRefraction = installRefraction(document.getElementById('app')!);
const disposeGlassMotion = installGlassMotion();
app.onUnmount(() => { disposeGlass(); disposeTooltips(); disposeRefraction(); disposeGlassMotion(); });
if (import.meta.hot) import.meta.hot.dispose(() => { disposeGlass(); disposeTooltips(); disposeRefraction(); disposeGlassMotion(); });
