---
name: anthropic-frontend-design-skill
description: Guides code-generation agents through writing an interface thesis, establishing UX constraints, performing visual swap tests, and critiquing rendered assets before writing production frontend code.
---

# Anthropic Frontend Design Methodology

This skill implements a design-first discipline for autonomous frontend development. It ensures every layout choice is grounded in a cohesive product thesis rather than hasty code generation.

---

## 1. The Interface Thesis

Before writing any HTML or CSS, the agent must formulate a 3-point interface thesis:
1. **Primary User Goal**: What is the single most critical action the user must accomplish without friction? (e.g. search across notebooks, initiate cross-synthesis).
2. **Information Hierarchy**: What data point demands immediate visual primacy? What elements should recede into supporting roles?
3. **Aesthetic Tone**: What is the visual personality? (e.g. "Precision Developer Console", "Sleek Spatial Studio", "Warm Minimalist Workspace").

---

## 2. Pre-Code Design Checklist

Evaluate every interface against these criteria:
- **Visual Contrast & Swap Test**:
  - If all text were replaced with lorem ipsum, would the hierarchy and structure still be instantly recognizable?
  - Does the primary action jump out in under 1 second of eye scanning?
- **Information Density vs. Breathing Room**:
  - Avoid claustrophobic layouts where items touch borders.
  - Avoid sparse empty spaces where users lose context.
- **Micro-State Completeness**:
  - Does every interactive element have defined:
    1. Default state
    2. Hover state
    3. Active / Pressed state
    4. Focus-visible state (keyboard accessibility)
    5. Loading / Disabled state
- **Responsive Adaptability**:
  - Verify layout collapses gracefully from ultrawide (1440px+) to laptop (1024px), tablet (768px), and mobile (375px).

---

## 3. Post-Render Critique Workflow

When running browser verification or inspecting visual artifacts:
1. Check typography line heights and font pairings (ensure no overlapping ascenders/descenders).
2. Inspect padding symmetry across modal windows, cards, and navigation headers.
3. Check color contrast ratios using WCAG AA standards.
4. Verify all tooltips, popovers, and modals stay inside the visible viewport on smaller screens.
