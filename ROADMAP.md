# Roadmap — priorytety dalszego rozwoju

Stan: po „update'cie progresji" (poziomy/punkty, crafting, mikstury+buffy, audio,
pochodnie, nocne i jaskiniowe moby, łucznicy, struktury, nagrobek, minimapa,
totem odrodzenia, Róg przyzwania) oraz refaktorach rozszerzalności
(rejestr statusów, rejestr źródeł modyfikatorów, centralny `damageHero`,
rejestr zasobów — patrz „Extension Points" w README).

**Fabuła domknięta**: pełny łuk „Warstwy Symulacji" od tutorialu do finału —
Zachód/Wschód → Trzeci Kret → Wieża Ambicji/Niebo (fałszywy finał) → Centrum
(Guardian Macierzysty: mimik gracza z odwróconymi obrażeniami — cios rani
zadającego; zwycięstwo przez przyjęcie ciosu) → epilog. Cele zawsze diegetyczne
(story_progression.js: beaty świata + zadania ze wskaźnikami), patrz „Story Arc"
w README.

## Tier 1 — ✅ ukończone
1. ~~**Tylna warstwa bloków (backwall)**~~ ✅ done — warstwa `constructionBackground`
   (tryb budowy tła, ghost preview, zapis + tombstony nad generowanym tłem miast).
2. ~~**Handlarz NPC**~~ ✅ done — `engine/trader.js`: wędrowny kramarz co 2–3 dni
   (kram z markizą na powierzchni), UI wymiany w main.js (kupno pochodni/mikstur/
   strzał/skrzyni epickiej, skup surowców), waluta = diament, asortyment losowany
   per wizyta (seed świata), kontrakt anty-arbitrażowy przypięty testem
   `npm run test:trader`; persystencja przez rejestr NPC.
3. ~~**Oświetlenie jaskiń**~~ ✅ done — `engine/lighting.js`: okienkowy grid światła
   0..15 (skylight skan kolumnowy + BFS od pochodni/lawy/ognia/skrzyń, ściany
   światłoszczelne), overlay 1px/kafel blitowany z wygładzaniem; pochodnie mają
   realną funkcję, PEŁZACZE spawnują tylko w mroku (`lightAt > 0.25` blokuje);
   test `npm run test:lighting`, QA `node tools/lighting-trader-qa.mjs`.

## Tier 2 — następne w kolejce
4. **Konfiguracja klawiszy + ekran tytułowy/pauzy z ustawieniami** (głośność,
   minimapa, język). Fundament pod i18n (PL/EN).
5. ~~**Podziemne biomy**~~ ✅ done — `world.js applyUndergroundBiomeDressing`
   (pass addytywny przed miastami/ruinami, czysty per-komórka): biom śnieżny
   szroni ściany jaskiń w LÓD (tylko STONE — warstwy granitu/bazaltu/węgla
   nietknięte) + sople; lasy/bagna dostają ŚWIECĄCE GRZYBY (kafel 75, emiter
   światła 9 → komory jarzą się w mroku, zbiór → zupa grzybowa +25 HP).
   Test `npm run test:underground-biomes`.
6. ~~**Boss przyzywany rytuałem na arenę**~~ ✅ done — `engine/altar.js` +
   struktura w `world.js placeStructures` (~1,4% chunków): obsydianowy Ołtarz
   Przyzwania z pochodniami (żarzy się w mroku przez lighting), klik z ofiarą
   3💎+3 obsydian wzywa GARGANTUICZNEGO bossa (stos epickich skrzyń po
   pokonaniu); cooldown 1 dzień/ołtarz, nieudany rytuał zwraca ofiarę.
   Test `npm run test:altar`, QA `node tools/altar-qa.mjs`.
7. ~~**Wędkarstwo**~~ ✅ done — `engine/fishing.js`: wędka (craft: drewno+trawa),
   F zarzuca do najbliższej wody, branie (❗) w oknie reakcji, duże ryby szarpią
   2–3 razy (za wczesne F płoszy); ryby → zupa rybna (+30 HP), złota rybka →
   Eliksir głębin, handlarz skupuje połów; XP za połów. Test `npm run
   test:fishing`, QA `node tools/fishing-qa.mjs`.

## Tier 3 — horyzont
8. ~~**Pory roku**~~ ✅ done — `engine/seasons.js`: pełny cykl wiosna/lato/
   jesień/zima (jesienne liście, sezonowe zwierzęta-okazy z trofeami,
   mnożniki spawnów, zimowe zamarzanie), test `npm run test:seasons`.
9. **Tryb hardcore** (nagrobek = pełny drop, jedno życie) i **tryb kreatywny**
   (obecny god mode rozszerzony o paletę wszystkich kafli).
10. **Współdzielenie świata** — eksport/import zapisu już istnieje; dodać
    udostępnianie przez URL (kompresja do fragmentu adresu).

## Zasady
- Każda nowa mechanika przechodzi przez istniejące rejestry (statusy, źródła
  modyfikatorów, zasoby, receptury) — jeśli nie pasuje, najpierw poszerz rejestr.
- Symulacje pozostają testowalne w Node (`tools/*-sim.test.mjs`); nowy system
  = nowy deterministyczny test w `npm run check`.
- Wizualia weryfikowane headless screenshotami (patrz memory: rAF pod
  virtual-time głodzi zdarzenia probabilistyczne — logika zawsze w testach Node).
