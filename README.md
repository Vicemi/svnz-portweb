# 🧛 Super Vampire Ninja Zero — Port Web

> Un port web no oficial de **Super Vampire Ninja Zero** (prototipo, 2009), el juego de pelea de **Batoví Games Studio**, reconstruido para correr en el navegador con **Astro**, **React** y **Canvas**. Se juega en PC y en el celular.

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
- **Los 5 modos de juego:**
  - **Normal Mode (modo historia):** 7 oleadas con 4 jefes (Ninja Dorado, Gran Demonio, Mina poseída y Drácula).
  - **Time Attack:** sobrevivir 5 minutos.
  - **Coop Survival:** con una compañera controlada por la IA.
  - **Practice:** enemigos no agresivos que aparecen sin parar.
  - **Enemy Test:** jugar como cualquiera de los enemigos.
- **Peleadores:** Mina con todos sus ataques (rápidos, fuertes, combos de hasta 5 golpes, saltos, dash, defensa con parry y especiales), Ninja demonio, Ninja genérico, Murciélago, Gran Demonio y Drácula; todos con las **máquinas de estados reales** del juego.
- **Golpes y daño:** zonas de golpe y de cuerpo por cuadro, pausa de impacto, chispas, caídas, rebotes, levantarse, invulnerabilidad al levantarse y muerte.
- **IA original:** cada enemigo decide y reacciona con las tablas del juego (se acerca, rodea, se aleja, espera, elige objetivo y ataca según la distancia).
- **HUD fiel:** vida de Mina con su nombre, barra de poder con orbes y "MAX", vida del último enemigo golpeado abajo a la derecha, **contador de combos** abajo a la izquierda con su tiempo, Record y Count.
- **Audio original:** música, efectos y voces.
- **Celular:** controles táctiles con los 6 botones, aviso para girar el teléfono y **botón de pantalla completa**.

### 🗺️ Planes a futuro

- [x] Motor de peleas y máquinas de estados reales
- [x] IA original
- [x] HUD y contador de combos
- [ ] Comparación lado a lado con el original para los últimos detalles (cámara, efectos de golpe, transición de pelea)
- [ ] Cámara y animaciones especiales de los jefes
- [ ] Soporte para mods (personajes y niveles nuevos)

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
| `/?level=bigDemonLevel` / `draculaLevel` / `batLevel` / `demonNinjaLevel` / `genericNinjaLevel` | Enemy Test |
| `/?debug=1` | Dibuja las zonas de golpe (rojo) y de cuerpo (azul) |
| `/?touch=1` / `/?touch=0` | Fuerza / desactiva los controles táctiles |

---

## 📁 Estructura del proyecto

```text
/
├── public/assets/            # assets originales del juego + manifest.json
├── src/
│   ├── components/           # SvnzGame.tsx (canvas, orientación, pantalla completa) y TouchControls.tsx
│   ├── pages/index.astro     # página única y estilos
│   └── svnz/
│       ├── game.ts           # estados de la app: logos → menú → pelea
│       ├── render.ts         # sprites, fuentes y HUD
│       ├── core/             # carga de assets, audio, teclado
│       ├── fight/            # luchador (máquina de estados, física), pelea y oleadas, IA, datos
│       └── data/             # chars.json, fsm.json y ai.json (generados por tools/)
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
- **Vicemi** ([vicemi.dev](https://vicemi.dev)) — dirección del proyecto y port.
