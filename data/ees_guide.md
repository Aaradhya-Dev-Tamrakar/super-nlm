# Energy, Environment and Society Engineering Guide & Numerical Cheat Sheet
## EX 758: Energy, Environment and Society (Revised 40 Marks Theory / 10 Assessment / 50 Total)

This reference guide details system sizing equations, renewable energy physics, battery electrochemical models, and environmental impact metrics across all 7 syllabus chapters for EX 758.

---

### Chapter 1: Technology and Development (2 Hours — 4 Marks)

#### 1. Core Paradigms
- **Definition of Technology**: The systematic application of scientific, engineering, and empirical knowledge to practical human tasks, production, and environmental control.
- **Appropriate Technology (E.F. Schumacher - *Small is Beautiful*)**:
  - Characteristics: People-centered, decentralized, low capital cost, labor-intensive (creating local employment), environmentally benign, repairable using locally available tools and materials.
  - Examples in Nepal: Improved Cook Stoves (ICS), bio-gas digesters (Gobar Gas), micro-hydro peltric sets, hydraulic ram pumps (Hydram).
- **Technology Transfer Pathways**: Direct foreign investment, licensing agreements, turnkey projects, joint ventures, technical assistance partnerships.
  - Barriers: Lack of local absorptive capacity, inadequate maintenance infrastructure, foreign exchange constraints, cultural resistance.

---

### Chapter 2: Energy Basics & Security (4 Hours — 4 Marks)

#### 1. Classification & Energy Metrics
- **Primary Energy**: Naturally occurring unprocessed energy (crude oil, coal, raw solar radiation, falling water).
- **Secondary Energy**: Converted, transportable energy vectors (electricity, refined gasoline, hydrogen).
- **Commercial vs Non-Commercial Energy**:
  - In Nepal: Historically $>60\%\text{--}70\%$ of primary energy consumption was non-commercial biomass (fuelwood, agricultural residues, animal dung). Gradual shift towards commercial hydropower electricity and imported petroleum (LPG, diesel).
- **Maslow's Hierarchy & Human Development Index (HDI)**:
  - Strong logarithmic correlation between per capita electricity consumption ($\text{kWh/person/year}$) and HDI. Basic survival requires energy for clean water and food preservation; self-actualization requires digital communications and industrial mobility.
- **Clean Development Mechanism (CDM)**: Market-based instrument under Kyoto Protocol (Article 12) allowing industrialized countries to earn Certified Emission Reductions (CERs) by investing in carbon emission-reduction projects in developing nations (e.g., biogas in Nepal).

---

### Chapter 3: Renewable Energy Sources (6 Hours — 8 Marks)

#### 1. Solar Energy Physics
- **Solar Constant ($I_{sc}$)**: Average extraterrestrial solar irradiance at the top of Earth's atmosphere:
  $$I_{sc} \approx 1367\ \text{W/m}^2$$
- **Air Mass Ratio ($AM$)**:
  $$AM = \frac{1}{\cos(\theta_z)}$$
  where $\theta_z$ is the solar zenith angle. Standard test condition (STC) for PV cell rating is $AM = 1.5$ (irradiance $1000\ \text{W/m}^2$, cell temp $25^\circ\text{C}$).
- **Photovoltaic Effect**: Photons with energy $h\nu \ge E_g$ (bandgap energy, $E_g \approx 1.12\ \text{eV}$ for silicon) excite electron-hole pairs across the $p\text{-}n$ junction.

#### 2. Hydropower Generation Physics
- **Theoretical Hydropower Equation**:
  $$P = \eta \cdot \rho \cdot g \cdot Q \cdot H_{net} \quad \text{[Watts]}$$
  where:
  - $\rho = 1000\ \text{kg/m}^3$ (water density)
  - $g = 9.81\ \text{m/s}^2$
  - $Q = \text{discharge flow rate } (\text{m}^3/\text{s})$
  - $H_{net} = \text{gross head } H_g - \text{head loss } h_f \ (\text{meters})$
  - $\eta = \text{overall plant efficiency } (\eta_{turbine} \times \eta_{generator} \times \eta_{transformer} \approx 0.75\text{--}0.85)$
  - *Engineering Practical Shortcut*:
    $$P \approx 9.81 \cdot \eta \cdot Q \cdot H_{net} \quad \text{[kW]}$$
- **Hydropower Classification (Nepal Norms)**:
  - Micro-hydro: $<100\ \text{kW}$
  - Mini-hydro: $100\ \text{kW} \text{ to } 1\ \text{MW}$
  - Small hydro: $1\ \text{MW} \text{ to } 25\ \text{MW}$
  - Medium hydro: $25\ \text{MW} \text{ to } 100\ \text{MW}$
  - Large hydro: $>100\ \text{MW}$

#### 3. Wind Power & Betz Limit
- **Wind Power Density Equation**:
  $$P_{wind} = \frac{1}{2} \rho_{air} A v^3 \quad \text{[Watts]}$$
  where $\rho_{air} \approx 1.225\ \text{kg/m}^3$, $A = \pi R^2 = \pi D^2 / 4$ (rotor swept area in $\text{m}^2$), and $v = \text{wind velocity (m/s)}$.
  - *Golden Rule*: Wind power is proportional to the **cube of velocity ($v^3$)**. Doubling wind speed increases available power by $2^3 = 8\times$!
- **Betz Limit ($C_{p, max}$)**: Maximum theoretical aerodynamic extraction efficiency of an ideal wind rotor:
  $$C_{p, max} = \frac{16}{27} \approx 59.3\%$$

#### 4. Hydrogen & Fuel Cells
- **PEM (Proton Exchange Membrane) Fuel Cell**:
  - Anode reaction: $2\text{H}_2 \to 4\text{H}^+ + 4e^-$
  - Cathode reaction: $\text{O}_2 + 4\text{H}^+ + 4e^- \to 2\text{H}_2\text{O}$
  - Overall: $2\text{H}_2 + \text{O}_2 \to 2\text{H}_2\text{O} + \text{Electrical Energy} + \text{Heat}$
  - Theoretical cell potential $E^0 = 1.23\ \text{V}$ at $25^\circ\text{C}$; operating cell voltage $\approx 0.6\text{--}0.7\ \text{V}$ due to activation, ohmic, and concentration overpotentials.

---

### Chapter 4: Application of RE to Power Electronic Equipment (8 Hours — 13 Marks)
*(Highest weightage chapter in the entire syllabus! Mandatory numerical topic)*

#### 1. Step-by-Step Standalone PV System Sizing Methodology

```
               [PV Array: Wp]
                     |
            (Charge Controller)
              /              \
             v                v
   [Battery Bank: Ah]    (DC Loads: BTS)
             |
         (Inverter)
             |
       (AC Loads: Institutional Appliances)
```

#### Step 1: Total Daily Energy Demand Calculation ($E_d$)
List all AC and DC loads with rated power $P_i$ and daily operating hours $t_i$:
$$E_{DC} = \sum P_{DC, i} \cdot t_{DC, i} \quad \text{[Wh/day]}$$
$$E_{AC} = \sum P_{AC, i} \cdot t_{AC, i} \quad \text{[Wh/day]}$$
Account for inverter efficiency $\eta_{inv}$ (typically $85\%\text{--}92\%$):
$$E_{total} = E_{DC} + \frac{E_{AC}}{\eta_{inv}} \quad \text{[Wh/day]}$$

#### Step 2: Design Energy Demand ($E_{design}$)
Account for battery round-trip Coulombic efficiency $\eta_{batt}$ ($80\%\text{--}85\%$) and wiring/dust losses $\eta_{wire}$ ($95\%$):
$$E_{design} = \frac{E_{total}}{\eta_{batt} \cdot \eta_{wire}}$$

#### Step 3: Battery Bank Capacity Sizing ($C_{batt}$)
Determine system nominal DC voltage $V_{sys}$ ($12\text{ V}, 24\text{ V}, \text{ or } 48\text{ V}$), Days of Autonomy $N_{days}$ (cloudy days without sun, typically 3 to 5 days in Nepal), and Maximum Depth of Discharge ($DOD$, typically $0.50$ for lead-acid, $0.80$ for Li-ion):
$$C_{batt} = \frac{E_{total} \cdot N_{days}}{V_{sys} \cdot DOD \cdot \eta_{temp}} \quad \text{[Ampere-hours (Ah)]}$$
- **Number of Batteries**:
  $$N_{series} = \frac{V_{sys}}{V_{unit}}, \quad N_{parallel} = \frac{C_{batt}}{C_{unit}}, \quad N_{total} = N_{series} \times N_{parallel}$$

#### Step 4: PV Array Sizing ($P_{peak} \text{ / } W_p$)
Obtain local Peak Sun Hours ($PSH$ in $\text{hours/day}$ at $1000\ \text{W/m}^2$, typically $4.5\text{--}5.5\ \text{hours}$ in Nepal) and total derating factor $F_{derate} \approx 0.80$ (temperature derating, mismatch, dust):
$$P_{array, Wp} = \frac{E_{design}}{PSH \cdot F_{derate}} \quad \text{[Watts-peak (Wp)]}$$
- **Number of Modules**:
  $$N_{modules} = \left\lceil \frac{P_{array, Wp}}{P_{module, rated}} \right\rceil$$

#### Step 5: Charge Controller Rating ($I_{cc}$)
The charge controller must handle maximum array short-circuit current with safety factor (typically $1.25$ to $1.30$):
$$I_{cc} = N_{strings} \times I_{sc, module} \times 1.25 \quad \text{[Amperes]}$$

#### Step 6: Inverter Rating ($P_{inv}$)
Must handle continuous simultaneous AC peak load plus motor starting surge multiplier ($2\times\text{--}3\times$):
$$P_{inv, continuous} \ge \sum P_{AC, simultaneous} \times 1.25 \quad \text{[Watts or VA]}$$

#### 2. Specific Requirements for Telecom BTS Stations
- Continuous uninterrupted operation ($99.999\%$ reliability).
- System voltage standardized at **$-48\text{ V DC}$**.
- High autonomy days ($N_{days} = 5\text{--}7\text{ days}$) due to remote mountainous terrain where helicopter/foot access during monsoons is delayed.
- Integration of hybrid backup (solar PV + diesel generator / grid trickle charger).

---

### Chapter 5: Solar Electricity for Better Livelihood (3 Hours — 3 Marks)

#### 1. Solar Water Pumping
- Hydraulic power requirement:
  $$P_{hyd} = \frac{\rho \cdot g \cdot Q \cdot H_{total}}{3600} \quad \text{[Watts]}$$
  where $Q = \text{daily water volume } (\text{m}^3/\text{day})$, $H_{total} = \text{static lift } + \text{friction head loss (m)}$.
- Direct-coupled PV array to Variable Frequency Drive (VFD) and brushless DC (BLDC) submersible pump eliminates battery degradation.

#### 2. Solar Clean Cooking vs Traditional Biomass
- Direct solar cookers (parabolic concentrators) vs box-type cookers vs modern institutional induction stoves powered by solar microgrids. Reduces indoor air pollution (particulate matter $\text{PM}_{2.5}$, carbon monoxide).

---

### Chapter 6: Energy Storage Systems (3 Hours — 4 Marks)

#### 1. Battery Chemistry Comparison: Lead-Acid vs Lithium-Ion

| Metric | Deep-Cycle Lead-Acid (Gel/AGM) | Lithium-Ion ($\text{LiFePO}_4$) |
| :--- | :--- | :--- |
| **Specific Energy** | $30\text{--}45\ \text{Wh/kg}$ | **$120\text{--}180\ \text{Wh/kg}$** |
| **Depth of Discharge ($DOD$)** | $50\%$ recommended | **$80\%\text{--}90\%$** |
| **Cycle Life** | $500\text{--}1200\text{ cycles}$ at $50\%\text{ DOD}$ | **$3000\text{--}6000\text{ cycles}$** |
| **Round-Trip Efficiency** | $75\%\text{--}85\%$ | **$>95\%$** |
| **Temperature Sensitivity** | High capacity drop below $0^\circ\text{C}$ | Built-in BMS protection required |
| **Capital Cost** | Low upfront, high lifetime replacement cost | High upfront, lower Levelized Cost of Storage |

#### 2. Electric Mobility & Grid Integration
- **Hybrid (HEV) vs Plug-in Hybrid (PHEV) vs Battery Electric Vehicle (BEV)**.
- **Vehicle-to-Grid (V2G) & Grid-to-Vehicle (G2V)**:
  - G2V: Smart controlled charging during off-peak hours (nighttime hydro surplus in Nepal).
  - V2G: Bidirectional power flow where EV fleet acts as a distributed virtual power plant (VPP) injecting peak shaving power into the grid during high-demand hours.
- **Supercapacitors**: Electrostatic double-layer capacitors (EDLC) with ultra-high power density ($>10\ \text{kW/kg}$), millions of cycles, but low energy density ($5\ \text{Wh/kg}$). Ideal for absorbing rapid regenerative braking surges and crane lifts.

---

### Chapter 7: Environmental Impact of Energy Sources (4 Hours — 4 Marks)

#### 1. Global Warming Potential (GWP) & Life Cycle Analysis (LCA)
- **Life Cycle Emissions ($\text{g CO}_2\text{ equivalent / kWh}$)**:
  - Coal: $820\text{--}1050\ \text{g/kWh}$
  - Diesel / Oil: $650\text{--}750\ \text{g/kWh}$
  - Natural Gas: $400\text{--}500\ \text{g/kWh}$
  - Solar PV (LCA silicon production & transport): $30\text{--}45\ \text{g/kWh}$
  - Hydropower (Run-of-River): $4\text{--}15\ \text{g/kWh}$
  - Wind: $8\text{--}12\ \text{g/kWh}$
  - Nuclear: $12\ \text{g/kWh}$
- **Keith Smith Hazard Classification Chart**: Categorizes environmental hazards along axes of **Frequency of Occurrence**, **Spatial Extent**, and **Severity of Consequences**. Nuclear events are low-frequency, large spatial extent, catastrophic consequence; biomass indoor air pollution is high-frequency, localized, chronic high mortality.
