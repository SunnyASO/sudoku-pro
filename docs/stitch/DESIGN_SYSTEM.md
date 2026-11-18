---
name: Ivory & Forest Navy Editorial
colors:
  surface: '#fbf9f4'
  surface-dim: '#dbdad5'
  surface-bright: '#fbf9f4'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3ee'
  surface-container: '#f0eee9'
  surface-container-high: '#eae8e3'
  surface-container-highest: '#e4e2dd'
  on-surface: '#1b1c19'
  on-surface-variant: '#44474c'
  inverse-surface: '#30312e'
  inverse-on-surface: '#f2f1ec'
  outline: '#74777c'
  outline-variant: '#c4c6cc'
  surface-tint: '#535f6e'
  primary: '#010b17'
  on-primary: '#ffffff'
  primary-container: '#16222f'
  on-primary-container: '#7d8a9a'
  inverse-primary: '#bbc8d9'
  secondary: '#775a19'
  on-secondary: '#ffffff'
  secondary-container: '#fed488'
  on-secondary-container: '#785a1a'
  tertiary: '#1d0200'
  on-tertiary: '#ffffff'
  tertiary-container: '#470800'
  on-tertiary-container: '#d8674d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#d7e4f6'
  primary-fixed-dim: '#bbc8d9'
  on-primary-fixed: '#101c29'
  on-primary-fixed-variant: '#3c4856'
  secondary-fixed: '#ffdea5'
  secondary-fixed-dim: '#e9c176'
  on-secondary-fixed: '#261900'
  on-secondary-fixed-variant: '#5d4201'
  tertiary-fixed: '#ffdad2'
  tertiary-fixed-dim: '#ffb4a3'
  on-tertiary-fixed: '#3d0600'
  on-tertiary-fixed-variant: '#822714'
  background: '#fbf9f4'
  on-background: '#1b1c19'
  surface-variant: '#e4e2dd'
typography:
  display-lg:
    fontFamily: Newsreader
    fontSize: 40px
    fontWeight: '500'
    lineHeight: 48px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Newsreader
    fontSize: 32px
    fontWeight: '500'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Newsreader
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Newsreader
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 30px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  grid-number:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 24px
  grid-pencil:
    fontFamily: Plus Jakarta Sans
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 10px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 18px
    letterSpacing: 0.02em
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.03em
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-mobile: 0.75rem
  margin: 1.5rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

The visual identity treats puzzle gaming as a quiet, mindful ritual akin to solving a physical broadsheet crossword in a sunlit library. Designed for thoughtful solvers, tactile enthusiasts, and daily mental athletes on modern Android devices, the UI rejects hyperactive arcade gamification in favor of a quiet-luxury editorial tone. 

The aesthetic fuses **Editorial Minimalism** with **Tactile Subtlety**:
- Crisp, bookmaker-grade typography paired with calm, expansive ivory surfaces.
- Micro-interactions communicate physical precision: soft button presses, ink-settling cell transitions, and restrained ambient shadows that avoid visual fatigue during long sessions.
- Premium restraint: achievements and milestones are celebrated through warm brass accents and understated badges rather than garish particle bursts.

## Colors

The palette reproduces the optical comfort of acid-free cream paper and carbon ink, balanced by botanical and architectural tones:

- **Primary Canvas & Surfaces**: Base background uses `#FBF9F4` (Warm Cream). Elevated cards and interactive overlays sit on `#FFFFFF` (Soft Ivory), while secondary wells, keypads, and sub-panels use `#F4EFE6` (Warm Neutral Surface) framed by `#EAE3D9` (Muted Sand Outline).
- **Ink & Typography**: `#16222F` (Deep Ink Navy) anchors major headlines, primary icon fills, and key interface targets. `#1E2A38` (Forest Navy) handles labels, body copy, and secondary controls. Unyielding crisp legibility on the board relies on `#111827` (Carbon Black) for initial clues and `#16222F` for user inputs.
- **Board Grid Highlights**: Active row, column, and 3x3 block overlays utilize `#E8EFF5` (Soft Slate Wash) with direct target cell selection lifting to `#DCE6F0`. Duplicate digit highlights leverage `#E2DDD5`.
- **Status & Progression Accents**: `#C5A059` and `#D4AF37` (Muted Brass & Antiqued Gold) are strictly reserved for daily streaks, star ratings, perfection rings, and mastery markers. `#E06D53` (Terracotta Coral) denotes conflict marks, invalid digits, mistake tallies, and critical countdown thresholds.

## Typography

The typographic hierarchy pairs the literary authority of **Newsreader** with the clean geometric ergonomics of **Plus Jakarta Sans**. 

- **Display & Headlines (Newsreader)**: Used for game completion cards, screen headers, chapter titles, and performance metrics. Set with tightened tracking to emulate fine editorial print.
- **User Interface & Controls (Plus Jakarta Sans)**: Ensures instant scanning on mobile displays for timers, move counters, difficulty selectors, and settings.
- **Sudoku Matrix (Tabular Figures)**: All numerals across the 9x9 board and entry keypad enforce `tabular-nums` alignment. Clue numbers default to weight `700`, user-placed answers to weight `500` (differentiated by ink value), and pencil annotations use clean 3x3 internal alignment at `10px` weight `600`.

## Layout & Spacing

The design system uses a strict fluid vertical column layout tailored to Android handheld ergonomics:

- **Mobile Viewports (under 600dp)**: 16px (`1rem`) outer canvas margins. The Sudoku board stretches edge-to-edge minus the margins, enforcing a 1:1 aspect ratio. Interactive components respect a 48dp minimum touch target.
- **Tablet / Large Screens (600dp+)**: The board constrains to a centered 540dp square canvas, reflowing keypads, statistics, and toolbars into a symmetrical right-hand side dock or split landscape panels with 24px (`1.5rem`) gutters.
- **Bottom-Heavy Ergonomic Zoning**: The screen layout arranges from top to bottom:
  1. *Top Bar*: Status indicators, pause, and timer (compact 44dp).
  2. *Game Board*: Centered square with micro-gutter spacing.
  3. *Utility Bar*: Undo, Erase, Pencil, Hint (56dp height).
  4. *Tactile Input Keypad*: 1-9 single-row or 3x3 arrangement optimized for thumb-reach.
  5. *Monetization Anchor*: Dedicated 120dp / 50dp adaptive banner buffer anchored cleanly at the lower safe area boundary.

## Elevation & Depth

Visual depth is achieved through layered structural tones rather than heavy drop shadows, reinforcing the tactile paper metaphor:

- **Base Canvas (Level 0)**: Unadorned `#FBF9F4` surface.
- **Interactive Board & Cards (Level 1)**: Crisp `#FFFFFF` surfaces with a 1px continuous border (`#EAE3D9`) and an ambient, warm shadow: `0px 4px 16px rgba(22, 34, 47, 0.04)`.
- **Selected States & Active Tiles (Level 2)**: Slightly lifted surface using `0px 6px 20px rgba(22, 34, 47, 0.08)` and interior tint highlights.
- **Modals, Dialogs & Victory Overlays (Level 3)**: `#FFFFFF` backing, 1px `#EAE3D9` border, and an ultra-diffused atmospheric shadow: `0px 16px 40px rgba(22, 34, 47, 0.12)`. Modal backdrops feature a 40% `#16222F` ink wash with 6px structural background blur.

## Shapes

The interface balances organic softness with architectural precision:

- **Outer Enclosures & System Dialogs**: Use `rounded-xl` (1.5rem / 24px) for cards, game-over summaries, and contextual sheets.
- **Interactive Controls & Input Keys**: Styled with `rounded-lg` (1rem / 16px) to match natural thumb pads.
- **Status Indicators & Difficulty Toggles**: Full pill shapes (`rounded-full`) for chips, badges, and quick filters.
- **Sudoku Board Cells**: The 9x9 grid cells maintain strict right-angle interiors (0px radius) to prevent geometric distortion across lines, but the global outer board frame is housed within a smooth `rounded-xl` (24px) bezel.

## Components

### Sudoku 9x9 Board
- **Frame**: `#FFFFFF` canvas encased in a 2px `#16222F` structural boundary.
- **Internal Grids**: 3x3 major quadrant divisions use 2px solid `#16222F` rules. Individual cell borders use 1px solid `#EAE3D9`.
- **Cell States**:
  - *Default*: Clear white or ivory.
  - *Selected*: `#DCE6F0` wash.
  - *Related (Row/Col/Block)*: `#E8EFF5` tint.
  - *Matching Values*: `#E2DDD5` tint.
  - *Conflict / Error*: `#FDE8E4` wash with `#E06D53` text.
  - *Given Clues*: `#111827`, weight 700.
  - *User Answers*: `#16222F`, weight 500.

### Input Keypad & Tool Action Buttons
- **Number Buttons (1–9)**: High-tactility pill/squircle tiles with `#F4EFE6` background, `#16222F` typography, and smooth active compression (`scale: 0.96` on touch). Completed digits (9 placed correctly) transition to 30% opacity with counter dot hidden.
- **Utility Tools (Undo, Erase, Notes, Hint)**: Vertical stack of circular or rounded-lg icons with clear state indicators (e.g., active pencil mode displays a subtle `#C5A059` filled background).

### Buttons & Pills
- **Primary Action**: Solid `#16222F` background, `#FFFFFF` text, `rounded-xl`, 52dp height, subtle pressed feedback.
- **Secondary Action**: `#F4EFE6` surface with 1px `#EAE3D9` border, `#16222F` text.
- **Chips & Badges**: Small pill containers (`rounded-full`) using `#F4EFE6` with `#1E2A38` labels. Gold milestone chips use a 10% `#C5A059` wash with `#C5A059` text and star icon.

### Adaptive Monetization / Ad Frame
- Standardized container located below primary game controls.
- Framed in a dedicated `#F4EFE6` utility slot with a 1px `#EAE3D9` perimeter and a minimal uppercase `ADVERTISEMENT` micro-label (`label-sm`, `#A39C90`), preventing layout shift across 50dp and 120dp formats.

### Cards & Dialogs
- Modal scorecards utilize large editorial display typography (`Newsreader`), centered metric cards for accuracy/time, and gold accent ribbons for personal best achievements.