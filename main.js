const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const AdmZip = require('adm-zip');
let win;

// ---- Pack layout rules: top-level name in pack -> target root ----
const RULES = [
  { re: /^(d3d11\.dll|d3dcompiler_46e\.dll|enb.*)$/i, label: 'ENB', target: 'gta' },
  { re: /^x64$/i, label: 'Sounds (x64)', target: 'gta' },
  { re: /^reshade-(shaders|presets)$/i, label: 'ReShade files', target: 'gta' },
  { re: /^mods$/i, label: 'Mods', target: 'fivem' },
  { re: /^plugins$/i, label: 'Plugins', target: 'fivem' },
  { re: /^citizen$/i, label: 'Citizen', target: 'fivem' },
];
const ruleFor = n => RULES.find(r => r.re.test(n));

// ---- helpers ----
const histFile = () => path.join(app.getPath('userData'), 'history.json');
const readHist = () => { try { return JSON.parse(fs.readFileSync(histFile(), 'utf8')); } catch { return []; } };
const writeHist = h => fs.writeFileSync(histFile(), JSON.stringify(h, null, 2));
const sha = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
const walk = (p, rel, out) => {
  if (fs.statSync(p).isDirectory()) fs.readdirSync(p).forEach(n => walk(path.join(p, n), path.join(rel, n), out));
  else out.push({ src: p, rel });
  return out;
};
function packRoot(dir) {
  let cur = dir;
  for (let i = 0; i < 3; i++) {
    const e = fs.readdirSync(cur);
    if (e.length === 1 && fs.statSync(path.join(cur, e[0])).isDirectory() && !ruleFor(e[0])) cur = path.join(cur, e[0]);
    else break;
  }
  return cur;
}
const detect = root => fs.readdirSync(root).filter(ruleFor).map(n => ({ name: n, ...ruleFor(n), re: undefined }));
function buildPlan(o) {
  const base = { fivem: o.fivem, gta: o.gta };
  return o.components.flatMap(c => walk(path.join(o.root, c.name), c.name, []).map(f => ({ ...f, target: c.target, dest: path.join(base[c.target], f.rel) })));
}

app.whenReady().then(() => {
  win = new BrowserWindow({ width: 1000, height: 900, minWidth: 820, minHeight: 700, frame: false, backgroundColor: '#0f1012',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true } });
  win.loadFile('renderer/index.html');
});
app.on('window-all-closed', () => app.quit());

// ---- window ----
ipcMain.handle('win', (_, a) => { if (a === 'min') win.minimize(); if (a === 'close') win.close(); });
ipcMain.handle('open', (_, u) => shell.openExternal(u));

// ---- pickers ----
ipcMain.handle('pick', async (_, kind) => {
  const r = await dialog.showOpenDialog(win, kind === 'zip'
    ? { properties: ['openFile'], filters: [{ name: 'ZIP', extensions: ['zip'] }] } : { properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});

// ---- auto-detect ----
ipcMain.handle('detect-dirs', () => {
  const fivem = path.join(process.env.LOCALAPPDATA || '', 'FiveM', 'FiveM.app');
  let gta = null;
  try { // FiveM stores the GTA V path itself
    const m = fs.readFileSync(path.join(fivem, 'CitizenFX.ini'), 'utf8').match(/^IVPath=(.+)$/m);
    if (m && fs.existsSync(m[1].trim())) gta = m[1].trim();
  } catch {}
  if (!gta) { // fallback: Steam libraries
    const steam = 'C:\\Program Files (x86)\\Steam';
    const libs = [steam];
    try { for (const m of fs.readFileSync(path.join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8').matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, '\\')); } catch {}
    gta = libs.map(l => path.join(l, 'steamapps', 'common', 'Grand Theft Auto V')).find(fs.existsSync) || null;
  }
  return { fivem: fs.existsSync(fivem) ? fivem : null, gta };
});

// ---- load pack (folder or ZIP) ----
ipcMain.handle('load-pack', (_, src) => {
  let dir = src;
  if (/\.zip$/i.test(src)) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-'));
    new AdmZip(src).extractAllTo(dir, true);
  }
  const root = packRoot(dir);
  return { root, components: detect(root) };
});

// ---- preview / install ----
ipcMain.handle('preview', (_, o) => {
  const plan = buildPlan(o);
  const exist = plan.filter(f => fs.existsSync(f.dest)).length;
  return dialog.showMessageBox(win, { type: 'info', message: 'Install preview',
    detail: `${plan.length} files will be copied.\n${exist} already exist.\n\n${o.components.map(c => `${c.label} -> ${c.target === 'gta' ? 'GTA V' : 'FiveM'}`).join('\n')}` });
});

ipcMain.handle('install', async (_, o) => {
  const plan = buildPlan(o), id = String(Date.now());
  const bdir = path.join(app.getPath('userData'), 'backups', id);
  let policy = o.policy; const files = [];
  for (let i = 0; i < plan.length; i++) {
    const f = plan[i]; let backup = null;
    if (fs.existsSync(f.dest)) {
      if (policy === 'skip') continue;
      if (policy === 'ask') {
        const r = await dialog.showMessageBox(win, { type: 'question', buttons: ['Overwrite', 'Skip'], message: 'File already exists', detail: f.dest, checkboxLabel: 'Apply to all remaining files' });
        const c = r.response === 0 ? 'overwrite' : 'skip';
        if (r.checkboxChecked) policy = c;
        if (c === 'skip') continue;
      }
      if (o.backup) { backup = path.join(bdir, f.target, f.rel); fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.copyFileSync(f.dest, backup); }
    }
    fs.mkdirSync(path.dirname(f.dest), { recursive: true });
    fs.copyFileSync(f.src, f.dest);
    files.push({ dest: f.dest, backup, hash: sha(f.dest) });
    win.webContents.send('progress', { i: i + 1, total: plan.length });
  }
  const h = readHist(); h.push({ id, date: new Date().toISOString(), pack: path.basename(o.root), files }); writeHist(h);
  return { count: files.length, skipped: plan.length - files.length };
});

// ---- history / verify / uninstall ----
ipcMain.handle('history', () => readHist().map(e => ({ id: e.id, date: e.date, pack: e.pack, files: e.files.length })).reverse());
ipcMain.handle('verify', () => {
  const e = readHist().pop(); if (!e) return { none: true };
  const missing = e.files.filter(f => !fs.existsSync(f.dest)).length;
  const changed = e.files.filter(f => fs.existsSync(f.dest) && sha(f.dest) !== f.hash).length;
  return { pack: e.pack, total: e.files.length, missing, changed };
});
ipcMain.handle('uninstall', async () => {
  const h = readHist(), e = h[h.length - 1]; if (!e) return { none: true };
  const r = await dialog.showMessageBox(win, { type: 'warning', buttons: ['Uninstall', 'Cancel'], message: `Uninstall "${e.pack}"?`, detail: 'Installed files are removed and backed-up originals are restored.' });
  if (r.response !== 0) return { cancelled: true };
  for (const f of [...e.files].reverse()) {
    try { if (f.backup && fs.existsSync(f.backup)) fs.copyFileSync(f.backup, f.dest); else fs.rmSync(f.dest, { force: true }); } catch {}
  }
  h.pop(); writeHist(h); return { pack: e.pack, count: e.files.length };
});

// ---- ReShade: read latest FiveM log, add line to CitizenFX.ini ----
// NOTE: the exact log pattern / ini key is the part to verify against your own FiveM log.
const RESHADE_LOG_RE = /reshade[^\r\n]*?([A-Za-z]:\\[^\r\n"]*?\.dll)/i;
const RESHADE_INI_KEY = 'AddDllToLoad';
ipcMain.handle('reshade', (_, fivem) => {
  const logs = path.join(fivem, 'logs');
  const latest = fs.existsSync(logs) && fs.readdirSync(logs).filter(n => /\.log$/i.test(n))
    .map(n => ({ n, t: fs.statSync(path.join(logs, n)).mtimeMs })).sort((a, b) => b.t - a.t)[0];
  if (!latest) return { error: 'No FiveM log found. Launch FiveM to the main menu first, then close it.' };
  const m = fs.readFileSync(path.join(logs, latest.n), 'utf8').match(RESHADE_LOG_RE);
  if (!m) return { error: `No ReShade entry in ${latest.n}. Install ReShade for FiveM, start FiveM to the main menu, then close it.` };
  const ini = path.join(fivem, 'CitizenFX.ini'), line = `${RESHADE_INI_KEY}=${m[1]}`;
  let txt = fs.existsSync(ini) ? fs.readFileSync(ini, 'utf8') : '[Game]\r\n';
  if (txt.includes(line)) return { ok: 'ReShade line is already in CitizenFX.ini.' };
  fs.writeFileSync(ini, txt.replace(/\s*$/, '') + '\r\n' + line + '\r\n');
  return { ok: 'ReShade line added to CitizenFX.ini.' };
});
