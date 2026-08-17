# LOVABLE IMPLEMENTATION BRIEF v0.1
## Chronosaga: The Game

**Versione:** 0.1  
**Data:** 2026-08-17  
**Target:** Lovable / React UI implementation  
**Status:** Ready for first prototype after human review of this PR

---

# 0. Mission

Implement the first serious visual prototype of **Chronosaga: The Game** using the existing React/TypeScript project and the visual rules defined in `UI_VISUAL_SYSTEM_v0.1.md`.

Chronosaga is not an AI chat with a game wrapped around it. It is a systemic simulation presented through a dense, credible operating interface.

The first prototype must communicate:

> a huge world is being simulated;

and

> the player is operating a command system, not browsing a generic web dashboard.

---

# 1. Source of truth

Before editing UI, use these documents in precedence order:

1. `PRODUCT_VISION_LOCKED_v1.md`
2. `GAME_SYSTEMS_SCHEMA_v0.1.md`
3. `UI_VISUAL_SYSTEM_v0.1.md`
4. `PARAMETRIC_AI_ADVENTURE_PROJECT_KNOWLEDGE.md`
5. `TECHNICAL_ROADMAP_v0.1.md`
6. `PLATFORM_DISTRIBUTION_LOCAL_AI_FEASIBILITY_v1.md`

GitHub is the source of truth.

Do not replace architecture decisions because another pattern is easier to generate.

---

# 2. Scope of the first Lovable task

Build an **Operations Vertical Slice**.

Do not attempt to build the full game.

The prototype should contain:

```text
TOP SYSTEM TELEMETRY
        │
LEFT ENTITY/PARTY PANEL
        │
CENTER WORLD VIEWPORT
        │
RIGHT ACTIVE SITUATION / INTEL / DIRECTIVES
        │
BOTTOM EVENT LOG / SYSTEM CONTEXT
        │
ANALYSIS MODE
```

Also expose visible but not necessarily fully functional entry points for:

- Tactical;
- Warfare;
- Management/Economy;
- Personnel;
- World/Intel.

---

# 3. Existing architecture must survive

Do not put authoritative game rules inside React components.

Forbidden example:

```ts
if (choice === 'attack') enemy.hp -= 20;
```

Expected boundary:

```ts
GameAPI.resolveAction(...)
GameAPI.getWorldState(...)
GameAPI.getCurrentEvent(...)
GameAPI.getBattleForecast(...)
```

If an endpoint/function does not yet exist, create an adapter/mock boundary rather than embedding final rules in the component.

The UI may temporarily use mock data but must be structured so real Game Core data can replace it immediately.

---

# 4. Mock-data strategy

First pass:

**mock-first, integration-ready immediately afterwards.**

Use typed fixtures matching current/shared game contracts where possible.

Mocks must simulate real states, not lorem ipsum.

Example scenario:

```text
LOCATION
Frontier Relay K-17

PARTY
4 active characters
1 injured
1 stressed

WORLD PRESSURE
rising

CURRENT EVENT
Unknown convoy detected beyond relay perimeter

KNOWN
3 signatures
civilian transponder
low confidence

UNKNOWN
cargo
armed escort
intent

DIRECTIVES
OBSERVE
CONTACT
INTERCEPT
IGNORE
```

This is UI demonstration data only. It must not redefine canon or gameplay rules.

---

# 5. Visual target

## 5.1 Character

- near-black environment;
- thin technical borders;
- dense but organized information;
- teal/cyan operational layer;
- amber action/warning layer;
- red/magenta danger layer;
- restrained positive green;
- technical monospace for data;
- readable sans for prose/dialogue;
- sharp geometry;
- no soft consumer-app feeling.

## 5.2 Do not produce

- large rounded cards;
- glassmorphism;
- gradient-heavy cyberpunk landing page;
- giant icons;
- excessive whitespace;
- floating pastel widgets;
- central chatbot;
- generic admin dashboard;
- mobile-first layout;
- decorative animation everywhere.

KPI-like information is welcome when it is operational and styled as telemetry rather than business analytics.

---

# 6. Initial palette

Use these as provisional tokens, not hard-coded scattered values:

```text
background0       #050708
background1       #0A0E10
surface1          #0E1417
surface2          #121A1E
grid              #1A2A2E
textPrimary       #D6E2E2
textSecondary     #7F9598
tealOperational   #4DB8B3
cyanFocus         #74D5D1
amber             #D6A44A
dangerRed         #D85B5B
dangerMagenta     #C45584
positive          #6FAE7B
```

About 80% of the visible surface should remain in dark/near-black tones.

Do not turn cyan into permanent neon glow.

---

# 7. Layout requirements

Default desktop composition:

```text
┌──────────────────────────────────────────────────────────────┐
│ SYSTEM / LOCATION / CLOCK / ALERTS / PRIMARY RESOURCES      │
├───────────────┬────────────────────────┬─────────────────────┤
│ PARTY/ENTITY  │                        │ ACTIVE SITUATION    │
│ STATUS        │      WORLD VIEW        │ INTEL               │
│               │                        │ DIRECTIVES          │
├───────────────┴────────────────────────┴─────────────────────┤
│ EVENT LOG / CONTEXT / SYSTEM STATUS                         │
└──────────────────────────────────────────────────────────────┘
```

Central viewport baseline: about 40% of usable layout.

Requirements:

- side panels collapsible;
- intelligent auto-hide permitted;
- resizable panels;
- sensible min/max dimensions;
- layout works before customization;
- support layout presets architecture;
- do not break at 1280px;
- equal attention to 1920×1080 and 2560×1440.

Mobile is out of scope.

---

# 8. Navigation

Use a hybrid navigation model.

Stable primary areas:

```text
OPERATIONS
PERSONNEL
WORLD
INTELLIGENCE
```

Contextual modules may appear when relevant:

```text
TACTICAL
WARFARE
ECONOMY
FACTIONS
DIPLOMACY
PRODUCTION
ARCHIVE
```

Do not show every possible module permanently.

Essential keyboard shortcuts may be supported, but do not make them necessary for basic use.

---

# 9. Main Operations screen

## 9.1 Top telemetry

Show compact operational context:

- system state;
- current location;
- campaign/world time placeholder;
- alerts;
- critical resources;
- simulation/activity status.

Keep height low.

## 9.2 Left panel — party/entities

For each active character show compactly:

- name/callsign;
- role;
- health;
- injury marker;
- stress/morale marker;
- current task/state.

Selecting a character opens contextual detail, not a giant card.

## 9.3 Central viewport

First prototype may use a technical map/world schematic rather than expensive rendered world art.

The viewport should feel alive:

- subtle grid;
- location markers;
- signal/object nodes;
- small movement/pulse effects;
- contextual overlays;
- selectable objects.

Do not build a decorative starfield that has no interaction/state meaning.

## 9.4 Right panel — situation/intel/directives

Show:

- active event title;
- classification;
- known information;
- unknown information;
- confidence;
- stakes;
- available directives.

Example:

```text
SIGNAL DETECTED
UNKNOWN CONVOY

KNOWN
3 signatures
civilian-band transponder

UNKNOWN
cargo ???
escort ???
intent ???

CONFIDENCE
LOW

DIRECTIVES
[OBSERVE]
[CONTACT]
[INTERCEPT]
[IGNORE]
```

Directive buttons should look like command controls, not large marketing CTA buttons.

## 9.5 Bottom strip

Include:

- event feed;
- system messages;
- action resolution summary;
- contextual status;
- optional future timeline slot.

---

# 10. Major event reveal

Prototype this sequence for a major event:

```text
SIGNAL DETECTED
      ↓
ANALYSIS
      ↓
EVENT CLASSIFICATION
      ↓
DIRECTIVE AVAILABLE
```

Rules:

- medium theatricality;
- fast enough not to annoy repeated play;
- skippable/reduced-motion friendly;
- approximately hundreds of milliseconds, not multi-second blocking animation;
- no fake "AI thinking" theatre.

Minor events stay in feed/compact notifications.

---

# 11. AI-DM presentation

AI narrative is context-dependent.

Do not create a permanent central chatbot.

Possible placements:

- right narrative context;
- dialogue focus layer;
- warfare event feed;
- event detail drawer.

For generation/loading state use diegetic labels such as:

```text
INTERPRETING STATE...
CORRELATING MEMORY...
ASSEMBLING REPORT...
```

Only use labels appropriate to the actual operation when integrated with the provider.

---

# 12. Dialogue prototype

Use a visual-novel-inspired layout rather than chat bubbles.

Target:

```text
SCENE / PORTRAIT
SPEAKER NAME + STATUS
DIALOGUE
CONTEXT / RELATIONSHIP ESTIMATE
PLAYER RESPONSES
```

Portrait style is not locked. Keep the portrait container adaptable.

Typing animation must be configurable and disable-able.

---

# 13. Analysis Mode

Add a clear `ANALYSIS` control.

When active:

- reveal deeper numerical information;
- show modifier breakdowns;
- expose confidence and data source where available;
- increase density without replacing the entire layout.

Prototype at least five explainable values.

Example:

```text
MORALE 63
base                     70
casualties                -8
commander confidence      +5
supply shortage           -6
momentum                  +2
```

Breakdowns must be data-driven. Do not ask an LLM to invent explanations for numeric state.

---

# 14. Informational fog of war

Default UI respects what the player should know.

Represent unknown data with:

```text
???
```

Support estimated/confidence states.

Example component states:

```text
KNOWN
ESTIMATED
UNKNOWN
CONFLICTING_INTEL
```

Do not treat hidden data as a CSS blur of the real value; the component should receive an information state, not secretly render authoritative values.

---

# 15. Tactical preview slot

Do not implement the full Tactical Engine in this task.

Create only enough visual scaffolding to test the design language.

Preferred prototype direction:

**top-down schematic tactical display**.

Why:

- best fit with diegetic OS;
- works with procedural generation;
- lower production cost;
- easy to overlay cover/range/line-of-sight later.

But architecture must not block later A/B testing against classic top-down or 2.5D.

Use stylized unit sprites/silhouettes, not photoreal miniatures.

---

# 16. Warfare preview slot

Create a preview panel/page that demonstrates:

- geographic military map;
- original unit symbols;
- unit type clarity;
- supply overlay toggle;
- morale bar;
- commander chain-of-command access;
- battle forecast range + confidence;
- event feed.

This can use mock data.

Do not build the Warfare resolver.

---

# 17. Management preview slot

Create enough of a management view to establish the visual pattern:

- 8–10 resource summary slots;
- trend indicators;
- production tree;
- population cohort summary;
- one contextual chart;
- warning state;
- link to deeper analysis.

KPI presentation is allowed and desired when embedded in the Chronosaga visual language.

---

# 18. Motion

Baseline: microanimation.

Allowed:

- panel reveal;
- focus transition;
- low-intensity signal pulse;
- data sweep;
- map pulse;
- optional glitch for damage/interference;
- status transitions.

Avoid constant motion.

Prefer ~120–220ms component feedback and ~200–450ms mode transitions.

Respect reduced-motion settings.

---

# 19. Component principles

Components should be composable and semantic.

Suggested primitives:

```text
SystemPanel
TelemetryRow
StatusIndicator
Metric
DataBreakdown
EntityRow
EntityPortrait
ThreatMarker
IntelField
DirectiveButton
EventFeed
EventEntry
MapViewport
MapOverlayToggle
CommandStrip
ModeTab
ConfidenceIndicator
UnknownValue
AlertBanner
RelationshipEstimate
InjuryMarker
ResourceFlow
```

Names are suggestions, not mandatory API contracts.

---

# 20. Libraries

Do not introduce a full visual framework that dictates the look of the product.

Allowed:

- lightweight utilities;
- accessibility primitives;
- headless components;
- small chart/map helpers if justified.

If using generic component libraries, use them as infrastructure and heavily customize/replace their visual surface.

Prefer bespoke Chronosaga components for high-identity areas.

Any new dependency must have a clear reason.

---

# 21. Accessibility

Even with dense hard-SF visuals:

- do not encode status only with color;
- maintain keyboard focus visibility;
- maintain text contrast;
- avoid tiny mandatory text;
- allow reduced motion;
- tooltips cannot contain critical information unavailable elsewhere;
- warning/danger use icon/label + color.

---

# 22. What Lovable may change autonomously

Allowed:

- spacing refinements;
- component composition improvements;
- hierarchy improvements;
- responsive refinements;
- accessibility improvements;
- small visual alternatives consistent with the spec.

Must ask/propose alternative instead of silently changing:

- primary architecture;
- game system boundaries;
- navigation model;
- major palette semantics;
- Tactical/Warfare/Management separation;
- AI role;
- persistence/data ownership;
- core game mechanics.

---

# 23. Definition of done — first prototype

The task is done only if:

1. project builds with existing tooling;
2. no authoritative simulation logic is embedded in UI components;
3. Operations screen is usable at 1280, 1920×1080 and 2560×1440;
4. panels collapse/resize safely;
5. visual identity is immediately non-generic;
6. no glassmorphism or giant rounded SaaS cards dominate the design;
7. event hierarchy is visible;
8. known/unknown/confidence data have distinct component states;
9. Analysis Mode demonstrates explainable derived values;
10. dialogue does not look like a chatbot;
11. Tactical/Warfare/Management previews visibly belong to the same OS;
12. major event reveal is restrained and repeatable;
13. screenshots are produced for visual review;
14. existing CI still passes.

---

# 24. Required review screenshots

Capture at minimum:

1. Operations — 2560×1440;
2. Operations — 1920×1080;
3. Operations — 1280 width;
4. major event active;
5. Analysis Mode;
6. dialogue state;
7. Warfare preview;
8. Management preview;
9. Tactical schematic preview.

Compare them against the checklist, not merely aesthetic preference.

---

# 25. Do not overbuild

This is a visual/interaction vertical slice.

Do not spend the first Lovable cycle implementing:

- full combat rules;
- full economy;
- database migrations;
- AI provider logic;
- llama.cpp lifecycle;
- authentication;
- complete procedural map generation;
- real army simulation.

Those belong to the Game Core/engineering tracks.

The first goal is to prove that **Chronosaga has a distinct, scalable interface capable of representing its systems**.