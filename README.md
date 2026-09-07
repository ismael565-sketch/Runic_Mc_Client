# Runic Client — Launcher y cliente de Minecraft

Launcher de Minecraft con **instancias separadas**, catálogo **Modrinth** (mods/shaders/resource packs), login **Microsoft** oficial, soporte de loaders (Fabric, Forge, NeoForge, OptiFine), skins vía **Ely.by**, base de datos local (SQLite) y descargas paralelas. Construido con **Electron** y empaquetado como instalador `.exe` para Windows 10/11 con **electron-builder (NSIS)**.

---

## Requisitos

| Herramienta | Versión recomendada |
|---|---|
| Node.js | 18 o superior (22.5+ recomendado para `node:sqlite`) |
| npm | incluido con Node.js |
| Windows | 10 / 11 (para compilar el instalador) |

No se requiere Java para desarrollar; el launcher detecta los Javas instalados en el equipo del usuario final. La base de datos usa `node:sqlite` (incluido en Node 22.5+ / Electron 33+), por lo que **no hay dependencias nativas que compilar**.

---

## Puesta en marcha (desarrollo)

```bash
npm install        # instalar dependencias
npm start          # ejecutar el launcher en modo desarrollo
```

El archivo `start.bat` también funciona para desarrollo (instala dependencias si faltan y arranca).

### QA automatizado

```bash
node scripts/qa-instances.js   # pruebas de instancias (11 tests)
```

Salida esperada: `RESULTADO: 11 pass / 0 fail`. Se ejecuta automáticamente antes de cada build.

---

## Compilar el instalador

```bash
npm run dist       # genera el instalador NSIS completo
npm run dist:dir   # solo carpeta win-unpacked (sin instalador, para pruebas rápidas)
```

El script `scripts/ensure-bmp.js` se ejecuta automáticamente antes de compilar para copiar el logo BMP al directorio de plantillas NSIS.

Salida en `dist/`:

- `Runic-Client-Setup-<version>.exe` → instalador final para usuarios.
- `win-unpacked/` → versión portable sin instalar.

> La primera compilación descarga herramientas de NSIS y binarios de Electron (requiere internet). Las siguientes son más rápidas.

Al cambiar la versión, editar `version` en `package.json`; el nombre del instalador la usa automáticamente.

> **Instalación silenciosa**: como el instalador es asistido (`oneClick: false`), el modo silencioso necesita el flag de contexto además de `/S`:
>
> ```bash
> Runic-Client-Setup-<version>.exe /S /currentuser
> ```
> Actualizar una instalación existente con el Setup nuevo conserva todos los datos.

---

## Funciones principales

### Interfaz (Design System v4)

- **Home premium**: franja de jugador con avatar/skin, chips de estadísticas (horas jugadas, instancias, servidores), panel de juego en dos columnas con el botón JUGAR como protagonista, chips de servidores destacados con ping en vivo y tarjeta de **Novedades remotas**.
- **Navegación agrupada**: Juego (Inicio, Instancias) · Comunidad (Servidores, Mods, Modpacks) · Sistema (Perfil, Ajustes). Atajos `Ctrl+1..7`.
- **Servidores v2**: búsqueda, filtro (todos/favoritos/en línea), orden por ping/jugadores/nombre y **favoritos persistentes** (estrella). Ping real TCP (Server List Ping).
- **Perfil**: cabeza del skin grande, grid de estadísticas (tiempo jugado, instaladas, versiones, servidores) y actividad reciente de instancias.
- **Ajustes con pestañas** (General / Juego / Cuenta) y buscador de ajustes en vivo.
- **Notificaciones modernas** apiladas con icono, barra de progreso y cierre manual.
- Pantalla de bienvenida tipo splash (3 s) con logo animado, sonidos de interfaz (con toggle en Ajustes) y modales propios del launcher (uiConfirm/uiPrompt/uiChoices).
- **Sistema de sonidos**: archivos WAV (`assets/sounds/`) reproducidos por SoundManager (click, whoosh, startup, error). Toggle en Ajustes.

### Catálogo Modrinth

Desde la pestaña **Mods** se navega el catálogo público de Modrinth (API v2, sin key):

- **Pestañas**: Mods · Modpacks · Shaders · Resource Packs. Cambio con transición whoosh.
- **Búsqueda** en vivo con debounce (400 ms), filtro por versión de Minecraft.
- **Tiles** con icono, nombre, autor, descargas y descripción truncada. Clic abre el **modal de detalle**.
- **Modal de detalle**: galería de imágenes, descripción, dependencias, YouTube embebido, chips de loaders y versión de MC. Lista de versiones con botón "Instalar" por cada una.
- **Flujo de instalación**: al instalar, se elige destino (instancia con loader compatible para mods; carpeta compartida o instancia para shaders/rp). Descarga el `.jar`/`.zip` directo a `mods/`, `shaderpacks/` o `resourcepacks/`.
- **Caché disco+memoria** con stale-while-revalidate (30 min en memoria + copia en disco en `%APPDATA%\runic-client\modrinth-cache`).

> Los modpacks muestran resultados pero la instalación automática aún no está implementada.

### Versiones (flujo principal)

Desde el hero de Inicio se elige una **versión de Minecraft** (+ modloader opcional: Vanilla/Fabric/Forge/NeoForge/OptiFine) y se pulsa **Jugar**: si falta algo, se descarga automáticamente en la carpeta compartida (`%APPDATA%\runic-client\minecraft`). Todas las versiones jugadas así **comparten** mundos, configs, mods y resourcepacks, como un `.minecraft` clásico.

- El botón muestra "Descargar y jugar" cuando la versión base no está instalada.
- Si se elige un loader no instalado, se instala solo al primer arranque.
- La versión y loader elegidos quedan guardados como predeterminados.
- **QuickPlay**: conexión directa a servidor. `<1.20.2` usa `server:{host,port}` nativo; `>=1.20.2` usa `--quickPlayMultiplayer host:port`.

### Overlay de lanzamiento

Al pulsar JUGAR se muestra un overlay con **lista de pasos** (Verificando Java → Descargando archivos → Instalando ModLoader → Iniciando) y una barra de progreso animada con transiciones CSS. El botón "Copiar log" muestra el buffer de diagnóstico del lanzamiento (stderr + stdout de Minecraft). El overlay se cierra automáticamente al iniciar el juego o al haber un error.

### Instancias (opcional)

Las instancias son carpetas totalmente separadas (sus propias `versions/`, `saves/`, `mods/`, `resourcepacks/`, `screenshots/` y `config/`), útiles para aislar un modpack o una versión. Se crean desde la pestaña **Instancias** y se lanzan desde su propia tarjeta; no son necesarias para jugar. Se pueden duplicar o eliminar (con 3 opciones):

| Modo | Descripción |
|---|---|
| Eliminar todo | Borra la instancia, sus mundos, mods y configuración del disco |
| Conservar mundos | Mueve los mundos a la carpeta compartida del juego y borra el resto |
| Solo quitar de la lista | La carpeta queda intacta en el disco por si quieres recuperarla |

- Al lanzar una instancia, se pre-descargan en paralelo (concurrencia 10) el client jar, librerías y assets que falten (`services/preloader.js`), con verificación SHA-1.
- Si la instancia usa un loader y aún no está instalado, se instala automáticamente al primer arranque.

### Iconos automáticos

Cada instancia y cada versión detectada genera un icono determinista (gradiente + símbolo) a partir de su nombre, versión y modloader — el mismo nombre siempre produce el mismo icono. Se puede personalizar con el lápiz que aparece al pasar el cursor: selector de símbolo y color, u opción «Automático» para volver al icono generado. En instancias se guarda en la BD; en versiones detectadas, en los metadatos del launcher.

### Versiones externas detectadas

La pestaña Instancias escanea `%APPDATA%\.minecraft`, la carpeta personalizada y las raíces de instancias importadas. Las versiones encontradas muestran su origen y permiten jugarlas directamente o convertirlas en instancia (sin copiar archivos, mediante `external_root`).

### Servidores

La pestaña **Servidores** hace ping real (Server List Ping TCP, `services/ping.js`) a servidores y muestra:

- Estado online/offline
- Jugadores conectados/máximos
- MOTD (Message of the Day)
- Latencia (ms)
- Búsqueda en tiempo real
- Filtros: todos / favoritos / en línea
- Orden: ping, jugadores, nombre
- **Favoritos persistentes** (estrella por servidor)
- **Conexión directa**: botón "JUGAR" lanza Minecraft conectado al servidor

### Microsoft Login (premium)

Flujo de autenticación **device-code flow** (`services/msauth.js`):

1. El usuario configura un **Client ID de Azure** (app "Public client") en Ajustes → Cuenta.
2. Se muestra un código de dispositivo y URL para autenticar desde el móvil/PC.
3. El launcher hace polling cada 5s hasta que el usuario autoriza.
4. Se resuelve la cadena completa: MSA → XBL → XSTS → Minecraft → perfil.
5. La sesión (tokens) se guarda cifrada con `safeStorage` en `%APPDATA%\runic-client\msauth.enc`.
6. Al jugar, se refresca automáticamente con `refresh_token` y se obtiene `mc_token` para autenticación premium.

### Cuentas y skins Ely.by

- En el primer arranque, un tutorial guiado (5 pasos) termina con un modal para crear la cuenta: nombre de usuario + nick opcional de Ely.by. El tutorial vuelve a aparecer si no existe ninguna cuenta, y tras desinstalar con la opción "Restablecer el launcher".
- **Skins Ely.by en el juego** (`useAuthlibInjector`, activado por defecto): al jugar siempre se inyecta `authlib-injector` (`-javaagent`) apuntando a `https://authserver.ely.by/api/authlib-injector`, de modo que todos los jugadores del cliente ven las skins y capas publicadas de Ely.by dentro del juego.
- Se pueden añadir más cuentas desde Ajustes → Cuentas.

### Skin y capa personalizadas (perfil)

- Pestaña Perfil → **Skin & Capa**: subir skin (PNG 64x32/64x64) y capa (PNG 2:1 o GIF animado, máx. 2 MB) desde archivo; se validan y guardan por cuenta en `%APPDATA%\runic-client\skins`.
- El avatar del launcher es la CABEZA recortada de la skin local; si no hay, usa el nick de Ely.by; como último recurso dibuja la cabeza de Steve por código.
- Vista previa del cuerpo completa renderizada en canvas (compatible skins antiguas 64x32 con espejo de extremidades) y capa visible con GIF animado en el launcher.
- Botón **Abrir Ely.by**: lleva al panel oficial para publicar skin/capa y que todos los jugadores la vean.

### Conexión directa a servidor

Desde la tarjeta de un servidor en la pestaña Servidores, el botón "JUGAR" lanza Minecraft conectado directamente:

- **`<1.20.2`**: argumento nativo `server:{host,port}` en el JSON de versión.
- **`>=1.20.2`**: argumento `--quickPlayMultiplayer host:port`.
- Se guarda la contraseña del servidor cifrada con `safeStorage` (si el usuario la introduce).

### Actualizaciones

- El instalador NSIS actualiza encima de una instalación existente conservando TODOS los datos (no hace falta desinstalar).
- Ajustes → **URL de actualizaciones**: apunta a un JSON `{"version":"x.y.z","url":"...Setup.exe","notes":"..."}` hosteado donde quieras. El botón "Buscar actualizaciones" compara versiones, descarga el instalador nuevo con progreso y lo ejecuta en modo silencioso (`/S`), reiniciando el cliente sin perder nada.

### Java

- Detección automática escaneando Adoptium, Microsoft, Zulu, Corretto, BellSoft, AdoptOpenJDK, Amazon Corretto y `JAVA_HOME`.
- Si no se detecta, Ajustes → **Carpetas Java adicionales** permite elegir carpetas manualmente.
- Selección automática de versión mayor según la versión de Minecraft:

| MC Version | Java requerido |
|---|---|
| ≤ 1.16.x | Java 8 |
| 1.17 – 1.20.x | Java 17 |
| ≥ 1.21 | Java 21 |

- En Windows, usa `javaw.exe` en vez de `java.exe` para ocultar la consola.

### Bandeja del sistema

Con "Minimizar a la bandeja del sistema" activo (predeterminado), la X oculta el launcher a la bandeja en vez de cerrarlo — sigue en segundo plano y se reabre desde el icono de la bandeja. Al iniciar Minecraft también se minimiza ahí automáticamente (con notificación). Se puede salir del todo con "Salir" en el menú de la bandeja o desactivando el ajuste.

### Diagnóstico y logs

- **Buffer circular de diagnóstico** (`launcher.js`): almacena las últimas 250 líneas de stdout/stderr de Minecraft. Accesible desde el overlay de lanzamiento con "Copiar log".
- **Archivo de crash**: stderr y stdout de Minecraft se redirigen a `runic-crash.log` en la carpeta del juego.
- Canal IPC `diag-log`: envía mensajes de diagnóstico del renderer al proceso principal (consola Node).

---

## Base de datos local

Ajustes, cuentas, instancias y flags internos viven en SQLite (`node:sqlite`) en `%APPDATA%\runic-client\runic.db` (modo WAL).

### Tablas

| Tabla | Propósito | Columnas principales |
|---|---|---|
| `settings` | Ajustes clave-valor (serializados en JSON) | `key TEXT PK`, `value TEXT` |
| `accounts` | Cuentas de usuario | `id INTEGER PK AUTOINCREMENT`, `name TEXT UNIQUE`, `elyby_nick`, `skin_path`, `cape_path` |
| `instances` | Instancias de juego | `id TEXT PK`, `name`, `mc_version`, `loader_type`, `loader_version`, `color`, `icon`, `ram_override`, `resolution_override`, `external_root`, `last_played`, `playtime_sec`, `pack_slug`, `pack_name`, `pack_icon`, `pack_installed_at`, `pack_version_id`, `pack_files` |
| `meta` | Flags internos (tutorial visto, etc.) | `key TEXT PK`, `value TEXT` |

### Defaults

RAM 4 GB, pantalla completa, minimizar a bandeja activado, sonidos activados, authlib-injector activado, fastBoot desactivado, sin cuenta precargada (se crea tras el tutorial), versión predeterminada 1.21.4.

Los ajustes legacy en `settings.json` se migran automáticamente a la BD la primera vez.

---

## Estructura del proyecto

```
Runic Client/
├── main.js               # Proceso principal (ventana, IPC, bandeja, diálogos, handlers)
├── preload.js            # Puente seguro renderer ↔ main (contextBridge → window.runicAPI)
├── app.js                # Lógica de la interfaz completa (renderer, ~3100 líneas)
├── index.html            # Interfaz HTML (ventana frameless)
├── styles.css            # Design System v4 completo
├── package.json          # Configuración del proyecto y electron-builder
├── start.bat             # Script de inicio para desarrollo
├── services/
│   ├── db.js             # SQLite (node:sqlite): settings/accounts/instances/meta
│   ├── settings.js       # Ajustes sobre BD + migración legacy + defaults
│   ├── instances.js      # CRUD de instancias, duplicar, eliminar (3 modos), playtime
│   ├── launcher.js       # Arranque del juego (733 líneas): Java, JVM args, authlib
│   │                     #   pre-descarga, resolución, QuickPlay, buffer diagnóstico
│   ├── loaders.js        # Instaladores Fabric/Forge/NeoForge/OptiFine (477 líneas)
│   ├── downloader.js     # Descargas Mojang (334 líneas), caché manifiesto, escaneo
│   ├── preloader.js      # Pre-descarga paralela (235 líneas): jar+libs+assets, SHA-1
│   ├── modrinth.js       # Cliente API Modrinth v2 (102 líneas): search, get, dl
│   ├── msauth.js         # Microsoft auth (157 líneas): device-code, MSA→XBL→XSTS→MC
│   ├── skins.js          # Validación/guardado skins y capas (117 líneas)
│   ├── ping.js           # Server List Ping TCP (131 líneas): VarInt, MOTD, favicon
│   └── updater.js        # Comparación semver y ejecución del instalador (86 líneas)
├── scripts/
│   ├── ensure-bmp.js     # Copia logo BMP al directorio de plantillas NSIS
│   ├── qa-instances.js   # Suite de pruebas automatizadas (11 tests)
│   └── fix-pvp-block.js  # Utilidad para parchear el bloque PvP en app.js
├── assets/
│   ├── installer.nsh     # Script NSIS personalizado (página de desinstalación)
│   ├── bg.svg            # Fondo SVG
│   ├── sounds/           # Sonidos de interfaz
│   │   ├── click.wav     # Click de botón
│   │   ├── whoosh.wav    # Transición de sección
│   │   ├── startup.wav   # Inicio de app / instalación exitosa
│   │   └── error.wav     # Error
│   └── icons/
│       ├── logo.png          # Logo original (1024x347)
│       ├── logo-install.bmp  # Logo BMP para el instalador NSIS
│       ├── icon-master.png   # Ícono cuadrado maestro (1024x1024)
│       ├── icon.png          # Ícono 512x512 (electron-builder)
│       └── icon.ico          # Ícono multi-resolución del ejecutable
└── dist/                 # Salida del build (no versionar)
```

---

## Comunicación IPC (arquitectura)

Toda llamada del frontend pasa por `preload.js` (`window.runicAPI`). El patrón es:

```
Renderer (app.js)  →  preload.js (contextBridge)  →  IPC Channel  →  main.js (ipcMain.handle)
```

### Flujo de una llamada típica

1. **Renderer**: `const res = await api.listInstances();`
2. **Preload**: `listInstances: () => ipcRenderer.invoke('instances-list')`
3. **Main**: `ipcMain.handle('instances-list', () => instances.list());`
4. **Servicio**: `instances.list()` consulta la BD y retorna el array.
5. **Respuesta**: via Promise resuelta en el renderer.

### Patrones IPC utilizados

| Tipo | Main | Renderer | Uso |
|---|---|---|---|
| Request/response | `ipcMain.handle` | `ipcRenderer.invoke` (async) | Consultas, CRUD, acciones |
| Fire-and-forget | `ipcMain.on` | `ipcRenderer.send` | Lanzar juego, minimizar, cerrar |
| Push events | `win.webContents.send` | `ipcRenderer.on` (callback) | Estado de descargas, login, updates |

### API completa de `window.runicAPI`

| Método | Canal IPC | Descripción |
|---|---|---|
| `minimize()` | `window-minimize` | Minimizar ventana |
| `maximize()` | `window-maximize` | Toggle maximizar |
| `close()` | `window-close` | Cerrar (o minimizar a bandeja) |
| `hideToTray()` | `hide-to-tray` | Ocultar a bandeja del sistema |
| `isMaximized()` | `window-isMaximized` | ¿Ventana maximizada? |
| `getSettings()` | `get-settings` | Obtener todos los ajustes |
| `saveSettings(data)` | `save-settings` | Guardar ajustes |
| `getSystemInfo()` | `get-system-info` | RAM total, plataforma |
| `getMeta(key, fb)` | `get-meta` | Leer flag interno |
| `setMeta(key, val)` | `set-meta` | Escribir flag interno |
| `getVersions()` | `get-versions` | Lista de versiones Mojang |
| `checkJava()` | `check-java` | Detectar Java instalado |
| `getJavaList()` | `get-java-list` | Todos los Javas disponibles |
| `addJavaPaths()` | `add-java-paths` | Diálogo añadir carpetas Java |
| `removeJavaPath(p)` | `remove-java-path` | Quitar carpeta Java personalizada |
| `listInstances()` | `instances-list` | Listar todas las instancias |
| `createInstance(opts)` | `instance-create` | Crear instancia nueva |
| `updateInstance(id, p)` | `instance-update` | Actualizar instancia |
| `duplicateInstance(id)` | `instance-duplicate` | Duplicar instancia |
| `removeInstance(id, mode)` | `instance-remove` | Eliminar (all/keep-saves/list-only) |
| `openInstanceDir(id)` | `open-instance-dir` | Abrir carpeta de la instancia |
| `checkVersionInstalled(v)` | `check-version-installed` | ¿Versión instalada? |
| `scanAllVersions()` | `scan-all-versions` | Escanear versiones (multi-raíz) |
| `downloadVersion(...)` | `download-version` | Descargar versión + loader |
| `deleteVersion(v, root)` | `delete-version` | Eliminar carpeta de versión |
| `launchGame(opts)` | `launch-game` | Lanzar Minecraft (fire-and-forget) |
| `killGame()` | `kill-game` | Matar proceso de Minecraft |
| `getLoaderVersions(t, v)` | `get-loader-versions` | Versiones de un loader |
| `installLoader(...)` | `install-loader` | Instalar loader en instancia |
| `getElybySkin(nick)` | `get-elyby-skin` | Skin PNG de Ely.by (dataURL) |
| `getElybyCape(nick)` | `get-elyby-cape` | Capa PNG de Ely.by (dataURL) |
| `skinChoose(kind)` | `skin-choose` | Diálogo elegir archivo skin/capa |
| `skinSave(acct, kind, p)` | `skin-save` | Guardar skin/capa por cuenta |
| `skinClear(acct, kind)` | `skin-clear` | Borrar skin/capa |
| `skinGet(acct, kind)` | `skin-get` | Obtener ruta de skin/capa |
| `getAppVersion()` | `app-version` | Versión del launcher |
| `updateCheck()` | `update-check` | Buscar actualizaciones |
| `updateInstall(url)` | `update-install` | Descargar e instalar actualización |
| `pingServer(host, port)` | `ping-server` | Server List Ping TCP |
| `modrinthSearch(t, q, o)` | `modrinth-search` | Buscar en catálogo Modrinth |
| `modrinthProject(id)` | `modrinth-project` | Detalle de proyecto |
| `modrinthVersions(id)` | `modrinth-versions` | Versiones de un proyecto |
| `modrinthInstall(p)` | `modrinth-install` | Instalar mod/shader/rp |
| `msGetClientId()` | `ms-get-client-id` | Client ID de Azure guardado |
| `msSaveClientId(cid)` | `ms-save-client-id` | Guardar Client ID |
| `msHasSession()` | `ms-has-session` | ¿Sesión Microsoft activa? |
| `msLogout()` | `ms-logout` | Cerrar sesión Microsoft |
| `msLoginStart()` | `ms-login-start` | Iniciar device-code flow |
| `msCancelLogin()` | `ms-cancel-login` | Cancelar login en curso |
| `openExternal(url)` | `open-external` | Abrir URL en navegador |
| `openYouTube(id)` | `open-youtube` | Abrir YouTube embebido |
| `diagLog(msg)` | `diag-log` | Log de diagnóstico |
| `getLaunchLog()` | `get-launch-log` | Buffer de log del lanzamiento |
| `repairVersion(v, r)` | `repair-version` | Redescargar archivos de versión |
| `serverPassSet(h, p)` | `serverpass-set` | Guardar contraseña de servidor |
| `serverPassGet(h)` | `serverpass-get` | Obtener contraseña de servidor |
| `lookupServer(host)` | `lookup-server` | Lookup DNS vía mcsrvstat.us |
| `chooseGameDir()` | `choose-game-dir` | Diálogo elegir carpeta del juego |
| `openGameDir()` | `open-game-dir` | Abrir carpeta del juego |

### Cómo agregar una función nueva

1. Crear el handler en `main.js` con `ipcMain.handle('canal', async (e, ...args) => { ... })` o `ipcMain.on(...)` para fire-and-forget.
2. Exponerlo en `preload.js` dentro de `contextBridge.exposeInMainWorld('runicAPI', { ... })`.
3. Consumirlo en `app.js` vía `const res = await api.canal(...args)`.
4. Si el handler depende de un servicio, crear el servicio en `services/` primero.

---

## Servicios detallados

### `services/launcher.js` — Motor de lanzamiento (733 líneas)

Flujo de `launchGame()`:

1. Verificar Java instalado (`checkJava()`).
2. Seleccionar Java correcto según versión MC (`pickJavaForMC()`).
3. Resolver directorio del juego (instancia o carpeta compartida).
4. Autenticar (offline con `Authenticator.getAuth` o Microsoft con token).
5. Resolver versión del loader (instalar si falta, con `ensureVanillaBase()`).
6. Pre-descarga paralela de archivos (`preloader.preloadVersion()`).
7. Construir argumentos JVM optimizados (`buildJVMParams()`).
8. Inyectar `authlib-injector` para skins Ely.by (si no es cliente custom).
9. Configurar resolución y QuickPlay.
10. Lanzar con `minecraft-launcher-core`.
11. Capturar eventos: debug, data, error, progress, exit.
12. Marcar tiempo jugado al cerrar.

### `services/loaders.js` — Instaladores de loaders (477 líneas)

| Loader | API fuente | Método de instalación |
|---|---|---|
| Fabric | Meta API (`fabricmc.net`) | Descarga `fabric-installer.jar` + ejecuta con Java |
| Forge | BMCLAPI mirror (fallback: files.minecraftforge.net) | Descarga `forge-{v}-installer.jar` + ejecuta con Java |
| NeoForge | API oficial (`maven.neoforged.net`) | Descarga `neoforge-{v}-installer.jar` + ejecuta con Java |
| OptiFine | `optifined.net` (scraping HTML) | Descarga `OptiFine_{v}_HD_U_I{ext}.jar` directo |

Funciones clave:
- `pickDefault(loaderType, mcVersion)`: elige la versión más reciente compatible.
- `getInstalledLoaderVersions(gameDir)`: escanea `versions/` para detectar loaders instalados.
- `installForge()` usa URLs duales con fallback automático y `ensureVanillaBase()` antes de instalar.

### `services/preloader.js` — Descarga paralela (235 líneas)

Descarga en paralelo (concurrencia 10) todos los archivos necesarios para una versión:
- **Client jar** (verificación SHA-1)
- **Librerías** (con reglas de exclusión por plataforma/features)
- **Assets** (index + archivos individuales, con cache/hash)

Usa `downloadIfNeeded()` que verifica tamaño + SHA-1 antes de descargar, y reutiliza archivos existentes.

### `services/ping.js` — Server List Ping (131 líneas)

Implementación completa del protocolo Minecraft VarInt para hacer ping a servidores:
- Handshake → Status Request → Parse Response JSON
- Extrae: online, players (online/max), version, MOTD (con formato ANSI), favicon (base64), latencia
- Timeout de 4 segundos, soporte IPv4/IPv6

### `services/msauth.js` — Microsoft Auth (157 líneas)

Flujo completo:
1. `requestDeviceCode(clientId)`: obtiene código de dispositivo de Azure AD.
2. `pollAndBuildSession(clientId, deviceCode)`: resuelve la cadena completa MSA → XBL → XSTS → Minecraft → perfil.
3. `refreshSession(clientId, refreshToken)`: refresca la sesión completa con refresh_token.
4. Tokens cifrados con `safeStorage` de Electron.

### `services/modrinth.js` — API Modrinth (102 líneas)

Cliente HTTP directo (sin dependencias) para la API v2 de Modrinth:
- `search(type, query, opts)`: búsqueda con facets (tipo, loader, versión MC).
- `getProject(idOrSlug)`: detalle de proyecto (galería, body, dependencias).
- `getVersions(idOrSlug, opts)`: versiones filtradas por loader/MC version.
- `getVersion(versionId)`: una versión específica por ID.
- `dl(url, dest, sha1)`: descarga con verificación SHA-1.

---

## Instalador y desinstalador

Configuración en el campo `build` de `package.json`.

- **Instalación por usuario** en `%LOCALAPPDATA%\Programs\Runic Client` (sin permisos de administrador).
- Asistido: permite elegir carpeta, crea accesos directos (escritorio + menú inicio).
- Aparece en *Configuración > Aplicaciones* como "Runic Client".

### Página personalizada al desinstalar (`assets/installer.nsh`)

Primera pantalla del desinstalador, con tres opciones:

| Opción | Descripción |
|---|---|
| **Restablecer el launcher** (default) | Borra la cuenta, ajustes, BD y skins (incluida la marca del tutorial), pero conserva mundos, versiones e instancias descargadas |
| **Conservar todo** | Elimina solo el programa (útil para reparar/reinstalar sin perder la sesión) |
| **Borrar absolutamente todo** | Además elimina `%APPDATA%\runic-client` completo y `%LOCALAPPDATA%\runic-client` |

- La desinstalación silenciosa (`/S`) conserva los datos.
- Si el usuario cambió la carpeta del juego en Ajustes, esa carpeta nunca se borra automáticamente.

**Importante al modificar `installer.nsh`:**

- Los `!include` de `LogicLib.nsh`, `nsDialogs.nsh` y `WinMessages.nsh` deben permanecer **dentro** del macro `customHeader`.
- La página y sus funciones están dentro de `!ifdef BUILD_UNINSTALLER` (build en dos pasadas).
- Ningún comentario puede terminar en `\` (NSIS lo interpreta como continuación → warning 6050).
- El texto está guardado en UTF-8 **con BOM** para que los acentos se vean bien. Si lo editas, conserva el BOM.

---

## Datos y ubicaciones (equipo del usuario final)

| Ruta | Contenido |
|---|---|
| `%APPDATA%\runic-client\runic.db` | Base de datos SQLite (ajustes, cuentas, instancias) |
| `%APPDATA%\runic-client\skins\` | Skins y capas subidas por cuenta |
| `%APPDATA%\runic-client\instances\` | Carpetas de cada instancia |
| `%APPDATA%\runic-client\minecraft\` | Carpeta del juego clásica (todas las versiones comparten) |
| `%APPDATA%\runic-client\authlib\` | authlib-injector.jar para skins Ely.by |
| `%APPDATA%\runic-client\mojang-manifest-cache.json` | Caché del manifiesto de versiones |
| `%APPDATA%\runic-client\modrinth-cache\` | Caché de resultados Modrinth (stale-while-revalidate) |
| `%APPDATA%\runic-client\msauth.enc` | Sesión Microsoft cifrada |
| `%APPDATA%\runic-client\sp-*.enc` | Contraseñas de servidores cifradas |
| `%APPDATA%\runic-client\minecraft\runic-crash.log` | Log de stderr/stdout de Minecraft |
| `%LOCALAPPDATA%\Programs\Runic Client\` | Programa instalado |

---

## Optimizaciones

- **Pre-descarga paralela**: 10 hilos de descarga para jar/librerías/assets antes de abrir el juego; salta lo ya descargado (tamaño + SHA-1) — relanzar una instancia tarda segundos.
- **Caché del manifiesto de Mojang**: 30 minutos en memoria + copia en disco; si no hay internet usa la última copia guardada.
- **Caché de Modrinth**: stale-while-revalidate en disco + memoria, evita re-fetch innecesarios.
- **Reintentos automáticos** (3 intentos con espera progresiva) en todas las descargas, con soporte de redirecciones HTTP.
- **Selección automática de Java** según la versión de Minecraft, con carpetas personalizables.
- **Argumentos JVM optimizados** (G1GC, AlwaysPreTouch, UseStringDeduplication, TieredStopAtLevel=1 en fastBoot) en `services/launcher.js` → `buildJVMParams`.
- **Límite de RAM ajustado al equipo** y sugerencia clickeable "Sugerido: X GB" en Ajustes.
- **Sin dependencias nativas**: SQLite via `node:sqlite`; no hace falta Visual Studio ni rebuilds.
- **Ventana frameless** con `backgroundColor: '#050508'` para carga instantánea sin flash blanco.

---

## Convenciones para trabajar en el proyecto

- Código y comentarios en español donde ya existan; mantener el estilo existente de cada archivo.
- No agregar comentarios innecesarios ni dependencias nuevas sin justificarlo.
- Probar siempre `npm start` antes de compilar, y `npm run dist` antes de entregar cambios que afecten empaquetado.
- Verificación rápida de sintaxis: `node --check <archivo.js>`.
- QA antes de cada build: `node scripts/qa-instances.js` (debe dar 11/11 pass).
- Si cambias íconos: regenerar `icon.ico` (multi-resolución, mínimo 256x256) y `icon.png` (512x512); `icon-master.png` es solo el archivo fuente del diseño.
- No subir a git la carpeta `dist/` ni `node_modules/` (agregarlos a `.gitignore` si se versiona el proyecto).
- Al modificar `installer.nsh`: conservar el BOM UTF-8 y evitar `\` al final de comentarios.
