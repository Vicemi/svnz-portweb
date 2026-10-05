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
