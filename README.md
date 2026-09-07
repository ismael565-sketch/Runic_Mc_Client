# Runic Client — Launcher y cliente de Minecraft

Launcher de Minecraft con **instancias separadas**, soporte de loaders (Fabric, Forge, NeoForge, OptiFine), skins vía **Ely.by**, base de datos local (SQLite) y descargas paralelas. Construido con **Electron** y empaquetado como instalador `.exe` para Windows 10/11 con **electron-builder (NSIS)**.

---

## Requisitos

| Herramienta | Versión recomendada |
|---|---|
| Node.js | 18 o superior |
| npm | incluido con Node.js |
| Windows | 10 / 11 (para compilar el instalador) |

No se requiere Java para desarrollar; el launcher detecta los Javas instalados en el equipo del usuario final. La base de datos usa `node:sqlite` (incluido en Node 22.5+ / Electron 33+), por lo que **no hay dependencias nativas que compilar**.

---

## Puesta en marcha (desarrollo)

```bash
npm install        # instalar dependencias
npm start          # ejecutar el launcher en modo desarrollo
```

El archivo `start.bat` también funciona para desarrollo (instala dependencias si faltan y arranca). No es necesario para usuarios finales.

---

## Compilar el instalador

```bash
npm run dist       # genera el instalador NSIS completo
npm run dist:dir   # solo carpeta win-unpacked (sin instalador, para pruebas rápidas)
```

Salida en `dist/`:

- `Runic-Client-Setup-<version>.exe` → instalador final para usuarios.
- `win-unpacked/` → versión portable sin instalar.

> La primera compilación descarga herramientas de NSIS y binarios de Electron (requiere internet). Las siguientes son más rápidas.

Al cambiar la versión, editar `version` en `package.json`; el nombre del instalador la usa automáticamente.

> **Instalación silenciosa**: como el instalador es asistido (`oneClick: false`), el modo silencioso necesita el flag de contexto además de `/S`. Sin ese flag el instalador termina sin hacer nada:
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
- **Servidores v2**: búsqueda, filtro (todos/favoritos/en línea), orden por ping/jugadores/nombre y **favoritos persistentes** (estrella).
- **Perfil**: cabeza del skin grande, grid de estadísticas (tiempo jugado, instaladas, versiones, servidores) y actividad reciente de instancias.
- **Ajustes con pestañas** (General / Juego / Cuenta) y buscador de ajustes en vivo.
- **Notificaciones modernas** apiladas con icono, barra de progreso y cierre manual.
- Pantalla de bienvenida tipo splash (3 s) con logo animado, sonidos de interfaz (con toggle en Ajustes) y modales propios del launcher.

### Versiones (flujo principal)

Desde el hero de Inicio se elige una **versión de Minecraft** (+ modloader opcional: Vanilla/Fabric/Forge/NeoForge/OptiFine) y se pulsa **Jugar**: si falta algo, se descarga automáticamente en la carpeta compartida (`%APPDATA%\runic-client\minecraft`). Todas las versiones jugadas así **comparten** mundos, configs, mods y resourcepacks, como un `.minecraft` clásico.

- El botón muestra "Descargar y jugar" cuando la versión base no está instalada.
- Si se elige un loader no instalado, se instala solo al primer arranque.
- La versión y loader elegidos quedan guardados como predeterminados.

### Instancias (opcional)

Las instancias son carpetas totalmente separadas (sus propias `versions/`, `saves/`, `mods/`, `resourcepacks/`, `screenshots/` y `config/`), útiles para aislar un modpack o una versión. Se crean desde la pestaña **Instancias** y se lanzan desde su propia tarjeta; no son necesarias para jugar. También se pueden duplicar o eliminar (con o sin borrar archivos).

- Al lanzar una instancia, se pre-descargan en paralelo (concurrencia 10) el client jar, librerías y assets que falten (`services/preloader.js`), con verificación SHA-1.
- Si la instancia usa un loader y aún no está instalado, se instala automáticamente al primer arranque.

### Iconos automáticos

Cada instancia y cada versión detectada genera un icono determinista (gradiente + símbolo) a partir de su nombre, versión y modloader — el mismo nombre siempre produce el mismo icono. Se puede personalizar con el lápiz que aparece al pasar el cursor: selector de símbolo y color, u opción «Automático» para volver al icono generado. En instancias se guarda en la BD; en versiones detectadas, en los metadatos del launcher.

### Versiones externas detectadas

La pestaña Instancias escanea `%APPDATA%\.minecraft`, la carpeta personalizada y las raíces de instancias importadas. Las versiones encontradas muestran su origen y permiten jugarlas directamente o convertirlas en instancia (sin copiar archivos, mediante `external_root`).

### Servidores destacados

La pestaña **Servidores** hace ping real (Server List Ping TCP) a servidores populares y muestra estado online/offline, jugadores conectados/máximos, MOTD, ícono y latencia. Debajo hay una sección placeholder de modos de juego locales para el futuro.

### Cuentas y skins Ely.by

- En el primer arranque, un tutorial guiado (5 pasos) termina con un modal para crear la cuenta: nombre de usuario + nick opcional de Ely.by. El tutorial vuelve a aparecer si no existe ninguna cuenta, y tras desinstalar con la opción "Restablecer el launcher".
- **Skins Ely.by en el juego** (`useAuthlibInjector`, activado por defecto): al jugar siempre se inyecta `authlib-injector` (`-javaagent`) apuntando a `https://authserver.ely.by/api/authlib-injector`, de modo que todos los jugadores del cliente ven las skins y capas publicadas de Ely.by dentro del juego.
- Se pueden añadir más cuentas desde Ajustes → Cuentas.

### Skin y capa personalizadas (perfil)

- Pestaña Perfil → **Skin & Capa**: subir skin (PNG 64x32/64x64) y capa (PNG 2:1 o GIF animado, máx. 2 MB) desde archivo; se validan y guardan por cuenta en `%APPDATA%\runic-client\skins`.
- El avatar del launcher es la CABEZA recortada de la skin local; si no hay, usa el nick de Ely.by; como último recurso dibuja la cabeza de Steve por código.
- Vista previa del cuerpo completo renderizada en canvas (compatible skins antiguas 64x32 con espejo de extremidades) y capa visible con GIF animado en el launcher (en el juego las capas se ven estáticas: límite de Minecraft).
- Botón **Abrir Ely.by**: lleva al panel oficial para publicar skin/capa y que todos los jugadores la vean.

### Actualizaciones

- El instalador NSIS actualiza encima de una instalación existente conservando TODOS los datos (no hace falta desinstalar).
- Ajustes → **URL de actualizaciones**: apunta a un JSON `{"version":"x.y.z","url":"...Setup.exe","notes":"..."}` hosteado donde quieras. El botón "Buscar actualizaciones" compara versiones, descarga el instalador nuevo con progreso y lo ejecuta en modo silencioso (`/S`), reiniciando el cliente sin perder nada.

### Java

- Detección automática escaneando Adoptium, Microsoft, Zulu, Corretto, BellSoft, AdoptOpenJDK y `JAVA_HOME`.
- Si no se detecta, Ajustes → **Carpetas Java adicionales** permite elegir carpetas manualmente (se escanean igual que las del sistema).
- Selección automática de versión mayor (8 / 17 / 21) según la versión de Minecraft.

### Bandeja del sistema

Con "Minimizar a la bandeja del sistema" activo (predeterminado), la X oculta el launcher a la bandeja en vez de cerrarlo — sigue en segundo plano y se reabre desde el icono de la bandeja. Al iniciar Minecraft también se minimiza ahí automáticamente (con notificación). Se puede salir del todo con "Salir" en el menú de la bandeja o desactivando el ajuste.

### Base de datos local

Ajustes, cuentas, instancias y flags internos viven en SQLite (`node:sqlite`) en `%APPDATA%\runic-client\runic.db` (modo WAL). Tablas: `settings`, `accounts`, `instances`, `meta`. Los ajustes legacy en `settings.json` se migran automáticamente la primera vez.

Defaults nuevos: RAM 4 GB, pantalla completa, minimizar a bandeza activado, sin cuenta precargada (se crea tras el tutorial).

---

## Estructura del proyecto

```
Runic Client/
├── main.js               # Proceso principal (ventana, IPC, bandeja, diálogos)
├── preload.js            # Puente seguro renderer ↔ main (contextBridge)
├── app.js                # Lógica de la interfaz (renderer)
├── index.html            # Interfaz
├── styles.css            # Estilos
├── services/
│   ├── db.js             # SQLite (node:sqlite): settings/accounts/instances/meta
│   ├── settings.js       # Ajustes sobre DB + migración legacy + defaults
│   ├── instances.js      # CRUD de instancias, duplicar, playtime, raíces
│   ├── launcher.js       # Arranque del juego, Java, JVM args, authlib-injector
│   ├── loaders.js        # Instaladores de Fabric / Forge / NeoForge / OptiFine
│   ├── downloader.js     # Descargas Mojang, caché manifiesto, escaneo multi-raíz
│   ├── preloader.js      # Pre-descarga paralela (jar + libs + assets, SHA-1)
│   ├── skins.js          # Validación/guardado de skins y capas por cuenta
│   ├── updater.js        # Comparación de versiones y ejecución del instalador
│   └── ping.js           # Server List Ping TCP (MOTD, jugadores, favicon)
└── assets/
    ├── installer.nsh     # Script NSIS personalizado (página de desinstalación)
    └── icons/
        ├── logo.png          # Logo original (1024x347)
        ├── icon-master.png   # Ícono cuadrado maestro generado (1024x1024)
        ├── icon.png          # Ícono 512x512 usado por electron-builder
        └── icon.ico          # Ícono multi-resolución del ejecutable
```

### Comunicación IPC

Toda llamada del frontend pasa por `preload.js` (`window.runicAPI`). Para agregar una función nueva:

1. Crear el handler en `main.js` con `ipcMain.handle` o `ipcMain.on`.
2. Exponerlo en `preload.js`.
3. Consumirlo en `app.js` vía `api.<nombre>()`.

---

## Instalador y desinstalador

Configuración en el campo `build` de `package.json`.

- **Instalación por usuario** en `%LOCALAPPDATA%\Programs\Runic Client` (sin permisos de administrador).
- Asistido: permite elegir carpeta, crea accesos directos (escritorio + menú inicio).
- Aparece en *Configuración > Aplicaciones* como "Runic Client".

### Página personalizada al desinstalar (`assets/installer.nsh`)

Primera pantalla del desinstalador, con tres opciones:

- **Restablecer el launcher** (opción por defecto): borra la cuenta, ajustes, BD y skins (incluida la marca del tutorial), pero conserva mundos, versiones e instancias descargadas. Al reinstalar, el cliente se comporta como la primera vez (tutorial incluido) SIN re-descargar el juego.
- **Conservar todo**: elimina solo el programa (útil para reparar/reinstalar sin perder la sesión).
- **Borrar absolutamente todo**: además elimina `%APPDATA%\runic-client` completo y `%LOCALAPPDATA%\runic-client`.
- La desinstalación silenciosa (`/S`) conserva los datos.
- Si el usuario cambió la carpeta del juego en Ajustes, esa carpeta nunca se borra automáticamente.

**Importante al modificar `installer.nsh`:**

- Los `!include` de `LogicLib.nsh`, `nsDialogs.nsh` y `WinMessages.nsh` deben permanecer **dentro** del macro `customHeader`: electron-builder incluye este archivo antes que su plantilla, y sin esos includes la compilación falla.
- La página y sus funciones están dentro de `!ifdef BUILD_UNINSTALLER` porque el instalador se compila en dos pasadas; quitar el guard rompe el build ("warning treated as error").
- Ningún comentario puede terminar en `\` (NSIS lo interpreta como continuación de línea → warning 6050 → build fallido).
- El texto está guardado en UTF-8 **con BOM** para que los acentos se vean bien. Si lo editas, conserva el BOM.

---

## Datos y ubicaciones (equipo del usuario final)

| Ruta | Contenido |
|---|---|
| `%APPDATA%\runic-client\runic.db` | Base de datos SQLite (ajustes, cuentas, instancias) |
| `%APPDATA%\runic-client\skins\` | Skins y capas subidas por cuenta |
| `%APPDATA%\runic-client\instances\` | Carpetas de cada instancia |
| `%APPDATA%\runic-client\minecraft\` | Carpeta del juego clásica (versiones detectadas/legacy) |
| `%APPDATA%\runic-client\authlib\` | authlib-injector.jar para skins Ely.by |
| `%APPDATA%\runic-client\mojang-manifest-cache.json` | Caché del manifiesto de versiones |
| `%LOCALAPPDATA%\Programs\Runic Client\` | Programa instalado |

---

## Optimizaciones ya implementadas

- **Pre-descarga paralela**: 10 hilos de descarga para jar/librerías/assets antes de abrir el juego; salta lo ya descargado (tamaño + SHA-1) — relanzar una instancia tarda segundos.
- **Caché del manifiesto de Mojang**: 30 minutos en memoria + copia en disco; si no hay internet usa la última copia guardada.
- **Reintentos automáticos** (3 intentos con espera progresiva) en todas las descargas, con soporte de redirecciones HTTP.
- **Selección automática de Java** según la versión de Minecraft, con carpetas personalizables.
- **Argumentos JVM optimizados** (G1GC, AlwaysPreTouch, UseStringDeduplication, etc.) en `services/launcher.js` → `buildJVMParams`.
- **Límite de RAM ajustado al equipo** y sugerencia clickeable "Sugerido: X GB" en Ajustes.
- **Sin dependencias nativas**: SQLite via `node:sqlite`; no hace falta Visual Studio ni rebuilds.

---

## Convenciones para trabajar en el proyecto

- Código y comentarios en español donde ya existan; mantener el estilo existente de cada archivo.
- No agregar comentarios innecesarios ni dependencias nuevas sin justificarlo.
- Probar siempre `npm start` antes de compilar, y `npm run dist` antes de entregar cambios que afecten empaquetado.
- Verificación rápida de sintaxis: `node --check <archivo.js>`.
- Si cambias íconos: regenerar `icon.ico` (multi-resolución, mínimo 256x256) y `icon.png` (512x512); `icon-master.png` es solo el archivo fuente del diseño.
- No subir a git la carpeta `dist/` ni `node_modules/` (agregarlos a `.gitignore` si se versiona el proyecto).
