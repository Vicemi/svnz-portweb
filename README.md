# 🧛 Super Vampire Ninja Zero — Port Web

> Un port web no oficial de **Super Vampire Ninja Zero** (prototipo, 2009), el juego de pelea de **Batoví Games Studio**, reconstruido para correr en el navegador con **Astro**, **React** y **Canvas**. Se juega en PC y en el celular.

---

🎮 **Jugalo online:** [svnz-portweb.vicemi.dev](https://svnz-portweb.vicemi.dev). No hay que instalar nada: anda en PC y en el celular, y se actualiza con cada cambio que llega a `main`.

---

## 📖 Sobre el proyecto

Super Vampire Ninja Zero es un beat 'em up 2.5D donde controlás a **Mina**, una experta en artes marciales con algo de demonio/no-muerto, contra oleadas de ninjas, murciélagos, demonios gigantes y hasta **Drácula**. El juego original es un prototipo de 2009 que quedó abandonado, y este proyecto nace para **revivirlo** y poder jugarlo en cualquier dispositivo, sin instalar nada.

Es el proyecto hermano de **[XA-PortWeb](https://github.com/Vicemi/Xa-portweb)**: el mismo método de trabajo (reimplementar el juego en TypeScript leyendo sus assets originales) aplicado a otro juego de Batoví. La meta es que sea **fiel 1 a 1 al original** como punto de partida.

## 🛠️ Cómo se hizo

El motor del juego (**bat**, de Batoví) es el mismo que usa XA, pero la capa de pelea es propia y vive **en el código**, no en archivos de datos. Así que el camino fue:

1. **Descompilar** `svnz.exe` (C++ de 2009, x86, sin símbolos) con **[Ghidra](https://ghidra-sre.org/)**, ayudándose con la información de clases (RTTI) que trae el ejecutable.
2. **Recuperar la lógica real** a partir del código: las funciones que construyen las máquinas de estados de cada personaje (72 estados con sus condiciones, acciones y transiciones), las definiciones de golpes, las físicas, la cámara y el HUD. Como el compilador pasaba parámetros de formas poco habituales, escribí un pequeño **ejecutor simbólico x86** que lee esas funciones y las convierte en datos legibles (`tools/build_fsm.py`).
3. **Decodificar la IA**: las tablas de decisiones y reflejos de cada enemigo, sus situaciones y reacciones y el controlador de movimiento.
4. **Reimplementar** todo en TypeScript y **contrastarlo contra el juego original corriendo**, midiendo posiciones y comportamientos en capturas de pantalla.

Todo se hizo con **Claude** y la skill **[universal-modder](https://github.com/rehan-remade/universal-modder)**. El diario completo del trabajo (formatos, direcciones, constantes y decisiones) está en [`MODLOG.md`](MODLOG.md).

## 🚧 Estado actual

El juego es **jugable**, pero todavía hay detalles por igualar con el original. Si encontrás algún problema, abrí un *issue* contando **en qué modo**, **qué hiciste** y **qué esperabas que pasara**.

### ✅ Lo que ya funciona

- **Flujo del original:** pantalla de Batoví, pantalla de vicemi.dev (el logo del port), menú principal, pelea, ayuda (**Enter**) y salida con **Esc**.
- **Los 5 modos de juego originales (más el modo bonus):**
  - **Normal Mode (modo historia):** 7 oleadas con 4 jefes (Ninja Dorado, Gran Demonio, Mina poseída y Drácula).
  - **Time Attack:** sobrevivir 5 minutos.
  - **Coop Survival:** con una compañera controlada por la IA.
  - **Practice:** enemigos no agresivos que aparecen sin parar.
  - **Enemy Test:** jugar como cualquiera de los enemigos.
- **Bonus Bosses (modo extra):** una sección nueva del menú con los personajes de **XA** dentro del motor de SVNZ, sin tocar el juego principal. Primero el **Jefe de XA** (camina, dispara su abanico de 5 balas, hace daño al tocarlo y explota al caer) y después el **Héroe de XA** (camina, salta dos veces, dispara sus bolas de energía y se cubre con su **escudo**: bloquea los golpes débiles de frente hasta que la guardia se rompe). Las balas salen de la boca del cañón y las muertes usan las animaciones de XA. Ambos se mueven en el plano 2.5D con IAs propias, usan los sonidos de XA y mantienen la música de SVNZ.
- **Menú con mouse y toque:** además del teclado, se puede elegir cada opción con el mouse (resalta al pasar) o tocándola en el celular. El original solo permitía el teclado.
- **Peleadores:** Mina con todos sus ataques (rápidos, fuertes, combos de hasta 5 golpes, saltos, dash, defensa con parry y especiales), Ninja demonio, Ninja genérico, Murciélago, Gran Demonio y Drácula; todos con las **máquinas de estados reales** del juego.
- **Golpes y daño:** zonas de golpe y de cuerpo por cuadro, pausa de impacto, chispas, caídas, rebotes, levantarse, invulnerabilidad al levantarse y muerte.
- **IA original:** cada enemigo decide y reacciona con las tablas del juego (se acerca, rodea, se aleja, espera, elige objetivo y ataca según la distancia).
- **HUD fiel:** vida de Mina con su nombre, barra de poder con orbes y "MAX", vida del último enemigo golpeado abajo a la derecha, **contador de combos** abajo a la izquierda con su tiempo, Record y Count.
- **Audio original:** música, efectos y voces (y los efectos de XA en el modo bonus).
- **Celular:** controles táctiles con los 6 botones, aviso para girar el teléfono y **botón de pantalla completa**.

### 🌐 VS y Online (agregado del port, no existía en el original)

Menú principal → **VS y Online**:

- **Coop Local (2 jug.)**: dos jugadores en el mismo teclado, cada uno con su personaje.
- **Crear sala: Coop**: sala online con un **código** que te da el [backend](https://github.com/Vicemi/svnz-backend); hasta **4 jugadores** para pasar el modo historia juntos (crossplay: PC y celular entran a la misma sala).
- **Crear sala: VS**: **todos contra todos**, hasta **4 jugadores** (1 contra 1, 1v1v1 o 1v1v1v1). Cada uno empieza con **3 vidas** (el anfitrión puede dejar 1 o 2) y gana el último en pie. El creador de la sala decide cuándo empezar.
- **Unirse con codigo**: o abrí un enlace de invitación `…/?room=ABCDE`.

Cómo se juega:

- **Personajes elegibles** (estilo selección de personaje, con el mismo diseño del menú del juego): Mina, Ninja, Demon Ninja, Gold Demon, Murciélago, Big Demon y Drácula con sus movimientos del juego original (Mina tiene combos, saltos, dash, especiales y defensa; Big Demon, armadura y *body slam*; Drácula, desplazamiento y patada voladora; etc.), y **XA Hero y XA Boss** (los del modo Bonus Bosses), **solo en VS** y algo recortados para que no sean un contra imposible (menos vida y daño; el jefe sin armadura).
- **Colores:** cada personaje tiene hasta **4 variantes de color** en el selector (las paletas de su hoja de sprites; XA tiene una sola). Si un jugador ya tiene un color de un personaje, **nadie más puede elegirlo**: sale bloqueado con el nombre de quien lo tiene.
- **Sobre cada personaje** se ve siempre el **nombre** del jugador (hasta 10 letras), con una **flecha** pequeña solo sobre *tu* personaje para que lo encuentres aunque haya varios iguales. En **coop** la **barra de vida** va arriba de cada jugador, junto al nombre; en **VS** la vida de todos va **abajo, estilo Smash**: una tarjeta por jugador con su cara, su nombre, la barra de vida y sus vidas restantes (corazones).
- **Power-ups (solo online, VS y coop):** aparecen pocos y espaciados (uno cada 20-36 s, como en Smash) para no dar ventajas todo el tiempo. Son: **Estrella** (lanza estrellas ninja: Mina con Q/W, los demás con su botón especial), **Rayo** (más velocidad), **Escudo** (la mitad del daño y sin tambalearse), **Fuerza** (+40 % de daño), **Colmillo** (recuperás vida con lo que golpeás) y, **solo en coop**, el **Corazón**, que aparece al azar mientras algún amigo está caído y lo **revive**. En VS no se revive. Cada efecto dura unos segundos: se ven los **tiempos** en pantalla (los iconos con su barra sobre el personaje y la lista de tus efectos arriba a la izquierda) y parpadean cuando están por terminar. Los proyectiles se ven en vuelo, con sombra en el piso y estela, para poder esquivarlos. **El anfitrión puede apagar todos los power-ups o elegir cuáles activar** desde el lobby.
- **Sesiones:** si recargás la página o se corta la conexión, **volvés a tu lugar** (la sesión se guarda en la pestaña y el servidor reserva tu asiento unos segundos); también podés volver entrando con el código de sala y el mismo nombre. Los asientos que nadie reclama se liberan solos. Si el que recarga es el anfitrión en plena partida, esa partida se termina y todos vuelven al lobby.
- **Dificultad del coop**: cada jugador extra suma un **6 %** de vida a los enemigos y **más enemigos** por oleada y en pantalla (con 2 jugadores, ×1,75: donde antes aparecían 2 ahora aparecen 4), los **jefes** tienen mucha más vida, y los personajes fuertes (Big Demon, Drácula, Gold Demon…) endurecen aún más el juego. Entre oleadas los caídos vuelven con la mitad de su vida; se pierde cuando caen todos. Los números exactos están en la [guía del backend](https://github.com/Vicemi/svnz-backend#reglas-del-juego-que-aplica-el-servidor).
- **Controles del jugador 2 (coop local):** **I J K L** mover · **U** ataque rápido · **O** ataque fuerte · **P** salto · **N** especial · **M** defensa · **,** dash. El jugador 1 usa los controles de siempre.
- En una partida online, **Esc dos veces** sale: si sos invitado dejás la sala; si sos el anfitrión terminás la partida y todos vuelven al lobby.

> La pelea online corre en el navegador del **anfitrión** (el que crea la sala): tiene que mantener la pestaña visible. Los invitados juegan con la latencia hacia el anfitrión (el lobby muestra el *ping*).

#### Montar tu propio backend

Los modos online necesitan un servidor de salas. **Cualquiera puede montar el suyo**: el código, la guía de instalación, de Docker y de Cloudflare Tunnel / Zero Trust están en **[github.com/Vicemi/svnz-backend](https://github.com/Vicemi/svnz-backend)**. Después, el juego solo necesita dos variables de entorno **al compilarse**:

| Variable | Valor |
| :--- | :--- |
| `PUBLIC_SVNZ_BACKEND_URL` | Dirección https de tu backend, sin `/` final (ej. `https://svnz-api.tudominio.com`). |
| `PUBLIC_SVNZ_BACKEND_TOKEN` | El `GAME_TOKEN` del `.env` del backend. |

En **Cloudflare Pages**: *Settings → Variables and Secrets* → agregalas y volvé a desplegar. En local, creá un `.env` (hay un [`.env.example`](.env.example)). Sin ellas, el coop local funciona igual y los modos online muestran «Backend sin configurar».

### 🗺️ Planes a futuro

- [x] Motor de peleas y máquinas de estados reales
- [x] IA original
- [x] HUD y contador de combos
- [ ] Comparación lado a lado con el original para los últimos detalles (cámara, efectos de golpe, transición de pelea)
- [ ] Cámara y animaciones especiales de los jefes
- [x] Bonus Bosses: jefe y héroe de XA
- [ ] Más personajes bonus y soporte para mods (personajes y niveles nuevos)

---

## 🎮 Controles

### Teclado

| Acción | Tecla |
| :--- | :--- |
| Moverse | **Flechas** |
| Ataque rápido | **Q** |
| Ataque fuerte | **W** |
| Saltar | **E** |
| Ataque especial | **A** |
| Defensa / parry | **S** |
| Dash | **D** (o doble toque hacia adelante) |
| Ayuda durante la pelea | **Enter** |
| Pantalla completa | **F4** |
| Salir del modo actual | **Esc** |

### VS y Online

Los controles de pelea son los mismos (el jugador 1 / quien juega online). En el lobby se usa el mouse o el toque; en el celular las salas online funcionan con los controles táctiles de siempre. Ver «VS y Online» más arriba para los controles del jugador 2 en el coop local.

### Celular / táctil

Girá el teléfono en **horizontal**.

- **Izquierda:** joystick flotante de 8 direcciones (el juego es 2.5D: también se camina hacia el fondo de la pantalla).
- **Derecha:** los 6 botones (Q, W, E / A, S, D) con la misma forma que en el teclado. Cada dedo se sigue por separado (**multitouch**) y podés deslizar entre botones.
- **Arriba a la izquierda:** botón de **pantalla completa** (⛶). **Arriba a la derecha:** ayuda (?) y volver (↩).
- Los controles se escalan con el alto de la pantalla, así que se adaptan a celulares chicos y grandes.

> En una notebook con pantalla táctil podés forzar los controles táctiles con `?touch=1` en la URL (o desactivarlos con `?touch=0`).

---

## 💻 Ejecutar el proyecto localmente

### Requisitos

- **[Node.js](https://nodejs.org/)** **22.12 o superior** (o Bun) y **npm**
- **Git**

### Instalación

```sh
git clone https://github.com/Vicemi/svnz-portweb.git
cd svnz-portweb
npm install
npm run dev
```

Abrí el juego en [http://localhost:4321](http://localhost:4321).

### Generar una versión de producción

```sh
npm run build
```

Los archivos se generan en `./dist/`, listos para subir a cualquier hosting estático (Cloudflare Pages, Vercel, Netlify, GitHub Pages…). Para previsualizarla: `npm run preview`.

### 🌐 Deploy y flujo de ramas

La versión pública vivirá en **[svnz-portweb.vicemi.dev](https://svnz-portweb.vicemi.dev)** (hosting estático, build con `npm run build` y carpeta `dist`). El desarrollo sigue este flujo: se crea una rama `feature/...` desde `develop`, se integra en `develop`, luego `develop` se integra en `main` y las ramas feature se borran. Así `main` y `develop` quedan siempre iguales y estables.

### 🧞 Comandos disponibles

| Comando | Acción |
| :--- | :--- |
| `npm install` | Instala las dependencias |
| `npm run dev` | Servidor local en `localhost:4321` |
| `npm run build` | Compila la versión de producción en `./dist/` |
| `npm run preview` | Previsualiza la build |
| `npm run manifest` | Regenera `public/assets/manifest.json` (después de agregar o quitar archivos del juego) |

### 🔗 Atajos por URL

| URL | Qué hace |
| :--- | :--- |
| `/?level=normalLevel` | Entra directo al modo historia |
| `/?level=timeAttackLevel` / `survivalLevel` / `practiceLevel` | Otros modos |
| `/?level=bonusXaLevel` | Bonus Bosses: jefe y héroe de XA |
| `/?level=bigDemonLevel` / `draculaLevel` / `batLevel` / `demonNinjaLevel` / `genericNinjaLevel` | Enemy Test |
| `/?room=ABCDE` | Abre «Unirse» con el código de sala ya escrito (enlace de invitación) |
| `/?debug=1` | Dibuja las zonas de golpe (rojo) y de cuerpo (azul) |
| `/?touch=1` / `/?touch=0` | Fuerza / desactiva los controles táctiles |

---

## 📁 Estructura del proyecto

```text
/
├── public/assets/            # assets originales del juego + manifest.json
├── src/
│   ├── components/           # SvnzGame.tsx (canvas, orientación, pantalla completa), TouchControls.tsx y OnlinePanel.tsx (lobby y selección de personaje)
│   ├── pages/index.astro     # página única y estilos
│   └── svnz/
│       ├── game.ts           # estados de la app: logos → menú → pelea
│       ├── render.ts         # sprites, fuentes y HUD
│       ├── core/             # carga de assets, audio, teclado
│       ├── fight/            # luchador (máquina de estados, física), pelea y oleadas, IA, datos
│       ├── bonus/            # datos del modo Bonus Bosses (estados, golpes, IA, niveles y menú de los personajes de XA)
│       ├── online/           # VS y Online: personajes elegibles, dificultad, cliente del backend (net), sincronía anfitrión/invitado (sync), retratos
│       └── data/             # chars.json, fsm.json, ai.json y xa.json (generados por tools/)
├── tools/                    # build_chars.py, build_fsm.py, gen-manifest.mjs
├── research/                 # herramientas de descompilación (Ghidra, decodificadores, captura del original)
└── MODLOG.md                 # diario de ingeniería inversa
```

---

## ⚖️ Aviso legal

Este es un proyecto **de fans, sin fines de lucro y no oficial**. *Super Vampire Ninja Zero* y todos sus personajes, gráficos, música y sonidos pertenecen a **Batoví Games Studio**; este repositorio incluye los assets del juego original (descargable gratis desde [supervampireninja.com](http://www.supervampireninja.com)) únicamente para preservarlo y hacerlo jugable en la web. Si sos titular de los derechos y querés que algo se retire, abrí un *issue* y se hará de inmediato.

El código del port (la reimplementación en TypeScript y las herramientas) lo escribió **Claude** con [Vicemi](https://vicemi.dev) como director del proyecto.

## 🙏 Créditos

- **Batoví Games Studio** — creadores del juego original: Federico Medina (motor y programación), Sebastián García (diseño, gráficos, personajes y efectos de sonido) y Juan Fornos (música). Voz: Giselle Ruiz.
- **[Ghidra](https://ghidra-sre.org/)** — análisis del ejecutable.
- **[universal-modder](https://github.com/rehan-remade/universal-modder)** — skills y metodología de ingeniería inversa.
- **Calcar y Batoví Games Studio** — creadores de **XA: Contra los Cuatreros Galácticos**, de donde salen el jefe, el héroe y sus sonidos del modo Bonus Bosses.
- **[SVG Repo](https://www.svgrepo.com/)** — los dibujos base de la estrella, el rayo y el corazón de los power-ups (convertidos al estilo 8-bit del juego por `tools/build_powerups.py`); el escudo, el puño y el colmillo se dibujaron para el proyecto.
- **[Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P)** (CodeMan38, OFL) — la tipografía de los paneles del lobby.
- **Vicemi** ([vicemi.dev](https://vicemi.dev)) — dirección del proyecto y port.
