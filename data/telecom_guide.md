# Telecommunication Engineering Core Foundations & Exam Traps Cheat Sheet
## EX 756 / EX 703: Telecommunication (80 Marks Theory / 20 Assessment / 25 Practical)

This comprehensive reference guide outlines theoretical mechanisms, mathematical proofs, switching matrices, queuing formulas, and exam traps across all 8 syllabus units to master prior to solving numericals.

---

### Unit 1: Telecommunication Networks (4 Hours — ~6-8 Marks)

#### 1. Core Architectural Evolution
- **PSTN Topology Hierarchy**: Class 1 (Regional Center) $\to$ Class 2 (Sectional) $\to$ Class 3 (Primary) $\to$ Class 4 (Toll Center) $\to$ Class 5 (Local / End Office).
- **Topology Trade-offs**:
  - **Full Mesh**: $N(N-1)/2$ links. Optimal for high-density, low-node core networks. O($N^2$) link cost trap.
  - **Star / Hierarchical**: $N-1$ links with central switch. High vulnerability to central node failure; requires tandem switches for survivability.
- **Switching Taxonomy**:
  - **Circuit Switching**: Dedicated physical/logical channel, fixed bandwidth, deterministic latency, zero packet header overhead during conversation, poor bursty data efficiency. Call setup $\to$ Data transfer $\to$ Call teardown.
  - **Message Switching**: Store-and-forward of complete message, variable delay, no real-time voice capability.
  - **Packet Switching**: Statistical multiplexing of variable/fixed packets (Datagram vs Virtual Circuit).

#### 2. Golden Exam Traps
- **Manual vs Strowger vs Crossbar**:
  - Step-by-Step (Strowger): Direct control by 10-pulse rotary dial (uniselector + two-motion selector). High wear, slow, limited alternate routing.
  - Crossbar: Common control architecture; separation of speech path (matrix of coordinate switches) from control logic (markers, register-translators). Introduced multi-frequency (MF) signaling.
  - Stored Program Control (SPC): Centralized processor executing software routing tables in memory.

---

### Unit 2: Transmission Media (4 Hours — ~6-8 Marks)

#### 1. Primary & Secondary Line Constants
- **Primary Constants**: Series Resistance $R$ ($\Omega/\text{km}$), Series Inductance $L$ ($\text{H/km}$), Shunt Conductance $G$ ($\text{S/km}$), Shunt Capacitance $C$ ($\text{F/km}$).
- **Propagation Constant**:
  $$\gamma = \alpha + j\beta = \sqrt{(R + j\omega L)(G + j\omega C)}$$
  where $\alpha$ is attenuation constant ($\text{Np/km}$ or $\text{dB/km}$, $1\text{ Np} = 8.686\text{ dB}$) and $\beta$ is phase constant ($\text{rad/km}$).
- **Characteristic Impedance**:
  $$Z_0 = \sqrt{\frac{R + j\omega L}{G + j\omega C}}$$
- **Heaviside Distortionless Line Criterion**:
  $$\frac{R}{L} = \frac{G}{C} \implies \alpha = \sqrt{RG}, \quad \beta = \omega\sqrt{LC}, \quad Z_0 = \sqrt{\frac{L}{C}}$$
  - **Trap**: On voice pairs, typically $R/L \gg G/C$. Adding series lumped inductance (Pupinization / Loading Coils) increases $L$, restoring the ratio to flatten attenuation over voice band ($300\text{--}3400\text{ Hz}$), but creates a sharp low-pass cutoff at higher frequencies, making loaded pairs **incompatible with DSL/broadband**.

#### 2. 2-Wire to 4-Wire Hybrids & Echo
- **Hybrid Transformer Balance**: Matches 2-wire subscriber loop impedance $Z_L$ to precision balance network $Z_B$.
- **Transhybrid Loss & Echo**: If $Z_L \neq Z_B$, reflection coefficient $\Gamma = \frac{Z_L - Z_B}{Z_L + Z_B} \neq 0$. Unbalanced energy leaks across the hybrid into the 4-wire return path, causing **Talker Echo** and **Listener Echo**. Sing-around oscillations (singing) occur when loop gain $\ge 0\text{ dB}$.

---

### Unit 3: Signal Multiplexing (4 Hours — ~8-10 Marks)

#### 1. FDM vs TDM vs WDM
- **FDM**: Analog frequency division; guard bands prevent adjacent channel crosstalk.
- **TDM**: Time division; interleaved slots in a recurring frame.
- **WDM / DWDM**: Optical domain FDM on silica fibers ($1310\text{ nm}$ / $1550\text{ nm}$). ITU grid spacing down to $50\text{ GHz}$ ($0.4\text{ nm}$) or $100\text{ GHz}$ ($0.8\text{ nm}$).

#### 2. The European E1 vs North American T1 Comparison Table

| Metric | European E1 (CEPT) | North American T1 (DS1) |
| :--- | :--- | :--- |
| **Gross Bitrate** | **$2.048\text{ Mbps}$** | **$1.544\text{ Mbps}$** |
| **Number of Channels** | **32 timeslots** (TS0 - TS31) | **24 channels** |
| **Voice Channels** | **30 voice channels** (TS1-15, TS17-31) | **24 voice channels** |
| **Sampling Rate / Resolution** | $8000\text{ samples/sec} \times 8\text{ bits} = 64\text{ kbps}$ | $8000\text{ samples/sec} \times 8\text{ bits} = 64\text{ kbps}$ |
| **Frame Duration** | $125\ \mu\text{s}$ ($1/8000\text{ s}$) | $125\ \mu\text{s}$ ($1/8000\text{ s}$) |
| **Bits per Frame** | $32 \times 8 = 256\text{ bits}$ | $24 \times 8 + 1\text{ (framing bit)} = 193\text{ bits}$ |
| **Signaling Timeslot** | **TS16** (Channel Associated or Common Channel) | In-Band / Robbed-bit (bit 8 every 6th frame) or PRI TS24 |
| **Synchronization / FAS** | **TS0** (Frame Alignment Signal, alternating CRC-4) | Dedicated 193rd framing bit ($F$-bit) |
| **Companding Law** | **A-law** ($A = 87.6$) | **$\mu$-law** ($\mu = 255$) |

- **Multiframe Structure**: E1 multiframe consists of 16 frames (Frame 0 to 15, duration $2\text{ ms}$). TS0 Frame 0 carries FAS ($0011011$); TS16 Frame 0 carries Multiframe Alignment Signal ($0000xyxx$).

---

### Unit 4: Digital Switching (8 Hours — ~12-14 Marks)

#### 1. Space (S) Switch vs Time (T) Switch
- **Space Switch ($S$)**: Crossbar/crosspoint matrix of AND gates connecting $N$ input lines to $M$ output lines in the **same timeslot**.
  - Crosspoints required: $N \times M$.
  - Fixed-slot connection: Cannot shift speech from TS $i$ to TS $j$.
  - Control mode: Input-controlled (decoded address activates input selector) or Output-controlled.
- **Time Switch ($T$)**: Exchanges samples between different timeslots on a single TDM multiplex bus using **Speech Memory (SM)** and **Control Memory (CM)**.
  - Capacity: $C = 125\ \mu\text{s} / t_{access}$.
  - Modes:
    - **Sequential Write / Random Read (Output Controlled)**: Input samples written cyclically into SM address matching timeslot counter. CM contains addresses of SM to be read out in each output timeslot.
    - **Random Write / Sequential Read (Input Controlled)**: Samples written into SM at address specified by CM; read out sequentially matching output timeslot.

#### 2. Multi-Stage Combinations: TST vs STS Switching
- **TST Switch (Time-Space-Time)**:
  - Input stage: $N$ Time switches each handling $L$ incoming timeslots expanded into $M$ internal timeslots.
  - Space stage: $N \times N$ space matrix connecting input time switches to output time switches.
  - Output stage: $N$ Time switches condensing $M$ internal timeslots back to $L$ outgoing timeslots.
  - **Complexity / Cost**:
    $$\text{Cost}_{TST} = 2N \cdot (SM + CM) + N^2 \text{ gates}$$
  - Advantage: Better for high-capacity exchanges ($>10,000$ lines) where space matrix size can be minimized by TDM concentration.
- **STS Switch (Space-Time-Space)**:
  - Input stage: Space matrix $N \times K$.
  - Middle stage: $K$ Time switches.
  - Output stage: Space matrix $K \times N$.
  - **Complexity / Cost**:
    $$\text{Cost}_{STS} = 2 \cdot (N \times K) + K \cdot (SM + CM)$$
  - Advantage: Lower total memory access delays for smaller exchanges.
- **Strict Blocking Analysis**:
  - Non-blocking criterion (Clos condition for TST): To guarantee strictly non-blocking operation without re-routing existing calls, the number of internal timeslots $M$ must satisfy:
    $$M \ge 2L - 1$$

---

### Unit 5: Signaling Systems (4 Hours — ~8-10 Marks)

#### 1. Channel Associated (CAS) vs Common Channel (CCS)
- **CAS**: Signaling path bound to voice channel (in-band tones e.g., DTMF, or dedicated digital timeslot TS16 nibbles per voice channel). High overhead, vulnerable to talk-off, limited message set.
- **CCS**: Dedicated, high-speed packet-switched data link carrying variable-length signaling messages for hundreds of voice trunks. Fast call setup, non-call associated signaling, database lookups (800 numbers, LNP, roaming).

#### 2. ITU Common Channel Signaling System No. 7 (SS7)

```
SS7 Architecture Protocol Stack:
+-------------------------------------------------------+
|  Application Layer: TCAP, MAP, INAP, CAMEL            |
+-------------------------------------------------------+
|  Call Control: ISUP (ISDN User Part) / TUP (Tel User) |
+-------------------------------------------------------+
|  SCCP (Signaling Connection Control Part - Global Title)|
+-------------------------------------------------------+
|  MTP-3 (Message Transfer Part Level 3: Routing/Network)|
+-------------------------------------------------------+
|  MTP-2 (Message Transfer Part Level 2: Link HDLC/FCS) |
+-------------------------------------------------------+
|  MTP-1 (Message Transfer Part Level 1: Physical E1/V.35)|
+-------------------------------------------------------+
```

- **SS7 Network Nodes**:
  - **SSP (Service Switching Point)**: Originates/terminates call signaling (local exchange).
  - **STP (Signal Transfer Point)**: Packet switch that routes signaling messages without processing call state.
  - **SCP (Service Control Point)**: Centralized database queried by SSP/STP (HLR/VLR, 800-number translation).
- **Link Types**: A-links (Access), B-links (Bridge), C-links (Cross), D-links (Diagonal), E-links (Extended), F-links (Fully associated).

---

### Unit 6: Teletraffic Engineering (9 Hours — ~15-18 Marks)

#### 1. Basic Parameters & Erlang Definition
- **Traffic Intensity ($A$)**:
  $$A = \lambda \cdot h \quad \text{[Erlangs]}$$
  where $\lambda = \text{call arrival rate (calls/unit time)}$, $h = \text{mean call holding time (same time unit)}$.
- **Centum Call Seconds (CCS)**:
  $$1\text{ Erlang} = 36\text{ CCS} = 3600\text{ call-seconds}$$
- **Busy Hour**: The continuous 60-minute period having the highest average traffic volume.

#### 2. Loss Systems: Erlang B Formula
- **Assumptions**: Poisson call arrivals, negative exponential holding times, memoryless system, **Blocked Calls Cleared (BCC)**, $N$ trunks, full accessibility.
- **Erlang B Equation (Blocking Probability / GOS $B$)**:
  $$B(N, A) = \frac{\frac{A^N}{N!}}{\sum_{k=0}^{N} \frac{A^k}{k!}}$$
- **Stable Recursive Computation (Mandatory for programming / exams)**:
  $$B(0, A) = 1$$
  $$B(k, A) = \frac{A \cdot B(k-1, A)}{k + A \cdot B(k-1, A)} \quad \text{for } k = 1, 2, \dots, N$$

#### 3. Delay Systems: Erlang C Formula (Queuing Systems)
- **Assumptions**: **Blocked Calls Delayed (BCD)** into an infinite queue.
- **Erlang C Equation (Probability of Waiting $P_w$)**:
  $$P_w = C(N, A) = \frac{\frac{A^N}{N!} \cdot \frac{N}{N - A}}{\sum_{k=0}^{N-1} \frac{A^k}{k!} + \frac{A^N}{N!} \cdot \frac{N}{N - A}} \quad (\text{Valid for } A < N)$$
- **Average Queue Length & Waiting Time**:
  $$W = \frac{P_w \cdot h}{N - A} \quad \text{[Mean delay for all arriving calls]}$$
  $$W_d = \frac{h}{N - A} \quad \text{[Mean delay for calls that actually experience delay]}$$

---

### Unit 7: Telecommunication Regulation (2 Hours — ~4-5 Marks)

#### 1. International Telecommunications Union (ITU)
- **Structure**:
  - **ITU-R**: Radiocommunication sector (spectrum allocation, orbital slots).
  - **ITU-T**: Standardization sector (V-series, G-series, X-series, Q-series recommendations).
  - **ITU-D**: Development sector (equitable telecommunications access).

#### 2. Nepal Telecommunications Authority (NTA) & Regulatory Acts
- **NTA Established**: Under Telecommunications Act 2053 (1997).
- **Core Functions**:
  - Issuing licenses (Mobile, Basic, ISP, Network Service Provider).
  - Frequency spectrum management, auctioning, and monitoring.
  - Interconnection guidelines and tariff approvals.
  - Rural Telecommunication Development Fund (RTDF) management (2% levy on gross telecom revenues) for infrastructure development in underserved districts (Optical fiber backbone along Mid-Hill highway).
- **National Numbering Plan**: Allocation of mobile prefixes (984/985 for NTC, 980/981/982 for Ncell), emergency codes (100, 101, 102), and short codes (1660 toll-free).

---

### Unit 8: Data Communication (10 Hours — ~12-15 Marks)

#### 1. Switching Paradigms
- **IP Switching vs MPLS**:
  - Traditional IP Routing: Hop-by-hop longest prefix match in Layer 3 forwarding table (FIB).
  - MPLS (Multi-Protocol Label Switching): Ingress Label Edge Router (LER) assigns fixed 32-bit shim label; interior Label Switch Routers (LSR) perform high-speed Layer 2 label swapping along a pre-established Label Switched Path (LSP).
- **Softswitch Architecture**:
  - Decouples call control (Media Gateway Controller / MGC) from transmission switching hardware (Media Gateway / MG).
  - Protocols: **SIP** (Session Initiation Protocol - RFC 3261), **H.323**, **MGCP** / **Megaco** (H.248).

#### 2. ISDN vs DSL Technologies
- **ISDN**:
  - **BRI (Basic Rate Interface)**: $2B + D = 2 \times 64 + 16 = 144\text{ kbps}$ (User data) + overhead $\to 192\text{ kbps}$.
  - **PRI (Primary Rate Interface)**:
    - Europe (E1 based): $30B + D = 30 \times 64 + 64 = 2.048\text{ Mbps}$.
    - North America (T1 based): $23B + D = 23 \times 64 + 64 = 1.544\text{ Mbps}$.
- **DSL Technologies**:
  - **ADSL**: Asymmetric (downstream $>$ upstream) using Discrete Multi-Tone (DMT) modulation over copper pairs ($256$ subchannels spaced at $4.3125\text{ kHz}$). POTS splitter isolates $0\text{--}4\text{ kHz}$ voice from high-frequency DMT data ($25\text{ kHz}\text{--}1.1\text{ MHz}$).
  - **VDSL / VDSL2**: Extended spectrum up to $17.6\text{ MHz}$ or $30\text{ MHz}$, achieving $>100\text{ Mbps}$ over short local loops ($<500\text{ m}$).
