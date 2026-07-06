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

## Tier 1 — następne w kolejce
1. **Tylna warstwa bloków (backwall)** — umożliwia budowę domów z wnętrzem.
   Wymaga: drugiej tablicy na chunk (format zapisu v6 + migracja), pasa
   renderowania za bytami, trybu stawiania (np. Shift+PPM), zbierania.
   Największy pojedynczy zysk dla ekspresji budowania.
2. **Handlarz NPC** — zlew na surowce i cel dla diamentów: wędrowny kramarz
   (spawn jak struktura/moby), UI wymiany (kupno mikstur/skrzyń/pochodni za
   diamenty), waluta = diament. Daje gospodarce domknięcie.
3. **Oświetlenie jaskiń** — prosty grid światła (BFS od pochodni/lawy/powierzchni,
   promień ~8) zaciemniający niewidoczne podziemia zamiast obecnego backdropu;
   pochodnie zyskują funkcję, PEŁZACZE czają się w mroku.

## Tier 2 — wkrótce potem
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
