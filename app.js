(function () {
  'use strict';

  const api = window.runicAPI;
  if (!api) return;

  let settings = {};
  let versionsData = null;
  let isLaunching = false;
  let instancesCache = [];
  let detectedCache = [];
  let viconOverrides = {};
  let pendingDownload = null; // { instanceId }

  // ----------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------
  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.from((ctx || document).querySelectorAll(sel)); }

  function debounce(fn, ms) {
    let timer;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, arguments), ms);
    };
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ----------------------------------------------------------
  // ICONOS AUTOMÁTICOS (deterministas por semilla)
  // ----------------------------------------------------------
  const ICON_GLYPHS = ['⛏️', '⚔️', '🛡️', '💎', '🔥', '❄️', '🌿', '⭐', '☠️', '👑', '🏹', '🗺️', '🧪', '🐉', '🏰', '✦'];
  const ICON_COLORS = ['#a855f7', '#c9a959', '#ef4444', '#3b82f6', '#22c55e', '#f97316', '#14b8a6', '#ec4899', '#64748b', '#84cc16'];

  function hashString(str) {
    let h = 5381;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h;
  }

  function shadeColor(hex, amt) {
    const n = parseInt(String(hex).slice(1), 16);
    const ch = (v) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) : -v) * Math.abs(amt) / 100)));
    const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function autoIconFor(seed) {
    const h = hashString(seed);
    return {
      glyph: ICON_GLYPHS[h % ICON_GLYPHS.length],
      color: ICON_COLORS[(h >>> 4) % ICON_COLORS.length]
    };
  }

  function iconFor(seed, customGlyph, customColor) {
    const auto = autoIconFor(seed);
    if (customGlyph) return { glyph: customGlyph, color: customColor || auto.color, isAuto: false };
    return { glyph: auto.glyph, color: auto.color, isAuto: true };
  }

  function iconHtml(icon, size) {
    const c2 = shadeColor(icon.color, -38);
    return `<div class="inst-icon${size === 'sm' ? ' sm' : ''}" style="background:linear-gradient(135deg, ${icon.color}, ${c2})"><span>${icon.glyph}</span></div>`;
  }

  let iconPickerEl = null;
  function openIconPicker(opts) {
    const sel = { glyph: opts.current.glyph, color: opts.current.color, isAuto: !!opts.current.isAuto };

    function paintPreview() {
      const prev = iconPickerEl.querySelector('#ip-preview');
      prev.innerHTML = iconHtml(sel);
      iconPickerEl.querySelectorAll('.ip-glyph').forEach(b => b.classList.toggle('active', b.dataset.g === sel.glyph));
      iconPickerEl.querySelectorAll('.ip-color').forEach(b => b.classList.toggle('active', b.dataset.c.toLowerCase() === String(sel.color).toLowerCase()));
    }

    if (!iconPickerEl) {
      iconPickerEl = document.createElement('div');
      iconPickerEl.className = 'modal-overlay';
      iconPickerEl.innerHTML = `
        <div class="modal-card icon-picker-modal">
          <h3 id="ip-title" class="modal-title">Cambiar icono</h3>
          <div class="ip-preview" id="ip-preview"></div>
          <div class="ip-label">Símbolo</div>
          <div class="ip-glyphs" id="ip-glyphs"></div>
          <div class="ip-label">Color</div>
          <div class="ip-colors" id="ip-colors"></div>
          <div class="modal-actions">
            <button class="btn btn-ghost btn-sm" id="ip-auto">Automático</button>
            <button class="btn btn-glass btn-sm" id="ip-cancel">Cancelar</button>
            <button class="btn btn-primary btn-sm" id="ip-save">Guardar</button>
          </div>
        </div>`;
      document.body.appendChild(iconPickerEl);

      iconPickerEl.querySelector('#ip-glyphs').innerHTML =
        ICON_GLYPHS.map(g => `<button class="ip-glyph" data-g="${g}">${g}</button>`).join('');
      iconPickerEl.querySelector('#ip-colors').innerHTML =
        ICON_COLORS.map(c => `<button class="ip-color" data-c="${c}" style="background:${c}"></button>`).join('');

      iconPickerEl.querySelector('#ip-glyphs').addEventListener('click', (e) => {
        const b = e.target.closest('.ip-glyph');
        if (!b) return;
        sel.glyph = b.dataset.g; sel.isAuto = false;
        paintPreview();
      });
      iconPickerEl.querySelector('#ip-colors').addEventListener('click', (e) => {
        const b = e.target.closest('.ip-color');
        if (!b) return;
        sel.color = b.dataset.c; sel.isAuto = false;
        paintPreview();
      });
      iconPickerEl.querySelector('#ip-cancel').addEventListener('click', closeIconPicker);
      iconPickerEl.addEventListener('click', (e) => { if (e.target === iconPickerEl) closeIconPicker(); });
      iconPickerEl.querySelector('#ip-save').addEventListener('click', () => {
        const cb = iconPickerEl._onSave;
        closeIconPicker();
        if (cb) cb(sel);
      });
    }

    iconPickerEl._onSave = opts.onSave || null;
    iconPickerEl.querySelector('#ip-title').textContent = opts.title || 'Cambiar icono';
    iconPickerEl.querySelector('#ip-auto').onclick = () => {
      const auto = autoIconFor(opts.seed || '');
      sel.glyph = auto.glyph; sel.color = auto.color; sel.isAuto = true;
      paintPreview();
    };
    paintPreview();
    iconPickerEl.classList.add('open');
  }

  function closeIconPicker() {
    if (iconPickerEl) iconPickerEl.classList.remove('open');
  }

  async function loadSettings() {
    try {
      settings = await api.getSettings();
    } catch (e) {
      settings = { username: 'Usuario', ram: 4 };
    }
    return settings;
  }

  async function saveSettings() {
    try { await api.saveSettings(settings); } catch (e) {}
  }

  function activeAccount() {
    const accs = settings.accounts || [];
    return accs.find(a => a.name === settings.username) || accs[0] || null;
  }

  // ----------------------------------------------------------
  // 1. NAVIGATION
  // ----------------------------------------------------------
  const navItems = document.querySelectorAll('.nav-item[data-page]');
  const pages = document.querySelectorAll('.page');
  let currentPage = 'home';

  function navigateTo(pageId) {
    navItems.forEach(item => {
      item.classList.toggle('active', item.dataset.page === pageId);
    });
    pages.forEach(page => {
      page.classList.remove('active');
      if (page.id === `page-${pageId}`) page.classList.add('active');
    });
    currentPage = pageId;
  }

  navItems.forEach(item => {
    item.addEventListener('click', function () { soundManager.play('whoosh'); navigateTo(this.dataset.page); });
  });
  window.navigateTo = navigateTo;

  // ----------------------------------------------------------
  // 2. WINDOW CONTROLS
  // ----------------------------------------------------------
  $('#btn-minimize').addEventListener('click', () => { soundManager.play('click'); api.minimize(); });
  $('#btn-maximize').addEventListener('click', () => { soundManager.play('click'); api.maximize(); });
  $('#btn-close').addEventListener('click', () => { soundManager.play('whoosh'); api.close(); });

  api.onMaximizeChange((isMax) => {
    const btn = $('#btn-maximize svg rect');
    if (btn) btn.setAttribute('width', isMax ? '12' : '14');
    if (btn) btn.setAttribute('height', isMax ? '12' : '14');
    if (btn) btn.setAttribute('x', isMax ? '6' : '5');
    if (btn) btn.setAttribute('y', isMax ? '6' : '5');
  });

  // ----------------------------------------------------------
  // 3. VERSION + LOADER SELECTOR (hero)
  // ----------------------------------------------------------
  const versionSelector = $('#version-select-hero');
  const versionDropdown = $('#version-dropdown-hero');
  const versionLabel = $('#selected-version');

  let currentLoaderType = settings.loaderType || 'vanilla';
  let currentLoaderVersion = settings.loaderVersion || '';

  function populateVersionDropdown() {
    if (!versionDropdown) return;
    const releases = (versionsData && versionsData.releases) || [];
    const snapshots = (versionsData && versionsData.snapshots) || [];
    let html = '';
    if (releases.length) {
      html += '<div class="version-group-label">Lanzamientos (' + releases.length + ')</div>';
      releases.forEach(v => {
        const sel = v.id === (settings.selectedVersion || '1.21.4') ? ' selected' : '';
        html += `<button class="version-option${sel}" data-version="${escapeHtml(v.id)}">${escapeHtml(v.id)}</button>`;
      });
    }
    if (snapshots.length) {
      html += '<div class="version-group-label">Snapshots (' + snapshots.length + ')</div>';
      snapshots.slice(0, 30).forEach(v => {
        const sel = v.id === settings.selectedVersion ? ' selected' : '';
        html += `<button class="version-option${sel}" data-version="${escapeHtml(v.id)}">${escapeHtml(v.id)}</button>`;
      });
    }
    versionDropdown.innerHTML = html;
    syncVersionUI(settings.selectedVersion || '1.21.4');

    versionDropdown.querySelectorAll('.version-option').forEach(opt => {
      opt.addEventListener('click', function () {
        versionDropdown.querySelectorAll('.version-option').forEach(o => o.classList.remove('selected'));
        this.classList.add('selected');
        if (this.dataset.version === '__runic_pvp__') {
          settings.selectedVersion = '__runic_pvp__';
          settings.loaderType = 'vanilla';
          currentLoaderVersion = '';
          settings.loaderVersion = '';
          saveSettings();
          syncVersionUI("Runic PvP");
          updatePlayButtonState();
          refreshLoaderVersions();
          versionSelector.classList.remove('open');
          return;
        }
        settings.selectedVersion = this.dataset.version;
        currentLoaderVersion = '';
        settings.loaderVersion = '';
        saveSettings();
        syncVersionUI(settings.selectedVersion);
        updatePlayButtonState();
        refreshLoaderVersions();
        versionSelector.classList.remove('open');
      });
    });
  }

  function syncVersionUI(ver) {
    if (versionLabel) versionLabel.textContent = ver || settings.selectedVersion || '1.21.4';
  }

  async function fetchLoaderVersionsForHero(loaderType, mcVersion) {
    const field = document.getElementById('loader-version-select');
    const dropdown = document.getElementById('loader-version-dropdown');
    if (!field || !dropdown) return;
    if (loaderType === 'vanilla' || loaderType === 'runicpvp') {
      field.style.display = 'none';
      return;
    }
    try {
      const data = await api.getLoaderVersions(loaderType, mcVersion);
      if (!data || data.error || !Array.isArray(data)) {
        field.style.display = 'none';
        return;
      }
      if (!data.length) {
        dropdown.innerHTML = '<option value="">Sin versiones</option>';
        field.style.display = '';
        return;
      }
      let html = '';
      data.forEach((item, i) => {
        const ver = item.loaderVersion || item.forgeVersion || item.neoforgeVersion || item.patch || item;
        const selected = (i === 0 && !currentLoaderVersion) || ver === currentLoaderVersion ? ' selected' : '';
        html += `<option value="${escapeHtml(ver)}"${selected}>${escapeHtml(ver)}${item.stable === false ? ' (beta)' : ''}${item.type === 'recommended' ? ' ★' : ''}</option>`;
      });
      dropdown.innerHTML = html;
      field.style.display = '';
      if (!currentLoaderVersion && dropdown.options.length > 0) {
        currentLoaderVersion = dropdown.value;
        settings.loaderVersion = currentLoaderVersion;
        saveSettings();
      }
    } catch (e) {
      field.style.display = 'none';
    }
  }

  function refreshLoaderVersions() {
    if (currentLoaderType && currentLoaderType !== 'vanilla' && currentLoaderType !== 'runicpvp') {
      fetchLoaderVersionsForHero(currentLoaderType, settings.selectedVersion || '1.21.4');
    }
  }

  function refreshLoaderButtons() {
    const selector = document.getElementById('loader-selector');
    if (!selector) return;
    selector.querySelectorAll('.loader-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.loader === currentLoaderType);
    });
  }

  document.getElementById('loader-selector')?.querySelectorAll('.loader-btn').forEach(btn => {
    btn.addEventListener('click', function () {
      if (this.classList.contains('active')) return;
      document.querySelectorAll('#loader-selector .loader-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      currentLoaderType = this.dataset.loader;
      currentLoaderVersion = '';
      if (currentLoaderType === 'runicpvp') {
        // Guardar versión previa y fijar 1.8.9 del cliente PvP
        if (!String(settings.selectedVersion || '').startsWith('runic-client-pvp') && !settings.__prevVer) {
          settings.__prevVer = settings.selectedVersion || null;
        }
        settings.loaderType = currentLoaderType;
        settings.selectedVersion = '1.8.9';
        saveSettings();
        syncVersionUI('1.8.9');
        updatePlayButtonState();
        versionSelector.classList.remove('open');
        return;
      }
      settings.loaderType = currentLoaderType;
      settings.loaderVersion = '';
      if (settings.__prevVer && currentLoaderType !== 'runicpvp') {
        settings.selectedVersion = settings.__prevVer;
        settings.__prevVer = null;
      }
      saveSettings();
      fetchLoaderVersionsForHero(currentLoaderType, settings.selectedVersion || '1.21.4');
      updatePlayButtonState();
    });
  });

  document.getElementById('loader-version-dropdown')?.addEventListener('change', function () {
    currentLoaderVersion = this.value;
    settings.loaderVersion = this.value;
    saveSettings();
    updatePlayButtonState();
  });

  if (versionSelector) {
    const btn = versionSelector.querySelector('.version-select-btn');
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        $$('.version-select').forEach(sel => { if (sel !== versionSelector) sel.classList.remove('open'); });
        versionSelector.classList.toggle('open');
      });
    }
  }
  document.addEventListener('click', () => {
    $$('.version-select').forEach(sel => sel.classList.remove('open'));
  });

  // ----------------------------------------------------------
  // 4. PLAY BUTTON + LAUNCH
  // ----------------------------------------------------------
  const playBtn = $('#btn-play-hero');

  async function updatePlayButtonState() {
    if (!playBtn || isLaunching) return;
    const ver = settings.selectedVersion || '1.21.4';
    if (settings.loaderType === 'runicpvp') {
      let pvpOk = false;
      playBtn.innerHTML = '<svg class="btn-icon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/></svg> ' + (pvpOk ? 'Jugar PvP' : 'Instalar Runic PvP');
      playBtn.className = 'btn btn-play' + (pvpOk ? '' : ' pvp-install');
      return;
    }
    let label = 'Descargar y jugar';
    try {
      const res = await api.checkVersionInstalled(ver);
      if (res && res.installed) label = 'Jugar';
    } catch (e) {}
    playBtn.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor" stroke="none"/></svg> ${label}`;
    playBtn.className = 'btn btn-play';
  }

  function setPlayState(state, message) {
    if (!playBtn) return;
    playBtn.disabled = state === 'loading' || state === 'error';
    switch (state) {
      case 'idle':
        isLaunching = false;
        hideLaunchOverlay();
        updatePlayButtonState();
        break;
      case 'loading':
        playBtn.innerHTML = `<svg class="btn-icon spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.4 31.4" stroke-linecap="round"/></svg> ${message || 'Preparando...'}`;
        playBtn.className = 'btn btn-play loading';
        isLaunching = true;
        break;
      case 'error':
        playBtn.innerHTML = `<svg class="btn-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2"/><line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2"/></svg> Error`;
        playBtn.className = 'btn btn-play error';
        setTimeout(() => setPlayState('idle'), 2500);
        break;
    }
  }

  playBtn.addEventListener('click', function () {
    if (isLaunching) return;
    doLaunch();
  });

  async function doLaunch(extra) {
    extra = extra || {};
    const accNow = activeAccount();
    if (!accNow || !(settings.username || "").trim()) {
      showToast("Primero crea tu cuenta para jugar", "error");
      maybeShowFirstAccountModal();
      return;
    }
    // ===== RUNIC CLIENT PVP =====
    // Lanza vanilla 1.8.9 limpio (el botón es visual/branding)
    if (!extra.instanceId && currentLoaderType === 'runicpvp') {
      hideLaunchOverlay();
      setPlayState('loading', 'Iniciando...');
      showLaunchOverlay('Iniciando...');
      const opts2 = {
        username: settings.username || 'Usuario',
        version: '1.8.9',
        ram: settings.ram || 4,
        javaVersion: settings.javaVersion || 'auto',
        resolution: settings.resolution || 'Pantalla completa',
        fastBoot: !!settings.fastBoot,
        gameDir: settings.gameDir || null,
        elybyNick: (accNow.elybyNick) || ''
      };
      setOverlayProgress(null, 'Iniciando Minecraft 1.8.9...', '');
      api.launchGame(opts2);
      return;
    }
    if (!accNow || !(settings.username || "").trim()) {
      showToast("Primero crea tu cuenta para jugar", "error");
      maybeShowFirstAccountModal();
      return;
    }
    setPlayState('loading', 'Iniciando...');
    if (copyLogBtn) copyLogBtn.style.display = 'none';
    showLaunchOverlay('Verificando Java...');

    let javaInfo = { found: true };
    try { javaInfo = await api.checkJava(); } catch (e) {}
    if (!javaInfo || !javaInfo.found) {
      hideLaunchOverlay();
      setPlayState('error');
      showToast('No se encontró Java. Añade su carpeta en Ajustes → Carpetas Java adicionales.', 'error');
      navigateTo('settings');
      return;
    }

    const inst = extra.instanceId ? instancesCache.find(i => i.id === extra.instanceId) : null;
    const acc = activeAccount();

    const opts = {
      username: settings.username || 'Usuario',
      version: inst ? inst.mcVersion : (extra.version || settings.selectedVersion || '1.21.4'),
      ram: (inst && inst.ram) || settings.ram || 4,
      javaVersion: settings.javaVersion || 'auto',
      resolution: (inst && inst.resolution) || settings.resolution || 'Pantalla completa',
      fastBoot: !!settings.fastBoot,
      gameDir: settings.gameDir || null,
      instanceId: inst ? inst.id : null,
      loader: inst ? (inst.loaderType || 'vanilla') : (currentLoaderType || 'vanilla'),
      loaderVersion: inst ? (inst.loaderVersion || '') : (currentLoaderVersion || ''),
      elybyNick: (acc && acc.elybyNick) || ''
    };
    if (extra.serverIp) opts.serverIp = extra.serverIp;
    if (extra.customId) { opts.customId = extra.customId; opts.vanillaVersion = extra.baseVersion || opts.version; }
    if (extra.gameDir) opts.gameDir = extra.gameDir;

    api.launchGame(opts);
  }

  // ----------------------------------------------------------
  // 5. LAUNCH OVERLAY + STATUS
  // ----------------------------------------------------------
  const overlay = $('#launch-overlay');
  const launchTask = $('#launch-task');
  const launchSubtask = $('#launch-subtask');
  const launchBar = $('#launch-progress-bar');
  const cancelBtn = $('#btn-cancel-launch');

  function setOverlayStep(n) {
    const steps = document.querySelectorAll('#launch-steps .lstep');
    steps.forEach((el, i) => {
      el.classList.toggle('done', i < n - 1);
      el.classList.toggle('active', i === n - 1);
    });
  }

  function showLaunchOverlay(task) {
    if (!overlay) return;
    if (task && launchTask) launchTask.textContent = task;
    if (launchSubtask) launchSubtask.textContent = '';
    if (launchBar) { launchBar.style.width = '0%'; launchBar.classList.add('indet'); }
    setOverlayStep(1);
    overlay.classList.add('open');
  }

  function hideLaunchOverlay() {
    if (!overlay) return;
    overlay.classList.remove('open');
  }

  function setOverlayProgress(pct, task, sub) {
    if (launchTask && task) launchTask.textContent = task;
    if (launchSubtask && sub) launchSubtask.textContent = sub;
    if (launchBar && typeof pct === 'number') {
      launchBar.classList.remove('indet');
      launchBar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    }
  }

  cancelBtn.addEventListener('click', function () {
    api.killGame();
    hideLaunchOverlay();
    setPlayState('idle');
    showToast('Proceso detenido', 'info');
  });

  api.onLaunchStatus((data) => {
    switch (data.type) {
      case 'start':
        setPlayState('loading', 'Preparando...');
        showLaunchOverlay('Preparando...');
        cancelBtn.style.visibility = 'visible';
        break;
      case 'progress':
        {
          let pct = null;
          let label = typeof data.task === 'string' ? data.task : 'Descargando...';
          let sub = '';
          const tl0 = label.toLowerCase();
          if (tl0.includes('java')) setOverlayStep(1);
          else if (/instalando|loader|forge|fabric|neoforge|optifine/.test(tl0)) setOverlayStep(3);
          else setOverlayStep(2);
          if (data.total > 0 && data.current >= 0) {
            pct = Math.round((data.current / data.total) * 100);
            label = pct + '% · ' + label;
          } else if (data.total === 0 && data.current > 0) {
            sub = data.current + ' archivos';
          }
          if (overlay && overlay.classList.contains('open')) {
            setOverlayProgress(pct, label, sub);
          }
          setPlayState('loading', label);
        }
        break;
      case 'debug':
        console.log('[MCLC]', data.message);
        break;
      case 'launching':
        setOverlayStep(4);
        launchBar.classList.remove('indet');
        launchBar.style.width = '100%';
        launchTask.textContent = 'Minecraft iniciado';
        cancelBtn.style.visibility = 'hidden';
        setPlayState('loading', '¡Jugando!');
        showToast('Minecraft iniciado — el launcher se minimiza a la bandeja', 'info');
        if (settings.minimizeToTrayOnLaunch !== false) {
          setTimeout(() => api.hideToTray(), 800);
        }
        break;
      case 'exit':
        cancelBtn.style.visibility = 'hidden';
        hideLaunchOverlay();
        setPlayState('idle');
        showToast('Minecraft cerrado' + (data.code !== 0 ? ' (código ' + data.code + ')' : ''), 'info');
        refreshInstances().catch(() => {});
        break;
    }
  });

  const copyLogBtn = document.getElementById('btn-copy-log');
  copyLogBtn?.addEventListener("click", async function () {
    try {
      const txt = await api.getLaunchLog();
      await navigator.clipboard.writeText(txt || "(log vacio)");
      this.textContent = "Copiado";
      setTimeout(() => { this.textContent = "Copiar log"; this.style.display = "none"; }, 1500);
    } catch (e) { showToast("No se pudo copiar", "error"); }
  });

  api.onLaunchError((msg) => {
    console.error('[Launch Error]', msg);
    setPlayState('error');
    if (copyLogBtn) copyLogBtn.style.display = "";
    showToast(msg, 'error');
  });

  // ----------------------------------------------------------
  // 6. TOAST
  // ----------------------------------------------------------
  const NOTIF_ICONS = {
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
  };

  function showToast(message, type) {
    const stack = document.getElementById('notif-stack');
    if (!stack) return;
    while (stack.children.length >= 4) stack.firstElementChild.remove();

    const kind = NOTIF_ICONS[type] ? type : 'info';
    const el = document.createElement('div');
    el.className = 'notif ' + kind;
    const dur = kind === 'error' ? 6000 : 4200;
    el.innerHTML =
      '<span class="notif-icon">' + (NOTIF_ICONS[kind] || NOTIF_ICONS.info) + '</span>' +
      '<span class="notif-body"><span class="notif-msg">' + escapeHtml(message) + '</span></span>' +
      '<button class="notif-close" aria-label="Cerrar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
      '<span class="notif-progress" style="animation-duration:' + dur + 'ms"></span>';

    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      el.classList.add('out');
      setTimeout(() => el.remove(), 300);
    };
    el.querySelector('.notif-close').addEventListener('click', close);
    stack.appendChild(el);
    const timer = setTimeout(close, dur);

    if (type === 'error') soundManager.play('error');
    else soundManager.play('click');
  }

  window.showToast = showToast;

  // ----------------------------------------------------------
  // 6c. SOUND MANAGER (efectos de audio para la app)
  // ----------------------------------------------------------
  const soundManager = {
    enabled: true,
    sounds: {},
    files: {
      startup: 'assets/sounds/startup.wav',
      click: 'assets/sounds/click.wav',
      whoosh: 'assets/sounds/whoosh.wav',
      error: 'assets/sounds/error.wav'
    },
    init() {
      Object.keys(this.files).forEach(k => {
        if (this.sounds[k]) return;
        try {
          const a = new Audio(this.files[k]);
          a.preload = 'auto';
          a.volume = k === 'startup' ? 0.5 : 0.35;
          this.sounds[k] = a;
        } catch (e) {}
      });
    },
    play(name) {
      if (!this.enabled) return;
      const s = this.sounds[name];
      if (!s) return;
      try {
        s.currentTime = 0;
        const p = s.play();
        if (p && p.catch) p.catch(() => {});
      } catch (e) {}
    }
  };
  soundManager.init();

  // ----------------------------------------------------------
  // 6b. MODAL GENÉRICO (reemplaza confirm() y prompt() nativos)
  // ----------------------------------------------------------
  const genericModal = document.getElementById('modal-generic');
  const genericTitleEl = document.getElementById('generic-title');
  const genericMsgEl = document.getElementById('generic-message');
  const genericFieldEl = document.getElementById('generic-input-field');
  const genericInputEl = document.getElementById('generic-input');
  const genericChoicesEl = document.getElementById('generic-choices');
  const genericActionsEl = document.getElementById('generic-actions');
  let genericDone = null;

  function closeGeneric(result) {
    if (!genericModal || !genericModal.classList.contains('open')) return;
    genericModal.classList.remove('open');
    console.log('[ui] generic close ->', result);
    const done = genericDone;
    genericDone = null;
    if (done) done(result);
  }

  function showGeneric(o) {
    if (!genericModal) {
      // Fallback extremo (no debería ocurrir): diálogos nativos
      if (o.choices) o.resolve((o.choicesList && o.choicesList[0] && o.choicesList[0].id) || null);
      else if (o.input) o.resolve(window.prompt(o.title || '', o.value || ''));
      else o.resolve(window.confirm((o.message || '') + '\n' + (o.title || '')));
      return;
    }
    closeGeneric(null);

    // Guardar el resolve de la promesa: sin esto, confirmar nunca resuelve
    genericDone = o.resolve;

    genericTitleEl.textContent = o.title || '';
    genericTitleEl.style.display = o.title ? '' : 'none';
    genericMsgEl.textContent = o.message || '';
    genericMsgEl.style.display = o.message ? '' : 'none';

    genericFieldEl.style.display = o.input ? '' : 'none';
    genericInputEl.value = o.value || '';
    genericInputEl.placeholder = o.placeholder || '';

    genericChoicesEl.innerHTML = '';
    const list = Array.isArray(o.choicesList) ? o.choicesList : [];
    genericChoicesEl.style.display = list.length ? '' : 'none';
    list.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'choice-option' + (c.danger ? ' danger' : '') + (i === (o.defaultIndex || 0) ? ' selected' : '');
      btn.innerHTML =
        '<span class="choice-radio"></span>' +
        '<span class="choice-text">' +
          '<span class="choice-label">' + escapeHtml(c.label) + '</span>' +
          (c.desc ? '<span class="choice-desc">' + escapeHtml(c.desc) + '</span>' : '') +
        '</span>';
      btn.addEventListener('click', () => {
        genericChoicesEl.querySelectorAll('.choice-option').forEach((el, j) => el.classList.toggle('selected', el === btn));
        void i;
      });
      genericChoicesEl.appendChild(btn);
    });

    genericActionsEl.innerHTML = '';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost';
    cancelBtn.textContent = o.cancelText || 'Cancelar';
    cancelBtn.addEventListener('click', () => { soundManager.play('whoosh'); closeGeneric(o.choices ? null : (o.input ? null : false)); });
    genericActionsEl.appendChild(cancelBtn);

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary');
    okBtn.textContent = o.okText || 'Aceptar';
    okBtn.addEventListener('click', () => {
      soundManager.play('click');
      if (list.length) {
        const opts = genericChoicesEl.querySelectorAll('.choice-option');
        let idx = 0;
        opts.forEach((el, j) => { if (el.classList.contains('selected')) idx = j; });
        closeGeneric(list[idx] ? list[idx].id : null);
      } else if (o.input) {
        closeGeneric(genericInputEl.value.trim() || null);
      } else {
        closeGeneric(true);
      }
    });
    genericActionsEl.appendChild(okBtn);

    genericModal.classList.add('open');
    if (o.input) setTimeout(() => genericInputEl.focus(), 60);
  }

  function uiConfirm(opts) {
    return new Promise(resolve => showGeneric(Object.assign({ resolve }, opts)));
  }
  function uiPrompt(opts) {
    return new Promise(resolve => showGeneric(Object.assign({ resolve, input: true }, opts)));
  }
  function uiChoices(opts) {
    return new Promise(resolve => showGeneric(Object.assign({ resolve, choices: true }, opts)));
  }

  genericModal?.addEventListener('click', e => { if (e.target === genericModal) closeGeneric(null); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && genericModal.classList.contains('open')) closeGeneric(null);
    else if (e.key === 'Tab' && genericModal.classList.contains('open')) {
      const focusables = genericModal.querySelectorAll('button, input, select');
      if (!focusables.length) return;
      const first = focusables[0], last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  genericInputEl?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const ok = genericActionsEl.querySelector('.btn-primary, .btn-danger');
      if (ok) ok.click();
    }
  });

  // ----------------------------------------------------------
  // 7. INSTANCES PAGE
  // ----------------------------------------------------------
  const instancesGrid = document.getElementById('instances-grid');
  const detectedGrid = document.getElementById('detected-grid');

  async function refreshInstances() {
    try { instancesCache = await api.listInstances(); } catch (e) { instancesCache = []; }
    renderInstancesGrid();
    updateProfileStats();
  }

  function formatLastPlayed(ts) {
    if (!ts) return 'Nunca jugada';
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Hace un momento';
    if (mins < 60) return `Hace ${mins} min`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `Hace ${hours} h`;
    const days = Math.floor(hours / 24);
    return `Hace ${days} día${days !== 1 ? 's' : ''}`;
  }

  const ICON_DOTS = '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/></svg>';
  const ICON_PENCIL = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>';

  async function deleteInstanceFlow(id) {
    const inst = instancesCache.find(i => i.id === id);
    if (!inst) return;
    const choice = await uiChoices({
      title: "Eliminar \"" + inst.name + "\"",
      message: "¿Qué quieres conservar de esta instancia?",
      choicesList: [
        { id: "all", label: "Eliminar todo", desc: "Borra la instancia, sus mundos, mods y configuración del disco.", danger: true },
        { id: "keep-saves", label: "Conservar mundos", desc: "Mueve los mundos a la carpeta compartida del juego y borra el resto." },
        { id: "list-only", label: "Solo quitar de la lista", desc: "La carpeta queda intacta en el disco por si quieres recuperarla." }
      ],
      defaultIndex: 0,
      okText: "Eliminar",
      danger: true
    });
    const res = await api.removeInstance(id, choice);
    if (res && res.success) {
      showToast(res.warning || (res.message ? "Instancia eliminada." + res.message : "Instancia eliminada"), res.warning ? "error" : "info");
      refreshInstances();
    } else showToast((res && res.error) || "No se pudo eliminar", "error");
  }

  function closeInstMenu() { document.querySelectorAll(".inst-menu").forEach(m => m.remove()); }
  document.addEventListener("click", () => closeInstMenu());

  function openInstanceMenu(id, evt) {
    closeInstMenu();
    const inst = instancesCache.find(i => i.id === id);
    if (!inst) return;
    const menu = document.createElement("div");
    menu.className = "inst-menu";
    const items = [
      ['play', 'Jugar'],
      ['rename', 'Renombrar'],
      ['dup', 'Duplicar'],
      ['folder', 'Abrir carpeta'],
      ['icon', 'Cambiar icono'],
      ['del', 'Eliminar']
    ];
    menu.innerHTML = items.map(([k, label]) => '<button class="inst-menu-item' + (k === 'del' ? ' danger' : '') + '" data-k="' + k + '">' + label + '</button>').join('');
    menu.style.top = (evt.pageY + 4) + 'px';
    menu.style.left = Math.min(evt.pageX - 120, window.innerWidth - 190) + 'px';
    document.body.appendChild(menu);
    menu.addEventListener('click', async e2 => {
      const k = e2.target.closest(".inst-menu-item")?.dataset.k;
      if (!k) return;
      closeInstMenu();
      if (k === 'play') { doLaunch({ instanceId: id }); return; }
      if (k === 'rename') {
        const v = await uiPrompt({ title: "Renombrar instancia", value: inst.name, okText: "Guardar" });
        if (!v) return;
        await api.updateInstance(id, { name: v }); refreshInstances(); showToast("Renombrada", "info"); return;
      }
      if (k === 'dup') { await api.duplicateInstance(id); refreshInstances(); showToast('Duplicada', 'info'); return; }
      if (k === 'folder') { api.openInstanceDir(id); return; }
      if (k === 'icon') {
        const inst2 = instancesCache.find(i => i.id === id);
        if (!inst2) return;
        const iconObj = iconFor("inst|" + id + "|" + inst2.mcVersion + "|" + (inst2.loaderType || ""), inst2.icon, inst2.icon ? inst2.color : null);
        openIconPicker({
          title: "Icono de \"" + inst2.name + "\"",
          current: iconObj,
          seed: "inst|" + id + "|" + inst2.mcVersion + "|" + (inst2.loaderType || ""),
          onSave: async (sel) => {
            await api.updateInstance(id, { icon: sel.isAuto ? '' : sel.glyph, color: sel.color });
            refreshInstances();
          }
        });
        return;
      }
      if (k === 'del') { deleteInstanceFlow(id); return; }
    });
  }

  function renderInstancesGrid() {
    if (!instancesGrid) return;
    const count = document.getElementById('instances-count');
    if (count) count.textContent = instancesCache.length + ' instancia(s)';
    if (!instancesCache.length) {
      instancesGrid.innerHTML = '<div class="empty-state">Aún no tienes instancias. Crea la primera con el botón «Crear instancia».</div>';
      return;
    }
    let html = '';
    instancesCache.forEach(inst => {
      const loaderBadge = inst.loaderType && inst.loaderType !== 'vanilla'
        ? `<span class="instance-badge loader">${escapeHtml(inst.loaderType)}</span>` : '';
      const dl = pendingDownload && pendingDownload.instanceId === inst.id;
      const icon = iconFor('inst|' + inst.id + '|' + inst.mcVersion + '|' + (inst.loaderType || ''), inst.icon, inst.icon ? inst.color : null);
            const ready = !dl;
      html += `<div class="instance-card${dl ? " downloading" : ""}" data-id="${escapeHtml(inst.id)}">
        <div class="instance-card-bar" style="background:${icon.color}"></div>
        <div class="instance-card-head">
          ${iconHtml(icon)}
          <div class="instance-card-titles">
            <span class="instance-card-name">${escapeHtml(inst.name)}</span>
            <span class="instance-dot ${ready ? "ok" : "busy"}" title="${ready ? "Lista" : "Descargando"}"></span>
          </div>
          <button class="inst-icon-edit" data-icon="${escapeHtml(inst.id)}" title="Cambiar icono">${ICON_PENCIL}</button>
        </div>
        <div class="instance-card-meta">
          <span class="instance-badge">${escapeHtml(inst.mcVersion)}</span>
          ${loaderBadge}
          <span class="instance-badge time">${formatLastPlayed(inst.lastPlayed)}${inst.playtimeSec ? " · " + Math.round(inst.playtimeSec / 60) + " min" : ""}</span>
        </div>
        ${dl ? '<div class="instance-progress"><div class="instance-progress-bar" id="ipb-' + escapeHtml(inst.id) + '"></div><span class="instance-progress-task" id="ipt-' + escapeHtml(inst.id) + '">Preparando…</span></div>' : '<div class="instance-card-info">&nbsp;</div>'}
        <div class="instance-card-actions">
          <button class="btn btn-primary btn-sm play-btn" data-play="${escapeHtml(inst.id)}" ${dl ? "disabled" : ""}>▶ Jugar</button>
          <button class="btn btn-ghost btn-sm text-danger" data-del="${escapeHtml(inst.id)}">Eliminar</button>
          <button class="btn btn-icon-only btn-sm" data-menu="${escapeHtml(inst.id)}" title="Más opciones">${ICON_DOTS}</button>
        </div>
      </div>`;
    });
    instancesGrid.innerHTML = html;

    instancesGrid.querySelectorAll('[data-play]').forEach(btn => {
      btn.addEventListener('click', function () {
        if (isLaunching) return;
        doLaunch({ instanceId: this.dataset.play });
      });
    });

    instancesGrid.addEventListener('click', function (e) {
      const mb = e.target.closest("[data-menu]");
      if (mb) { e.stopPropagation(); openInstanceMenu(mb.dataset.menu, e); }
    });
    instancesGrid.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', function () {
        deleteInstanceFlow(this.dataset.del);
      });
    });
    instancesGrid.querySelectorAll('[data-icon]').forEach(btn => {
      btn.addEventListener('click', function () {
        const inst = instancesCache.find(i => i.id === this.dataset.icon);
        if (!inst) return;
        const icon = iconFor('inst|' + inst.id + '|' + inst.mcVersion + '|' + (inst.loaderType || ''), inst.icon, inst.icon ? inst.color : null);
        openIconPicker({
          title: 'Icono de "' + inst.name + '"',
          current: icon,
          seed: 'inst|' + inst.id + '|' + inst.mcVersion + '|' + (inst.loaderType || ''),
          onSave: async (sel) => {
            await api.updateInstance(inst.id, { icon: sel.isAuto ? '' : sel.glyph, color: sel.color });
            refreshInstances();
          }
        });
      });
    });
  }

  async function refreshDetected() {
    try { detectedCache = await api.scanAllVersions(); } catch (e) { detectedCache = []; }
    renderDetectedGrid();
    updateProfileStats();
  }

  function renderDetectedGrid() {
    if (!detectedGrid) return;
    const count = document.getElementById('detected-count');
    if (count) count.textContent = detectedCache.length + ' instalación(es) local(es)';
    if (!detectedCache.length) {
      detectedGrid.innerHTML = '<div class="empty-state">No se han encontrado otras instalaciones de Minecraft</div>';
      return;
    }
    let html = '';
    detectedCache.forEach(v => {
      const key = v.rootDir + '|' + v.id;
      const ov = viconOverrides[key];
      const icon = iconFor('ver|' + key, ov && ov.g, ov && ov.g ? ov.c : null);
      html += `<div class="card version-card installed">
        <div class="version-card-head">
          ${iconHtml(icon)}
          <span class="version-card-id">${escapeHtml(v.id)}</span>
          <button class="inst-icon-edit" data-vicon="${escapeHtml(key)}" title="Cambiar icono">✏️</button>
        </div>
        <div class="version-card-meta">
          <span class="vbadge">${escapeHtml((v.loader || "vanilla") === "vanilla" ? "Vanilla" : v.loader)}</span>
          <span class="vbadge">Base ${escapeHtml(v.base || v.id)}</span>
          <span class="vbadge origin" title="${escapeHtml(v.rootDir)}">${escapeHtml(v.sourceLabel || "")}</span>
          ${v.installed ? '<span class="version-card-status ok">Lista</span>' : '<span class="version-card-status">Incompleta</span>'}
        </div>
        <div class="version-card-foot">
          <button class="btn btn-primary btn-sm" data-ext-play="${escapeHtml(v.id)}" data-root="${escapeHtml(v.rootDir)}" data-base="${escapeHtml(v.base || v.id)}">Jugar</button>
          <button class="btn btn-glass btn-sm" data-ext-inst="${escapeHtml(v.id)}" data-ext-inst-id="${escapeHtml(v.id)}" data-root="${escapeHtml(v.rootDir)}" data-base="${escapeHtml(v.base || v.id)}">Crear instancia</button>
          <button class="btn btn-ghost btn-sm text-danger" data-vdel="${escapeHtml(v.id)}" data-vroot="${escapeHtml(v.rootDir)}" title="Eliminar esta versión del disco">🗑</button>
        </div>
      </div>`;
    });
    detectedGrid.innerHTML = html;

    detectedGrid.querySelectorAll('[data-ext-play]').forEach(btn => {
      btn.addEventListener('click', function () {
        if (isLaunching) return;
        doLaunch({
          customId: this.dataset.extPlay,
          baseVersion: this.dataset.base,
          gameDir: this.dataset.root
        });
      });
    });
    detectedGrid.querySelectorAll('[data-ext-inst]').forEach(btn => {
      btn.addEventListener('click', async function () {
        const name = await uiPrompt({
          title: 'Crear instancia desde ' + this.dataset.base,
          message: 'Nombre para la nueva instancia:',
          value: 'Mi instancia ' + this.dataset.base,
          okText: 'Crear'
        });
        if (!name || !name.trim()) return;
        const det = detectedCache.find(x => x.id === this.dataset.extInst);
        let res;
        try {
          res = await api.createInstance({
            name: name.trim(),
            mcVersion: this.dataset.base,
            loaderType: (det && det.loader) || 'vanilla',
            externalRoot: this.dataset.root
          });
        } catch (err) {
          return showToast('Error al crear: ' + (err && err.message || err), 'error');
        }if (res && res.success) {
          showToast('Instancia vinculada a tu instalación existente', 'success');
          await refreshInstances();
          navigateTo('instances');
        } else {
          showToast((res && res.error) || 'No se pudo crear la instancia', 'error');
        }
      });
    });
    detectedGrid.querySelectorAll('[data-vdel]').forEach(btn => {
      btn.addEventListener('click', async function () {
        e_stop(this);
        const vid = this.dataset.vdel, root = this.dataset.vroot;
        const ok = await uiConfirm({ title: "Eliminar versión", message: "Se BORRARÁ del disco la versión \"" + vid + "\" (carpeta y archivos). ¿Continuar?", okText: "Eliminar", danger: true });
        if (!ok) return;
        const r = await api.deleteVersion(vid, root);
        if (r && r.success !== false) {
          showToast("Versión eliminada", "success");
          await refreshDetected();
          if (document.querySelector('[data-vdel]')) showToast('La versión también existe en otra ubicación; ahí permanece', 'info');
        }
        else showToast((r && r.error) || "No se pudo eliminar", "error");
      });
    });

    function e_stop(el) { try { el.stopPropagation(); } catch (e) {} }


    
    detectedGrid.querySelectorAll('[data-vicon]').forEach(btn => {
      btn.addEventListener('click', function () {
        const key = this.dataset.vicon;
        const v = detectedCache.find(x => (x.rootDir + '|' + x.id) === key);
        if (!v) return;
        const ov = viconOverrides[key];
        const icon = iconFor('ver|' + key, ov && ov.g, ov && ov.g ? ov.c : null);
        openIconPicker({
          title: 'Icono de "' + v.id + '"',
          current: icon,
          seed: 'ver|' + key,
          onSave: async (sel) => {
            if (sel.isAuto) delete viconOverrides[key];
            else viconOverrides[key] = { g: sel.glyph, c: sel.color };
            try { await api.setMeta('viconOverrides', viconOverrides); } catch (e) {}
            renderDetectedGrid();
          }
        });
      });
    });
  }

  // ----------------------------------------------------------
  // 8. CREATE INSTANCE MODAL
  // ----------------------------------------------------------
  const modalCreate = document.getElementById('modal-create-instance');
  const instNameInput = document.getElementById('instance-name-input');
  const instMcSelect = document.getElementById('instance-mc-version');
  const instLoaderType = document.getElementById('instance-loader-type');
  const instLoaderVerField = document.getElementById('instance-loader-ver-field');
  const instLoaderVerSelect = document.getElementById('instance-loader-ver');

  function openCreateModal() {
    populateInstanceMcSelect();
    modalCreate.classList.add('open');
    setTimeout(() => instNameInput && instNameInput.focus(), 50);
  }

  function closeCreateModal() {
    modalCreate.classList.remove('open');
  }

  document.getElementById('btn-create-instance')?.addEventListener('click', openCreateModal);
  document.getElementById('btn-cancel-instance')?.addEventListener('click', closeCreateModal);
  modalCreate?.addEventListener('click', function (e) { if (e.target === this) closeCreateModal(); });

  function populateInstanceMcSelect() {
    if (!instMcSelect) return;
    if (!versionsData) return;
    let html = '';
    (versionsData.releases || []).slice(0, 80).forEach(v => {
      html += `<option value="${escapeHtml(v.id)}">${escapeHtml(v.id)}</option>`;
    });
    (versionsData.snapshots || []).slice(0, 10).forEach(v => {
      html += `<option value="${escapeHtml(v.id)}">${escapeHtml(v.id)} (snapshot)</option>`;
    });
    instMcSelect.innerHTML = html;
  }

  instLoaderType?.addEventListener('change', function () {
    instLoaderVerField.style.display = this.value === 'vanilla' ? 'none' : '';
    if (this.value !== 'vanilla') fetchLoaderVersionsForModal(this.value, instMcSelect.value);
  });

  instMcSelect?.addEventListener('change', function () {
    if (instLoaderType.value !== 'vanilla') fetchLoaderVersionsForModal(instLoaderType.value, this.value);
  });

  async function fetchLoaderVersionsForModal(type, mcVer) {
    try {
      const data = await api.getLoaderVersions(type, mcVer);
      if (!data || data.error || !Array.isArray(data)) {
        instLoaderVerSelect.innerHTML = '<option value="">No disponible para esta versión</option>';
        return;
      }
      let html = '';
      data.forEach(item => {
        const ver = item.loaderVersion || item.forgeVersion || item.neoforgeVersion || item.patch || item;
        const label = String(ver) + (item.stable === false ? ' (beta)' : '') + (item.type === 'recommended' ? ' ★' : '');
        html += `<option value="${escapeHtml(ver)}">${escapeHtml(label)}</option>`;
      });
      instLoaderVerSelect.innerHTML = html || '<option value="">Sin opciones</option>';
    } catch (e) {
      instLoaderVerSelect.innerHTML = '<option value="">Error al cargar versiones</option>';
    }
  }

  document.getElementById('btn-confirm-instance')?.addEventListener('click', async function () {
    const name = (instNameInput.value || '').trim();
    if (!name) return showToast('Escribe un nombre para la instancia', 'error');
    const mcVersion = instMcSelect.value;
    if (!mcVersion) return showToast('Selecciona una versión de Minecraft', 'error');
    const loaderType = instLoaderType.value;
    let loaderVer = loaderType === 'vanilla' ? '' : instLoaderVerSelect.value;
    if (loaderType !== 'vanilla' && !loaderVer) {
      showToast('Cargando versiones de ' + loaderType + '...', 'info');
      await fetchLoaderVersionsForModal(loaderType, mcVersion);
      loaderVer = instLoaderVerSelect.value;
      if (!loaderVer) return showToast('No hay versiones disponibles de ' + loaderType + ' para esa versión', 'error');
    }

    const res = await api.createInstance({ name, mcVersion, loaderType, loaderVersion: loaderVer });
    if (!res || !res.success) return showToast((res && res.error) || 'No se pudo crear', 'error');

    closeCreateModal();
    instNameInput.value = '';
    await refreshInstances();
    navigateTo('instances');

    pendingDownload = { instanceId: res.id };
    renderInstancesGrid();
    showToast('Descargando ' + mcVersion + (loaderType !== 'vanilla' ? ' + ' + loaderType : '') + '...', 'info');
    const dlRes = await api.downloadVersion(mcVersion, loaderType, loaderVer, res.id);
    pendingDownload = null;
    renderInstancesGrid();
    if (dlRes && dlRes.success) {
      if (dlRes.loaderError) showToast('Vanilla listo, pero el loader falló: ' + dlRes.loaderError, 'error');
      else showToast('¡Instancia lista para jugar!', 'info');
    } else {
      showToast((dlRes && dlRes.error) || 'Error al descargar', 'error');
    }
    refreshDetected().catch(() => {});
  });

  api.onDownloadStatus((data) => {
    if (!pendingDownload) return;
    const bar = document.getElementById('ipb-' + pendingDownload.instanceId);
    const task = document.getElementById('ipt-' + pendingDownload.instanceId);
    if (!bar || !task) return;
    switch (data.type) {
      case 'start': task.textContent = data.message || 'Descargando...'; bar.style.width = '5%'; break;
      case 'progress': {
        let pct = 50;
        if (data.total > 0 && data.current >= 0) pct = Math.round((data.current / data.total) * 100);
        task.textContent = data.task || 'Instalando...';
        bar.style.width = pct + '%';
        break;
      }
      case 'downloaded': task.textContent = data.message || 'Descargado'; bar.style.width = '70%'; break;
      case 'loader-done': task.textContent = data.message || 'Loader instalado'; bar.style.width = '90%'; break;
      case 'done': task.textContent = '¡Listo!'; bar.style.width = '100%'; break;
      case 'error': task.textContent = 'Error: ' + (data.message || ''); break;
    }
  });

  // ----------------------------------------------------------
  // 9. SERVERS PAGE (destacados con ping real)
  // ----------------------------------------------------------
  const FEATURED_SERVERS = [
    { host: 'mc.hypixel.net', name: 'Hypixel', cat: 'Minijuegos' },
    { host: 'mco.cubecraft.net', name: 'CubeCraft', cat: 'Minijuegos' },
    { host: 'minemen.club', name: 'Minemen Club', cat: 'PvP', ver: '1.8.9' },
    { host: 'play.pika-network.net', name: 'PikaNetwork', cat: 'PvP', ver: '1.8.9' },
    { host: 'jartexnetwork.com', name: 'Jartex Network', cat: 'PvP', ver: '1.8.9' },
    { host: 'us.mineplex.com', name: 'Mineplex', cat: 'PvP' },
    { host: 'gommehd.net', name: 'GommeHD', cat: 'Survival' },
    { host: 'mc.manacube.net', name: 'ManaCube', cat: 'Survival' },
    { host: 'wynncraft.com', name: 'Wynncraft', cat: 'MMORPG' },
    { host: '2b2t.org', name: '2b2t', cat: 'Anarquia' },
    { host: '9b9t.org', name: '9b9t', cat: 'Anarquia' },
    { host: 'constantiam.org', name: 'Constantiam', cat: 'Anarquia' },
    { host: 'play.hivemc.com', name: 'The Hive', cat: 'Minijuegos' },
    { host: 'eu.mineplex.com', name: 'Mineplex EU', cat: 'PvP' },
    { host: 'play.manacube.net', name: 'ManaCube Skyblock', cat: 'Survival' },
    { host: 'server.wynncraft.com', name: 'Wynncraft', cat: 'MMORPG' },
    { host: 'pvp.thearchon.net', name: 'The Archon', cat: 'PvP', ver: '1.8.9' },
    { host: 'opcraft.net', name: 'OPCraft', cat: 'Factions', ver: '1.8.9' },
    { host: 'ms.vanillasurvival.com', name: 'Vanilla Survival', cat: 'Survival' },
    { host: 'mccentral.org', name: 'MC-Central', cat: 'Minijuegos' },
  ];

  const serversGrid = document.getElementById('servers-grid');

  function serverCardSkeleton(s, i) {
    const fav = !!(typeof srvFavs === 'object' && srvFavs[s.host.toLowerCase()]);
    return `<div class="server-card" id="srv-${i}" data-host="${escapeHtml(s.host)}" data-name="${escapeHtml(s.name)}">
      <div class="server-card-icon"><div class="server-icon-placeholder">?</div></div>
      <div class="server-card-body">
        <div class="server-card-title">${escapeHtml(s.name)}</div>
        <div class="server-card-host">${escapeHtml(s.host)}</div>
        <div class="server-card-status"><span class="server-dot checking"></span> Comprobando...</div>
      </div>
      <div class="server-card-side">
        <span class="server-latency" id="srv-lat-${i}"></span>
        <button class="btn btn-gold btn-sm" data-srv-connect="${escapeHtml(s.host)}">Conectar</button>
        <button class="btn btn-ghost btn-xs" data-spass="${escapeHtml(s.host)}" title="Contraseña /login">🔑</button>
        <button class="srv-star${fav ? ' fav' : ''}" data-star="${escapeHtml(s.host)}" title="Marcar como favorito">
          <svg viewBox="0 0 24 24" fill="${fav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        </button>
      </div>
    </div>`;
  }

  const PROTOCOL_MAP = {
    47: "1.8.9", 340: "1.12.2", 393: "1.13", 404: "1.13.2", 441: "1.14.4", 578: "1.15.2",
    754: "1.16.5", 756: "1.17.1", 757: "1.18.2", 758: "1.18.2", 759: "1.19", 760: "1.19.2",
    761: "1.19.3", 762: "1.19.4", 763: "1.20.1", 764: "1.20.2", 765: "1.20.4", 766: "1.21",
    767: "1.21.1", 768: "1.21.3", 769: "1.21.4"
  };

  function latestReleaseId() {
    try { return versionsData.releases[0].id; } catch (e) { return "1.21.4"; }
  }

  function suggestVersion(info) {
    if (!info) return latestReleaseId();
    if (info.ver) return info.ver;
    if (info.result && info.result.version) {
      const m = String(info.result.version).match(/(\d+\.\d+(?:\.\d+)?)/);
      if (m && m[1].startsWith("1.")) return m[1];
    }
    if (info.result && info.result.protocol && PROTOCOL_MAP[info.result.protocol]) return PROTOCOL_MAP[info.result.protocol];
    return latestReleaseId();
  }

  async function connectToServer(host) {
    if (isLaunching) return;
    const info = srvResults.find(x => x && x.host === host);
    const sug = suggestVersion(info);
    const compatible = instancesCache.filter(i => i.mcVersion === sug);
    const choicesList = [{ id: "__normal__", label: "Versión " + sug + " (directa)", desc: "Abre Minecraft y te conecta automáticamente" }];
    compatible.forEach(i => choicesList.push({ id: i.id, label: i.name, desc: "Instancia existente · " + i.mcVersion }));
    if (!compatible.length) choicesList.push({ id: "__create__", label: "Crear instancia " + sug, desc: "Instalación limpia dedicada a este servidor" });
    const c = await uiChoices({
      title: "Conectar a " + host,
      message: "Versión recomendada: " + sug,
      choicesList, defaultIndex: 0, okText: "Conectar"
    });
    if (!c) return;
    const savedPass = await api.serverPassGet(host).catch(() => "");
    if (savedPass) showToast("Contraseña /login guardada para este server", "info");
    if (c === "__normal__") return doLaunch({ serverIp: host, version: sug });
    if (c === "__create__") {
      const res = await api.createInstance({ name: ("SRV " + host.split(".")[0]).slice(0, 24), mcVersion: sug, loaderType: "vanilla" });
      if (!res || !res.success) return showToast((res && res.error) || "No se pudo crear la instancia", "error");
      pendingDownload = { instanceId: res.id }; renderInstancesGrid();
      showToast("Descargando " + sug + "...", "info");
      const dl = await api.downloadVersion(sug, "vanilla", "", res.id);
      pendingDownload = null; renderInstancesGrid();
      if (!(dl && dl.success)) return showToast((dl && dl.error) || "Error descargando", "error");
      return doLaunch({ serverIp: host, instanceId: res.id });
    }
    doLaunch({ serverIp: host, instanceId: c });
  }

  function renderServersSkeleton() {
    if (!serversGrid) return;
    serversGrid.innerHTML = FEATURED_SERVERS.map(serverCardSkeleton).join('');
    serversGrid.querySelectorAll('[data-srv-connect]').forEach(btn => {
      btn.addEventListener('click', function () { connectToServer(this.dataset.srvConnect); });
    });
    serversGrid.querySelectorAll('[data-star]').forEach(btn => {
      btn.addEventListener('click', async function () {
        const host = this.dataset.star.toLowerCase();
        srvFavs[host] = !srvFavs[host];
        if (!srvFavs[host]) delete srvFavs[host];
        this.classList.toggle('fav', !!srvFavs[host]);
        const svg = this.querySelector('svg');
        if (svg) svg.setAttribute('fill', srvFavs[host] ? 'currentColor' : 'none');
        soundManager.play('click');
        await saveSrvFavs();
        applyServerView();
      });
    });
  }

  const pingCache = { at: 0, data: {} };

  async function pingHost(host) {
    const now = Date.now();
    const key = host.toLowerCase();
    if (pingCache.data[key] && now - pingCache.at < 60000) return pingCache.data[key];
    let r;
    try { r = await api.pingServer(host, 25565); } catch (e) { r = { online: false }; }
    pingCache.at = now;
    pingCache.data[key] = r;
    return r;
  }

  serversGrid.querySelectorAll(".server-card .server-card-body").forEach(bodyEl => {
    bodyEl.style.cursor = 'pointer';
    bodyEl.addEventListener('click', () => {
      const card = bodyEl.closest(".server-card");
      if (card) openServerDetail(card.dataset.host);
    });
  });

  async function openServerDetail(host) {
    if (!detailModal) return;
    const meta = FEATURED_SERVERS.find(s => s.host === host) || {};
    const info = srvResults.find(x => x && x.host === host);
    const sug = suggestVersion(info);
    detailState.projectId = null; detailState.name = meta.name || host;
    detailModal.classList.add("open");
    const ic = document.getElementById("detail-icon");
    const idx = srvResults.findIndex(x => x && x.host === host);
    const favImg = idx >= 0 ? document.querySelector("#srv-" + idx + " .server-card-icon img") : null;
    if (favImg) ic.src = favImg.src; else ic.removeAttribute("src");
    document.getElementById("detail-title").textContent = meta.name || host;
    const res = info && info.result;
    const statusHtml = res && res.online ? '<span style="color:#22c55e">Online</span> · ' + res.playersOnline + '/' + res.playersMax + ' · ' + res.latency + ' ms' : '<span style="color:#e5484d">Offline / comprobando…</span>';
    document.getElementById('detail-meta').innerHTML = escapeHtml(meta.cat || '') + ' · ' + statusHtml + ' · Recomendada: <b>' + sug + '</b>';
    document.getElementById("detail-gallery").style.display = "none";
    document.getElementById("detail-deps-sec").style.display = "none";
    document.getElementById('detail-desc').innerHTML = '<div style="white-space:pre-wrap;">' + escapeHtml((res && res.motd) || 'Servidor destacado de la comunidad.') + '</div>' +
      '<p class="note-text" style="margin-top:10px;">Al conectar se abrirá Minecraft ' + sug + ' y entrarás automáticamente.</p>';
    document.getElementById("detail-loaders").innerHTML = "";
    const gvSel = document.getElementById("detail-gv");
    gvSel.style.display = "none";
    const versEl = document.getElementById('detail-vers');
    versEl.innerHTML = '<button class="btn btn-play btn-lg" id="dv-connect" style="width:100%;justify-content:center;">JUGAR ahora en ' + escapeHtml(meta.name || host) + '</button>' +
      '<div style="display:flex;gap:8px;margin-top:8px;"><button class="btn btn-glass btn-sm" id="dv-pass">🔑 Contraseña /login</button><button class="btn btn-glass btn-sm" id="dv-fav">★ Favorito</button></div>';
    document.getElementById('dv-connect').addEventListener('click', () => { closeDetail(); connectToServer(host); });
    document.getElementById('dv-pass').addEventListener('click', async () => {
      const cur = await api.serverPassGet(host).catch(() => "");
      const v = await uiPrompt({ title: "Contraseña de " + host, message: "Se guarda CIFRADA:", value: cur || "", okText: "Guardar" });
      if (v !== null) { await api.serverPassSet(host, v); showToast(v ? "Guardada cifrada" : "Borrada", "success"); }
    });
    document.getElementById('dv-fav').addEventListener('click', async () => {
      const k = host.toLowerCase();
      srvFavs[k] = !srvFavs[k]; if (!srvFavs[k]) delete srvFavs[k];
      await saveSrvFavs(); applyServerView(); showToast("Favoritos actualizados", "info");
    });
  }

  serversGrid.querySelectorAll("[data-spass]").forEach(btn => {
    btn.addEventListener("click", async function () {
      const h = this.dataset.spass;
      const cur = await api.serverPassGet(h).catch(() => "");
      const v = await uiPrompt({ title: "Contraseña de " + h, message: "Se guarda CIFRADA en este PC (para /login):", value: cur || "", okText: "Guardar" });
      if (v === null) return;
      await api.serverPassSet(h, v);
      showToast(v ? "Contraseña guardada cifrada" : "Contraseña borrada", "success");
    });
  });

  async function pingFeaturedServers() {
    renderServersSkeleton();
    FEATURED_SERVERS.forEach(async (s, i) => {
      const card = document.getElementById('srv-' + i);
      const lat = document.getElementById('srv-lat-' + i);
      let result;
      result = await pingHost(s.host);
      srvResults[i] = { host: s.host, name: s.name, result };
      if (!card || !card.isConnected) return;
      const statusEl = card.querySelector('.server-card-status');
      if (result && result.online) {
        statusEl.innerHTML = `<span class="server-dot online"></span> ${result.playersOnline} / ${result.playersMax} jugadores`;
        const motdEl = card.querySelector('.server-card-host');
        if (motdEl && result.motd) motdEl.textContent = String(result.motd).replace(/\u00a7./g, '').slice(0, 70);
        if (lat) { const ms = result.latency; lat.textContent = ms + ' ms'; lat.className = 'server-latency ' + (ms < 50 ? 'good' : ms < 120 ? 'mid' : 'bad'); }
        if (result.favicon) {
          const iconWrap = card.querySelector('.server-card-icon');
          if (iconWrap) iconWrap.innerHTML = `<img src="${result.favicon}" alt="">`;
        }
      } else {
        statusEl.innerHTML = '<span class="server-dot offline"></span> Offline';
        if (lat) lat.textContent = '';
      }
      applyServerView();
    });
  }

  document.getElementById('btn-refresh-servers')?.addEventListener('click', pingFeaturedServers);

  // ----------------------------------------------------------
  // 10. SETTINGS — RAM
  // ----------------------------------------------------------
  const ramSlider = document.querySelector('.slider-input');
  const ramValue = document.querySelector('.ram-value-text');

  if (ramSlider && ramValue) {
    ramSlider.value = settings.ram || 4;
    ramValue.textContent = parseFloat(ramSlider.value) + ' GB';

    if (typeof api.getSystemInfo === 'function') {
      api.getSystemInfo().then(info => {
        if (!info || !info.totalRamGB) return;
        const total = info.totalRamGB;
        const maxAllowed = Math.max(1, Math.min(16, total - 1));
        ramSlider.max = maxAllowed;
        if (parseFloat(ramSlider.value) > maxAllowed) {
          ramSlider.value = maxAllowed;
          settings.ram = maxAllowed;
          ramValue.textContent = maxAllowed + ' GB';
          saveSettings();
        }
        const rec = Math.max(2, Math.min(maxAllowed, Math.round(total / 2) - 1));
        const hint = document.getElementById('ram-hint');
        if (hint && rec !== parseFloat(settings.ram)) {
          hint.innerHTML = 'Cantidad de RAM dedicada a Minecraft · <a href="#" id="ram-apply" style="color:#FF5AFF;text-decoration:none">Sugerido: ' + rec + ' GB (aplicar)</a>';
          const apply = document.getElementById('ram-apply');
          if (apply) {
            apply.addEventListener('click', (ev) => {
              ev.preventDefault();
              ramSlider.value = rec;
              ramValue.textContent = rec + ' GB';
              settings.ram = rec;
              saveSettings();
              hint.textContent = 'Cantidad de RAM dedicada a Minecraft';
            });
          }
        }
      }).catch(() => {});
    }

    ramSlider.addEventListener('input', function () {
      ramValue.textContent = parseFloat(this.value) + ' GB';
    });
    ramSlider.addEventListener('change', function () {
      settings.ram = parseFloat(this.value);
      saveSettings();
    });
  }

  // ----------------------------------------------------------
  // 11. SETTINGS — JAVA
  // ----------------------------------------------------------
  const javaSelect = document.getElementById('java-select');
  if (javaSelect) {
    const currentJava = settings.javaVersion || 'auto';
    if (Array.from(javaSelect.options).some(o => o.value === currentJava)) {
      javaSelect.value = currentJava;
    }
    javaSelect.addEventListener('change', function () {
      settings.javaVersion = this.value;
      saveSettings();
    });
  }

  document.getElementById('btn-download-java')?.addEventListener('click', function () {
    const a = document.createElement('a');
    a.href = 'https://adoptium.net';
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  async function updateJavaChip() {
    const chip = document.getElementById('java-chip');
    const dot = document.getElementById('profile-java-dot');
    const txt = document.getElementById('profile-java-text');
    try {
      const info = await api.checkJava();
      if (!info || !info.found) {
        if (chip) { chip.textContent = 'Java no encontrado'; chip.classList.add('missing'); }
        if (dot) dot.className = 'java-dot missing';
        if (txt) txt.textContent = 'No se encontró Java. Descárgalo o añade su carpeta manualmente.';
      } else {
        const label = Array.isArray(info.available) && info.available.length
          ? info.available.map(j => 'Java ' + j.major).join(', ')
          : (info.versionLabel || 'Java detectado');
        if (chip) { chip.textContent = label; chip.classList.remove('missing'); }
        if (dot) dot.className = 'java-dot';
        if (txt) txt.textContent = 'Java detectado: ' + label;
      }
    } catch (e) {
      if (chip) { chip.textContent = 'Sin datos'; chip.classList.add('missing'); }
    }
  }

  async function renderJavaPaths() {
    const list = document.getElementById('java-paths-list');
    const row = document.getElementById('java-paths-row');
    const clearBtn = document.getElementById('btn-clear-java-paths');
    const paths = settings.customJavaPaths || [];
    if (row) row.style.display = paths.length ? '' : 'none';
    if (clearBtn) clearBtn.style.display = paths.length ? '' : 'none';
    if (!list) return;
    if (!paths.length) { list.innerHTML = ''; return; }
    list.innerHTML = paths.map(p => `
      <div class="java-path-item">
        <span class="java-path-text">${escapeHtml(p)}</span>
        <button class="btn btn-ghost btn-xs text-danger" data-rm-path="${escapeHtml(p)}">Quitar</button>
      </div>`).join('');
    list.querySelectorAll('[data-rm-path]').forEach(btn => {
      btn.addEventListener('click', async function () {
        const res = await api.removeJavaPath(this.dataset.rmPath);
        if (res && res.success) {
          settings.customJavaPaths = res.paths;
          renderJavaPaths();
          updateJavaChip();
    refreshMicrosoftUI();
    if (document.getElementById("mods-grid")) renderCatalog();
    if (packsGrid) { renderPacks(); const _oldRI = refreshInstances; window.refreshInstances = async function(){ await _oldRI(); renderPacks(); }; }
        }
      });
    });
  }

  document.getElementById('btn-add-java-path')?.addEventListener('click', async function () {
    const res = await api.addJavaPaths();
    if (res && res.success) {
      settings.customJavaPaths = res.paths;
      renderJavaPaths();
      updateJavaChip();
    refreshMicrosoftUI();
    if (document.getElementById("mods-grid")) renderCatalog();
    if (packsGrid) { renderPacks(); const _oldRI = refreshInstances; window.refreshInstances = async function(){ await _oldRI(); renderPacks(); }; }
      showToast('Carpetas Java añadidas', 'info');
    }
  });

  document.getElementById('btn-clear-java-paths')?.addEventListener('click', async function () {
    const paths = settings.customJavaPaths || [];
    for (const p of paths) {
      const res = await api.removeJavaPath(p);
      if (res && res.success) settings.customJavaPaths = res.paths;
    }
    renderJavaPaths();
    updateJavaChip();
    refreshMicrosoftUI();
    if (document.getElementById("mods-grid")) renderCatalog();
    if (packsGrid) { renderPacks(); const _oldRI = refreshInstances; window.refreshInstances = async function(){ await _oldRI(); renderPacks(); }; }
  });

  // ----------------------------------------------------------
  // 12. SETTINGS — RESOLUTION + TOGGLES
  // ----------------------------------------------------------
  function findSettingsRow(labelText) {
    return Array.from(document.querySelectorAll('.settings-row')).find(row => {
      const label = row.querySelector('.settings-row-label');
      return label && label.textContent.trim() === labelText;
    });
  }

  const resRow = findSettingsRow('Resolución de ventana');
  const resSelect = resRow && resRow.querySelector('.select-input');
  if (resSelect) {
    const resOptions = ['Pantalla completa', '1920 x 1080', '1280 x 720', '854 x 480'];
    const idx = resOptions.indexOf(settings.resolution || 'Pantalla completa');
    if (idx >= 0) resSelect.selectedIndex = idx;
    resSelect.addEventListener('change', function () {
      settings.resolution = this.value;
      saveSettings();
    });
  }

  const toggleMap = {
    'Iniciar minimizado': 'startMinimized',
    'Minimizar a la bandeja del sistema': 'minimizeToTrayOnLaunch',
    'Inicio rápido del juego': 'fastBoot',
    'Skins Ely.by en el juego': 'useAuthlibInjector',
    'Sonidos del cliente': 'soundsEnabled',

  };

  document.querySelectorAll('.settings-row .toggle input[type="checkbox"]').forEach(chk => {
    const row = chk.closest('.settings-row');
    if (!row) return;
    const labelText = row.querySelector('.settings-row-label');
    if (!labelText) return;
    const key = toggleMap[labelText.textContent.trim()];
    if (key && settings[key] !== undefined) chk.checked = settings[key];

    chk.addEventListener('change', function () {
      if (key) {
        settings[key] = this.checked;
        saveSettings();
        if (key === 'soundsEnabled') {
          soundManager.enabled = this.checked;
          if (this.checked) soundManager.play('click');
        }
      }
    });
  });

  // ----------------------------------------------------------
  // ACTUALIZACIONES
  // ----------------------------------------------------------
  const updateUrlInput = document.getElementById('update-url-input');
  const updateStatusText = document.getElementById('update-status-text');

  (async () => {
    try {
      const ver = await api.getAppVersion();
      if (updateStatusText && ver) updateStatusText.textContent = 'Versión actual: ' + ver;
    } catch (e) {}
    if (updateUrlInput) updateUrlInput.value = settings.updateUrl || '';
  })();

  api.onUpdateProgress((done, total) => {
    if (!updateStatusText || !total) return;
    const pct = Math.round((done / total) * 100);
    updateStatusText.textContent = `Descargando actualización... ${pct}%`;
  });

  document.getElementById('btn-save-update-url')?.addEventListener('click', function () {
    if (!updateUrlInput) return;
    settings.updateUrl = (updateUrlInput.value || '').trim();
    saveSettings();
    showToast(settings.updateUrl ? 'URL de actualizaciones guardada' : 'URL de actualizaciones borrada', 'info');
  });

  document.getElementById('btn-check-updates')?.addEventListener('click', async function () {
    const btn = this;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Buscando...';
    try {
      const res = await api.updateCheck();
      if (!res.ok) {
        showToast(res.error || 'No se pudo comprobar actualizaciones', 'error');
      } else if (!res.updateAvailable) {
        showToast(`Ya tienes la última versión (${res.latest})`, 'info');
      } else {
        const wants = await uiConfirm({
          title: 'Actualización disponible: ' + res.latest,
          message:
            `Versión actual: ${res.current}\n\n` +
            (res.notes ? res.notes + '\n\n' : '') +
            '¿Descargar e instalar ahora?\nTus datos, mundos y cuentas se conservan.',
          okText: 'Descargar e instalar'
        });
        if (wants) {
          if (updateStatusText) updateStatusText.textContent = 'Descargando actualización...';
          const r = await api.updateInstall(res.url);
          if (!r || !r.success) {
            showToast((r && r.error) || 'Error descargando la actualización', 'error');
          } else {
            showToast('Instalando la nueva versión. El launcher se reiniciará...', 'info');
          }
        }
      }
    } catch (e) {
      showToast('Error comprobando actualizaciones: ' + e.message, 'error');
    }
    btn.disabled = false;
    btn.textContent = original;
  });

  // ----------------------------------------------------------
  // 13. CUENTAS + SKINS ELY.BY
  // ----------------------------------------------------------
  const skinHeadCache = new Map();

  function skinHeadFromDataUrl(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 32; canvas.height = 32;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 32, 32);
          resolve(canvas.toDataURL());
        } catch (e) { resolve(null); }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }

  async function getSkinHead(nick) {
    nick = String(nick || '').trim();
    if (!nick) return null;
    if (skinHeadCache.has(nick)) return skinHeadCache.get(nick);
    const raw = await api.getElybySkin(nick);
    if (!raw) { skinHeadCache.set(nick, null); return null; }
    const head = await skinHeadFromDataUrl(raw);
    skinHeadCache.set(nick, head);
    return head;
  }

  // ----------------------------------------------------------
  // SKINS LOCALES: STEVE, RECORTE DE CABEZA Y CUERPO COMPLETO
  // ----------------------------------------------------------
  const STEVE_FACE = [
    ['H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    ['S', 'S', 'S', 'S', 'S', 'S', 'S', 'S'],
    ['S', 'W', 'E', 'S', 'S', 'E', 'W', 'S'],
    ['S', 'S', 'N', 'N', 'N', 'N', 'S', 'S'],
    ['S', 'M', 'M', 'M', 'M', 'M', 'M', 'S'],
    ['S', 'S', 'M', 'S', 'S', 'M', 'S', 'S'],
    ['S', 'S', 'B', 'B', 'B', 'B', 'S', 'S'],
    ['S', 'S', 'B', 'B', 'B', 'B', 'S', 'S']
  ];
  const STEVE_COLORS = { H: '#312218', S: '#c6976f', W: '#ffffff', E: '#4a3fa3', N: '#9a6b4f', M: '#7d5636', B: '#58391f' };

  let steveHeadUrl = null;
  function steveHead() {
    if (steveHeadUrl) return steveHeadUrl;
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const ctx = c.getContext('2d');
    STEVE_FACE.forEach((row, y) => row.forEach((k, x) => {
      ctx.fillStyle = STEVE_COLORS[k];
      ctx.fillRect(x * 4, y * 4, 4, 4);
    }));
    steveHeadUrl = c.toDataURL();
    return steveHeadUrl;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function loadLocalImage(p) {
    if (!p) return null;
    const url = encodeURI('file:///' + String(p).replace(/\\/g, '/'));
    return await loadImage(url);
  }

  function headFromImg(img) {
    try {
      const c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 32, 32);
      ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 32, 32); // capa del sombrero
      return c.toDataURL();
    } catch (e) { return null; }
  }

  async function resolveAccountHead(acc) {
    const local = await loadLocalImage(acc && acc.skinPath);
    if (local) {
      const h = headFromImg(local);
      if (h) return h;
    }
    const ely = acc && acc.elybyNick ? await getSkinHead(acc.elybyNick) : null;
    return ely || steveHead();
  }

  function drawSkinFront(img, canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const S = 10;
    const modern = img.height >= 64;

    const put = (sx, sy, w, h, dx, dy) =>
      ctx.drawImage(img, sx, sy, w, h, dx * S, dy * S, w * S, h * S);
    const putMirrored = (sx, sy, w, h, dx, dy) => {
      const tmp = document.createElement('canvas');
      tmp.width = w * S; tmp.height = h * S;
      const t = tmp.getContext('2d');
      t.imageSmoothingEnabled = false;
      t.translate(w * S, 0);
      t.scale(-1, 1);
      t.drawImage(img, sx, sy, w, h, 0, 0, w * S, h * S);
      ctx.drawImage(tmp, dx * S, dy * S);
    };

    put(8, 8, 8, 8, 4, 0);    // cara
    put(40, 8, 8, 8, 4, 0);   // sombrero
    put(20, 20, 8, 12, 4, 8); // torso
    put(44, 20, 4, 12, 0, 8); // brazo derecho
    if (modern) put(36, 52, 4, 12, 12, 8);
    else putMirrored(44, 20, 4, 12, 12, 8);
    put(4, 20, 4, 12, 4, 20); // pierna derecha
    if (modern) put(20, 52, 4, 12, 8, 20);
    else putMirrored(4, 20, 4, 12, 8, 20);
  }

  async function applySkinAvatars() {
    const acc = activeAccount();
    const head = await resolveAccountHead(acc);
    const targets = [
      document.querySelector('.sidebar-avatar'),
      document.querySelector('.profile-avatar')
    ];
    targets.forEach(el => {
      if (!el) return;
      el.style.backgroundImage = `url(${head})`;
      el.style.backgroundSize = 'cover';
      el.style.backgroundPosition = 'center';
      el.style.imageRendering = 'pixelated';
      el.textContent = '';
    });
  }

  async function refreshSkinUI() {
    const acc = activeAccount();

    const skinDesc = document.getElementById('skin-status-desc');
    const capeDesc = document.getElementById('cape-status-desc');
    const clearSkinBtn = document.getElementById('btn-clear-skin');
    const clearCapeBtn = document.getElementById('btn-clear-cape');

    const hasLocalSkin = !!(acc && acc.skinPath);
    const hasLocalCape = !!(acc && acc.capePath);

    if (skinDesc) {
      skinDesc.textContent = hasLocalSkin
        ? 'Personalizada (archivo local)'
        : (acc && acc.elybyNick ? `De Ely.by (@${acc.elybyNick})` : 'Sin skin personalizada (se usa Steve)');
    }
    if (capeDesc) {
      capeDesc.textContent = hasLocalCape
        ? (String(acc.capePath).toLowerCase().endsWith('.gif') ? 'GIF animado (visible en el launcher)' : 'PNG personalizado')
        : (acc && acc.elybyNick ? 'Puede cargarse desde Ely.by' : 'Sin capa personalizada');
    }
    if (clearSkinBtn) clearSkinBtn.style.display = hasLocalSkin ? '' : 'none';
    if (clearCapeBtn) clearCapeBtn.style.display = hasLocalCape ? '' : 'none';

    // Preview del cuerpo
    const canvas = document.getElementById('skin-preview-body');
    if (canvas) {
      let img = await loadLocalImage(acc && acc.skinPath);
      if (!img && acc && acc.elybyNick) {
        const raw = await api.getElybySkin(acc.elybyNick);
        if (raw) img = await loadImage(raw);
      }
      if (img) drawSkinFront(img, canvas);
      else {
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#c6976f';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        STEVE_FACE.forEach((row, y) => row.forEach((k, x) => {
          ctx.fillStyle = STEVE_COLORS[k];
          ctx.fillRect((4 + x) * 10, y * 10, 10, 10);
        }));
      }
    }

    // Preview de la capa
    const frame = document.getElementById('cape-preview-frame');
    if (frame) {
      if (hasLocalCape) {
        const url = encodeURI('file:///' + String(acc.capePath).replace(/\\/g, '/'));
        frame.innerHTML = `<img src="${url}" alt="capa">`;
      } else if (acc && acc.elybyNick) {
        const cloak = await api.getElybyCape(acc.elybyNick);
        frame.innerHTML = cloak ? `<img src="${cloak}" alt="capa">` : '<span>—</span>';
      } else {
        frame.innerHTML = '<span>—</span>';
      }
    }
  }

  let lastUploadKind = 'skin';
  async function handleUpload(kind) {
    const acc = activeAccount();
    if (!acc) return showToast('No hay cuenta activa', 'error');
    const src = await api.skinChoose(kind);
    if (!src) return;
    const res = await api.skinSave(acc.name, kind, src);
    if (!res || !res.success) return showToast((res && res.error) || 'No se pudo guardar la imagen', 'error');
    if (kind === 'skin') acc.skinPath = res.path;
    else acc.capePath = res.path;
    lastUploadKind = kind;
    saveSettings();
    refreshAccountUI();
    showToast(kind === 'skin' ? '¡Skin aplicada!' : '¡Capa aplicada!', 'info');
  }

  async function handleClear(kind) {
    const acc = activeAccount();
    if (!acc) return;
    await api.skinClear(acc.name, kind);
    if (kind === 'skin') acc.skinPath = '';
    else acc.capePath = '';
    saveSettings();
    refreshAccountUI();
    showToast(kind === 'skin' ? 'Skin local eliminada' : 'Capa local eliminada', 'info');
  }

  document.getElementById('btn-upload-skin')?.addEventListener('click', () => handleUpload('skin'));
  document.getElementById('btn-upload-cape')?.addEventListener('click', () => handleUpload('cape'));
  document.getElementById('btn-clear-skin')?.addEventListener('click', () => handleClear('skin'));
  document.getElementById('btn-clear-cape')?.addEventListener('click', () => handleClear('cape'));
  document.getElementById('btn-publish-elyby')?.addEventListener('click', async function () {
    const url = lastUploadKind === 'cape'
      ? 'https://account.ely.by/settings/cloak'
      : 'https://account.ely.by/settings/skin';
    showToast('Inicia sesión gratis en Ely.by y sube ahí tu archivo para que todos la vean en el juego', 'info');
    await api.openExternal(url);
  });

  function refreshAccountUI() {
    const select = document.getElementById('account-select');
    const removeBtn = document.getElementById('btn-remove-account');
    const accounts = settings.accounts || [];

    if (select) {
      select.innerHTML = accounts.map((a, i) =>
        `<option value="${i}"${a.name === settings.username ? ' selected' : ''}>${escapeHtml(a.name)}${a.elybyNick ? ' (' + escapeHtml(a.elybyNick) + ')' : ''}</option>`
      ).join('');
    }

    const onlyOne = accounts.length <= 1;
    if (removeBtn) {
      removeBtn.style.opacity = onlyOne ? '0.4' : '1';
      removeBtn.style.cursor = onlyOne ? 'not-allowed' : 'pointer';
      removeBtn.disabled = onlyOne;
    }

    const name = (settings.username || "").trim();
    const sidebarName = document.querySelector('.sidebar-username');
    const profileName = document.querySelector('.profile-name');
    const usernameInput = document.getElementById('profile-username-input');
    if (sidebarName) sidebarName.textContent = name;
    if (profileName) profileName.textContent = name;
    if (usernameInput) usernameInput.value = name;

    const elybyInput = document.getElementById('elyby-nick-input');
    const acc = activeAccount();
    if (elybyInput) elybyInput.value = (acc && acc.elybyNick) || '';

    applySkinAvatars();
    refreshSkinUI();
  }

  document.getElementById('account-select')?.addEventListener('change', function () {
    const acc = (settings.accounts || [])[parseInt(this.value, 10)];
    if (!acc) return;
    settings.username = acc.name;
    saveSettings();
    refreshAccountUI();
  });

  document.getElementById('btn-add-account')?.addEventListener('click', async function () {
    const name = await uiPrompt({
      title: 'Nueva cuenta',
      message: 'Nombre para la nueva cuenta:',
      placeholder: 'Ej. Usuario2',
      okText: 'Crear'
    });
    if (name && name.trim()) {
      const clean = name.trim();
      if (!settings.accounts) settings.accounts = [];
      if (settings.accounts.some(a => a.name === clean)) {
        showToast('Ya existe una cuenta con ese nombre', 'error');
        return;
      }
      settings.accounts.push({ name: clean });
      settings.currentAccount = settings.accounts.length - 1;
      settings.username = clean;
      saveSettings();
      refreshAccountUI();
    }
  });

  document.getElementById('btn-remove-account')?.addEventListener('click', async function () {
    if (this.disabled) return;
    const acc = activeAccount();
    if (!acc) return;
    const ok = await uiConfirm({
      title: 'Eliminar cuenta',
      message: `¿Seguro que quieres eliminar la cuenta "${acc.name}"?`,
      okText: 'Eliminar',
      danger: true
    });
    if (!ok) return;
    const idx = (settings.accounts || []).indexOf(acc);
    settings.accounts.splice(idx, 1);
    if (settings.accounts.length === 0) settings.accounts = [{ name: 'Usuario' }];
    settings.username = settings.accounts[0].name;
    saveSettings();
    refreshAccountUI();
  });

  document.getElementById('btn-save-elyby')?.addEventListener('click', function () {
    const input = document.getElementById('elyby-nick-input');
    if (!input) return;
    const acc = activeAccount();
    if (!acc) return;
    acc.elybyNick = input.value.trim();
    settings.username = acc.name;
    saveSettings();
    refreshAccountUI();
    showToast(acc.elybyNick ? 'Skin Ely.by vinculado: ' + acc.elybyNick : 'Skin Ely.by desvinculado', 'info');
  });

  const profileUsernameInput = document.getElementById('profile-username-input');
  if (profileUsernameInput) {
    profileUsernameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveUsername();
    });
  }
  document.getElementById('btn-save-username')?.addEventListener('click', saveUsername);

  function saveUsername() {
    const input = document.getElementById('profile-username-input');
    if (!input) return;
    const name = input.value.trim();
    if (!name) return showToast('Escribe un nombre de usuario', 'error');
    if (name.length < 3 || name.length > 16) {
      return showToast('El nombre debe tener entre 3 y 16 caracteres', 'error');
    }
    if (!settings.accounts) settings.accounts = [{ name: 'Usuario' }];
    const acc = activeAccount();
    if (acc) acc.name = name;
    settings.username = name;
    saveSettings();
    refreshAccountUI();
    showToast('Nombre guardado: ' + name, 'info');
  }

  // ----------------------------------------------------------
  // 14. SERVIDORES PERSONALES (perfil)
  // ----------------------------------------------------------
  function updateProfileStats() {
    const statInstalled = document.getElementById('stat-modes');
    const statVersions = document.getElementById('stat-versions');
    const statServers = document.getElementById('stat-servers');
    if (statInstalled) statInstalled.textContent = instancesCache.length;
    const bases = new Set(detectedCache.map(v => v.base || v.id));
    instancesCache.forEach(i => bases.add(i.mcVersion));
    if (statVersions) statVersions.textContent = bases.size;
    if (statServers) statServers.textContent = (settings.servers || []).length + FEATURED_SERVERS.length;

    // Estadísticas ampliadas del rediseño
    const totalMin = instancesCache.reduce((a, i) => a + (i.playedMinutes || 0), 0);
    const pt = document.getElementById('stat-playtime');
    const chipPt = document.getElementById('chip-playtime');
    const label = totalMin >= 60 ? Math.floor(totalMin / 60) + 'h' : (totalMin || 0) + 'm';
    if (pt) pt.textContent = label;
    if (chipPt) chipPt.textContent = label;
    const chipInst = document.getElementById('chip-instances');
    if (chipInst) chipInst.textContent = instancesCache.length;

    renderActivity();
    renderPlayerStrip();
  }

  function formatPlaytime(mins) {
    if (!mins) return 'Sin jugar aún';
    if (mins < 60) return mins + ' minutos';
    const h = Math.floor(mins / 60);
    return h + ' h ' + (mins % 60 ? (mins % 60) + ' min' : '').trim();
  }

  function renderActivity() {
    const list = document.getElementById('activity-list');
    if (!list) return;
    const played = instancesCache.filter(i => i.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 5);
    if (!played.length) {
      list.innerHTML = '<div class="empty-state" style="padding:var(--sp-6)"><span class="empty-state-desc">Aún no has jugado ninguna instancia. ¡Lanza tu primera partida!</span></div>';
      return;
    }
    list.innerHTML = played.map(inst => {
      const icon = iconFor('inst|' + inst.id + '|' + inst.mcVersion + '|' + (inst.loaderType || ''), inst.icon, inst.icon ? inst.color : null);
      return `<div class="activity-item">
        <span class="activity-icon" style="background:${icon.color}22;color:${icon.color}">${escapeHtml(icon.glyph)}</span>
        <div class="activity-main">
          <div class="activity-name">${escapeHtml(inst.name)}</div>
          <div class="activity-sub">${escapeHtml(inst.mcVersion)}${inst.loaderType && inst.loaderType !== 'vanilla' ? ' · ' + escapeHtml(inst.loaderType) : ''} · ${formatPlaytime(inst.playedMinutes)}</div>
        </div>
        <span class="activity-time">${formatLastPlayed(inst.lastPlayed)}</span>
      </div>`;
    }).join('');
  }

  function renderPlayerStrip() {
    const acc = activeAccount();
    const nameEl = document.getElementById('home-player-name');
    const dn = document.getElementById('profile-display-name');
    const nm = acc && acc.name ? acc.name : (settings.username || 'Usuario');
    if (nameEl) nameEl.textContent = nm;
    if (dn) dn.textContent = nm;
    resolveAccountHead(acc).then(src => {
      const c = document.getElementById('player-avatar');
      if (!c || !src) return;
      const img = new Image();
      img.onload = () => {
        const ctx = c.getContext('2d');
        if (!ctx) return;
        c.width = 8; c.height = 8;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
      };
      img.src = src;
    }).catch(() => {});
  }

  function renderServers() {
    const list = document.getElementById('servers-list');
    const servers = settings.servers || [];
    if (!list) return;
    if (!servers.length) {
      list.innerHTML = '<div class="empty-state small">Aún no has añadido servidores</div>';
      return;
    }
    list.innerHTML = servers.map((s, i) => `
      <div class="server-item">
        <div class="server-item-info">
          <span class="server-dot"></span>
          <span class="server-host">${escapeHtml(s.host || s)}</span>
        </div>
        <div class="server-item-actions">
          <button class="btn btn-gold btn-xs" data-server="${i}">Conectar</button>
          <button class="btn btn-ghost btn-xs text-danger" data-remove="${i}">Eliminar</button>
        </div>
      </div>`).join('');

    list.querySelectorAll('[data-server]').forEach(btn => {
      btn.addEventListener('click', function () {
        const s = settings.servers[parseInt(this.dataset.server, 10)];
        if (!s) return;
        const host = typeof s === 'string' ? s : s.host;
        showToast('Conectando a ' + host + '...', 'info');
        doLaunch({ serverIp: host });
      });
    });
    list.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', function () {
        settings.servers.splice(parseInt(this.dataset.remove, 10), 1);
        saveSettings();
        renderServers();
        updateProfileStats();
      });
    });
  }

  document.getElementById('btn-add-server')?.addEventListener('click', addServer);
  document.getElementById('input-server-ip')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addServer();
  });

  function addServer() {
    const input = document.getElementById('input-server-ip');
    const raw = input.value.trim();
    if (!raw) return showToast('Escribe una IP de servidor', 'error');
    if (!/^[a-z0-9.\-:_]+$/i.test(raw)) return showToast('IP inválida', 'error');
    if (!settings.servers) settings.servers = [];
    if (settings.servers.some(s => (typeof s === 'string' ? s : s.host) === raw)) {
      return showToast('Ese servidor ya está añadido', 'info');
    }
    settings.servers.push({ host: raw });
    saveSettings();
    input.value = '';
    renderServers();
    updateProfileStats();
    showToast('Servidor añadido: ' + raw, 'info');
  }

  // ----------------------------------------------------------
  // 15. CARPETA DEL JUEGO
  // ----------------------------------------------------------
  document.getElementById('btn-open-game-dir')?.addEventListener('click', async function () {
    const dir = await api.openGameDir();
    showToast('Abriendo: ' + dir, 'info');
  });

  document.getElementById('btn-choose-game-dir')?.addEventListener('click', async function () {
    const res = await api.chooseGameDir();
    if (res && res.success) {
      settings.gameDir = res.path;
      showToast('Carpeta cambiada: ' + res.path, 'info');
      refreshDetected().catch(() => {});
    }
  });

  // ----------------------------------------------------------
  // 16. ACCESOS RÁPIDOS DEL INICIO
  // ----------------------------------------------------------
  document.getElementById('qa-new-instance')?.addEventListener('click', () => openCreateModal());
  document.getElementById('qa-servers')?.addEventListener('click', () => navigateTo('servers'));
  document.getElementById('qa-open-folder')?.addEventListener('click', async function () {
    const btn = this;
    btn.disabled = true;
    try {
      const res = await api.openGameDir();
      if (res && !res.success) showToast(res.error || 'No se pudo abrir la carpeta', 'error');
    } catch (e) {
      showToast('No se pudo abrir la carpeta', 'error');
    }
    btn.disabled = false;
  });
  document.getElementById('qa-updates')?.addEventListener('click', () => {
    document.getElementById('btn-check-updates')?.click();
    showToast('Buscando actualizaciones...', 'info');
  });

  // ----------------------------------------------------------
  // 17. TOUR GUIADO
  // ----------------------------------------------------------
  const tourOverlay = document.getElementById('tour-overlay');
  const tourSpotlight = document.getElementById('tour-spotlight');
  const tourCard = document.getElementById('tour-card');
  const tourTitle = document.getElementById('tour-title');
  const tourText = document.getElementById('tour-text');
  const tourStepCounter = document.getElementById('tour-step-counter');
  const tourNextBtn = document.getElementById('btn-tour-next');
  const tourSkipBtn = document.getElementById('btn-tour-skip');

  const TOUR_STEPS = [
    {
      title: 'Bienvenido a Runic Client',
      text: 'Te enseñamos lo esencial en 5 pasos rápidos. Puedes saltarlo cuando quieras.',
      target: null
    },
    {
      title: 'Juega al instante',
      text: 'Elige una versión y pulsa Jugar: se descarga lo que falte automáticamente. Al iniciar Minecraft, el launcher se guarda en la bandeja del sistema.',
      target: '#btn-play-hero',
      page: 'home'
    },
    {
      title: 'Tus instancias',
      text: 'Cada instancia tiene sus propios mundos, mods y configuración. Crea una por versión de Minecraft o modloader (Forge, Fabric, NeoForge, OptiFine).',
      target: '[data-page="instances"]',
      page: 'instances'
    },
    {
      title: 'Servidores destacados',
      text: 'Consulta el estado en tiempo real de los servidores más populares: jugadores conectados, MOTD y latencia.',
      target: '[data-page="servers"]',
      page: 'servers'
    },
    {
      title: 'Ajustes importantes',
      text: 'Configura tu RAM y Java. Si no detectamos tu Java automáticamente, añade su carpeta aquí mismo.',
      target: '[data-page="settings"]',
      page: 'settings'
    }
  ];
  let tourIndex = 0;

  function positionTourCard(targetSel) {
    if (!tourCard) return;
    if (!targetSel) {
      tourCard.style.left = '50%';
      tourCard.style.top = '50%';
      tourCard.style.transform = 'translate(-50%, -50%)';
      if (tourSpotlight) {
        tourSpotlight.style.display = 'none';
      }
      return;
    }
    const el = document.querySelector(targetSel);
    if (!el) {
      positionTourCard(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    if (tourSpotlight) {
      tourSpotlight.style.display = '';
      tourSpotlight.style.left = (rect.left - 8) + 'px';
      tourSpotlight.style.top = (rect.top - 8) + 'px';
      tourSpotlight.style.width = (rect.width + 16) + 'px';
      tourSpotlight.style.height = (rect.height + 16) + 'px';
    }
    const cardW = 340, cardH = 220;
    let left = rect.right + 20;
    let top = rect.top;
    if (left + cardW > window.innerWidth - 20) {
      left = Math.max(20, rect.left - cardW - 20);
    }
    if (top + cardH > window.innerHeight - 20) top = window.innerHeight - cardH - 20;
    if (top < 20) top = 20;
    tourCard.style.left = left + 'px';
    tourCard.style.top = top + 'px';
    tourCard.style.transform = 'none';
  }

  function showTourStep(i) {
    tourIndex = i;
    const step = TOUR_STEPS[i];
    if (!step) return finishTour(true);
    if (step.page) navigateTo(step.page);
    tourStepCounter.textContent = `Paso ${i + 1} de ${TOUR_STEPS.length}`;
    tourTitle.textContent = step.title;
    tourText.textContent = step.text;
    tourNextBtn.textContent = i === TOUR_STEPS.length - 1 ? 'Terminar' : 'Siguiente';
    requestAnimationFrame(() => positionTourCard(step.target));
  }

  function startTour() {
    tourOverlay.style.display = '';
    showTourStep(0);
  }

  function finishTour(completed) {
    tourOverlay.style.display = 'none';
    api.setMeta('tourDone', true);
    navigateTo('home');
    maybeShowFirstAccountModal();
  }

  tourNextBtn?.addEventListener('click', () => {
    if (tourIndex >= TOUR_STEPS.length - 1) finishTour(true);
    else showTourStep(tourIndex + 1);
  });
  tourSkipBtn?.addEventListener('click', () => finishTour('skip'));
  window.addEventListener('resize', debounce(() => {
    if (tourOverlay && tourOverlay.style.display !== 'none') {
      positionTourCard(TOUR_STEPS[tourIndex] && TOUR_STEPS[tourIndex].target);
    }
  }, 150));

  // ----------------------------------------------------------
  // 18. MODAL PRIMERA CUENTA
  // ----------------------------------------------------------
  const firstAccModal = document.getElementById('modal-first-account');
  const firstAccName = document.getElementById('first-account-name');
  const firstAccElyby = document.getElementById('first-account-elyby');
  const firstAccAvatar = document.getElementById('first-account-avatar');
  const firstAccCanvas = document.getElementById('first-account-skin-canvas');
  const firstAccNote = document.getElementById('first-account-note');

  function maybeShowFirstAccountModal() {
    if ((settings.accounts || []).length > 0) return;
    firstAccModal.classList.add("open", "locked");
    setTimeout(() => firstAccName && firstAccName.focus(), 80);
  }

  async function previewFirstAccountSkin() {
    const nick = (firstAccElyby.value || '').trim();
    if (!nick) {
      firstAccCanvas.style.display = 'none';
      firstAccAvatar.style.display = '';
      firstAccNote.textContent = 'Sin skin de Ely.by usarás el skin por defecto de Minecraft.';
      return;
    }
    const head = await getSkinHead(nick);
    if (head) {
      const ctx = firstAccCanvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, 64, 64);
        ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64);
      };
      img.src = head;
      firstAccCanvas.style.display = '';
      firstAccAvatar.style.display = 'none';
      firstAccNote.textContent = 'Skin encontrado en Ely.by. Se usará dentro del juego.';
    } else {
      firstAccCanvas.style.display = 'none';
      firstAccAvatar.style.display = '';
      firstAccNote.textContent = 'No se encontró ese nick en Ely.by (se usará el skin por defecto).';
    }
  }

  firstAccElyby?.addEventListener('input', debounce(previewFirstAccountSkin, 500));

  document.getElementById('btn-confirm-first-account')?.addEventListener('click', async function () {
    const name = (firstAccName.value || '').trim();
    if (name.length < 3 || name.length > 16) {
      return showToast('El nombre debe tener entre 3 y 16 caracteres', 'error');
    }
    const elyby = (firstAccElyby.value || '').trim();
    settings.accounts = [{ name, elybyNick: elyby }];
    settings.username = name;
    await saveSettings();
    firstAccModal.classList.remove('open');
    refreshAccountUI();
    showToast('¡Cuenta creada! Bienvenido, ' + name, 'info');
  });

  // ----------------------------------------------------------
  // 19. PARTICLES
  // ----------------------------------------------------------
  const particleContainer = document.getElementById('particles-container');
  if (particleContainer) {
    const RUNE_SYMBOLS = ['⟐', '✦', '⬩', '⌾', '⊹', '⋆', '⍟', '⊛', '◈', '◆'];
    const COLORS = [
      'rgba(168, 85, 247, 0.3)',
      'rgba(155, 89, 182, 0.2)',
      'rgba(201, 169, 89, 0.15)',
      'rgba(224, 192, 106, 0.1)'
    ];
    function createParticle() {
      const isRune = Math.random() > 0.6;
      const particle = document.createElement('div');
      if (isRune) {
        particle.className = 'ambient-particle rune';
        particle.textContent = RUNE_SYMBOLS[Math.floor(Math.random() * RUNE_SYMBOLS.length)];
        const size = 10 + Math.random() * 14;
        particle.style.width = size + 'px';
        particle.style.height = size + 'px';
        particle.style.fontSize = (size * 0.7) + 'px';
        particle.style.opacity = '0.08';
      } else {
        particle.className = 'ambient-particle dot';
        const size = 2 + Math.random() * 4;
        particle.style.width = size + 'px';
        particle.style.height = size + 'px';
        particle.style.background = COLORS[Math.floor(Math.random() * COLORS.length)];
      }
      particle.style.left = Math.random() * 100 + '%';
      particle.style.bottom = '-10%';
      particle.style.animationDuration = (20 + Math.random() * 30) + 's';
      particle.style.animationDelay = (Math.random() * 25) + 's';
      return particle;
    }
    for (let i = 0; i < 16; i++) particleContainer.appendChild(createParticle());

    // Pausar animaciones del fondo cuando la ventana no es visible (bandeja)
    document.addEventListener('visibilitychange', () => {
      particleContainer.style.display = document.hidden ? 'none' : '';
    });
  }

  // ----------------------------------------------------------
  // 20. RIPPLE + KEYBOARD
  // ----------------------------------------------------------
  if (!document.querySelector('#ripple-style')) {
    const style = document.createElement('style');
    style.id = 'ripple-style';
    style.textContent = `@keyframes ripple-effect { to { transform: scale(2.5); opacity: 0; } }`;
    document.head.appendChild(style);
  }

  document.querySelectorAll('.btn').forEach(btn => {
    if (getComputedStyle(btn).position !== 'relative') btn.style.position = 'relative';
    if (getComputedStyle(btn).overflow !== 'hidden') btn.style.overflow = 'hidden';
    btn.addEventListener('click', function (e) {
      if (this.disabled) return;
      const ripple = document.createElement('span');
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      ripple.style.cssText = [
        'position:absolute',
        `width:${size}px`,
        `height:${size}px`,
        `left:${e.clientX - rect.left - size / 2}px`,
        `top:${e.clientY - rect.top - size / 2}px`,
        'border-radius:50%',
        'background:rgba(255,255,255,0.12)',
        'transform:scale(0)',
        'animation:ripple-effect 0.5s ease-out',
        'pointer-events:none'
      ].join(';');
      this.appendChild(ripple);
      requestAnimationFrame(() => setTimeout(() => ripple.remove(), 500));
    });
  });

  document.addEventListener('keydown', function (e) {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!e.ctrlKey) return;
    const map = { '1': 'home', '2': 'servers', '3': 'instances', '4': 'mods', '5': 'modpacks', '6': 'settings', '7': 'profile' };
    if (map[e.key]) navigateTo(map[e.key]);
  });

  // ----------------------------------------------------------
  // 20b. WIRING DEL REDISEÑO (home, servers v2, ajustes tabs)
  // ----------------------------------------------------------
  let srvFavs = {};
  let srvQuery = '';
  let srvFilter = 'all';
  let srvSort = 'default';
  const srvResults = [];

  async function loadSrvFavs() {
    try { srvFavs = (await api.getMeta('srvFavs', {})) || {}; } catch (e) { srvFavs = {}; }
  }
  async function saveSrvFavs() {
    try { await api.setMeta('srvFavs', srvFavs); } catch (e) {}
  }

  

  function applyServerView() {
    if (!serversGrid) return;
    const cards = Array.from(serversGrid.children);
    const list = cards.map(card => ({
      card,
      data: srvResults[Number(String(card.id).replace('srv-', ''))] || { host: card.dataset.host, name: card.dataset.name }
    }));
    let visible = list;
    if (srvQuery) {
      const q = srvQuery.toLowerCase();
      visible = visible.filter(x => ((x.data.name || '') + ' ' + (x.data.host || '')).toLowerCase().includes(q));
    }
    if (srvFilter === 'fav') visible = visible.filter(x => srvFavs[(x.data.host || '').toLowerCase()]);
    if (srvFilter === 'online') visible = visible.filter(x => x.data.result && x.data.result.online);
    if (srvSort !== 'default') {
      const val = x => srvSort === 'ping'
        ? (x.data.result && x.data.result.online ? x.data.result.latency : Infinity)
        : srvSort === 'players'
          ? (x.data.result && x.data.result.online ? -(x.data.result.playersOnline || 0) : Infinity)
          : String(x.data.name || '').toLowerCase();
      visible = [...visible].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0));
    }
    visible.forEach(({ card }) => { card.style.display = ''; serversGrid.appendChild(card); });
    list.forEach(({ card }) => {
      if (!visible.some(v => v.card === card)) card.style.display = 'none';
    });
  }

  document.getElementById('srv-search')?.addEventListener('input', function () { srvQuery = this.value.trim(); applyServerView(); });
  document.getElementById('srv-filter')?.addEventListener('change', function () { srvFilter = this.value; soundManager.play('click'); applyServerView(); });
  document.getElementById('srv-sort')?.addEventListener('change', function () { srvSort = this.value; soundManager.play('click'); applyServerView(); });

  // --- Home: chips de servidores destacados ---
  function renderRecentChips() {
    const row = document.getElementById('recent-row');
    const wrap = document.getElementById('recent-chips');
    if (!row || !wrap) return;
    row.style.display = '';
    wrap.innerHTML = FEATURED_SERVERS.slice(0, 4).map((s, i) => `
      <button class="recent-chip" data-recent-host="${escapeHtml(s.host)}">
        <span class="rc-icon">?</span>
        <span class="rc-ping" id="rc-ping-${i}"></span>
        <b>${escapeHtml(s.name)}</b>
      </button>`).join('');
    wrap.querySelectorAll('[data-recent-host]').forEach(b =>
      b.addEventListener('click', () => connectToServer(b.dataset.recentHost))
    );
    FEATURED_SERVERS.slice(0, 4).forEach(async (s, i) => {
      let r;
      r = await pingHost(s.host);
      const dot = document.getElementById('rc-ping-' + i);
      if (dot && r) dot.className = 'rc-ping ' + (r.online ? 'online' : 'offline');
    });
  }

  // --- Home: novedades remotas (JSON de updateUrl con campo news[]) ---
  async function loadRemoteNews() {
    const mini = document.getElementById('news-mini');
    const list = document.getElementById('news-list');
    if (!mini || !list || !settings.updateUrl) return;
    try {
      const res = await fetch(settings.updateUrl, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data.news) || !data.news.length) return;
      list.innerHTML = data.news.slice(0, 3).map(n =>
        `<div class="news-item">
          ${n.tag ? `<span class="news-item-tag">${escapeHtml(String(n.tag))}</span>` : ''}
          <div class="news-item-title">${escapeHtml(String(n.title || ''))}</div>
          <div class="news-item-body">${escapeHtml(String(n.body || n.text || ''))}</div>
        </div>`).join('');
      mini.style.display = '';
    } catch (e) {}
  }

  // --- Ajustes: pestañas + búsqueda ---
  document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.settings-tab').forEach(x => x.classList.toggle('active', x === tab));
      const key = tab.dataset.tab;
      document.querySelectorAll('#page-settings .settings-pane').forEach(pn => pn.classList.toggle('active', pn.dataset.pane === key));
      soundManager.play('whoosh');
    });
  });

  document.getElementById('settings-search')?.addEventListener('input', function () {
    const q = this.value.trim().toLowerCase();
    const panes = document.querySelectorAll('#page-settings .settings-pane');
    if (!q) {
      panes.forEach(pn => {
        pn.querySelectorAll('.settings-row, .profile-name-row').forEach(r => { r.style.display = ''; });
        pn.querySelectorAll('.settings-group').forEach(g => { g.style.display = ''; });
      });
      const activeTab = document.querySelector('.settings-tab.active');
      const key = activeTab ? activeTab.dataset.tab : 'game';
      panes.forEach(pn => pn.classList.toggle('active', pn.dataset.pane === key));
      return;
    }
    panes.forEach(pn => {
      pn.classList.add('active');
      pn.querySelectorAll('.settings-group').forEach(group => {
        let any = false;
        group.querySelectorAll('.settings-row, .profile-name-row').forEach(row => {
          const hit = (row.textContent || '').toLowerCase().includes(q);
          row.style.display = hit ? '' : 'none';
          if (hit) any = true;
        });
        group.style.display = any ? '' : 'none';
      });
    });
  });

  // --- Perfil: cabeza grande del jugador ---
  function renderProfileSkin() {
    const acc = activeAccount();
    resolveAccountHead(acc).then(src => {
      const c = document.getElementById('profile-skin-canvas');
      if (!c || !src) return;
      const img = new Image();
      img.onload = () => {
        const ctx = c.getContext('2d');
        if (!ctx) return;
        c.width = 8; c.height = 8;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
      };
      img.src = src;
    }).catch(() => {});
  }

  // ----------------------------------------------------------
  // 20c. CUENTA MICROSOFT
  // ----------------------------------------------------------
  const msCodeBox = document.getElementById("ms-code-box");
  const msUserCodeEl = document.getElementById("ms-user-code");
  const msLoginStateEl = document.getElementById("ms-login-state");
  const msSessionDesc = document.getElementById("ms-session-desc");
  const btnMsLogin = document.getElementById("btn-ms-login");
  const btnMsCancel = document.getElementById("btn-ms-cancel");
  const btnMsLogout = document.getElementById("btn-ms-logout");
  let msUri = "";

  async function refreshMicrosoftUI() {
    try {
      const cid = await api.msGetClientId();
      const inp = document.getElementById("ms-client-id");
      if (inp && !inp.value) inp.value = cid || "";
      const has = await api.msHasSession();
      if (has) {
        if (msSessionDesc) msSessionDesc.textContent = "Sesion premium activa. JUGAR usara tu cuenta de Minecraft automaticamente.";
        if (btnMsLogout) btnMsLogout.style.display = "";
        if (btnMsLogin) btnMsLogin.style.display = "none";
      } else {
        if (msSessionDesc) msSessionDesc.textContent = cid ? "Sin sesion premium." : "Pega tu Client ID de Azure arriba para habilitar premium.";
        if (btnMsLogout) btnMsLogout.style.display = "none";
        if (btnMsLogin) btnMsLogin.style.display = "";
      }
    } catch (e) {}
  }

  document.getElementById("btn-ms-save-cid")?.addEventListener("click", async function () {
    const v = (document.getElementById("ms-client-id").value || "").trim();
    await api.msSaveClientId(v);
    showToast(v ? "Client ID guardado" : "Client ID borrado", "info");
    refreshMicrosoftUI();
    if (document.getElementById("mods-grid")) renderCatalog();
    if (packsGrid) { renderPacks(); const _oldRI = refreshInstances; window.refreshInstances = async function(){ await _oldRI(); renderPacks(); }; }
  });
  btnMsLogin?.addEventListener("click", async function () {
    btnMsLogin.disabled = true;
    btnMsCancel.style.display = "";
    msCodeBox.style.display = "";
    msLoginStateEl.textContent = "Generando codigo...";
    await api.msLoginStart();
  });
  btnMsCancel?.addEventListener("click", async () => { await api.msCancelLogin(); });
  btnMsLogout?.addEventListener("click", async () => { await api.msLogout(); showToast("Sesion Microsoft cerrada", "info"); refreshMicrosoftUI(); });
  document.getElementById("btn-ms-open-link")?.addEventListener("click", () => { if (msUri) api.openExternal(msUri); });

  api.onMsLoginStatus((d) => {
    if (!d) return;
    if (d.type === "code") {
      msUserCodeEl.textContent = d.user_code;
      msUri = d.verification_uri;
      msLoginStateEl.textContent = "Esperando tu inicio de sesion...";
    } else if (d.type === "done") {
      msLoginStateEl.textContent = "Sesion lista: " + d.profile.name;
      setTimeout(() => { msCodeBox.style.display = "none"; btnMsCancel.style.display = "none"; btnMsLogin.disabled = false; refreshMicrosoftUI(); }, 1400);
      showToast("Cuenta premium vinculada: " + d.profile.name, "success");
      soundManager.play("startup");
    } else if (d.type === "cancelled") {
      msLoginStateEl.textContent = "Cancelado.";
      btnMsCancel.style.display = "none"; btnMsLogin.disabled = false;
    } else if (d.type === "error") {
      msLoginStateEl.textContent = d.message;
      showToast(d.message, "error");
      btnMsCancel.style.display = "none"; btnMsLogin.disabled = false;
    }
  });

  // ----------------------------------------------------------
  // 20d. CATALOGO MODRINTH (Descubrir)
  // ----------------------------------------------------------
  let mType = "mod", mQuery = "", mGV = "", mTimer = null;
  const modsGrid = document.getElementById("mods-grid");

  function fmtDownloads(n) {
    if (!n && n !== 0) return "";
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  async function renderCatalog() {
    if (!modsGrid) return;
    modsGrid.innerHTML = Array.from({ length: 6 }).map(() => '<div class="mod-tile"><div class="mod-tile-head"><span class="mod-tile-icon">?</span><div class="activity-main"><div class="activity-name">&nbsp;</div></div></div></div>').join("");
    const res = await api.modrinthSearch(mType, mQuery, { gameVersion: mGV || undefined, limit: 18 });
    const hits = (res && res.hits) || [];
    if (!hits.length) { modsGrid.innerHTML = ""; document.getElementById("mods-empty").style.display = ""; return; }
    document.getElementById("mods-empty").style.display = "none";
    modsGrid.innerHTML = hits.map(h => {
      const icon = h.icon_url ? '<img src="' + h.icon_url + '" style="width:42px;height:42px;border-radius:10px;" alt="">' : '<span class="mod-tile-icon">?</span>';
      return '<div class="mod-tile">' +
        '<div class="mod-tile-head">' + icon +
        '<div class="activity-main"><div class="activity-name">' + escapeHtml(h.title || "") + '</div>' +
        '<div class="activity-sub">' + escapeHtml((h.author || "")) + ' · ' + fmtDownloads(h.downloads) + ' descargas</div></div></div>' +
        '<div class="quick-desc" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">' + escapeHtml(String(h.description || "").slice(0, 140)) + '</div>' +
        '<div class="activity-sub">Clic para ver detalles e instalar</div>' +
        '</div>';
    }).join("");
    modsGrid.querySelectorAll('.mod-tile').forEach((tile, idx) => {
      tile.style.cursor = 'pointer';
      tile.addEventListener('click', () => { const h = hits[idx]; if (h) openModDetail(h.project_id || h.slug, h.title); });
    });
  }

  async function installFlow(projectId, name) {
    const targets = instancesCache.filter(i => (i.loaderType || "vanilla") !== "vanilla");
    let choice = null;
    if (mType === "mod") {
      if (!targets.length) return showToast("Primero crea una instancia con Fabric/Forge/NeoForge", "error");
      choice = await uiChoices({
        title: "Instalar " + name,
        message: "Elige la instancia donde instalar el mod:",
        choicesList: targets.map(i => ({ id: i.id, label: i.name, desc: i.mcVersion + " · " + i.loaderType })),
        okText: "Instalar"
      });
    } else if (mType === "shader" || mType === "resourcepack") {
      const opts = [{ id: "__shared__", label: "Carpeta compartida del juego", desc: settings.gameDir || "carpeta por defecto" }]
        .concat(instancesCache.map(i => ({ id: i.id, label: i.name, desc: i.mcVersion + " · " + (i.loaderType || "vanilla") })));
      choice = await uiChoices({ title: "Instalar " + name, message: "Donde instalar:", choicesList: opts, okText: "Instalar" });
    } else {
      choice = "__newpack__";
    }
    if (!choice) return;
    const payload = { type: mType, projectId };
    if (choice === "__shared__") payload.shared = true;
    else if (choice === "__newpack__") payload.packName = name;
    else payload.instanceId = choice;
    showToast("Descargando e instalando...", "info");
    const r = await api.modrinthInstall(payload);
    if (r && r.success) {
      showToast("Instalado en " + (r.where || "destino"), "success");
      soundManager.play("startup");
      refreshInstances();
    } else {
      showToast((r && r.error) || "Fallo la instalacion", "error");
    }
  }

  document.querySelectorAll("[data-mtype]").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll("[data-mtype]").forEach(x => x.classList.toggle("active", x === tab));
      mType = tab.dataset.mtype;
      soundManager.play("whoosh");
      renderCatalog();
    });
  });
  document.getElementById("mods-search")?.addEventListener("input", function () {
    clearTimeout(mTimer); mQuery = this.value.trim();
    mTimer = setTimeout(renderCatalog, 400);
  });
  document.getElementById("mods-gameversion")?.addEventListener("change", function () {
    mGV = this.value; renderCatalog();
  });

  // ----------------------------------------------------------
  // 20e. MODAL DETALLE CATALOGO
  // ----------------------------------------------------------
  function extractYouTubeId(html) {
    const m = String(html || "").match(/(?:youtube\.com\/(?:embed\/|watch\?v=|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function sanitizeHtml(html) {
    return String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/ on[a-z]+="[^"]*"/gi, "")
      .replace(/ on[a-z]+='[^']*'/gi, '')
      .replace(/javascript:/gi, "");
  }

  const detailModal = document.getElementById("modal-detail");
  const detailState = { projectId: null, name: "", type: null, versions: [], loaderFilter: null, gvFilter: "" };

  function closeDetail() { detailModal.classList.remove("open"); }
  document.getElementById("detail-close")?.addEventListener("click", closeDetail);
  detailModal?.addEventListener("click", e => { if (e.target === detailModal) closeDetail(); });

  function fmtDate(ts) { try { return new Date(ts).toLocaleDateString(); } catch (e) { return ""; } }
  function fmtBytes(n) { if (!n) return ""; if (n > 1048576) return (n / 1048576).toFixed(1) + " MB"; return Math.round(n / 1024) + " KB"; }

  async function openModDetail(projectId, name) {
    if (!detailModal) return;
    detailState.projectId = projectId; detailState.name = name || projectId;
    detailState.type = mType;
    detailState.versions = []; detailState.loaderFilter = null; detailState.gvFilter = "";
    detailModal.classList.add("open");
    const tEl = document.getElementById("detail-title");
    const mEl = document.getElementById("detail-meta");
    const dEl = document.getElementById("detail-desc");
    tEl.textContent = name; mEl.textContent = "Cargando...";
    dEl.innerHTML = "<em>Cargando…</em>";
    document.getElementById("detail-vers").innerHTML = "<em>Cargando…</em>";
    document.getElementById("detail-gv").style.display = "";
    document.getElementById("detail-loaders").dataset.built = "";
    document.getElementById("detail-gallery").style.display = "none";
    document.getElementById("detail-deps-sec").style.display = "none";

    const [proj, vers] = await Promise.all([
      api.modrinthProject(projectId),
      api.modrinthVersions(projectId).catch(() => [])
    ]);
    if (!proj || proj.error) { dEl.textContent = (proj && proj.error) || "No se pudo cargar"; return; }
    detailState.versions = Array.isArray(vers) ? vers : [];

    const ic = document.getElementById("detail-icon");
    if (proj.icon_url) ic.src = proj.icon_url; else ic.removeAttribute("src");
    tEl.textContent = proj.title || name;
    mEl.innerHTML = escapeHtml(proj.author ? "por " + proj.author : "") + " · " + fmtDownloads(proj.downloads) +
      " descargas · actualizado " + fmtDate(proj.updated);
    const gal = document.getElementById("detail-gallery");
    if (Array.isArray(proj.gallery) && proj.gallery.length) {
      gal.style.display = "flex";
      gal.innerHTML = proj.gallery.map(g => '<img src="' + escapeHtml(g.url) + '" alt="">').join("");
    } else gal.style.display = "none";
    dEl.innerHTML = sanitizeHtml(proj.body || "(sin descripción)");

    // Tráiler de YouTube si el proyecto lo trae embebido
    const ytId = extractYouTubeId(proj.body);
    const ytSec = document.getElementById("detail-yt-sec");
    if (ytId) {
      ytSec.style.display = "";
      document.getElementById("detail-yt").innerHTML =
        '<div class="yt-thumb" data-yt="' + ytId + '">' +
        '<img src="https://i.ytimg.com/vi/' + ytId + '/hqdefault.jpg" loading="lazy" alt="trailer">' +
        '<span class="yt-play">▶</span></div>';
      document.querySelector('#detail-yt .yt-thumb').addEventListener('click', function () {
        const id = this.dataset.yt;
        this.innerHTML = '<div style="padding:10px;text-align:center;"><span class="text-sm text-muted">Abriendo reproductor…</span></div>';
      });
    } else ytSec.style.display = "none";

    // Dependencias (de la versión más reciente)
    const depsSec = document.getElementById("detail-deps-sec");
    const depIds = new Set();
    detailState.versions.slice(0, 3).forEach(v => (v.dependencies || []).forEach(d => { if (d.project_id) depIds.add(d.project_id); }));
    if (depIds.size) {
      depsSec.style.display = "";
      document.getElementById("detail-deps").innerHTML = Array.from(depIds).map(id =>
        '<button class="dchip" data-dep="' + escapeHtml(id) + '">' + escapeHtml(id) + '</button>').join("");
      document.querySelectorAll("#detail-deps [data-dep]").forEach(b => b.addEventListener("click", () => openModDetail(b.dataset.dep)));
    } else depsSec.style.display = "none";

    renderDetailVersions();
  }

  function renderDetailVersions() {
    const wrapEl = document.getElementById("detail-vers");
    const loadersEl = document.getElementById("detail-loaders");
    const gvSel = document.getElementById("detail-gv");

    const loaders = new Set();
    const gvs = new Set();
    detailState.versions.forEach(v => { (v.loaders || []).forEach(l => loaders.add(l)); (v.game_versions || []).slice(-6).forEach(g => gvs.add(g)); });

    if (!loadersEl.dataset.built) {
      loadersEl.dataset.built = "1";
      loadersEl.addEventListener("click", e => {
        const chip = e.target.closest(".dchip");
        if (!chip) return;
        detailState.loaderFilter = detailState.loaderFilter === chip.dataset.loader ? null : chip.dataset.loader;
        renderDetailVersions();
      });
      gvSel.addEventListener("change", () => { detailState.gvFilter = gvSel.value; renderDetailVersions(); });
    }
    loadersEl.innerHTML = Array.from(loaders).sort().map(l =>
      '<span class="dchip' + (detailState.loaderFilter === l ? " active" : "") + '" data-loader="' + l + '">' + l + '</span>').join("");
    const currentGv = gvSel.dataset.built ? gvSel.value : "";
    if (!gvSel.dataset.built || gvSel.dataset.for !== detailState.projectId) {
      gvSel.dataset.built = "1"; gvSel.dataset.for = detailState.projectId;
      gvSel.innerHTML = '<option value="">Cualquier versión</option>' + Array.from(gvs).sort().reverse().map(g =>
        '<option value="' + g + '">' + g + '</option>').join("");
    }
    void currentGv;

    let list = detailState.versions.filter(v => {
      if (detailState.loaderFilter && !(v.loaders || []).includes(detailState.loaderFilter)) return false;
      if (detailState.gvFilter && !(v.game_versions || []).includes(detailState.gvFilter)) return false;
      return true;
    }).slice(0, 30);

    if (!list.length) { wrapEl.innerHTML = "<em>Sin versiones con esos filtros</em>"; return; }
    wrapEl.innerHTML = list.map(v => {
      const f = (v.files || []).find(x => x.primary) || (v.files || [])[0] || {};
      return '<div class="dver">' +
        '<div><div class="dver-name">' + escapeHtml(v.name || v.version_number) + '</div>' +
        '<div class="dver-sub">' + (v.loaders || []).join(", ") + " · " + (v.game_versions || []).slice(-1)[0] + " · " + fmtDate(v.date_published) + " · " + fmtBytes(f.size) + '</div></div>' +
        '<button class="btn btn-primary btn-xs" data-vinstall="' + escapeHtml(v.id) + '">Instalar</button>' +
        '</div>';
    }).join("");
    wrapEl.querySelectorAll("[data-vinstall]").forEach(btn => {
      btn.addEventListener("click", () => installFromDetail(btn.dataset.vinstall));
    });
  }

  async function installFromDetail(versionId) {
    const v = detailState.versions.find(x => x.id === versionId);
    const type = (detailState.type || "mod").replace("resourcepack", "resourcepack");
    let choice = null;
    const targets = instancesCache.filter(i => (i.loaderType || "vanilla") !== "vanilla");
    if (type === "mod") {
      if (!targets.length) return showToast("Primero crea una instancia con Fabric/Forge/NeoForge", "error");
      choice = await uiChoices({ title: "Destino del mod", message: detailState.name, choicesList: targets.map(i => ({ id: i.id, label: i.name, desc: i.mcVersion + " · " + i.loaderType })), okText: "Instalar" });
      if (!choice) return;
      return runInstall({ type, projectId: detailState.projectId, versionId, instanceId: choice });
    }
    if (type === "shader" || type === "resourcepack") {
      const opts = [{ id: "__shared__", label: "Carpeta compartida del juego", desc: settings.gameDir || "" }]
        .concat(instancesCache.map(i => ({ id: i.id, label: i.name, desc: i.mcVersion })));
      choice = await uiChoices({ title: "Destino", message: detailState.name, choicesList: opts, okText: "Instalar" });
      if (!choice) return;
      return runInstall({ type, projectId: detailState.projectId, versionId, instanceId: choice === "__shared__" ? null : choice, shared: choice === "__shared__" });
    }
    // modpack: instancia nueva automática
    runInstall({ type, projectId: detailState.projectId, versionId, packName: detailState.name });
  }

  async function runInstall(payload) {
    showToast("Descargando e instalando...", "info");
    const r = await api.modrinthInstall(payload);
    if (r && r.success) { showToast("Instalado en " + (r.where || "destino"), "success"); soundManager.play("startup"); refreshInstances(); }
    else showToast((r && r.error) || "Fallo la instalación", "error");
  }

  // installFlow antiguo redirige al detalle
  window.__openModDetail = openModDetail;

  // ----------------------------------------------------------
  // 20f. GESTOR DE MODPACKS
  // ----------------------------------------------------------
  const packsGrid = document.getElementById("packs-grid");

  function renderPacks() {
    if (!packsGrid) return;
    const packs = instancesCache.filter(i => i.packSlug);
    const empty = document.getElementById("packs-empty");
    if (empty) empty.style.display = packs.length ? "none" : "";
    if (!packs.length) { packsGrid.innerHTML = ""; return; }
    packsGrid.innerHTML = packs.map(p => {
      const icon = p.packIcon
        ? '<img src="' + escapeHtml(p.packIcon) + '" style="width:56px;height:56px;border-radius:14px;object-fit:cover;" alt="">'
        : '<span class="mod-tile-icon">?</span>';
      return '<div class="mod-tile" style="gap:10px;">' +
        '<div class="mod-tile-head">' + icon +
        '<div class="activity-main"><div class="activity-name">' + escapeHtml(p.name) + '</div>' +
        '<div class="activity-sub">' + escapeHtml(p.mcVersion) + ' · ' + escapeHtml(p.loaderType || "vanilla") + ' · ' + (p.packFiles || 0) + ' mods</div></div></div>' +
        '<div class="quick-desc">Actualizado ' + fmtDate(p.packInstalledAt) + '</div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
          '<button class="btn btn-primary btn-sm" data-pk-play="' + p.id + '">Jugar</button>' +
          '<button class="btn btn-glass btn-sm" data-pk-update="' + p.id + '" data-slug="' + escapeHtml(p.packSlug) + '">Actualizar</button>' +
          '<button class="btn btn-glass btn-sm" data-pk-detail="' + escapeHtml(p.packSlug) + '">Detalle</button>' +
          '<button class="btn btn-ghost btn-sm text-danger" data-pk-del="' + p.id + '">Desinstalar</button>' +
        '</div>' +
      '</div>';
    }).join("");

    packsGrid.querySelectorAll("[data-pk-play]").forEach(b => b.addEventListener("click", () => doLaunch({ instanceId: b.dataset.pkPlay })));
    packsGrid.querySelectorAll("[data-pk-detail]").forEach(b => b.addEventListener("click", () => openModDetail(b.dataset.pkDetail)));
    packsGrid.querySelectorAll("[data-pk-update]").forEach(async b => {
      b.addEventListener("click", async () => {
        b.disabled = true;
        showToast("Buscando actualizaciones del pack...", "info");
        const r = await api.modrinthUpdatePack(b.dataset.pkUpdate);
        if (r && r.success && r.updated) { showToast("Pack actualizado (" + r.mods + " mods)", "success"); soundManager.play("startup"); }
        else if (r && r.updated === false) showToast(r.error || "Ya tienes la última versión", "info");
        else showToast((r && r.error) || "Fallo al actualizar", "error");
        b.disabled = false;
      });
    });
    packsGrid.querySelectorAll("[data-pk-del]").forEach(b => {
      b.addEventListener("click", async () => {
        const id = b.dataset.pkDel;
        const inst = instancesCache.find(i => i.id === id);
        const ok = await uiConfirm({ title: "Desinstalar pack", message: "Se eliminará la instancia completa de \"" + (inst ? inst.name : "") + "\" con sus mundos y configuración.", okText: "Desinstalar", danger: true });
        if (!ok) return;
        const r = await api.removeInstance(id, "all");
        if (r && r.success) { showToast("Modpack desinstalado", "success"); refreshInstances(); }
        else showToast((r && r.error) || "No se pudo desinstalar", "error");
      });
    });
  }

  // ----------------------------------------------------------
  // 21. INIT
  // ----------------------------------------------------------
  window.__openModDetailRef = null;
  async function init() {
    await loadSettings();

    currentLoaderType = settings.loaderType || 'vanilla';
    currentLoaderVersion = settings.loaderVersion || '';

    // Sonidos activos/inactivos según ajustes
    soundManager.enabled = settings.soundsEnabled !== false;

    // Versión real de la app en sidebar y hero
    try {
      const ver = await api.getAppVersion();
      if (ver) {
        const label = 'v' + ver;
        const sb = document.getElementById('sidebar-brand-ver');
        if (sb) sb.textContent = label;
        const hv = document.getElementById('hero-version');
        if (hv) hv.textContent = label;
      }
    } catch (e) {}

    refreshAccountUI();
    renderServers();
    updateProfileStats();

    // Versiones Mojang (para el hero y los selects)
    try {
      const data = await api.getVersions();
      if (data && !data.error) versionsData = data;
    } catch (e) {}
    populateVersionDropdown();
    refreshLoaderButtons();
    refreshLoaderVersions();

    await refreshInstances();
    refreshDetected().catch(() => {});
    try { viconOverrides = (await api.getMeta('viconOverrides', {})) || {}; } catch (e) {}
    loadSrvFavs().then(() => pingFeaturedServers());
    renderRecentChips();
    loadRemoteNews();
    renderProfileSkin();
    updateJavaChip();
    refreshMicrosoftUI();
    if (document.getElementById("mods-grid")) renderCatalog();
    if (packsGrid) { renderPacks(); const _oldRI = refreshInstances; window.refreshInstances = async function(){ await _oldRI(); renderPacks(); }; }
    renderJavaPaths();
    updatePlayButtonState();

    // Tour solo la primera vez (o mientras no exista ninguna cuenta)
    try {
      const tourDone = await api.getMeta('tourDone', false);
      const noAccounts = !(settings.accounts || []).length;
      if (!tourDone || noAccounts) setTimeout(startTour, 700);
    } catch (e) {}

    // Sonido de bienvenida cuando el cliente está listo
    setTimeout(() => soundManager.play('startup'), 300);
  }

  init();

})();
