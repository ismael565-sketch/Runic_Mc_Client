const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('runicAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  hideToTray: () => ipcRenderer.send('hide-to-tray'),
  isMaximized: () => ipcRenderer.invoke('window-isMaximized'),
  onMaximizeChange: (callback) => {
    ipcRenderer.on('window-maximized-change', (_event, isMaximized) => callback(isMaximized));
  },

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

  // Meta (tutorial, flags)
  getMeta: (key, fallback) => ipcRenderer.invoke('get-meta', key, fallback),
  setMeta: (key, value) => ipcRenderer.invoke('set-meta', key, value),

  // Minecraft versions
  getVersions: () => ipcRenderer.invoke('get-versions'),

  // Java
  checkJava: () => ipcRenderer.invoke('check-java'),
  getJavaList: () => ipcRenderer.invoke('get-java-list'),
  addJavaPaths: () => ipcRenderer.invoke('add-java-paths'),
  removeJavaPath: (p) => ipcRenderer.invoke('remove-java-path', p),

  // Instancias
  listInstances: () => ipcRenderer.invoke('instances-list'),
  createInstance: (opts) => ipcRenderer.invoke('instance-create', opts),
  updateInstance: (id, patch) => ipcRenderer.invoke('instance-update', id, patch),
  duplicateInstance: (id) => ipcRenderer.invoke('instance-duplicate', id),
  removeInstance: (id, deleteFiles) => ipcRenderer.invoke('instance-remove', id, deleteFiles),
  openInstanceDir: (id) => ipcRenderer.invoke('open-instance-dir', id),
  openGameDir: () => ipcRenderer.invoke('open-game-dir'),

  // Versiones instaladas / externas
  checkVersionInstalled: (versionId) => ipcRenderer.invoke('check-version-installed', versionId),
  scanAllVersions: () => ipcRenderer.invoke('scan-all-versions'),
  downloadVersion: (mcVersion, loaderType, loaderVersion, instanceId) =>
    ipcRenderer.invoke('download-version', mcVersion, loaderType, loaderVersion, instanceId),
  deleteVersion: (versionId, rootDir) => ipcRenderer.invoke('delete-version', versionId, rootDir),
  onDownloadStatus: (callback) => {
    ipcRenderer.on('download-status', (_event, data) => callback(data));
  },

  // Launch
  launchGame: (opts) => ipcRenderer.send('launch-game', opts),
  killGame: () => ipcRenderer.send('kill-game'),

  // Open / choose game directory
  openGameDir: () => ipcRenderer.invoke('open-game-dir'),
  chooseGameDir: () => ipcRenderer.invoke('choose-game-dir'),

  // Launch status events
  onLaunchStatus: (callback) => {
    ipcRenderer.on('launch-status', (_event, data) => callback(data));
  },
  onLaunchError: (callback) => {
    ipcRenderer.on('launch-error', (_event, msg) => callback(msg));
  },

  // Loaders
  getLoaderVersions: (loaderType, mcVersion) => ipcRenderer.invoke('get-loader-versions', loaderType, mcVersion),
  installLoader: (loaderType, mcVersion, loaderVersion, instanceId) =>
    ipcRenderer.invoke('install-loader', loaderType, mcVersion, loaderVersion, instanceId),

  // Skins Ely.by
  getElybySkin: (nick) => ipcRenderer.invoke('get-elyby-skin', nick),
  getElybyCape: (nick) => ipcRenderer.invoke('get-elyby-cape', nick),

  // Skins/capas locales por cuenta
  skinChoose: (kind) => ipcRenderer.invoke('skin-choose', kind),
  skinSave: (account, kind, srcPath) => ipcRenderer.invoke('skin-save', account, kind, srcPath),
  skinClear: (account, kind) => ipcRenderer.invoke('skin-clear', account, kind),
  skinGet: (account, kind) => ipcRenderer.invoke('skin-get', account, kind),

  // Actualizaciones
  getAppVersion: () => ipcRenderer.invoke('app-version'),
  // Microsoft
  msGetClientId: () => ipcRenderer.invoke('ms-get-client-id'),
  msSaveClientId: (cid) => ipcRenderer.invoke('ms-save-client-id', cid),
  msHasSession: () => ipcRenderer.invoke('ms-has-session'),
  msLogout: () => ipcRenderer.invoke('ms-logout'),
  msLoginStart: () => ipcRenderer.invoke('ms-login-start'),
  msCancelLogin: () => ipcRenderer.invoke('ms-cancel-login'),
  onMsLoginStatus: (cb) => { ipcRenderer.on('ms-login-status', (_ev, data) => cb(data)); },
  // Modrinth

  updateCheck: () => ipcRenderer.invoke('update-check'),
  updateInstall: (url) => ipcRenderer.invoke('update-install', url),
  onUpdateProgress: (callback) => {
    ipcRenderer.on('update-progress', (_event, done, total) => callback(done, total));
  },

  // Enlaces externos
  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Servidores
  pingServer: (host, port) => ipcRenderer.invoke('ping-server', host, port),

  // Diagnóstico
  diagLog: (msg) => { try { ipcRenderer.send('diag-log', String(msg).slice(0, 600)); } catch (e) {} },
  getLaunchLog: () => ipcRenderer.invoke('get-launch-log'),
  repairVersion: (v, r) => ipcRenderer.invoke('repair-version', v, r),

  // YouTube / enlaces
  openYouTube: (id) => ipcRenderer.invoke('open-youtube', id),

  // Server passwords / lookup
  serverPassSet: (host, pass) => ipcRenderer.invoke('serverpass-set', host, pass),
  serverPassGet: (host) => ipcRenderer.invoke('serverpass-get', host),
  lookupServer: (host) => ipcRenderer.invoke('lookup-server', host),

  // Modrinth
  modrinthSearch: (type, q2, opts) => ipcRenderer.invoke('modrinth-search', type, q2, opts),
  modrinthProject: (id) => ipcRenderer.invoke('modrinth-project', id),
  modrinthVersions: (id) => ipcRenderer.invoke('modrinth-versions', id),
  modrinthInstall: (payload) => ipcRenderer.invoke('modrinth-install', payload),
  modrinthUpdatePack: (instanceId) => ipcRenderer.invoke('modrinth-update-pack', instanceId)
});
