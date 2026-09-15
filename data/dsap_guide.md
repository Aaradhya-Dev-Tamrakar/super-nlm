# DSAP Core Foundations & High-Yield Exam Traps Cheat Sheet
## CT704: Digital Signal Analysis and Processing

This reference guide outlines the fundamental theoretical mechanisms, mathematical proofs, edge cases, and exam traps across all 7 syllabus units to master prior to attempting numericals.

---

### Unit 1: Discrete-Time Signals & Systems (9 Marks)

#### 1. Fundamental Periodicity Trap
- **The Core Rule**: For a continuous signal cos(Omega_0 * t), it is ALWAYS periodic. For discrete cos(omega_0 * n), it is periodic **if and only if** omega_0 / (2*pi) = k / N is a **rational number**.
- **Edge Case**: If omega_0 = 0.5*pi, 0.5*pi / (2*pi) = 1/4 -> Periodic with fundamental period N = 4. But if omega_0 = 2, 2 / (2*pi) = 1/pi is irrational -> **NOT Periodic**. (Classic 2-mark trap).

#### 2. Signal Transformation Precedence
- **Strict Precedence Rule**: **Shift first, then Scale/Fold**.
  Sequence: x[n] -> Shift by +3 -> x[n+3] -> Scale by 2 -> x[2n+3] -> Fold (n -> -n) -> x[-2n+3].

#### 3. Analytical Proofs for LTI Systems
- **BIBO Stability Proof**: Show that |y[n]| = |sum h[k]*x[n-k]| <= M_x * sum_{k=-inf}^{inf} |h[k]| < infinity.  
  BIBO Stability <=> sum_{n=-inf}^{inf} |h[n]| < infinity (Absolute Summability of impulse response).
- **Causality Proof**: y[n] depends only on past/present inputs <=> h[n] = 0 for n < 0.

---

### Unit 2: Z-Transform & ROC Mechanics (6 Marks)

#### 1. The 3 ROC Golden Rules
- **Rule 1 (Finite Duration)**: Causal signals have ROC: |z| > 0. Anti-causal have ROC: |z| < infinity. Two-sided exclude both 0 and infinity.
- **Rule 2 (Causality Criterion)**: System is **causal** <=> ROC is strictly **outside the outermost pole** (|z| > r_max).
- **Rule 3 (BIBO Stability Criterion)**: System is **stable** <=> ROC **includes the unit circle (|z| = 1)**.

#### 2. Stability vs. Causality Trap
- If poles exist at z = 0.5 and z = 2:
  - Causal <=> ROC: |z| > 2 (excludes unit circle -> **Unstable**).
  - Stable <=> ROC: 0.5 < |z| < 2 (includes unit circle, but ring boundary -> **Non-Causal**).
  - *Golden Law*: A system cannot be both causal and stable if any pole lies outside or on the unit circle (|p| >= 1).

---

### Unit 3: Analysis of LTI in Frequency Domain (10 Marks)

#### 1. Geometric Interpretation of H(e^{j*omega})
- On the unit circle z = e^{j*omega}, magnitude response is:
  |H(e^{j*omega})| = b_0 * (product of zero-vector lengths) / (product of pole-vector lengths).
- Zero on the unit circle (z = e^{j*omega_0}) => response is **identically 0** (Notch / Stopband null).
- Pole close to unit circle => Sharp resonant peak.

#### 2. Phase Delay vs. Group Delay
- **Phase Delay**: tau_p(omega) = -theta(omega) / omega (carrier wave delay).
- **Group Delay**: tau_g(omega) = -d[theta(omega)] / d[omega] (signal envelope / burst information delay).
- **Generalized Linear Phase**: Constant group delay <=> theta(omega) = -alpha * omega => **Zero Phase Distortion**. Requires impulse response symmetry h[n] = +- h[M-1-n].

---

### Unit 4: Filter Structures & Quantization (10 Marks)

#### 1. Canonical Delay Minimization
- **Direct Form I**: Requires 2N delay elements (separate delays for poles and zeros).
- **Direct Form II (Canonic)**: Requires only N delay elements by sharing intermediate states.
- **Linear Phase FIR Structure**: Exploit impulse symmetry h[n] = h[M-1-n] to save **50% of hardware multipliers** (floor(M/2)).

#### 2. Finite Word-Length Edge Cases
- **Round-off Noise Variance**: sigma_e^2 = (2^{-2B}) / 12 for B-bit representation.
- **Zero-Input Limit Cycles (Deadband Effect)**: Ongoing parasitic oscillations caused by non-linear rounding in feedback loops even when input is zero.
- **Overflow Limit Cycles**: Eliminated by implementing **Saturation Arithmetic** instead of standard Two's Complement roll-over.

---

### Unit 5: FIR Filter Design (15 Marks)

#### 1. Gibbs Phenomenon & Windowing Mechanics
- Direct truncation of ideal infinite impulse response h_d[n] corresponds to windowing with rectangular window w[n].
- Abrupt spectral truncation creates an inescapable **~8.9% overshoot (-21 dB first sidelobe)** regardless of filter length M.
- Tapered windows (Hanning, Hamming, Blackman, Kaiser) smooth discontinuities at the expense of wider transition band Delta_omega.

#### 2. Window Trade-off Matrix
- **Rectangular**: Delta_omega = 4*pi / M, Stopband Attenuation = -21 dB.
- **Hanning**: Delta_omega = 8*pi / M, Stopband Attenuation = -44 dB.
- **Hamming**: Delta_omega = 8*pi / M, Stopband Attenuation = -53 dB.
- **Blackman**: Delta_omega = 12*pi / M, Stopband Attenuation = -74 dB.

---

### Unit 6: IIR Filter Design (15 Marks)

#### 1. Bilinear Transformation (BLT) & Pre-Warping
- Conformal mapping: s = (2/T) * (1 - z^{-1}) / (1 + z^{-1}) maps entire left-half s-plane into |z| < 1.
- **Non-linear Frequency Warping**: Omega = (2/T) * tan(omega / 2).
- **Mandatory Numerical Step**: **Always pre-warp** cutoff frequencies omega_p, omega_s -> Omega_p, Omega_s prior to analog filter order N calculation.

#### 2. Impulse Invariance Aliasing Limitation
- Mapping p_k = e^{s_k * T} preserves impulse response, but periodic frequency replication causes **spectral aliasing**.
- Unsuitable for High-Pass/Band-Pass filters. BLT is strictly preferred.

---

### Unit 7: DFT & FFT Principles (15 Marks)

#### 1. Circular vs. Linear Convolution
- Linear convolution length of x_1[n] (length L_1) and x_2[n] (length L_2) is L = L_1 + L_2 - 1.
- Multiplied DFTs compute **Circular Convolution**.
- **To obtain Linear Convolution via DFT**: Both sequences must be zero-padded to at least N >= L_1 + L_2 - 1.

#### 2. Computational Speedup
- **Direct DFT**: N^2 complex multiplications, N(N-1) complex additions.
- **Radix-2 FFT**: (N/2) * log2(N) complex multiplications, N * log2(N) complex additions.
- *Speedup for N = 1024*: From ~1.05 x 10^6 multiplications down to 5,120 multiplications (~200x faster).
