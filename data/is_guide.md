# Information Systems Core Architecture & Exam Trap Guide
## CT 751: Information Systems (80 Marks Theory / 20 Assessment / 100 Total)

This comprehensive reference guide details enterprise architectures, Balanced Scorecards, MapReduce algorithms, data warehousing schemas, and security controls across all 8 syllabus chapters for CT 751.

---

### Unit 1: Information System Foundations & Architecture (3 Hours — ~8-10 Marks)

#### 1. Organizational Hierarchy of Information Systems
- **TPS (Transaction Processing System)**: Operational tier; high-volume, structured, deterministic processing (ATM cash withdrawals, retail POS billing, barcode scanning). ACID guarantees.
- **MIS (Management Information System)**: Tactical tier; aggregates TPS data into periodic structured summary reports for middle management (monthly sales variance, inventory reorder reports).
- **DSS (Decision Support System)**: Semi-structured and unstructured decision analysis using mathematical/analytical models (pricing optimization, investment scenarios).
- **ESS / EIS (Executive Support System)**: Strategic tier; high-level executive dashboards, balanced scorecards, external competitive intelligence.

#### 2. Information System Architecture & Quality Attributes
- **Architectural Paradigms**:
  - Monolithic $\to$ Client-Server (2-tier, 3-tier, $N$-tier) $\to$ Service-Oriented Architecture (SOA) $\to$ Event-Driven Microservices.
- **IS Quality Dimensions**:
  - Information Quality: Accuracy, Timeliness, Completeness, Relevancy, Consistency.
  - System Quality: Availability, Throughput, Scalability, Fault Tolerance, Usability.

#### 3. The Balanced Scorecard (Kaplan & Norton)
A strategic performance management framework translating mission and strategy into measurable objectives across four balanced perspectives:
1. **Financial Perspective**: *"How do we look to shareholders?"* (ROI, Operating Margin, Cash Flow, Revenue Growth).
2. **Customer Perspective**: *"How do customers see us?"* (Customer Satisfaction, Retention Rate, Net Promoter Score, Market Share).
3. **Internal Business Process Perspective**: *"What business processes must we excel at?"* (Cycle Time, Unit Cost, Manufacturing Yield, Quality Defect Rate).
4. **Learning and Growth Perspective**: *"Can we continue to improve and create value?"* (Employee Retention, Training Hours, Intellectual Property, IT Capabilities).

---

### Unit 2: Control, Audit and Security of IS (5 Hours — ~10-12 Marks)

#### 1. Internal Controls & IS Audit
- **Classification of Controls**:
  - **Preventive Controls**: Deter adverse events before occurrence (dual authorization, authentication, physical locks).
  - **Detective Controls**: Discover adverse events upon occurrence (log audits, checksum verification, intrusion detection).
  - **Corrective Controls**: Remedy the impact of adverse events (disaster recovery failover, automated backup restoration, incident patching).
- **IS Audit Framework (COBIT / ITIL)**: Independent evaluation of whether IT assets safeguard organizational assets, maintain data integrity, and achieve business goals.

#### 2. Layered Defense-in-Depth Security Strategy
- **Perimeter Defense**: Next-generation firewalls, DMZ, DDoS mitigation.
- **Network Layer**: VLAN segmentation, VPN, IPsec tunnels, TLS 1.3 encryption.
- **Host / Endpoint Layer**: EDR agents, OS hardening, patch management.
- **Application Layer**: WAF, input sanitization, OWASP Top 10 mitigation.
- **Data Layer**: At-rest encryption (AES-256), tokenization, RBAC (Role-Based Access Control).

#### 3. Cryptographic Trust: SSL/TLS & Extended Validation (EV)
- **SSL/TLS Handshake Mechanics**:
  1. Client Hello (supported ciphers, TLS version, client random).
  2. Server Hello (selected cipher, server random, X.509 digital certificate).
  3. Certificate Verification against Trusted Root CA store.
  4. Key Exchange (ECDHE for Ephemeral Diffie-Hellman proving **Forward Secrecy**).
  5. Symmetric session key derived for bulk AES encryption.
- **EV vs OV vs DV Certificates**:
  - Domain Validated (DV): Proves control of domain name via DNS/HTTP challenge only.
  - Organization Validated (OV): Verifies existence of company in business registry.
  - Extended Validation (EV): Thorough legal and physical verification of organizational existence.

---

### Unit 3: Enterprise Management Systems (4 Hours — ~8-10 Marks)

#### 1. ERP, SCM, and CRM Matrix

```
                      [   SUPPLIERS   ]
                            |
                     ( SCM Pipeline )
                            v
+-----------------------------------------------------------+
|               ENTERPRISE RESOURCE PLANNING (ERP)          |
|  - Financials & Accounting      - Production Planning    |
|  - Human Capital Management     - Inventory / Warehouse   |
+-----------------------------------------------------------+
                            |
                     ( CRM Channels )
                            v
                      [   CUSTOMERS   ]
```

- **ERP (Enterprise Resource Planning)**: Centralized relational transactional database eliminating isolated departmental data silos; enforces standardized business process workflows.
- **SCM (Supply Chain Management)**: Upstream coordination; Demand forecasting, Just-In-Time (JIT) procurement, vendor management, logistics optimization.
  - *Bullwhip Effect*: Small fluctuations in retail customer demand amplify into catastrophic order swings upstream to distributors and raw component manufacturers. Mitigated by sharing live POS data.
- **CRM (Customer Relationship Management)**: Downstream customer lifecycle; Sales Force Automation (SFA), marketing automation, customer service ticketing, churn prediction.

#### 2. The Electronic Organism & Enterprise Engineering
- Conceptualizing the enterprise as a responsive living organism: sensors (IoT, sales scanners), nervous system (enterprise message bus, Kafka/RabbitMQ), brain (ERP/DSS engines), effectors (automated robotic warehouses, automated supply orders).
- **Loose Coupling vs Tight Integration**:
  - Tight Integration: Direct synchronous API/database dependencies. High coupling, cascade failure risks.
  - Loose Coupling: Asynchronous message brokers and event-driven architectures. Autonomous microservices scaling independently.

---

### Unit 4: Decision Support & Intelligent Systems (7 Hours — ~14-16 Marks)

#### 1. Data Warehousing: OLTP vs OLAP

| Feature | OLTP (Online Transaction Processing) | OLAP (Online Analytical Processing) |
| :--- | :--- | :--- |
| **Primary Purpose** | Day-to-day business operations & transaction recording | Strategic business intelligence & historical trend analysis |
| **Data Schema** | Highly normalized (3NF / BCNF) to eliminate write redundancy | Denormalized (Star Schema / Snowflake Schema) |
| **Query Complexity** | Simple, fast atomic read/write (single record by Primary Key) | Complex aggregation queries (`GROUP BY`, multi-table joins) |
| **Database Size** | Gigabytes to Terabytes (recent operational window) | Terabytes to Petabytes (multi-year historical archive) |
| **Optimization Focus**| Low write latency, high concurrency, ACID compliance | High read throughput, columnar indexing, query parallelization |

#### 2. Star Schema vs Snowflake Schema
- **Star Schema**: Central Fact Table containing numerical foreign keys and quantitative metrics ($M$), surrounded by denormalized Dimension Tables ($D$). Fast query performance due to fewer joins.
- **Snowflake Schema**: Dimension tables are normalized into sub-dimension tables. Saves disk space, but degrades read performance due to multiple joins.
- **OLAP Cubes & Operations**:
  - **Roll-up**: Aggregation up the dimensional hierarchy (day $\to$ month $\to$ year).
  - **Drill-down**: Disaggregation into granular details (year $\to$ quarter $\to$ month).
  - **Slice**: Selecting a single dimension value (Sales where Region = 'Bagmati').
  - **Dice**: Defining a sub-cube by selecting specific ranges across multiple dimensions.
  - **Pivot**: Rotating the viewing axes of the cube.

#### 3. Data Mining & Anomaly Detection
- Tasks: Association rule mining (Apriori algorithm, Market Basket Analysis: $\text{Support}, \text{Confidence}, \text{Lift}$), Classification (Decision trees, Random Forest, SVM), Clustering ($K$-Means, DBSCAN).
- Anomaly Detection: Identifying out-of-band fraudulent financial transactions via Isolation Forests, One-Class SVM, or Mahalanobis distance thresholds.

---

### Unit 5 & 6: Planning, Implementation & Change Management (10 Hours — ~16-18 Marks)

#### 1. Three Tiers of Information Systems Planning
1. **Strategic Planning (Long-term, 3-5 years)**: Alignment of IT architecture with core corporate strategy, competitive differentiation (Porter's Five Forces, Value Chain Model).
2. **Tactical Planning (Medium-term, 1-2 years)**: Resource allocation, project portfolio management, capital budgeting, legacy modernization schedules.
3. **Operational Planning (Short-term, daily to quarterly)**: Sprint milestones, SLA enforcement, server provisioning, security patch schedules.

#### 2. System Implementation & Change Management
- **Conversion Strategies**:
  - **Direct Cutover (Plunge / Big Bang)**: High risk; instant switchover on specified cutover date.
  - **Parallel Conversion**: Safest; old and new systems run simultaneously for an evaluation cycle. High operational cost and double data entry.
  - **Phased Conversion**: Modules deployed incrementally (e.g., HR first, then Financials).
  - **Pilot Conversion**: System deployed completely at a single branch/location before enterprise rollout.
- **Lewin's 3-Stage Change Model**: **Unfreeze** (disrupt status quo, communicate urgency) $\to$ **Change** (implement new system, train personnel) $\to$ **Refreeze** (institutionalize new policies and culture).
- **Critical Success Factors (CSF)**: Executive sponsorship, stakeholder buy-in, scope creep governance, continuous data migration validation.

---

### Unit 7: Web-Based IS, Navigation & Link Analysis (8 Hours — ~14-16 Marks)

#### 1. Web Link Graph & Link Analysis Algorithms
- The Web modeled as a directed graph $G = (V, E)$ where pages are vertices $V$ and hyperlinks are directed edges $E$.

#### 2. The Google PageRank Algorithm
- Models a "Random Surfer" traversing links with a damping factor $d \approx 0.85$ (probability of following an outgoing link vs teleporting to an arbitrary random page $1 - d$):
  $$PR(A) = \frac{1 - d}{N} + d \sum_{i \in In(A)} \frac{PR(i)}{C(i)}$$
  where:
  - $N = \text{total number of pages in the graph}$
  - $In(A) = \text{set of pages linking into page } A$
  - $C(i) = \text{number of outgoing links from page } i$
- **Power Iteration Method**: Solves for the principal eigenvector of the stochastic transition matrix $M$.
- **Edge Cases**:
  - **Spider Traps**: Mutually linking closed cycles absorbing rank $\implies$ resolved by damping factor $d < 1$.
  - **Dead Ends (Dangling Nodes)**: Pages with zero outgoing links $\implies$ pre-conditioned by distributing their weight uniformly across all $N$ pages.

#### 3. Kleinberg's HITS Algorithm (Hubs and Authorities)
- Mutual reinforcement principle:
  - **Authority Score ($a_p$)**: High if linked to by many good Hubs.
  - **Hub Score ($h_p$)**: High if pointing to many good Authorities.
- Iterative Equations:
  $$a_p^{(k)} = \sum_{q \in In(p)} h_q^{(k-1)}, \quad h_p^{(k)} = \sum_{r \in Out(p)} a_r^{(k)}$$
  Normalized at each iteration: $\sum a_p^2 = 1, \quad \sum h_p^2 = 1$.

#### 4. Recommender Systems
- **Collaborative Filtering**:
  - User-Based: Predicts ratings based on similarity between user taste vectors ($u_1, u_2$) using Cosine Similarity or Pearson Correlation:
    $$\text{sim}(u, v) = \frac{\sum_{i \in I} (r_{u,i} - \bar{r}_u)(r_{v,i} - \bar{r}_v)}{\sqrt{\sum (r_{u,i} - \bar{r}_u)^2} \sqrt{\sum (r_{v,i} - \bar{r}_v)^2}}$$
  - Item-Based: Predicts based on similarity between items rated by the same user.
- **Content-Based Filtering**: Matches item metadata (TF-IDF vector of document words) against user profile preferences.
- **Cold-Start Problem**: Lack of interactions for new users or new items; resolved using hybrid models.

---

### Unit 8: Scalable & Emerging IS Techniques (8 Hours — ~14-16 Marks)

#### 1. The 5 V's of Big Data
- **Volume** (Terabytes to Exabytes).
- **Velocity** (Real-time stream ingestion e.g. clickstreams, financial transactions).
- **Variety** (Structured tables, semi-structured JSON/XML, unstructured text/video).
- **Veracity** (Data cleanliness, noise, missing fields).
- **Value** (Actionable business intelligence).

#### 2. Google MapReduce Paradigm & Hadoop Distributed File System (HDFS)
- **HDFS Architecture**:
  - **NameNode**: Master node; stores metadata and file block namespace mapping in memory.
  - **DataNodes**: Worker nodes; store actual data blocks ($128\text{ MB}$ default block size) with $3\times$ replication across failure domains/racks.
- **MapReduce Execution Flow**:

```
[Input Split] 
      |
      v
  (Map Task) ----> Output: (key, value) pairs
      |
      v
[Shuffle & Sort] -> Partitions & sorts by intermediate key
      |
      v
 (Reduce Task) ---> Aggregates values per key
      |
      v
 [HDFS Output]
```

- **Functional Formulation**:
  $$\text{Map}: (k_1, v_1) \to \text{list}(k_2, v_2)$$
  $$\text{Reduce}: (k_2, \text{list}(v_2)) \to \text{list}(k_3, v_3)$$
- **Word Count Canonical Example**:
  - Mapper receives line: splits into words $\implies$ emits `(word, 1)` for each occurrence.
  - Combiner (optional mini-reducer on local mapper node) reduces bandwidth.
  - Shuffle and sort partitions by `hash(k2) mod R` and transfers over network.
  - Reducer receives `(word, [1, 1, 1, 1])` $\implies$ sums counts $\implies$ emits `(word, total)`.

#### 3. Cloud Computing Service & Deployment Models
- **Service Models**:
  - **IaaS (Infrastructure as a Service)**: Raw VMs, block storage, virtual networks (AWS EC2, GCP Compute Engine).
  - **PaaS (Platform as a Service)**: Managed runtime, database, app servers (AWS Elastic Beanstalk, Google App Engine).
  - **SaaS (Software as a Service)**: End-user applications (Google Workspace, Salesforce).
- **Deployment Models**: Public Cloud, Private Cloud, Hybrid Cloud (combining on-premise regulatory data with public cloud elastic burst compute), Multi-Cloud.
