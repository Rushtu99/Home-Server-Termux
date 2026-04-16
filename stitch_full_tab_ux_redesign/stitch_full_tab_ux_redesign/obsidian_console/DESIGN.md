# Design System Document: The Obsidian Engine

## 1. Overview & Creative North Star

### Creative North Star: The Silent Command Center
This design system is built for the high-stakes environment of home infrastructure management. It moves away from the "toy-like" aesthetics of consumer dashboards toward a philosophy we call **The Silent Command Center**. It is an editorial approach to technical data: authoritative, dense but legible, and aesthetically rigorous. 

The system breaks the "bootstrap template" look by utilizing intentional asymmetry—placing high-density technical readouts against expansive, quiet negative space. We favor tonal depth over structural lines, creating a UI that feels carved from a single block of dark obsidian rather than assembled from plastic components.

---

## 2. Colors

### The "No-Line" Rule
To achieve a premium, high-end feel, **the use of 1px solid borders for sectioning is strictly prohibited.** Section boundaries must be defined through:
1.  **Background Color Shifts:** Use `surface_container_low` for secondary areas and `surface_container_highest` for elevated cards.
2.  **Tonal Transitions:** A container should be distinguished from its parent by moving one step up or down the `surface_container` tier.

### Surface Hierarchy & Nesting
Treat the dashboard as a series of physical layers. 
- **Base Layer:** `surface` (#0b1326) acts as the deep substrate.
- **Sectioning:** Use `surface_container_low` for broad layout regions (like a sidebar or a footer).
- **Interactive Units:** Use `surface_container` or `surface_container_high` for individual cards or data modules.
- **Nesting:** If a card contains a sub-module (e.g., a process list inside a CPU monitor), the inner module should use `surface_container_lowest` to create a "recessed" technical feel.

### The Glass & Gradient Rule
Floating elements (modals, tooltips, dropdowns) must utilize **Glassmorphism**. Use a semi-transparent `surface_bright` with a `backdrop-filter: blur(12px)`. Main CTAs and high-priority status indicators should utilize a subtle linear gradient (e.g., `primary` to `primary_container`) to provide a "glow" that flat colors lack.

### Status Accents
Status is the heartbeat of this system. Use high-chroma accents sparingly:
- **Healthy:** `secondary` (#4edea3)
- **Degraded/Warning:** `tertiary` (#ffc174)
- **Critical:** `error` (#ffb4ab)

---

## 3. Typography

The typographic strategy balances human-centric UI with raw technical precision.

*   **Display & Headlines (Space Grotesk):** Used for high-level "Editorial" moments. The wide apertures and geometric forms of Space Grotesk convey a modern, "New Space" aesthetic.
*   **Body & Labels (Inter):** The workhorse. Inter provides maximum legibility for status updates and navigation.
*   **Technical Data (Monospace Fallback):** For IP addresses, logs, and port numbers, use a crisp monospace font. This signals "Raw Data" to the user’s brain instantly.

**Hierarchy Strategy:** 
Large typographic scales (`display-lg`) should be used for system health percentages to create a visual "hook," while technical metadata uses `label-sm` in `on_surface_variant` to recede into the background until needed.

---

## 4. Elevation & Depth

### The Layering Principle
Elevation is expressed through light, not shadows. As an element moves "closer" to the user, it becomes lighter in tone (`surface_container_highest`). 

### Ambient Shadows
Traditional shadows are too heavy for a dark UI. When a "floating" effect is required (e.g., for a context menu), use a shadow with a 24px blur and 6% opacity, tinted with `primary` to mimic the ambient glow of the screen.

### The "Ghost Border" Fallback
In rare cases where accessibility requires a border (e.g., input focus states), use a **Ghost Border**. Apply `outline_variant` at 15% opacity. This provides a "suggestion" of a boundary without cluttering the technical density of the layout.

---

## 5. Components

### Buttons
- **Primary:** `primary` background with `on_primary` text. Use `xl` (0.75rem) roundedness. 
- **Secondary:** Transparent background with a `Ghost Border`. Use `primary` for text color.
- **States:** On hover, primary buttons should gain a 10% white overlay to "glow" rather than just changing color.

### Data Chips
Chips are used for service status (e.g., "Jellyfin: Online").
- **Style:** No background. Use a 2px left-border of the status color (`secondary`, `tertiary`, or `error`) and `label-md` typography. This mimics "code editor" styling.

### Input Fields
- **Container:** `surface_container_lowest`.
- **Focus:** Transition the Ghost Border from 15% opacity to 60% `primary`.
- **Text:** Technical inputs (URLs, Paths) must use monospace formatting.

### Technical Lists & Cards
- **Forbid Dividers:** Do not use lines to separate items in a list. Use `1rem` of vertical whitespace or a subtle background toggle between `surface_container` and `surface_container_low`.
- **The "Node" Component:** A specific component for this app. A card showing server stats should have an asymmetric layout: Big display-sm number on the left, a vertical sparkline in the center, and metadata labels stacked on the right.

---

## 6. Do's and Don'ts

### Do
- **Do** use `on_surface_variant` for secondary technical info to reduce visual noise.
- **Do** use the `xl` (0.75rem) corner radius for large containers and `sm` (0.125rem) for technical data chips to create a "soft-edge tech" feel.
- **Do** use "Breathing Room." Even technical dashboards need air. Give headers significant top-padding (32px+).

### Don't
- **Don't** use pure black (#000000). It kills the depth of the `surface` tokens.
- **Don't** use 100% opaque borders. They create "grid-prison" and make the UI feel dated and boxed-in.
- **Don't** use standard "Success Green." Use the `secondary` (#4edea3) token for a more sophisticated, "Emerald" technical look.
- **Don't** center-align technical data. Always left-align for rapid scanning, or right-align numerical values in tables.