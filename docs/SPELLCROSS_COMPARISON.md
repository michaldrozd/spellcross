# Porovnanie: Spellcross Remake vs. Originál

Tento dokument porovnáva našu implementáciu s originálnym GDD.

---

## ZHRNUTIE

| Kategória | Stav | Kompletnosť |
|-----------|------|-------------|
| **Strategická vrstva** | Implementované | 75% |
| **Taktická vrstva** | Implementované | 80% |
| **Jednotky & Frakcie** | Implementované | 85% |
| **Bojové mechaniky** | Implementované | 70% |
| **AI** | Implementované | 60% |
| **Audio/Vizuál** | Čiastočne | 40% |

---

## 1. STRATEGICKÁ VRSTVA

### Implementované ✅

| Feature | Originál | Náš Remake | Poznámka |
|---------|----------|------------|----------|
| Mapa regiónov | ✅ | ✅ | Máme mapu Európy s 17 teritóriami |
| Zdroje (Money) | ✅ | ✅ | `resources.money` |
| Zdroje (Research) | ✅ | ✅ | `resources.research` |
| Strategické body | ✅ | ✅ | `resources.strategic` |
| Výber jednotiek do misie | ✅ | ✅ | Deployment screen |
| Brífing | ✅ | ✅ | `scenario.brief` |
| Territory timers | ✅ | ✅ | `remainingTimer` na každom teritóriu |
| Nákup jednotiek | ✅ | ✅ | Recruit v Army management |
| Výskum (Tech Tree) | ✅ | ✅ | 9 research topics |
| Oprava/Heal jednotiek | ✅ | ✅ | Refill button |
| Tiery jednotiek | ✅ | ✅ | rookie/veteran/elite |
| Ukladanie (Save) | ✅ | ✅ | 3 save sloty |

### Čiastočne implementované ⚠️

| Feature | Originál | Náš Remake | Čo chýba |
|---------|----------|------------|----------|
| Resource Slider | ✅ | ❌ | Slider pre Money/Research ratio |
| Vyčerpateľné zdroje | ✅ | ❌ | Zdroje z regiónov neklesajú |
| Velitelia (Officers) | ✅ | ⚠️ | Máme heroes, ale nie attachment system |
| Formácie | ✅ | ⚠️ | Data struct existuje, UI chýba |
| Convert jednotky | ✅ | ❌ | Zmena typu jednotky |
| Upgrade jednotky | ✅ | ❌ | Lepšia výstroj |
| Čas na recruit | ✅ | ⚠️ | `availableOnTurn` existuje, nie je aktívne |

### Chýba ❌

| Feature | Popis |
|---------|-------|
| FMV videá | Cutscenes medzi misiami |
| "Slepý" výskum | Hráč vie čo odomkne |
| Vyčerpávanie zdrojov | Strategické body z regiónov by mali klesať |

---

## 2. TAKTICKÁ VRSTVA

### Implementované ✅

| Feature | Originál | Náš Remake | Poznámka |
|---------|----------|------------|----------|
| Izometrická mriežka | ✅ Square | ✅ Hex | Používame hex grid (modernejšie) |
| Terén: Road | ✅ | ✅ | `movementCostModifier: 0.8` |
| Terén: Forest | ✅ | ✅ | Cover + movement cost |
| Terén: Hills | ✅ | ✅ | Elevation + vision boost |
| Terén: Swamp | ✅ | ✅ | High movement cost |
| Terén: Water | ✅ | ✅ | Impassable |
| Terén: Urban | ✅ | ✅ | High cover |
| Destructible terrain | ✅ | ✅ | `destructible: true, hp: X` |
| Fog of War | ✅ | ✅ | `VisionGrid` s explored/visible |
| Action Points | ✅ | ✅ | `actionPoints` na jednotke |
| Experience/Level | ✅ | ✅ | XP za zásah/kill, level up |
| Morale | ✅ | ✅ | Klesá/stúpa, ovplyvňuje stance |
| Stance (ready/suppressed/routed) | ✅ | ✅ | Podľa morale |
| Entrenchment (zakopanie) | ✅ | ✅ | 0-3 level, rastie keď unit stojí |
| Ammunition | ✅ | ✅ | `currentAmmo`, `ammoCapacity` |
| Transport/Embark | ✅ | ✅ | `transportCapacity`, `carrying`, `embarkedOn` |
| Supply zones | ✅ | ✅ | `supplyZones` pre doplnenie ammo |
| Weather | ✅ | ✅ | clear/night/fog |
| Mission objectives | ✅ | ✅ | eliminate/reach/protect/hold |
| Turn limits | ✅ | ✅ | `turnLimit` na objectives |

### Čiastočne implementované ⚠️

| Feature | Originál | Náš Remake | Čo chýba |
|---------|----------|------------|----------|
| Opportunity Fire | ✅ | ⚠️ | Overwatch existuje, ale nie automatická reakcia |
| Damage scaling (HP) | ✅ | ⚠️ | Damage neklesá s HP jednotky |
| Attack Matrix | ✅ | ⚠️ | Máme `weaponTargets`, ale nie vs Light/Heavy/Air/Objects |
| Radar units | ✅ | ❌ | Nie je Deploy/Pack mechanika |
| Line of Sight blocking | ✅ | ✅ | Implementované, ale môže byť lepšie |

### Chýba ❌

| Feature | Popis |
|---------|-------|
| Initiative test pre Opportunity Fire | Skúsenosti/iniciatíva pre reaction fire |
| Strength = Damage output | Menej HP = menej damage |
| Limitované ukladanie | 6 slotov na misiu (Ironman mode) |
| Ambush triggers | Spawn nepriateľov na trigger |
| Reinforcements script | Nové jednotky počas misie |
| Fake Loss misie | Misie kde musíš ustúpiť |

---

## 3. JEDNOTKY A FRAKCIE

### Alliance (Hráč) ✅

| Originál | Náš Remake | ID |
|----------|------------|-----|
| Light Infantry | ✅ Light Infantry | `light-infantry` |
| Heavy Infantry | ✅ Storm Squad | `heavy-infantry` |
| Mortar Team | ✅ Mortar Team | `mortar-team` |
| Commandos | ⚠️ Rangers (podobné) | `rangers` |
| Sniper Team | ✅ Pathfinder Snipers | `sniper-team` |
| Hummer (scout) | ⚠️ M113 (má transport) | `m113` |
| APCs | ✅ M113 IFV | `m113` |
| Tanks | ✅ Leopard 2 MBT | `leopard-2` |
| Artillery M109 | ✅ M109 SPG | `spg-m109` |
| Radar trucks | ❌ | - |
| Helicopters | ✅ Attack Helicopter | `attack-helo` |
| Field Medic | ✅ Field Medic | `field-medic` |
| Supply Truck | ✅ Supply Truck | `supply-truck` |
| AA (Gepard) | ✅ Gepard AA | `gepard-aa` |
| SAM | ✅ Sky Lance SAM | `sky-lance` |
| Heavy Artillery | ✅ Paladin ACS | `paladin-acs` |
| Hero/Commander | ✅ Captain John Alexander | `john-alexander` |

### The Other Side (Nepriateľ) ✅

| Originál | Náš Remake | ID |
|----------|------------|-----|
| Orcs | ✅ Orc Warband | `orc-warband` |
| Wolf Riders | ❌ | - |
| Undead/Skeletons | ⚠️ Specter (podobné) | `specter` |
| Golems | ✅ Ogre Brute | `ogre-brute` |
| Magotars (flying scout) | ✅ Winged Fiend | `winged-fiend` |
| Hell Riders | ❌ | - |
| Necromancers | ✅ Necromancer | `necromancer` |
| Warlocks | ✅ Warlock | `warlock` |
| Dragons | ✅ Void Drake | `void-drake` |
| Demon Engine | ✅ Demon Engine | `demon-engine` |
| Salamander | ✅ Salamander | `salamander` |
| Ghouls | ✅ Ghoul Pack | `ghoul-pack` |
| Lich | ✅ Lich Lord | `lich-lord` |
| Arrow Towers | ❌ | - |
| Fortress of Terror | ❌ | - |

---

## 4. AI

### Implementované ✅

| Feature | Popis |
|---------|-------|
| Prioritizácia cieľov | Heroes, transport, artillery majú vyššiu prioritu |
| Pathfinding | A* s terrain cost |
| Attack decision | Najlepšia zbraň + šanca na zásah |
| Demolition targeting | AI ničí destructible terrain |
| Movement toward enemies | Pohyb k najbližšiemu nepriateľovi |
| Supply action | AI jednotky môžu zásobovať |

### Chýba ❌

| Feature | Popis |
|---------|-------|
| Difficulty levels | Len jeden level AI |
| Formation movement | Skupinový pohyb |
| Retreat behavior | AI neustupuje |
| Magic/Spell casting | Špeciálne schopnosti |
| Ambush tactics | Čakanie na hráča |

---

## 5. UI/UX

### Implementované ✅

- Main menu so save slotmi
- Strategic HQ s mapou
- Army management (recruit, refill, dismiss)
- Research tree
- Territory selection s brífingom
- Tactical battle UI
- Unit selection panel
- Attack confirmation
- Combat log
- End turn button
- Retreat button

### Čiastočne implementované ⚠️

| Feature | Čo chýba |
|---------|----------|
| Hit chance display | Ukázať % pri mierení (nie len v paneli) |
| Damage preview | Predpokladaný damage pri mierení |
| Formation movement | UI pre pohyb skupiny |
| Turbo mode | Zrýchlenie animácií nepriateľa |
| Tooltips | Vysvetlenia mechaník |

### Chýba ❌

- Kovový/industriálny UI vzhľad (originál)
- Zelené monochromatické displeje
- Detailed unit info popup
- Mini-tutoriál

---

## 6. AUDIO

### Chýba ❌

- Zvuky zbraní
- Zvuky monštier
- Ambient hudba
- UI zvuky
- Dabing/hlasy

---

## PRIORITNÝ ZOZNAM NA DOPLNENIE

### Vysoká priorita (Core gameplay)

1. **Opportunity Fire (Reaction)** - Automatická paľba pri pohybe nepriateľa
2. **Strength = Damage** - Menej HP = menej damage output
3. **Hit chance display** - Ukázať % priamo na mape pri mierení
4. **Difficulty levels** - Easy/Normal/Hard pre AI

### Stredná priorita (Polish)

5. **Wolf Riders & Hell Riders** - Chýbajúce enemy jednotky
6. **Resource slider** - Money/Research allocation
7. **Formation bonus UI** - Zobrazenie a úprava formácií
8. **Turbo mode** - Zrýchlenie AI ťahu

### Nízka priorita (Nice to have)

9. **Audio** - Zvuky a hudba
10. **Radar Deploy/Pack** - Špeciálna mechanika pre radar jednotky
11. **Arrow Towers** - Statické obranné veže
12. **Ironman mode** - Limitované ukladanie

---

## ZÁVER

Náš remake má **solídny základ** a pokrýva väčšinu core mechaník originálnej hry:

- ✅ Strategická vrstva funguje dobre
- ✅ Taktický boj je funkčný
- ✅ Väčšina jednotiek je implementovaná
- ✅ Základná AI funguje

Hlavné oblasti na zlepšenie:
- ⚠️ Opportunity Fire systém
- ⚠️ Damage scaling podľa HP
- ⚠️ UI feedback (hit chance, damage preview)
- ❌ Audio úplne chýba

Celkovo je hra **hrateľná a zábavná**, ale na plné priblíženie sa originálu treba ešte dopracovať uvedené featury.
