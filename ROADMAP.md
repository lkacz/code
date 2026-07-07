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
5. **Podziemne biomy** — jaskinie lodowe / grzybowe komory (warianty caveAt
   per biom, nowe rośliny grzybowe przez rejestr PLANTS).
6. **Boss przyzywany rytuałem na arenę** — Róg już jest; wariant „ołtarz" w
   ruinach przyzywający wzmocnionego bossa z gwarantowanym epickim łupem.
7. **Wędkarstwo** — woda jest wszędzie; prosta minigra rytmiczna, ryby jako
   żywność (heal) i składnik mikstur.

## Tier 3 — horyzont
8. **Pory roku** — temperatura już steruje biomami; sezonowy offset zmienia
   śnieg/roślinność/zachowanie mobów.
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
