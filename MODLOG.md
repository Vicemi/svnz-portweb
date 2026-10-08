# MODLOG — Super Vampire Ninja Zero, port web

Diario del port web 1:1 de *Super Vampire Ninja Zero* (prototipo, Batoví Games Studio, 2009). Mismo método que el
port de Xa (E:\Vicemi\Proyectos\XA-PortWeb): reimplementación en TypeScript que lee los assets originales.

## Fuentes
- Juego: `F:\Games\SuperVampireNinjaZero` — `svnz.exe` (PE32 MSVC x86, 2009-12-09, 1.2 MB, sin símbolos; d3d9,
  OpenAL + libvorbisfile, DirectInput8). Assets: `assets/` (xml, png, ogg, fgt).
- Motor: **bat** (el mismo de Xa: `App@bat`, `AppState@bat`, `Sprite@bat`, `TextSprite@bat`, `Camera@bat`, …) +
  capa de pelea propia. 298 clases RTTI (ver abajo).
- Descompilación: Ghidra 12.1.2 (`E:\Transfer\Descargas\ghidra_12.1.2_PUBLIC_20260605\ghidra_12.1.2_PUBLIC`, JDK
  `C:\Program Files\Java\jdk-26.0.1`). Al Ghidra le faltaba `os/win_x86_64/decompile.exe` (borrado, probablemente
  por el antivirus): se reemplazó por un puente (`research/ghidra_scripts/DecompileBridge.cs`, compilado con el csc
  de .NET 4) que ejecuta el `decompile` de Linux del mismo release dentro de WSL (Ubuntu-22.04,
  `~/ghidra_decomp/decompile`) y pasa stdin/stdout/stderr. Proyecto y salida en `research/` (gitignored, nunca se
  publica).

## Ruta elegida
Reimplementar (como Xa): el juego entero en TS/Canvas sobre Astro + React, con los assets originales incluidos en
`public/assets/` (mismo criterio que el repo de Xa). La lógica de pelea (estados, condiciones, acciones, IA) está
**en el código** del exe, no en datos: hay que portarla desde la descompilación.

## Datos (assets/data)
- `characters.xml`: Mina, DemonNinja, GoldDemonNinja (DemonNinja color 3 + armorMode), GenericNinja, Bat, BigDemon,
  Dracula. Por personaje: statesDictionary (`<X>_FighterStates`), controlTriggers (`<X>_Control`), decisionsAI /
  reflexesAI, reflexesFrequency, friction, gravity, collisionWidth, strength, armorMode, lifeHuman/lifeCPU,
  close/mid/longAttackDist, walkSpeed, nombres alternativos con paleta (`color` = hoja `<X><n>.png`).
- `waves.xml`: niveles (normalLevel = Story Mode: 7 oleadas con 4 jefes; timeAttack 300 s; survival coop; practice;
  modos de prueba de enemigo), `waveList` (StandarMode / BossMode / TimeMode / SurvivalMode, activeEnemies,
  listExtras/activeExtras), `fighterLists` (equipos y enemigos con estado inicial `Intro1`/`DamageFall`/`Jump`/
  `Appear`, yPos, nameIndex -1 = al azar, lifeCPU).
- `menu.xml`: textos en/es y menú (Normal Mode, Time Attack, Coop Survival, Practice, Enemy Test → submenú, Exit).
- Sprites: FighterFactory (`<Char>.png` + `.xml` rects + `.fgt` ejes/frames/anims/rects azul y rojo). Formato
  ya documentado en el port de Xa (ronda 45 del MODLOG de Xa).

## Clases relevantes (RTTI)
Fight, FightCamera, Fighter, FighterState, FighterStateDictionary, FighterStateManager, FighterControlTriggerPackage,
TriggerFighter, Trigger, HitsManager, CollisionsManager, SparksManager, LifeBarManager, ScoreManager, WavesManager,
AIManager/AIController/AIPart/situaciones y reacciones, ~40 condiciones (IsPressedCond, IsDownForwardCond,
AnimEndCond, StateTimeArrivedCond, HitWasConnectedCond, …) y ~45 acciones (ChangeStateAction, VelSetAction,
HitPerformAction, MakeGeneralSparkAction, ShakeAction, DramaticSlowMotionAction, …). Áreas: DojoArea, ArenaArea,
DungeonArea, PracticeArea. Estados: LogoState, MainScreenState, GameState.

## Controles (readme.txt original)
Flechas mover · Q ataque rápido · W ataque fuerte · E salto · A especial · S defensa/parry · D dash ·
ENTER ayuda en pelea · F4 pantalla completa · ESC salir del modo actual.
Texturas: fondos/pantallas 512x512 (potencia de 2; vista probable 512x384 como Xa, confirmar en exe),
fightbanner 512x64, fuentes 256xN, hud/bars 256x32, fullBars 128x64, comboBars 64x16.

## Estado
- Ghidra headless exportando `research/svnz_decompiled.c` (ExportVtables.java preparado para mapear vftables→clases).

## Ronda 1 — estados de pelea decodificados (2026-10-05)
- La descompilación C de Ghidra pierde los punteros a cadenas que viajan en registros (MSVC LTCG usa convenciones
  propias). Solución: `ExportListing.java` (desensamblado anotado: cadenas, vftables RTTI, llamadas) +
  `research/decode_builders.py`, un ejecutor simbólico x86 mínimo (registros, pila, x87) que convierte las 4
  funciones constructoras en scripts legibles:
  - `0043aa80` controles (`<X>_Control`), `0043fe60` estados Human_*, `00441dc0` Mina_*, `00448cf0` enemigos/jefes,
    `00446780` diccionarios (`<X>_FighterStates`: genérico→específico), `0043bc50` definiciones de golpe.
- API del builder: newState / newStateFrom(nombre, base) · trigger · cond(idx, esperado 1|0) · action(idx) ·
  parámetros int/float/str/bool (se apilan ANTES de la cond/acción que los consume) · beginOr/beginAnd/endCompound ·
  controlState(n). Acciones antes del primer trigger = acciones de entrada del estado.
- Campos de FighterState: +0x3c anim por defecto, +0x74 tipo de estado, +0x78 estado físico, +0x40/+0x44/+0x48/+0x4c
  (movimiento: Stand 1/10/vel/fricción); Trigger +0x3c = trigger persistente.
- Índices: 48 condiciones (`00415d30`) y 48 acciones (`00416720`), tablas en decode_builders.py.
- Las condiciones delegan en `Fighter` (herencia múltiple: IConditionFighter / IActionFighter / IAIFighter).

## Ronda 2 — motor jugable (2026-10-06)
- `src/svnz/`: core (assets/audio/input), fight (fighter FSM+física+animación, fight/colisiones/oleadas, pad, data, ai
  provisional), render (sprites FighterFactory, fuentes 8x8/8x16 desde '!', HUD), game (Logo→Menú→Pelea), táctil 6 botones.
- Resolución lógica 480x272; proyección `sx=floor(x+.5)`, `sy=floor(z/2-y+.5)`; área x 0..480, z 60..220.
- Datos del exe: gravedad -1200, fricción 1200, poder 0..300 (humano arranca en 250), spawn aleatorio con margen 1.2×collisionWidth.
- Tooling de verificación contra el original: `research/drive.py` (lanza, enfoca, teclas por scancode, captura cliente) y `cap.py`.
- Pendiente: IA real (Standar/BigDemon/Dracula decisions+reflexes), definiciones de golpe por enemigo, cámara, efectos,
  pantalla de ayuda/transición, comparación cuadro a cuadro con el original.

## Ronda 3 — HUD fiel (2026-10-06)
Medido en el original (research/drive.py, capturas 2x) y decodificado del exe (DrawableLifeBar/ProportionalLifeBar/ComboBar):
- Vida del jugador: marco bars.png (0,0,168,12) en (10,12), relleno fullBars (0,0,128*vida/max,8) en (30,14), nombre small en (32,4).
- Vida del enemigo (último golpeado por el humano, `Fight+0x3d0`): abajo a la derecha, marco proporcional en (304,258):
  ancho interior W=min(vidaMax,128); marco = bars.png cols 0..W+20 + tapa derecha (148,0,20,12); nombre en (326,250).
  Relleno por capas: verde 0..128, amarillo (fullBars y=26) 128..256, cian (y=34) 256..384 (00436260). >384 no dibuja relleno (literal del exe, sin verificar).
- Combo (`Fight::v10` 00420cd0): "N Hits" (smallFontEnabled, naranja) centrado en x=42,y=244; barra comboBars 64x8 en (10,254): rojo base +
  verde = tiempo restante/ventana. Ventana 1 s (1er golpe) creciendo a 2.2 s a 20 golpes (curva de easing sin decodificar: lineal).
- "Press ENTER for Help" small blanca (200,6); Record/Count smallFontEnabled alineados a la derecha en x=452; Record sube en vivo.
- Poder: 250 inicial = 2 orbes + media barra; a 300 parpadea el overlay MAX de barsEffect.png.
- Pendiente de verificar contra el original: overlay de vida baja, barra del compañero (coop), jefes con vida > 384, curva exacta del combo.

## Ronda 4 — IA original (2026-10-06)
Decodificada del exe (clases AIController/AIManager/AIPart/AIPartReactionBucket, situaciones y reacciones) y de los datos de
`0043dfc0` con `research/decode_ai.py` -> `src/svnz/data/ai.json`; implementada en `src/svnz/fight/ai.ts`.
- Cada luchador CPU: Decisions AI (qué hacer) + Reflexes AI (reacciones rápidas, cada `reflexesFrequency`/60 s con fase aleatoria).
- Parte = situación + peso "no hacer nada" + reacciones con pesos. Selección (00423a00): para cada parte con situación cierta,
  r=floor(total*rand); si r <= total-idle se dispara y se elige reacción recorriendo pesos; si no, siguiente parte.
- Situaciones (Fight 0x64..0xac): Close/Mid/LongToTarget = |dx| <= dist + radio(objetivo) y |dz| < 24; AboveToTarget = |dx| < 25 y |dz| < 24
  (los dos encima: por eso el original se separa); CloseToAirTarget exige y > 50; Is*ToEnemy mira el alcance del ENEMIGO sobre mí.
- Reacciones: Wait(ticks), RandomWalk, Close/Mid/LongToTarget (modo 2/3/4: ir al punto a `dist` del objetivo por el lado más cercano),
  AboveToTarget (ir a su posición), StalkTarget (Fight::v44: lado actual, 30..90 en z y 0..110 en x), StayAway (>=100 px),
  Find{NewTargetRandom,Closest,Strong,Weak}Target, PressButton(n), PressButtonAimingToTarget(n) (empuja el stick hacia el objetivo y pulsa).
- Movimiento (FUN_00423fe0): vector unitario hacia el destino hasta quedar a <5 px; la reacción termina cuando el controlador queda
  ocioso (follow/wait) o el luchador deja de moverse (walk/stalk/away). Reflejo disparado: cancela movimiento y pone el temporizador de
  decisión en 1 s.
- Caminar con objetivo: siempre mira al objetivo y la velocidad es walkSpeed*stick con signo (retrocede mirando al rival).
- collisionWidth es el margen completo a las paredes (no la mitad).
- Corrige el bug "encima del enemigo": ya nadie se queda clavado; el enemigo se separa (Stalk/Close) y se reacomoda.
Pendiente: coop (el compañero usa la IA del xml), Dracula/BigDemon movimientos especiales (estados FastMove/BodySlam ya enlazados por StateEquals).

## Ronda 5 — logos, responsivo y publicación (2026-10-06)
- Flujo de inicio: Batoví (3 s) -> vicemiScreen (3 s, mismo fundido) -> menú; cualquier tecla/toque salta cada logo.
- Responsivo táctil: tamaños con clamp() según el alto de pantalla (botones, stick, márgenes con safe-area), botón de pantalla
  completa (⛶, arriba a la izquierda; Fullscreen API + bloqueo a horizontal si existe) y F4 en teclado como el original.
- README al estilo del de XA. Publicado en https://github.com/Vicemi/svnz-portweb (ramas develop y main).

## Ronda 6 — calibración de la IA contra el original (2026-10-06)
- Medición en el original (Mina quieta 30 s, vida del HUD en píxeles): ~31 de vida perdida (5 golpes de 6); el DemonNinja
  también rodea y ataca con las garras extendidas a ~45 px sin tocar a Mina durante largos períodos, es decir, el original
  también "golpea al aire" en el borde del alcance (disparo a close+radio = 46 px, alcance real del tajo ~41 px).
- Mi simulación de 10 pruebas de 30 s: 2-10 ataques, vida perdida 0-42 (media 22): agresividad comparable.
- Bug corregido: radio del luchador = collisionWidth*0.5 (0040a5c4), no el ancho completo (los enemigos atacaban demasiado lejos).
- Bug corregido: velocidad al caminar = f48 del estado salvo que f4c != 0 (entonces walkSpeed del personaje) (Fighter::v36 004099e0);
  el murciélago (walkSpeed DEFAULT=0 en el xml, f48=150 en Bat_Fly) se quedaba inmóvil.

## Ronda 7 — menú con mouse y Bonus Bosses (2026-10-06)
- Menú: mouse/toque (hover resalta, clic activa; `SvnzGame.pointer`), lista compacta (104 + 23·i, 256x22) debajo del título y de la
  línea "Vicemi Mod" de mainScreen.png (antes tapaba las letras); 7 entradas con "Bonus Bosses" (submenú `bonusBosses`).
- Modo bonus (`src/svnz/bonus/data.ts`, no toca los datos originales): jefe y héroe de XA como luchadores del motor SVNZ con
  estados/golpes/controles/IA propios; sprites convertidos de XA por `tools/build_xa_chars.py` -> `data/xa.json` (escala 0.62 el jefe).
  Motor: proyectiles (`Fight.shoot/shootFan`, derivan en z hacia el objetivo), acciones `Shoot`/`ShootFan`, `CharSprites.scale`.
- Jefe XA: camina, abanico de 5 balas (60..120°, 200 px/s) con la pose de disparo, contacto hace daño (hit re-armado cada ciclo),
  armadura, explosión BOSS_DEAD ~4 s y sacudida. Héroe XA: caminar, salto y doble salto (segundo salto solo desde `Jump`),
  bola de energía, reacción de daño/caída/levantarse reutilizando los estados Human con anims 5xxx del héroe.
- Oleadas: jefe (música bgmBoss) y luego héroe (bgmNormal). Sonidos de XA en `assets/xa/fx`.

## Ronda 8 — escudo del héroe XA, IA y cañones (2026-10-06)
- Escudo (mecánica de XA, BLOCK_IN/OUT = frames 22..25): estados `XaHero_Block`/`Unblock` (botón 2). Con la guardia arriba
  (`Fighter.guard`) los golpes débiles (fallType<=1) de frente se bloquean: sin daño, sonido s_1/s_2, efecto SHIELD (XaFx 20),
  no suman combo ni chispa; cada bloqueo carga `guardHits` (se descarga 0.4/s) y el 4º rompe la guardia. Los golpes fuertes pasan.
- Salida de balas: cada fotograma de pistola/cañón lleva `mz` (boca medida sobre los sheets, `research/muzzle.py`; héroe ≈(26,-17),
  jefe ≈(36,-66)·0.62). `Fight.shoot/shootFan` usan `frame.mz` y espejan según el facing.
- Muertes: héroe = pose de golpe, explosión HERO_DEATH + player_death + temblor, desaparece y muere (`XaHero_Dead`, acciones
  `XaSpark`/`Hide`); jefe = BOSS_DEAD + explosiones encadenadas + temblor + cámara lenta.
- IA: nuevas situaciones (TargetAttacking, TargetAirborne, TargetOffDepth, LowLife, TargetBehind) y reacciones (AlignDepth, JumpAway).
  El héroe se cubre ante ataques/cercanía, salta lejos de los problemas, se alinea en profundidad para disparar y se retira con poca vida;
  el jefe se alinea en z, dispara a quemarropa o contra objetivos en el aire.

## Ronda 9 — estrellas ninja (2026-10-06)
- El jefe XA ya no hace daño al tocarlo (se quitó el hit de contacto; Mina es sobre todo cuerpo a cuerpo).
- Power-up de nivel bonus: una estrella dorada aparece en el mapa (a los 4 s y luego cada 10 s si no hay ninguna ni poder activo; dura 14 s
  en el suelo) y al tocarla Mina tiene 20 s de estrellas (`Fighter.stars`, icono + barra bajo la de poder). Con el botón especial (4)
  lanza una estrella (`Mina_StarThrow`, control `HasStars` al frente de `Mina_Control`).
- Animación reutilizada: 7000 = FastAttack (1000) sin el arco del tajo (frames 0,1,1,6; mano en frame.mz). La estrella sale pequeña (x0.5) y
  crece en 0.15 s, gira en vuelo, se inclina en z hacia el enemigo más cercano del frente; daño 10 (jefe: mitad por armadura), suma combo.
- Sprites 8-bit: `tools/build_star.py` rasteriza `tools/star-source.svg` (SVG Repo), máscara de 1 bit, aplanada a 16x16 / 22x22 con paleta
  fija (contorno oscuro + 3 tonos, luz arriba-izquierda), 4 cuadros de giro -> `public/assets/bonus/star.png`, `data/star.json`.

## Ronda 10 — lanzamiento con W/Q (2026-10-06)
- Mientras dura el poder, W (botón 2) y Q (botón 1) lanzan la estrella en la dirección en que mira Mina (control `StarThrow` por delante
  de los ataques). Animación = la de FastAttack (1000) completa, sin hits; la estrella sale de la mano al llegar al frame 2 (mz = 32,-21).

## Ronda 11 — enemigos que caían al terminar la fase (2026-10-06)
- Bug: en BossMode los extras seguían apareciendo (1 por segundo) mientras el jefe moría (life 0 pero aún sin `dead`), y al pasar a
  `cleared` se les mataba nada más caer, con el cartel de la fase siguiente en pantalla. Ahora un jefe con life 0 cierra la oleada
  (`clear()`) y no entra ningún luchador nuevo; en TimeMode tampoco se genera uno en el mismo tick en que se acaba el tiempo.

## Ronda 12 — VS y Online (2026-10-08)
- Menú: entrada **VS y Online** (8 entradas; con más de 7 la separación baja a 20 px para que entren bajo el título) -> submenú (Coop Local,
  Crear sala Coop, Crear sala VS, Unirse con codigo). Las acciones `ui:*` abren el panel React `OnlinePanel` (lobby, selección de personaje con
  retratos sacados de los sprites del juego, fuente Press Start 2P).
- Motor: `Fight(levelKey, opts?)`. Sin `opts` todo igual que antes (modo `story`, un humano). Con `opts` (`FightOptions`): `mode` coop|vs, `players`
  (`PlayerSlot`: id, apodo, personaje, equipo, control p1|p2|remote), dificultad, `localId`. `Fight.humans`/`local`/`mode`/`difficulty`; el combo y el
  objetivo pasan a `Fighter.combo`/`comboTarget` (la HUD usa `fight.local`). Nivel VS = `vsLevel` (arena, oleada `VsMode` sin enemigos, gana el
  último equipo con alguien vivo). Coop = `normalLevel` con escalado (`scaleList`, `activeEnemies`, vida de jefes), tope de 10 enemigos en pantalla y
  8 acompañantes de jefe, los caídos vuelven entre oleadas (mitad de vida) y los vivos recuperan un cuarto; se pierde cuando caen todos.
- Entrada: `Profile` p1/p2 (`input.ts`); P2 = IJKL + U O P , N M. `UserPad(KeySource)`; `RemoteSource` (host) reconstruye pulsaciones desde
  máscaras `{m, tp}` (mantenidas / pulsadas desde el último paquete); `PadSampler` (invitado) las genera. Escribir en un campo de texto no mueve el juego.
- Red (backend `svnz-backend`, repo aparte): anfitrión-autoritativo. El anfitrión simula y manda `Snap` 30 veces por segundo (`online/sync.ts`:
  luchadores con posición, anim, frame, vida, banderas; chispas y sonidos nuevos; combo por jugador); el invitado mantiene un `Mirror` (Fight con
  `mirror=true`) que interpola posiciones entre snapshots y copia animaciones. Sonidos: `setSoundTap` en `audio.ts`.
- Verificado en el navegador con el backend real y dos pestañas: crear sala, invitación `?room=`, unirse, elegir personaje, listo, empezar, controles
  del invitado moviendo a su personaje en el anfitrión, espejo en el invitado (nombres, barras de compañeros), VS 8 jugadores, victoria por abandono,
  vuelta al lobby con el resultado, coop de 4 (conteos de oleadas y vida de jefes), reanimación entre oleadas, modo historia sin cambios.
- Limitaciones: la pestaña del anfitrión debe estar visible (rAF); el invitado ve su personaje con la latencia al anfitrión; sin predicción.

## Ronda 13 — VS todos contra todos, vidas, power-ups, XA, sesiones y colores (2026-10-08)
- **VS = todos contra todos (máx. 4)**, no por equipos: cada jugador es su propio equipo (`team = id + 1`). Cada uno tiene `stocks` (3 vidas por defecto,
  1-3 a elección del anfitrión): al morir `killFighter` resta una vida, rellena la vida y programa `respawn` (1,8 s, `respawnPlayer`: sitio al azar, vida llena,
  parpadeo e invulnerabilidad 2,5 s); sin vidas `out`. `Fighter.alive` = no eliminado y (vida > 0 o vidas > 1). Gana el último con `alive`.
- **HUD VS estilo Smash** (`drawVsBar`): tarjetas abajo (cara = retrato del personaje, nombre ≤ 10, barra de vida, corazones de `PowerUps` anim 12). En coop la
  vida va sobre la cabeza (`drawNameplate`: flecha del jugador local, iconos de efectos con barra de tiempo, nombre, barra de vida). Se quitó la lista de compañeros.
- **Power-ups** (`online/items.ts`, `Fight.updateItems/collect`): star, heart (solo coop), bolt, shield, fist, fang. `Fighter.buff {speed, shield, power, fang}` +
  `stars`; `damageMul`/`speedMul`/`onDealt` (robo de vida). La estrella para quien no es Mina se lanza con el botón especial (`starCd` 0,45 s). Ritmo: 1.º a los
  14-24 s y luego cada 20-36 s, uno en el mapa a la vez, nunca el mismo dos veces seguidas; el corazón tiene su reloj (8-14 s con alguien caído, luego 12-22 s) y
  revive a un caído con la mitad de vida (`revivePlayer`). Medido: 6 apariciones en 180 s. Duraciones: estrella 20 s, rayo 12, escudo 10, fuerza 12, colmillo 12.
- **Sprites** (`tools/build_powerups.py`): mismas reglas que la estrella (máscara de 1 bit, contorno + 3 tonos, luz arriba a la izquierda) desde SVG:
  `heart-source.svg` y `bolt-source.svg` (SVG Repo, aportados por el usuario) y `shield-/fist-/fang-source.svg` (dibujados para el proyecto; en el SVG el blanco
  pinta el tono claro y el rojo el contorno). Los de contorno se rellenan (`fill_holes`). 4 cuadros: la estrella gira, los demás llevan un destello que cruza.
  Hoja `public/assets/bonus/powerups.png` + `src/svnz/data/powerups.json` (`PowerUps`, anim 1-6 = tipo, 11-16 = icono 12x12).
- **XA en VS** (`roster.ts`: `vsOnly`, `dmg`, `noArmor`): Hero 200 de vida y daño ×0,8; Boss 260 y ×0,65 sin armadura. En coop no se pueden elegir (cliente y servidor).
- **Colores** (`online/variants.ts`): hasta 4 por personaje = paletas de la hoja; `paletteOf(char, v)`; único por personaje en la sala (servidor: `setVariant`,
  `taken`). El selector muestra los bloqueados con el nombre de su dueño. El panel se rediseñó con el aspecto del menú del juego (paneles oscuros, marcos azules
  discontinuos, barra marrón/dorada de selección, título rojo, Press Start 2P).
- **Red:** el snapshot ahora lleva proyectiles (`pj`, se extrapolan entre snapshots), los tiempos de los efectos (`bt`, el invitado los descuenta localmente), los
  objetos del mapa y las vidas. Antes el invitado no veía los proyectiles hasta que golpeaban.
- **Sesiones** (servidor + `online/net.ts`): `sid` secreto guardado en `sessionStorage`; `resume`; reconexión automática con retroceso; asiento reservado 45 s;
  volver con código + apodo; el anfitrión que recarga en plena partida termina la partida (`end` abortado) y los asientos siguen; `peer` avisa al anfitrión.
- **Bug encontrado y corregido en las pruebas:** al recargar, el lobby se pintaba antes de cargar los datos y React se caía (`makeDesc` sin datos): ahora el panel
  de reanudación espera `game.whenReady()` y `portrait()` devuelve vacío si no hay datos.
- **Verificado** en el navegador integrado con el backend real y 4 pestañas (anfitrión + 3 invitados, uno con viewport móvil `?touch=1`): colores únicos,
  partida de 4, proyectil visible en el invitado, temporizadores, corte de socket del anfitrión y del invitado móvil (reconexión automática y la partida sigue),
  recarga del anfitrión en plena partida (vuelven todos al lobby), recarga del invitado. No probado: teléfono físico, cuatro navegadores distintos, red móvil real.
