const $ = id => document.getElementById(id), api = window.api;
const S = { root: null, comps: [], policy: 'ask' };
const say = (t, bad) => { $('status').textContent = t; $('status').style.color = bad ? 'var(--bad)' : 'var(--dim)'; };
const ready = () => { const ok = S.root && S.comps.length && $('fivem').value && $('gta').value; $('install').disabled = !ok; $('preview').disabled = !ok; $('redetect').disabled = !S.root; };
const opts = () => ({ root: S.root, components: S.comps, fivem: $('fivem').value, gta: $('gta').value, backup: $('backup').checked, policy: S.policy });

async function loadPack(src) {
  if (!src) return;
  $('pack').value = src; say('Reading pack…');
  try {
    const r = await api.invoke('load-pack', src); S.root = r.root; S.comps = r.components;
    $('comps').innerHTML = r.components.length
      ? r.components.map(c => `<li><span>${c.label}</span><em>${c.name} → ${c.target === 'gta' ? 'GTA V' : 'FiveM'}</em></li>`).join('')
      : '<li class="muted">No known components found. Expected folders such as mods, plugins, citizen, x64 or ENB files.</li>';
    say(r.components.length ? '' : 'This pack has no recognised layout.', !r.components.length);
  } catch (e) { say('Could not read the pack: ' + e.message, true); }
  ready();
}
function tag(id, val, msg) { const t = $(id); t.textContent = val ? '✓ auto-detected' : msg; t.className = val ? '' : 'warn'; }

(async () => {
  const d = await api.invoke('detect-dirs');
  $('fivem').value = d.fivem || ''; $('gta').value = d.gta || '';
  tag('fivemTag', d.fivem, 'FiveM not found. Browse to FiveM.app.'); tag('gtaTag', d.gta, 'GTA V not found. Browse to its folder.');
  ready();
})();

$('pickFolder').onclick = async () => loadPack(await api.invoke('pick', 'folder'));
$('pickZip').onclick = async () => loadPack(await api.invoke('pick', 'zip'));
$('redetect').onclick = () => loadPack($('pack').value);
$('bFivem').onclick = async () => { const p = await api.invoke('pick', 'folder'); if (p) { $('fivem').value = p; $('fivemTag').textContent = ''; ready(); } };
$('bGta').onclick = async () => { const p = await api.invoke('pick', 'folder'); if (p) { $('gta').value = p; $('gtaTag').textContent = ''; ready(); } };
$('policy').onclick = e => { const p = e.target.dataset.p; if (!p) return; S.policy = p; [...$('policy').querySelectorAll('button')].forEach(b => b.classList.toggle('on', b.dataset.p === p)); };
$('preview').onclick = () => api.invoke('preview', opts());

$('install').onclick = async () => {
  $('install').disabled = true; say('Installing…');
  api.onProgress(({ i, total }) => $('prog').firstChild.style.width = (i / total * 100) + '%');
  try { const r = await api.invoke('install', opts()); say(`Installed ${r.count} files${r.skipped ? `, skipped ${r.skipped}` : ''}.`); }
  catch (e) { say('Install failed: ' + e.message, true); }
  ready();
};
$('verify').onclick = async () => {
  const r = await api.invoke('verify');
  say(r.none ? 'Nothing installed yet.' : `${r.pack}: ${r.total - r.missing - r.changed} of ${r.total} files OK, ${r.missing} missing, ${r.changed} changed.`, !r.none && (r.missing || r.changed));
};
$('uninstall').onclick = async () => {
  const r = await api.invoke('uninstall');
  if (r.none) say('Nothing to uninstall.'); else if (!r.cancelled) say(`Uninstalled ${r.pack} (${r.count} files).`);
};
$('reshade').onclick = async () => {
  const r = await api.invoke('reshade', $('fivem').value);
  $('rsMsg').textContent = r.error || r.ok; $('rsMsg').className = r.error ? 'warn' : '';
};
$('history').onclick = async () => {
  const h = await api.invoke('history');
  $('hist').innerHTML = h.length ? h.map(e => `<li><span>${e.pack}</span><em class="muted">${new Date(e.date).toLocaleString()} · ${e.files} files</em></li>`).join('') : '<li class="muted">No installs yet.</li>';
  $('modal').hidden = false;
};
$('mclose').onclick = () => $('modal').hidden = true;
$('min').onclick = () => api.invoke('win', 'min'); $('close').onclick = () => api.invoke('win', 'close');
