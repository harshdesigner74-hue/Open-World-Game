# INDIA: OPEN WORLD

A browser-based, real-time 3D open-world game set in a real-world-inspired New Delhi.
Built with React + TypeScript + Three.js (React Three Fiber) + Rapier physics + Zustand.

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # production build in dist/
```

Click into the game to capture the mouse. Chrome / Edge / Safari with WebGL2 recommended.
On phones and tablets on-screen touch controls appear automatically (add `?touch=1` to the URL to force them on a desktop).

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move (camera-relative) |
| Mouse | Look around |
| Shift | Sprint (drains stamina) |
| Ctrl / Alt | Walk slowly |
| Space | Jump |
| E | Interact: buy chai/food/fruit/paan, ATM, sit on benches, metro, read plaques, talk to people |
| C | Cycle camera: shoulder → far → first-person |
| Mouse wheel | Camera distance |
| M | World map (scroll zoom, drag pan, click = waypoint, right-click = clear) |
| Tab | Character menu (stats, money, outfit colours) |
| Esc | Pause (resume, map, character, settings, save, exit) |
| F | Enter / exit a vehicle |
| W S · A D (driving) | Throttle, brake/reverse · steer |
| Space · H (driving) | Handbrake · horn |
| J | Jobs board |
| P | Phone (contacts, call friends over, messages) |
| E / Space / click (in a conversation) | Next line of story dialogue |

**Touch:** drag the left side of the screen for the movement joystick (push it all the way to run; when driving it is throttle and steering). Drag the right side to look. The buttons are JUMP/BRAKE, CAR (F), E (when a prompt is shown), RUN/HORN, and MAP, JOBS, CAM and menu at the top.

## Campaign order (current)
A new game now opens with the **relationship arc** (`src/game/story/love.ts`):
1. **Dil Ki Baat:** Maa calls, you meet Rohan, say hi to Ananya, Zoya, Ishita or Vikram, become friends, and make them notice you.
2. **Pehli Date:** your first date, telling Rohan about it, a second date, then asking them to be your girlfriend or boyfriend (Maa calls).
3. **Rishta Pakka:** save ₹25,000, buy the ring, propose, and Rohan's shaadi fund.
4. **Shaadi Mubarak:** the wedding, then Rohan calls.
5. After that come the city-life chapters: **Naya Shehar**, then **Apni Gaadi**, then **Agla Station**.

Saves from before this change restart at the new chapter 1. Every story step pays a reward, so you can afford dates and the ring without endless grinding.

### Smoothness
- World streaming builds at most one chunk per frame (a chunk takes 4–9 ms to build). Previously it could stack several in one frame while you sprinted or drove, which caused the stutter on roads.
- The camera's collision ray ignores traffic and pedestrians, so it no longer snaps in and out when cars pass. Its height also eases over kerbs.
- Measured while driving fast through Delhi: a steady 60 fps, worst frame 17 ms, 0 dropped frames. Before the fix, 114 frames went over 33 ms.

## Update — visual pass 2 + relationships

### Less blocky, more detailed
- **People:** the crowd and the named characters have new bodies. Torsos are shaped on a lathe (a separate female silhouette), limbs are rounded with joints, shoes are rounded, and long hair falls to the shoulders. Faces are textured (eyes, brows, nose, lips) and tinted to each person's skin tone.
- **Buildings:** real 3D façade detail lines up with the painted windows: chajjas (sunshades), balconies with railings, AC units, window sills, cornices and floor bands on colonial and government blocks, mullion fins on glass offices, and coloured awnings over shopfronts.
- **Ground:** photo-scanned CC0 materials from ambientCG (asphalt, paving stones, grass) with normal maps, blended by surface type (see `public/assets/textures/CREDITS.txt`).
- **Grass:** swaying instanced grass blades on real park lawns, in a ring around the player (Medium/High quality only).

### Relationships (`src/game/social/`)
- **Original adult cast**, each with a job, hangout hours, likes and dislikes:
  - Love interests: Ananya (architect), Zoya (journalist), Ishita (doctor), Vikram (chef).
  - Friends: Rohan (your cousin), Meera (mechanic), Arjun (college friend), Kabir (DJ).
  - Everyone hangs out at a real spot in each city (a park, market, landmark, chai stall or petrol pump).
- **Friendship:** walk up and press E to talk. Topics land well or badly depending on what the person likes, and once you are friends their likes and dislikes are revealed. You can also give gifts (one per day), have chai together, watch the cricket together, and call friends over from your phone (P).
- **Friend challenges**, unlocked at friendship 40:
  - Arjun's timed race
  - Kabir's rush delivery
  - Rohan's chai run
  - Meera's test drive
- **Romance:** ask someone on a date (street food, sunset walk, movie, candle-light dinner, live music, or a long drive in your own vehicle). Each date has three conversation moments that are scored against their personality.
- **Milestones:**
  1. Ask them to be your girlfriend/boyfriend (after 2 good dates).
  2. Spend the night at your flat. This is a fade to black that cuts to the next morning; nothing explicit is shown.
  3. Buy a ₹25,000 ring and propose.
  4. Get married, either with a court ceremony or a big Indian wedding.
- **Rules:** you must stay faithful, since you can only date one person. Relationships fade if you vanish for days, partners text you when they miss you, and a neglected partner can break up with you.
- **Achievements:** Yaari Dosti, Pehli Date, Officially Official, Rishta Pakka, Shaadi Mubarak.

## Update — graphics, interiors, touch, story

### Cinematic graphics (GTA-style *techniques*, no Rockstar assets)
- A post-processing chain (`src/game/env/PostFX.tsx`): HDR half-float buffer, then bloom, then exposure, then ACES filmic tone mapping, then a colour grade (saturation, contrast, warm/cool split tone that changes with time of day), then a vignette, then SMAA (high) or FXAA (medium). You can switch it off in Settings ("Cinematic post-processing"). The low quality preset skips it.
- Image-based lighting: a gradient sky is baked with PMREM into `scene.environment`, so glass, car paint, water and wet roads reflect the sky. It re-bakes only when the sun or clouds change.
- A procedural fbm cloud layer driven by the weather system.
- Per-facade normal and roughness/metalness maps (reflective office glass), a ground detail normal, animated water normals and baked ambient occlusion at wall bases.
- New vehicle models: rounded bodies, glass cabins, alloy wheels, light clusters and glossy metallic paint.
- Leaf-card trees, plus palms in tropical cities (Mumbai, Chennai).

### Building interiors and the underground metro
- Enterable dhabas, general stores and clothes shops are generated from real OSM restaurant and shop POIs (fictional names). Buy a thali or snacks, or change clothes. **E** at the door enters; **E** at EXIT leaves.
- Flats for sale (₹1.5–3 lakh). Once bought, you can enter one and sleep until 7:00 AM, which saves the game.
- Metro entrances lead down to an underground platform with screen doors. A 4-car train arrives every 45 s; board it while it is in the station and ride to any station.
- Interiors are procedural rooms (`src/game/interiors/`). They are built off-map and the player is teleported into them, the way many open-world games handle interiors.

### Touch controls
`src/ui/TouchControls.tsx`: a floating joystick (`input.analog`, plus mapping to drive keys), drag-to-look, and buttons that send virtual key presses through the normal input path. There is also a compact HUD layout for small or landscape phone screens.

### Story campaign — "Naya Safar" (original)
Three chapters and 12 steps (`src/game/story/`). Locations are resolved from the live city, so the story works in any of the 10 cities:
1. **Naya Shehar:** meet your cousin Rohan at a chai stall, take a selfie at a landmark, finish your first job, then return to Rohan (₹500).
2. **Apni Gaadi:** buy a vehicle, visit Meera's roadside garage, finish two more jobs (₹1,500).
3. **Agla Station:** carry ₹5,000 cash, go to the railway counter, take a train to another city, then answer Rohan's phone call (₹2,500).

Talk steps use a letterboxed dialogue panel. Objectives get a HUD card and a map waypoint, and "reach" steps show a light beam. Progress is saved in `progress.story`.

### Flyovers and bridges (real OSM)
- `scripts/osm-import.mjs` now keeps `bridge=*` / `layer>=1` arterial roads (and long spans of any class). In OSM only the raised deck is tagged as a bridge, so the importer also pulls the straight-on approach ways (≤ 2 ways, ≤ 260 m) into the elevated set as ramps.
- Heights: a node that meets a ground road sits at grade. Elsewhere the deck rises along the road (smoothstep ramp of about 110 m) to 7.5 m (`layer=1`) or 13 m (`layer>=2`). Short bridges over drains on lanes stay at grade.
- `src/game/world/Flyovers.tsx` builds the asphalt deck with lane markings, concrete sides, parapets (opened up at branch and merge points), piers with cap beams every ~24 m, retaining walls on the low part of ramps, and deck lamps. It also adds sloped Rapier colliders for the deck, parapets and piers.
- Flyover edges join the road graph, so AI traffic drives over them (cars follow the deck height and pitch, and cars on different levels don't block each other). The player's vehicle has real gravity and pitches with the slope. Props are cleared from flyover footprints. You can't get out of a vehicle on a raised deck.
- Elevated road per city: Delhi 4.4 km (Shivaji Flyover, New Delhi Railway Station Flyover), Pune 8 km, Bengaluru 7 km, Chennai 5.3 km, Hyderabad 3.6 km, Kolkata 2.6 km, Gwalior 1.8 km, Chandigarh 1.7 km, Mumbai 0.5 km, Jaipur none.

### Real terrain backdrop
- `scripts/terrain-import.mjs` samples AWS Terrain Tiles (SRTM / GMTED / NED / ETOPO1, public, no key; tiles cached in `data/terrain/`) on a 60 m grid out to 5.2 km beyond each map. It removes building spikes and writes `public/data/<city>-terrain.json`.
- `src/game/world/Terrain.tsx` draws it with its own long-range haze, so the real hills frame each city: Jaipur's Nahargarh ridge (+195 m), the Chandigarh Shivalik foothills (+193 m), Pune's hills (+142 m), Hyderabad (+116 m), Gwalior's fort rock (+99 m), Mumbai's Malabar Hill and the sea.
- **The playable map itself is still flat** (y = 0). The relief inside the maps is only about 10–30 m, and making every system terrain-aware (roads, buildings, traffic, pedestrians, physics) is a much bigger change. The backdrop is visual only.

### Rendering fixes in this pass
- The analytic sky was replaced by a bounded gradient sky. It is the same model that lights the reflections, so the visible sky and the reflections match.
- Fixed the pale discs and arcs that sometimes showed in the sky. Causes: a clipped sky box, bloom on the sun's halo, a hard per-channel highlight clip, and the shader vignette, which now lives in a CSS overlay.
- Fixed black patches where overflowing specular highlights were turned into black.
- `runtime.vehicles` no longer goes stale after a city load. This restores traffic ambience audio and anything else that reads traffic positions.

### Still not done (honest list)
- The playable street grid is flat (see above). There are no tunnels or underpasses.
- Interiors are generic procedural rooms, not the real layouts of those buildings.
- Story characters are simple figures (no voice acting or cutscene animation).
- You can't park on a flyover, because parked vehicles live at ground level.

## Phases 3–6

### Phase 3 — Vehicles
- **Drivable vehicles:** every parked hatchback, sedan, SUV, scooter, motorcycle and auto-rickshaw in the city can be driven. Walk up, press **F**, and drive. Your character sits in cars and rides two-wheelers with a lean into turns.
- **Driving model:** arcade handling (acceleration, braking, reverse, handbrake, speed-dependent steering). Collisions use Rapier's shape-cast controller against buildings, parked vehicles and AI traffic.
- **Vehicle state:** impacts cause damage, fuel is used per km, and a car you leave stays parked where you left it.
- **Refuel and repair** at real OSM petrol pumps (press E while stopped).
- **Feel:** a chase camera, a speedometer HUD, a synthesised engine note, a horn, and a headlight at night.
- **People and traffic:** pedestrians jump out of your way (and complain in Hinglish), and AI traffic accounts for your vehicle's size.
- **Not done yet:** flyovers are still skipped (the world is flat), and there's no carjacking of moving AI traffic, by design.

### Phase 4 — Living city
- **Weather:** sunny, cloudy, rain, fog and thunderstorm, either automatic or picked in Settings. Rain is GPU particles that follow the camera. Streets turn wet and glossy, fog closes in, lightning flashes with delayed thunder, and rain has its own sound. Pedestrians thin out in the rain and walk under umbrellas.
- **Daily rhythm:** walker and traffic counts follow an hourly curve with morning and evening rush, quiet nights and busy evenings. Office workers dominate rush hour and families come out in the evening. Vendors set up at 6:30 and pack up at 23:30, police work 8:00–22:00, and benches empty at night.
- **Ambient life:** you overhear Hinglish conversations (cricket, petrol prices, the metro, rain, air quality), vendors call out to passers-by, and temple bells ring near Hindu temples.

### Phase 5 — Ten real cities
The same OpenStreetMap pipeline builds every city at 1:1 scale.

| City | Area | Notes |
| --- | --- | --- |
| New Delhi | CP, Paharganj, India Gate | hand-tuned zones |
| Mumbai | Colaba, Fort, CSMT | sea from the real coastline, Gateway of India model |
| Bengaluru | MG Road, Cubbon Park | domed Vidhana Soudha |
| Gwalior | Lashkar, Maharaj Bada | sparse OSM coverage → much procedural infill; the hill fort is outside the map |
| Jaipur | Walled Pink City | pink palette, Hawa Mahal model |
| Hyderabad | Charminar & Old City | Charminar model |
| Kolkata | Park Street, Maidan | Victoria Memorial model |
| Chennai | Marina Beach, Mylapore | real coastline and sea, lighthouse |
| Pune | Shaniwar Wada & peths | |
| Chandigarh | Sector 17 to Capitol Complex | concrete & brick palette |

- **Districts and names:** without hand-drawn zones, districts come from OSM land use, and the HUD shows OSM neighbourhood and suburb names.
- **Train travel:** book a train at a real railway station counter or a travel counter (fictional) in each city centre, or via Pause → Travel. Fares and journey times are game-balanced estimates from real distances. Cash, outfit, vehicles and progress carry over between cities.

### Phase 6 — Advanced gameplay
- **Jobs (J):**
  - tiffin and parcel deliveries (timed)
  - passenger fares (need a car, taxi or auto; tip for fast drop-offs)
  - sightseeing tours of real landmarks

  Each job has an objective tracker, a waypoint beam and a countdown.
- **Economy:** you earn from jobs and diyas, and spend on food, fuel, repairs, metro, trains, clothes and vehicles. Purchases are paid from cash, then by bank transfer.
- **Vehicle showroom and garage:**
  - Buy a scooter, motorcycle, auto, hatchback, sedan, SUV or taxi, in your choice of colour.
  - Your vehicles persist, even across cities.
  - From **My Vehicles** you can have one delivered to you.
- **Character customisation:** buy outfit styles at clothes shops (real OSM clothing shops plus one fictional store per city): T-shirt, button-down shirt or kurta, alongside the reference hoodie. Colours stay free in the Tab menu.
- **Collectibles and achievements:** 8 Golden Diyas hidden in every city, landmark discovery, and 9 achievements with bank rewards. Progress shows in the Character menu.
- **Saving:** saves now include your whole career. The game autosaves every 3 minutes on foot and after each train journey.

## Phase 2 — City environment

New Delhi is now built from **real OpenStreetMap data at 1:1 scale**: about 3.3 × 4.6 km, from Paharganj and New Delhi Railway Station in the north, through Connaught Place and Janpath, to Kartavya Path and India Gate in the south.

**Built from real data:**
- **Streets:** 6,771 road segments with real names, widths, one-way streets and roundabouts. That includes CP's Inner, Middle and Outer Circles, Radial Roads 1–7, Janpath, Baba Kharak Singh Marg, Kartavya Path and the Lutyens' rotaries.
- **Buildings:** about 3,500 real building footprints, extruded. Heights and colours come from OSM tags where mappers recorded them.
- **Places of worship:** detailed roof work for gurudwaras (gold domes: Bangla Sahib, Rakab Ganj), temples (shikharas), mosques (domes and minarets) and churches (Sacred Heart Cathedral).
- **Landmarks:** India Gate (custom model on its real footprint), Netaji's canopy, the Jantar Mantar yantras (the Samrat Yantra as its giant gnomon), Agrasen ki Baoli, and New Delhi Railway Station with platform canopies and parked trains.
- **Parks and water:** real parks, lawns, water, railway land and parking areas. Roundabout islands become tree-filled rotaries.
- **Junctions:** 40 real signalised junctions (from OSM signal nodes) and zebra crossings at real OSM crossings.
- **Street furniture:** bus stops, Delhi Metro entrances (fast travel between real stations), ATMs, benches, fountains, police posts, petrol pumps and roadside shrines, all at their real OSM positions.

**Neighbourhoods:** Connaught Place, Janpath, Paharganj, the station area, Gole Market, Minto Road, Sansad Marg, Mandi House, Barakhamba Road, Lutyens' Delhi and the Central Vista. Each has its own building style, crowd density, street trees and stall density, and its name appears in the HUD. **These zone boundaries are my approximations**, not official ones.

**Traffic:** now drives the real road graph. Vehicles follow real one-way streets and roundabouts, make turning choices at junctions, and stop at real signals. They spawn around you.

**Pedestrians:** about 160 walkers on Medium (85 on Low, 230 on High), plus vendors, police at junctions, people waiting at bus stops and so on. They use a 114k-node pavement network covering the whole city.

**Honest limits:**
- **Procedural infill:** where OSM has no buildings mapped, gaps are filled with procedural buildings. They're shown lighter on the world map.
- **Fictional details:** shop names and signs, street stalls, NPCs and traffic are fictional or generic. Names of real shops, restaurants and hotels are deliberately **not** used, and branded points of interest are made generic.
- **Flyovers** (14 bridge segments) are skipped because the world is still flat. Underground structures such as Rajiv Chowk metro station are not drawn.
- **Monument models** are simplified interpretations.

### Updating or adding a city's map data
```bash
node scripts/osm-import.mjs delhi --fetch   # re-download from the Overpass API, then convert
node scripts/osm-import.mjs delhi           # convert the cached raw file only
node scripts/terrain-import.mjs delhi       # terrain backdrop (or `all`)
```
To add a city:
1. Add a bbox and origin in `scripts/cities.mjs` (shared by both importers).
2. Add a small config (zones, names, plaques, spawn) like `src/game/world/cities/delhi.ts`.
3. Register it in `cities/registry.ts`.

The generic builder (`src/game/world/osmCity.ts`) does the rest.

**Licence:** the files in `data/osm/` and `public/data/` are derived from OpenStreetMap and are © OpenStreetMap contributors, available under the [ODbL 1.0](https://opendatacommons.org/licenses/odbl/). Attribution appears on the in-game map. If you distribute the derived data, it must remain under the ODbL.

## Phase 1 foundation (still included)

**Playable and working (tested in Chrome on Apple M1, ~60 FPS on Medium):**

- **Hero character** from your reference sheet (`public/assets/character/reference-sheet.png`): a jointed 3D model with procedural walk/jog/sprint, jump, idle and sit animations. The face is your photo projected onto a sculpted 3D head, with skin tone sampled from the photo. Wavy hair, maroon hoodie (hood, drawstrings, kangaroo pocket, cuffs), charcoal cargo trousers, white sneakers, and a smartwatch on the left wrist. Branded logos from the photo are **replaced with an original emblem**.
- *(Phase 1's hand-drawn, compressed Delhi layout has been replaced by the real map above.)*
- **Pedestrians:** about 240 live NPCs (office workers, students, shoppers, elderly, delivery riders, tourists, families, vendors, traffic police, security guards; sarees, salwar-kameez, kurtas). They follow a 10k-node pavement graph, wait for the green man at signals, use zebra crossings, check their phones, pause, sidestep each other and you, glance at you, complain if you barge into them, and talk to you in Hinglish (with English subtitles).
- **AI traffic** (cars, taxis, auto-rickshaws, buses, trucks, scooters/bikes with riders): drives on the left, goes clockwise around roundabouts, obeys 50 working signalised junctions, keeps gaps, brakes for people, and honks. You collide with vehicles physically.
- **Day/night cycle:** the sun path, sky, fog, stars, lit windows and shop signs, street-light pools and real point lights near you at night. Time speed and time of day are adjustable in Settings.
- **Procedural ambience** (no audio files): traffic rumble, crowd murmur, birds by day, crickets at night, horns from actual nearby vehicles, footsteps.
- **HUD:** clock, cash, health and stamina, rotating minimap with waypoint, current area and road. **World map** with landmarks marked real (approximate) or fictional.
- **Economy hooks:** cash and bank, ATM, metro fast-travel (₹30), food that restores health/stamina.
- Save/load (localStorage), quality presets, and a performance overlay.

**Still not implemented (as of Phase 6):**
- Building interiors (shops are counters on the street), flyovers and terrain/hills, underground metro stations (the metro is fast travel), mobile/touch controls (the input layer is abstracted for them), and a story campaign.

## Architecture

```
scripts/osm-import.mjs    OpenStreetMap → public/data/<city>.json (offline)
src/
  App.tsx                 screens + loading pipeline (pre-builds chunks around spawn)
  game/
    GameCanvas.tsx        R3F canvas + Physics; mounts all engine systems
    state/                zustand UI store, mutable per-frame runtime, save/load
    input/                device-agnostic actions (keyboard/mouse now, touch later)
    world/
      types.ts            city data model (roads, areas, buildings, props, graph, routes…)
      cities/registry.ts  modular city list (add a city = add an entry with load())
      cities/delhi.ts     Delhi config: OSM data file, neighbourhood zones, plaques, spawn
      osmCity.ts          GENERIC OSM city builder (roads, footprints, areas, POIs, signals, road graph)
      generator.ts        GENERIC: procedural infill, pavements, pedestrian graph,
                          zebra crossings, street props
      chunkBuilder.ts     builds one 100 m chunk into ~8 merged draw calls + colliders
      chunkCache.ts       streaming: time-sliced build, LOD, eviction
      World.tsx           chunk manager (detail / LOD / physics radii), flag, signals, night lights
      models.ts, landmarks.ts  procedural props, vehicles, India Gate, station…
    player/               character model + animation, face texture, controller + camera
    npc/                  instanced crowd (≈20 draw calls total), routines, dialogue
    traffic/              signal timing, AI traffic on the real road graph
    interaction/          reusable interaction handlers + speech bubble
    env/                  time of day, sun/moon, sky, fog, ambience driver
    audio/                Web Audio procedural sound
  ui/                     HUD, minimap, map, menus, title, city select (DOM, outside the canvas)
```

- **Streaming:** only chunks within the detail radius are built and rendered, nearest first, within a 5 ms per-frame budget. Farther chunks use box LOD; colliders exist only near the player. Fog hides the edge. Radii, shadows, NPC count and traffic scale with the quality preset.
- **Rendering cost:** every chunk merges its geometry by material, so it costs about 8 draw calls no matter how many props it has. NPCs use instancing.
- **No external services, API keys or paid assets.** All textures, models and sounds are generated in code.

## Map data: what was used and why

- **Google Photorealistic 3D Tiles (Map Tiles API)** were investigated and **not used**. They need an API key and billing, and their use is subject to the Map Tiles API policies:
  - Caching, data extraction and offline use are restricted.
  - Google logo and data attribution must be shown.
  - Your own 3D objects may be overlaid only if they are not *extracted, traced or derived* from the tiles.
  - There is no games carve-out.

  So they could at most be streamed as a visual backdrop through a compliant renderer. They can't be used for collisions, gameplay geometry or offline assets. Verify the current [policies](https://developers.google.com/maps/documentation/tile/policies) before any use.
- **Since Phase 2** the playable geography comes from **OpenStreetMap** (ODbL), imported offline by `scripts/osm-import.mjs`. No Google content of any kind is used.

## Replacing the hero with a rigged model

The current hero is procedural. For a photoreal, skinned likeness:
1. Generate a head and body from the photos (e.g. Reallusion Character Creator + Headshot, KeenTools FaceBuilder for Blender, or Avaturn / Ready Player Me-style services). Check each service's licence.
2. Rig to a humanoid skeleton and add animations (e.g. Mixamo: idle, walk, run, jump, sit). Export **GLB**.
3. Put it at `public/assets/character/hero.glb`, load it in `player/Player.tsx` with drei's `useGLTF` + `useAnimations`, and drive the clips from the same `speed / grounded / sitting` values `animateRig` uses. The controller, camera and gameplay don't change.

## Testing

Automated browser playtests (Playwright + Chrome) drove the game through these flows with no console errors:
- spawning, walking, sprinting and jumping
- day, sunset and night
- the world map and waypoints
- buying chai, sitting on a bench and standing up
- ATM withdrawal and metro fast travel
- talking to an NPC
- pause, settings, character menu and outfit change
- save, exit and continue

Release builds strip the dev-only `window.__iow` test hook.
