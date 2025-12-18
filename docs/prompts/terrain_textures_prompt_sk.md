# Prompt na generovanie terénnych textúr pre Spellcross‑like izometrický renderer

Úloha pre AI generátor textúr: vygeneruj 8 bezšvových (seamless) PNG textúr pre povrchy terénu. Tieto textúry budú použité ako jemný detailový „overlay“ nad jednofarebnou bázou (tón podľa palety terénu), preto musia byť vhodné na alpha‑kompozíciu bez zmeny celkovej farby.

## Kontext renderera
- Projekcia: izometrická, 2D, PixiJS.
- Každá dlaždica má jednofarebnú bázu (podľa typu terénu) a navrchu sa renderer vyplní **dlaždicovou textúrou** (tile fill) s **alpha ≈ 0.28** (viditeľná), resp. **0.16** v hmle.
- Overlay sa kreslí ako bežný alfa‑blend (nie multiply). Preto je kritické, aby textúra sama o sebe **nebola farebná** – ideálne je **transparentné pozadie** a tmavšie (alebo neutrálne sivé) „znaky“/detaily.
- Osvetlenie/tieňovanie terénu rieši renderer sám (smerové steny, svahy, atď.). Textúry musia byť **bez akéhokoľvek „baked lighting“**.

## Technické požiadavky
- Formát: PNG (RGBA, sRGB), 8‑bit, bez metadát.
- Rozmery: 32×32 px (ak máš lepší zdroj, dodať aj 64×64; primárne však 32×32). Musí byť bezšvová (tileable) v oboch smeroch.
- Pozadie: **úplne transparentné** tam, kde nemá byť žiadny detail.
- Obsah: **odtiene sivej/čiernej** (nepoužívaj farebné pixely). Cieľ je len lokálne stmavenie/zosvetlenie detailu nad farebnou bázou.
- Kontrast: skôr jemný (žiadne ostré „tvrdé“ škvrny, ktoré by preblikávali). Vyhni sa výraznej periodickosti a moiré efektu.
- Antialiasing: jemný, ale udrž rovnováhu – malé znaky by nemali byť rozmazané do „blata“.
- Žiadne nápisy, symboly, logá, text.

## Názvy súborov a umiestnenie
- Budú sa hľadať v ceste: `apps/web/public/textures/terrain/`
- Názvy (povinné):
  - `plain.png`
  - `road.png`
  - `forest.png`
  - `urban.png`
  - `hill.png`
  - `water.png`
  - `swamp.png`
  - `structure.png`
- Voliteľné varianty na rozbitie patternu (ak bude generátor vedieť): `plain_0.png … plain_3.png` (rovnako pre ďalšie terény). Ak je variantov viac, základný súbor aj tak ponechaj.

## Paleta (len informačne – textúry majú byť neutrálne)
Renderer má farebnú paletu pre bázu (hex):
- plain:    #2F4F4F
- road:     #566573
- forest:   #145214
- urban:    #5E5B70
- hill:     #4F614F
- water:    #143464
- swamp:    #3D5E4A
- structure:#6F5F4F

Textúry nemajú tieto farby duplikovať – budú len jemne stmavovať/štruktúrovať.

## Špecifikácia vzorov podľa terénu
Všetky vzory musia byť bezšvové a „low‑noise“ (žiadna agresívna perioda). Používaj transparentné pozadie + sivé/čierne detaily.

1) plain (tráva/lúka)
- Jemný šum z drobných bodiek a krátkych tenkých „steeblov“ (pixlové prúžky) s nízkou hustotou.
- Zmes 2–3 úrovní jasu (tmavšia, stredná, veľmi jemná). Vyhni sa makro‑štruktúre.

2) road (cesta)
- Jemná longitudinalna textúra: drobná zrnitosť, mikro‑ryhy v smere jazdy, veľmi mierne „vyjazdené“ stopové body.
- Bez ostrých hrán; nie okraje cesty (tie rieši level design), len vnútorný povrch.

3) forest (lesný pôdny kryt)
- Organický šum: drobné lístie/ihlina/triesky – malé, zaoblené tvary s miernou variabilitou veľkosti.
- O chlĺpok „špinavšie“/hustejšie než plain, ale stále jemné.

4) urban (mestský povrch)
- Neutrálny „betón/asfalt“ mikro‑šum, jemné hranaté mikrotvary (póry), prípadne veľmi jemná textúra jemne pripomínajúca drobný kameň.
- Bez viditeľných spojov/škár (žiadna mriežka dlažby – to by blikalo).

5) hill (skalnato‑trávnaté vyvýšeniny)
- Nepravidelné „šupiny“/zhluky bodiek a krátkych ťahov, o trochu kontrastnejšie než plain.
- Stále jemné; žiadne veľké smery alebo pásy.

6) water (vodná hladina)
- Jemné, drobné „ripples“ – kratučké vlnovky/oblúčiky, rovnomerne rozptýlené.
- Bez výrazných svetlých škvŕn; skôr veľmi jemné stmavenie v mikro‑vzoroch.

7) swamp (močiar)
- Blotchy (fľakaté) organické fliačiky + drobný šum, mierne hustejší než forest.
- Vyhni sa výrazným „krúžkom“/okám – skôr malé nepravidelné škvrny.

8) structure (umelý povrch / budovy)
- Jemný priemyselný mikro‑šum (betón/omietka/kompozit) bez pravidelného šrafovania.
- Neutrálny, mierne tvrdší než urban, ale stále jemný.

## Kvalitatívne kritériá (akceptácia)
- Seamless v oboch osiach (žiadny viditeľný spoj na 32 px hranách).
- Bez farebného posunu – iba sivá/čierna + transparentné pozadie.
- Bez „baked“ tieňov a smerového svetla.
- Detaily sú malé, no čitateľné pri 1× zobrazení (žiadne výrazné „blob“ plochy).
- Žiadna opakujúca sa perioda, ktorá by vytvorila mriežku pri tilingu.

## Dodanie
- 8 PNG súborov (prípadne aj 64×64 varianty, voliteľne).
- Voliteľné: 2–4 varianty na terén (suffix _0…_3) pre rozbitie repeticie.
- Nezabaliť do atlasu; dodať samostatné súbory s presnými názvami.

---
Zhrnutie: vytvor neutrálne, jemné, bezšvové grayscale detailové overlay textúry s transparentným pozadím pre 8 typov terénu. Žiadne farby, žiadne „baked“ svetlo, žiadne výrazné periodické vzory. Súbory pomenuj podľa sekcie „Názvy súborov a umiestnenie“.
