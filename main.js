const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage, Notification, safeStorage } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const https = require('https');

// Permitir que los sonidos de la interfaz suenen sin interacción previa del usuario
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const settings = require('./services/settings');
const launcher = require('./services/launcher');
const loaders = require('./services/loaders');
const downloader = require('./services/downloader');
const instances = require('./services/instances');
const preloader = require('./services/preloader');
const db = require('./services/db');
const ping = require('./services/ping');

let win;
let tray = null;
let forceQuit = false;

function sendWin(channel, data) {
  if (win && !win.isDestroyed() && win.webContents) {
    win.webContents.send(channel, data);
  }
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'icons', 'icon.ico');
    const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : null;
    tray = new Tray(icon && !icon.isEmpty() ? icon : nativeImage.createEmpty());
    tray.setToolTip('Runic Client');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Mostrar launcher', click: () => showWindow() },
      { type: 'separator' },
      { label: 'Salir', click: () => { forceQuit = true; app.quit(); } }
    ]));
    tray.on('click', () => showWindow());
  } catch (e) {
    console.error('No se pudo crear la bandeja:', e.message);
  }
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function hideToTray() {
  if (!win || win.isDestroyed()) return;
  win.hide();
  try {
    if (launcher.isGameRunning() && Notification.isSupported()) {
      new Notification({
        title: 'Runic Client',
        body: 'Minecraft está corriendo. El launcher sigue en la bandeja del sistema.'
      }).show();
    } else if (tray) {
      tray.displayBalloon({ iconType: 'info', title: 'Runic Client', content: 'El launcher sigue abierto en la bandeja del sistema.' });
    }
  } catch (e) {}
}

// E2E opcional: solo con RUNIC_E2E=1 y nunca en producción
if (process.env.RUNIC_E2E === '1') {
  try {
    if (fs.existsSync(path.join(__dirname, 'scripts', 'e2e-pvp-dom.js'))) {
      require('./scripts/e2e-pvp-dom.js');
    }
  } catch (e) { console.error('[e2e] desactivado:', e.message); }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 1280,
    minHeight: 720,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#050508',
    show: false,
    icon: path.join(__dirname, 'assets', 'icons', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.loadFile('index.html');

  win.webContents.on('console-message', (_e, levelOrDetails, maybeMsg) => {
    let level = levelOrDetails;
    let msg = maybeMsg;
    if (typeof levelOrDetails === 'object' && levelOrDetails !== null) {
      level = levelOrDetails.level;
      msg = levelOrDetails.message;
    }
    if (level >= 2 || level === 'error') {
      console.error('[renderer]', msg);
    }
  });

  win.once('ready-to-show', () => {
    const s = settings.load();
    if (s.startMinimized) {
      win.minimize();
      win.show();
    } else {
      win.maximize();
      win.show();
    }
  });

  // Window controls
  ipcMain.on('window-minimize', () => win.minimize());
  ipcMain.on('window-maximize', () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on('window-close', () => {
    if (settings.load().minimizeToTrayOnLaunch) {
      hideToTray();
    } else {
      win.close();
    }
  });
  ipcMain.on('hide-to-tray', () => hideToTray());
  ipcMain.handle('window-isMaximized', () => win.isMaximized());

  win.on('maximize', () => win.webContents.send('window-maximized-change', true));
  win.on('unmaximize', () => win.webContents.send('window-maximized-change', false));

  // Con "minimizar a la bandeja" activo, la X oculta la ventana en vez de salir
  win.on('close', (event) => {
    if (!forceQuit && settings.load().minimizeToTrayOnLaunch) {
      event.preventDefault();
      hideToTray();
    }
  });

  // Settings
  ipcMain.handle('get-settings', () => settings.load());
  ipcMain.handle('save-settings', (_e, data) => settings.save(data));

  // System info
  ipcMain.handle('get-system-info', () => ({
    totalRamGB: Math.round(os.totalmem() / (1024 * 1024 * 1024)),
    platform: process.platform
  }));

  // Meta (tutorial, flags)
  ipcMain.handle('get-meta', (_e, key, fallback) => db.getMeta(key, fallback));
  ipcMain.handle('set-meta', (_e, key, value) => { db.setMeta(key, value); return true; });

  // Minecraft versions
  ipcMain.handle('get-versions', async () => {
    try {
      return await launcher.fetchVersions();
    } catch (err) {
      return { error: err.message };
    }
  });

  // Java
  ipcMain.handle('check-java', () => launcher.checkJava());
  ipcMain.handle('get-java-list', () => launcher.getJavaList());

  ipcMain.handle('add-java-paths', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Selecciona las carpetas donde tienes Java instalado',
      properties: ['openDirectory', 'multiSelections']
    });
    if (res.canceled || !res.filePaths.length) return { success: false, paths: [] };
    const s = settings.load();
    const current = Array.isArray(s.customJavaPaths) ? s.customJavaPaths : [];
    for (const p of res.filePaths) {
      if (!current.includes(p)) current.push(p);
    }
    s.customJavaPaths = current;
    settings.save(s);
    launcher.clearJavaCache();
    return { success: true, paths: current };
  });

  ipcMain.handle('remove-java-path', (_e, p) => {
    const s = settings.load();
    s.customJavaPaths = (s.customJavaPaths || []).filter(x => x !== p);
    settings.save(s);
    launcher.clearJavaCache();
    return { success: true, paths: s.customJavaPaths };
  });

  // Instancias
  ipcMain.handle('instances-list', () => instances.list());
  ipcMain.handle('instance-create', (_e, opts) => instances.create(opts));
  ipcMain.handle('instance-update', (_e, id, patch) => instances.update(id, patch));
  ipcMain.handle('instance-duplicate', (_e, id) => instances.duplicate(id));
  ipcMain.handle('instance-remove', async (_e, id, mode) => { console.log('[ipc] remove <-', id, mode); const r = instances.remove(id, mode); console.log('[ipc] remove ->', JSON.stringify(r && r.success)); return r; });
  ipcMain.handle('open-instance-dir', (_e, id) => {
    const inst = instances.get(id);
    if (!inst) return null;
    const dir = instances.rootFor(inst);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
    return dir;
  });

  // ---------- CUENTA MICROSOFT (premium) ----------
  let msAbort = false;
  function msStorePath() { return path.join(app.getPath('userData'), 'msauth.enc'); }
  function spPath(host) { return path.join(app.getPath('userData'), 'sp-' + String(host).toLowerCase().replace(/[^a-z0-9.-]/g, '_') + '.enc'); }
  function setServerPass(host, pass) {
    const data = String(pass || '');
    const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(data) : Buffer.from(data, "utf8");
    fs.writeFileSync(spPath(host), buf);
  }
  function getServerPass(host) {
    if (!fs.existsSync(spPath(host))) return '';
    try { const b = fs.readFileSync(spPath(host)); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString("utf8"); } catch (e) { return ""; }
  }

  function saveMsSession(sess) {
    const data = JSON.stringify(sess);
    const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(data) : Buffer.from(data, 'utf8');
    fs.writeFileSync(msStorePath(), buf);
  }
  function loadMsSession() {
    if (!fs.existsSync(msStorePath())) return null;
    try {
      const buf = fs.readFileSync(msStorePath());
      const txt = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
      return JSON.parse(txt);
    } catch (e) { return null; }
  }

  ipcMain.handle('ms-get-client-id', () => settings.load().microsoftClientId || '');
  ipcMain.handle('ms-save-client-id', (_e, cid) => {
    db.setSetting('s:microsoftClientId', String(cid || '').trim());
    return true;
  });
  ipcMain.handle('ms-has-session', () => !!loadMsSession());
  ipcMain.handle('ms-logout', () => {
    try { fs.unlinkSync(msStorePath()); } catch (e) {}
    return true;
  });
  ipcMain.handle('ms-login-start', async (_e) => {
    const sender = _e.sender;
    const cid = settings.load().microsoftClientId;
    if (!cid) { sender.send('ms-login-status', { type: 'error', message: 'Falta el Client ID de Azure en Ajustes' }); return false; }
    msAbort = false;
    try {
      const dc = await msauth.requestDeviceCode(cid);
      sender.send('ms-login-status', { type: 'code', user_code: dc.user_code, verification_uri: dc.verification_uri });
      const deadline = Date.now() + (dc.expires_in || 900) * 1000;
      let interval = (dc.interval || 5) * 1000;
      while (Date.now() < deadline) {
        if (msAbort) { sender.send('ms-login-status', { type: 'cancelled' }); return false; }
        await new Promise(r => setTimeout(r, interval));
        let res;
        try { res = await msauth.pollAndBuildSession(cid, dc.device_code); }
        catch (err) { sender.send('ms-login-status', { type: 'error', message: err.message }); return false; }
        if (res.pending) { if (res.slow) interval = Math.min(interval * 1.5, 30000); continue; }
        if (res.ok) {
          saveMsSession(res);
          sender.send('ms-login-status', { type: 'done', profile: res.profile });
          return true;
        }
      }
      sender.send('ms-login-status', { type: 'error', message: 'Tiempo agotado' });
      return false;
    } catch (err) {
      sender.send('ms-login-status', { type: 'error', message: err.message });
      return false;
    }
  });
  ipcMain.handle('ms-cancel-login', () => { msAbort = true; return true; });

  // ---------- CATÁLOGO MODRINTH ----------
  // Caché disco+memoria con stale-while-revalidate
  const mCacheDir = path.join(app.getPath('userData'), 'modrinth-cache');
  const mMem = new Map();
  function cacheKey(kind, obj) { return kind + "-" + crypto.createHash("sha1").update(JSON.stringify(obj)).digest("hex").slice(0, 20); }
  function readDisk(k) { try { return JSON.parse(fs.readFileSync(path.join(mCacheDir, k + ".json"), "utf8")); } catch (e) { return null; } }
  function writeDisk(k, data) { try { fs.mkdirSync(mCacheDir, { recursive: true }); fs.writeFileSync(path.join(mCacheDir, k + ".json"), JSON.stringify({ at: Date.now(), data })); } catch (e) {} }
  async function cached(kind, keyObj, ttlMs, fetcher) {
    const k = cacheKey(kind, keyObj);
    const mem = mMem.get(k);
    const now = Date.now();
    if (mem && now - mem.at < ttlMs) return mem.data;
    const disk = readDisk(k);
    if (disk && now - disk.at < ttlMs) { mMem.set(k, disk); return disk.data; }
    if (disk) { // stale-while-revalidate
      mMem.set(k, disk);
      fetcher().then(data => { const fresh = { at: Date.now(), data }; mMem.set(k, fresh); writeDisk(k, data); }).catch(() => {});
      return disk.data;
    }
    const data = await fetcher();
    const rec = { at: Date.now(), data };
    mMem.set(k, rec); writeDisk(k, data);
    return data;
  }




  function extractZip(zipPath, destDir) {
    const ps = 'powershell -NoProfile -Command "Expand-Archive -LiteralPath \'"' + zipPath.replace(/'/g, "''") + '\'" -DestinationPath \'"' + destDir.replace(/'/g, "''") + '\'" -Force"';
    const { execSync } = require('child_process');
    execSync(ps, { timeout: 120000, stdio: 'pipe' });
  }

  function activateResourcePack(rootDir, fileName) {
    try {
      const opt = path.join(rootDir, 'options.txt');
      let raw = fs.existsSync(opt) ? fs.readFileSync(opt, 'utf8') : '';
      if (!raw.includes('resourcePacks:')) {
        raw += (raw.endsWith('\n') || !raw ? '' : '\n') + 'resourcePacks:[\"file/' + fileName + '\"]';
      } else {
        raw = raw.replace(/resourcePacks:\[[^\]]*\]/, 'resourcePacks:[\"file/' + fileName + '\"]');
      }
      fs.writeFileSync(opt, raw);
      return true;
    } catch (e) { return false; }
  }




  // ---------- RUNIC CLIENT PVP ----------





  ipcMain.handle('open-game-dir', () => {
    const dir = settings.getGameDir();
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    shell.openPath(dir);
    return { success: true };
  });

  // Check installed version
  ipcMain.handle('check-version-installed', (_e, versionId) => {
    const gameDir = settings.getGameDir();
    return launcher.checkVersionInstalled(versionId, gameDir);
  });

  // Escaneo global: instancias + .minecraft + carpeta personalizada
  ipcMain.handle('scan-all-versions', () => {
    const roots = [];
    const labels = new Map();
    for (const inst of instances.list()) {
      const root = instances.rootFor(inst);
      if (root && !roots.includes(root)) {
        roots.push(root);
        labels.set(root, inst.name);
      }
    }
    // Solo carpetas del propio cliente (instancias + carpeta del juego)
    const custom = settings.getGameDir();
    if (custom && !roots.includes(custom)) {
      roots.push(custom);
      labels.set(custom, 'Carpeta personalizada');
    }
    const results = downloader.scanVersionsIn(roots).map(v => ({
      ...v,
      sourceLabel: labels.get(v.rootDir) || v.rootDir,
      external: labels.get(v.rootDir) !== undefined && v.rootDir !== settings.getGameDir()
    }));
    return results;
  });

  // Descargar versión completa (paralelo) en instancia o carpeta por defecto
  ipcMain.handle('download-version', async (_e, mcVersion, loaderType, loaderVersion, instanceId) => {
    let rootDir = settings.getGameDir();
    if (instanceId) {
      const inst = instances.get(instanceId);
      if (!inst) return { success: false, error: 'La instancia no existe' };
      rootDir = instances.rootFor(inst);
    }
    try {
      sendWin('download-status', { type: 'start', message: 'Descargando ' + mcVersion + '...' });
      const res = await preloader.preloadVersion(mcVersion, rootDir, (p) => {
        sendWin('download-status', { type: 'progress', task: p.task, total: p.total, current: p.current });
      });
      sendWin('download-status', { type: 'downloaded', message: 'Minecraft ' + mcVersion + ' descargado (' + res.downloaded + ' archivos)' });

      if (loaderType && loaderType !== 'vanilla') {
        sendWin('download-status', { type: 'progress', task: 'Instalando ' + loaderType + '...' });
        let ver = loaderVersion;
        if (!ver) {
          ver = await loaders.pickDefault(loaderType, mcVersion);
          if (!ver) throw new Error('No se pudo determinar la versión de ' + loaderType);
        }
        const dlJava = launcher.pickJavaForMC ? launcher.pickJavaForMC(mcVersion) : null;
        let result;
        if (loaderType === 'fabric') result = await loaders.installFabric(mcVersion, ver, rootDir);
        else if (loaderType === 'forge') result = await loaders.installForge(mcVersion, ver, rootDir, dlJava);
        else if (loaderType === 'neoforge') result = await loaders.installNeoForge(mcVersion, ver, rootDir, dlJava);
        else if (loaderType === 'optifine') result = await loaders.installOptiFine(mcVersion, ver, rootDir, dlJava);
        else result = { success: false, error: 'Loader desconocido' };

        if (!result || !result.success) {
          const errMsg = (result && result.error) || 'Error instalando ' + loaderType;
          sendWin('download-status', { type: 'error', message: errMsg });
          return { success: true, versionId: mcVersion, loaderError: errMsg };
        }
        sendWin('download-status', { type: 'loader-done', message: 'Loader instalado', loaderVersionId: result.versionId });
        if (instanceId) {
          instances.update(instanceId, { loaderType, loaderVersion: result.versionId });
        }
      }

      sendWin('download-status', { type: 'done', message: 'Instalación completada' });
      return { success: true, versionId: mcVersion };
    } catch (err) {
      sendWin('download-status', { type: 'error', message: err.message });
      return { success: false, error: err.message };
    }
  });

  // Delete an installed version folder from a given root
  ipcMain.handle('delete-version', (_e, versionId, rootDir) => {
    return downloader.deleteVersion(versionId, rootDir || settings.getGameDir());
  });

  // Loaders
  ipcMain.handle('get-loader-versions', async (_e, loaderType, mcVersion) => {
    try {
      switch (loaderType) {
        case 'fabric': return await loaders.fetchFabricLoaders(mcVersion);
        case 'forge': return await loaders.fetchForgeVersions(mcVersion);
        case 'neoforge': return await loaders.fetchNeoForgeVersions(mcVersion);
        case 'optifine': return await loaders.fetchOptiFineVersions(mcVersion);
        default: return [];
      }
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('install-loader', async (_e, loaderType, mcVersion, loaderVersion, instanceId) => {
    let rootDir = settings.getGameDir();
    if (instanceId) {
      const inst = instances.get(instanceId);
      if (inst) rootDir = instances.rootFor(inst);
    }
    try {
      let ver = loaderVersion;
      if (!ver) {
        ver = await loaders.pickDefault(loaderType, mcVersion);
        if (!ver) return { success: false, error: 'No se pudo determinar la versión de ' + loaderType };
      }
      // Garantizar vanilla base antes del instalador
      const baseChk = launcher.checkVersionInstalled(mcVersion, rootDir);
      if (!baseChk.installed) {
        await preloader.preloadVersion(mcVersion, rootDir, () => {});
      }
      const ilJava = launcher.pickJavaForMC ? launcher.pickJavaForMC(mcVersion) : null;
      let result;
      switch (loaderType) {
        case 'fabric': result = await loaders.installFabric(mcVersion, ver, rootDir); break;
        case 'forge': result = await loaders.installForge(mcVersion, ver, rootDir, ilJava); break;
        case 'neoforge': result = await loaders.installNeoForge(mcVersion, ver, rootDir, ilJava); break;
        case 'optifine': result = await loaders.installOptiFine(mcVersion, ver, rootDir, ilJava); break;
        default: return { success: false, error: 'Loader desconocido: ' + loaderType };
      }
      if (result && result.success && instanceId) {
        instances.update(instanceId, { loaderType, loaderVersion: result.versionId });
      }
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // Launch game (fire-and-forget; feedback via events)
  ipcMain.on('launch-game', async (_e, opts) => {
    const merged = { ...(opts || {}) };
    // El toggle de skins Ely.by se aplica desde la configuración del proceso principal
    const s = settings.load();
    merged.useAuthlibInjector = s.useAuthlibInjector !== false;
    if (merged.useMicrosoft) {
      const cid = s.microsoftClientId;
      const sess = loadMsSession();
      if (!sess || !sess.tokens || !cid) {
        merged.useMicrosoft = false;
      } else {
        try {
          const fresh = await msauth.refreshSession(cid, sess.tokens.refresh_token);
          saveMsSession(fresh);
          merged.authorization = { access_token: fresh.tokens.mc_token, uuid: fresh.profile.uuid, name: fresh.profile.name };
        } catch (err) {
          sendWin('launch-status', { type: 'debug', message: 'Microsoft: ' + err.message + ' (se jugara offline)' });
          merged.useMicrosoft = false;
        }
      }
    }
    launcher.launchGame(merged, win ? win.webContents : null);
  });

  ipcMain.on('kill-game', () => {
    launcher.killGame();
  });

  // Change game directory
  ipcMain.handle('choose-game-dir', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Selecciona la carpeta de Minecraft',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: settings.getGameDir()
    });
    if (!res.canceled && res.filePaths && res.filePaths[0]) {
      const s = settings.load();
      s.gameDir = res.filePaths[0];
      settings.save(s);
      return { success: true, path: res.filePaths[0] };
    }
    return { success: false };
  });

  // Skins Ely.by: devuelve el PNG del skin como dataURL para mostrar en el launcher
  const skinCache = new Map();
  ipcMain.handle('get-elyby-skin', (_e, nick) => {
    nick = String(nick || '').trim();
    if (!nick) return Promise.resolve(null);
    if (skinCache.has(nick)) return Promise.resolve(skinCache.get(nick));
    return new Promise((resolve) => {
      const url = 'https://skinsystem.ely.by/skins/' + encodeURIComponent(nick) + '.png';
      const finish = (dataUrl) => {
        skinCache.set(nick, dataUrl);
        resolve(dataUrl);
      };
      const grab = (target, redirects) => {
        const req = https.get(target, { headers: { 'User-Agent': 'RunicClient/2.0' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            if (redirects >= 5) return finish(null);
            return grab(res.headers.location, redirects + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return finish(null);
          }
          const chunks = [];
          res.on('data', c => chunks.push(c));
          res.on('end', () => finish('data:image/png;base64,' + Buffer.concat(chunks).toString('base64')));
        });
        req.on('error', () => finish(null));
      };
      grab(url, 0);
    });
  });

  // Skins/capas locales por cuenta
  const skins = require('./services/skins');
  ipcMain.handle('skin-choose', async (_e, kind) => {
    const filters = kind === 'cape'
      ? [{ name: 'Capa (PNG o GIF animado)', extensions: ['png', 'gif'] }]
      : [{ name: 'Skin de Minecraft (PNG)', extensions: ['png'] }];
    const res = await dialog.showOpenDialog(win, {
      title: kind === 'cape' ? 'Selecciona tu capa' : 'Selecciona tu skin',
      properties: ['openFile'],
      filters
    });
    if (!res.canceled && res.filePaths && res.filePaths[0]) return res.filePaths[0];
    return null;
  });
  ipcMain.handle('skin-save', (_e, account, kind, srcPath) => {
    try { return skins.saveForAccount(account, kind, srcPath); }
    catch (err) { return { success: false, error: err.message }; }
  });
  ipcMain.handle('skin-clear', (_e, account, kind) => {
    try { return skins.clear(account, kind); } catch (err) { return { success: false }; }
  });
  ipcMain.handle('skin-get', (_e, account, kind) => skins.get(account, kind));

  // Capa Ely.by por nickname (para el perfil)
  ipcMain.handle('get-elyby-cape', (_e, nick) => {
    nick = String(nick || '').trim();
    if (!nick) return Promise.resolve(null);
    return new Promise((resolve) => {
      const url = 'https://skinsystem.ely.by/cloaks/' + encodeURIComponent(nick) + '.png';
      const req = https.get(url, { headers: { 'User-Agent': 'RunicClient/2.0' } }, (res) => {
        if (res.statusCode !== 200) { res.resume(); return resolve(null); }
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve('data:image/png;base64,' + Buffer.concat(chunks).toString('base64')));
      });
      req.on('error', () => resolve(null));
    });
  });

  // Abrir enlaces externos en el navegador del sistema
  ipcMain.handle('open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  // Diagnóstico
  ipcMain.on('diag-log', (_e, msg) => { console.log('[DIAG]', msg); });
  ipcMain.handle('get-launch-log', () => launcher.getLaunchLog ? launcher.getLaunchLog() : '');
  ipcMain.handle('repair-version', async (_e, versionId, rootDir) => {
    try {
      const res = await preloader.preloadVersion(versionId, rootDir, null);
      return { success: true, downloaded: res.downloaded };
    } catch (err) { return { success: false, error: err.message }; }
  });

  // YouTube (ventana embebida)
  ipcMain.handle('open-youtube', (_e, videoId) => {
    const clean = String(videoId || '').replace(/[^A-Za-z0-9_-]/g, '');
    if (!clean) return false;
    const parent = BrowserWindow.getAllWindows()[0];
    const ytWin = new BrowserWindow({
      width: 960, height: 560,
      title: 'Runic Client — Reproductor',
      backgroundColor: '#050508',
      parent: parent && !parent.isDestroyed() ? parent : null,
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    ytWin.setMenuBarVisibility(false);
    ytWin.loadURL('https://www.youtube.com/embed/' + clean + '?autoplay=1&playsinline=1&rel=0');
    return true;
  });

  // Server passwords / lookup
  ipcMain.handle('serverpass-set', (_e, host, pass) => {
    try { fs.writeFileSync(path.join(app.getPath('userData'), 'sp-' + String(host).toLowerCase().replace(/[^a-z0-9.-]/g, '_') + '.enc'),
      safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(String(pass || '')) : Buffer.from(String(pass || ''), 'utf8'));
    } catch (e) {}
    return true;
  });
  ipcMain.handle('serverpass-get', (_e, host) => {
    const sp = path.join(app.getPath('userData'), 'sp-' + String(host).toLowerCase().replace(/[^a-z0-9.-]/g, '_') + '.enc');
    if (!fs.existsSync(sp)) return '';
    try { const b = fs.readFileSync(sp); return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(b) : b.toString('utf8'); } catch (e) { return ''; }
  });
  ipcMain.handle('lookup-server', async (_e, host) => {
    try {
      const clean = String(host || '').trim().replace(/:\d+$/, '');
      const r = await fetch('https://api.mcsrvstat.us/3/' + encodeURIComponent(clean));
      if (!r.ok) return { online: false };
      const j = await r.json();
      return { online: !!j.online, name: j.hostname || clean, motd: j.motd && j.motd.clean ? j.motd.clean.join(' ') : '', players: j.players && j.players.online || 0, max: j.players && j.players.max || 0, version: j.version || '' };
    } catch (err) { return { online: false, error: err.message }; }
  });

  // Modrinth
  const modrinth = require('./services/modrinth');
const msauth = require('./services/msauth');
  ipcMain.handle('modrinth-search', async (_e, type, query, opts) => {
    try { return await modrinth.search(type, query || '', opts || {}); }
    catch (err) { return { error: err.message, hits: [] }; }
  });
  ipcMain.handle('modrinth-project', async (_e, idOrSlug) => {
    try { return await modrinth.getProject(idOrSlug); } catch (err) { return { error: err.message }; }
  });
  ipcMain.handle('modrinth-versions', async (_e, idOrSlug, opts) => {
    try { return await modrinth.getVersions(idOrSlug, opts || {}); } catch (err) { return []; }
  });
  ipcMain.handle('modrinth-install', async (_e, payload) => {
    try {
      const { type, projectId, versionId, instanceId, shared, packName } = payload;

      // Resolver la versión a descargar
      let version = null;
      if (versionId) {
        version = await modrinth.getVersion(versionId);
      } else {
        const vers = await modrinth.getVersions(projectId);
        if (!vers.length) return { success: false, error: 'No hay versiones disponibles' };
        version = vers[0];
      }
      if (!version) return { success: false, error: 'No se pudo obtener la versión' };

      const file = (version.files || []).find(f => f.primary) || (version.files || [])[0];
      if (!file || !file.url) return { success: false, error: 'La versión no tiene archivo para descargar' };

      const fileName = file.filename || (projectId + '.jar');

      // Determinar destino
      let destDir;
      const subdirs = { mod: 'mods', shader: 'shaderpacks', resourcepack: 'resourcepacks' };
      const sub = subdirs[type] || 'mods';

      if (type === 'modpack') {
        return { success: false, error: 'Los modpacks aún no están disponibles desde Modrinth' };
      }

      if (shared || !instanceId) {
        const gd = settings.getGameDir();
        destDir = path.join(gd, sub);
      } else {
        const inst = instances.get(instanceId);
        if (!inst) return { success: false, error: 'Instancia no encontrada' };
        const root = instances.rootFor(inst);
        destDir = path.join(root, sub);
      }

      fs.mkdirSync(destDir, { recursive: true });
      const destPath = path.join(destDir, fileName);

      await downloader.downloadFile(file.url, destPath);

      const where = shared || !instanceId ? 'carpeta compartida' : (instances.get(instanceId)?.name || instanceId);
      return { success: true, where, path: destPath };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
  ipcMain.handle('modrinth-update-pack', async (_e, instanceId) => {
    return { success: false, error: 'Actualización de packs pendiente' };
  });

  // Actualizaciones
  const updater = require('./services/updater');
  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('update-check', () => updater.check(settings.load().updateUrl, app.getVersion()));
  ipcMain.handle('update-install', async (_e, url) => {
    if (!url || !/^https?:\/\//i.test(url)) return { success: false, error: 'URL de descarga inválida' };
    const dest = updater.tempInstallerPath();
    try {
      await downloader.downloadFile(url, dest, (done, total) => {
        if (win && !win.isDestroyed()) win.webContents.send('update-progress', done, total);
      });
    } catch (err) {
      return { success: false, error: 'No se pudo descargar la actualización: ' + err.message };
    }
    updater.runInstaller(dest);
    setTimeout(() => app.quit(), 1200);
    return { success: true };
  });

  // Ping de servidores (Server List Ping)
  ipcMain.handle('ping-server', async (_e, host, port) => {
    try {
      return await ping.pingServer(host, port);
    } catch (err) {
      return { online: false, error: err.message };
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('before-quit', () => {
  forceQuit = true;
  launcher.killGame();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
