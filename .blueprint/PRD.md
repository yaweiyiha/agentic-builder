**SPRI™**

Stablecoin Peg Risk Index

Business Requirements Document

Prepared by: Nuvanté Technologies Ltd

Prepared for: 57blocks

Date: April 2026

Classification: Confidential

Version: 2.0 - Draft

# 1\. Executive Summary

Nuvanté Technologies Ltd is developing SPRI™ (Stablecoin Peg Risk Index), a proprietary scoring model that evaluates stablecoin peg stability in real time across four weighted risk dimensions. SPRI produces a composite score from 0 (no risk) to 100 (extreme peg stress) for each stablecoin assessed.

This document provides the business requirements for a Proof of Concept (PoC) build. The objective is to produce a functional demonstration of the SPRI scoring engine and dashboard, ingesting real market and blockchain data, computing scores, storing results, and presenting them through a web-based monitoring interface.

The PoC will cover four major stablecoins (USDC, USDT, USDe and PYUSD) using a starting set of 9 variables grouped into four categories. The build should include a database to store both input data along with the computed scores.

Each variable may have a number of data items used to determine the risk level of that variable

# 2\. Product Overview

## 2.1 What SPRI Does

SPRI is a risk scoring model specifically built for stablecoins. It aims to identify the likelihood that a stablecoin will lose its peg. It does this by ingesting data from external providers and placing it into four categories (reserve composition, market trading behavior, blockchain activity and external media signals). It then proceeds to synthesize this information into a single composite score.

The live production model will include more variables across these four weighted categories. For the purposes of this PoC, we are scoping it down to 9 high signal, API available variables.

## 2.2 Scoring Dimensions

| **Dimension**        |     | **What It Measures**                                                                       | **PoC Variables** |
| -------------------- | --- | ------------------------------------------------------------------------------------------ | ----------------- |
| Reserve Quality      |     | Composition, transparency, and safety of reserve assets backing the stablecoin             | 3                 |
| Market Confidence    |     | Real-time price behaviour, liquidity conditions, and trading patterns on CEX/DEX platforms | 3                 |
| On-Chain Behaviour   |     | Blockchain-native signals: mint/burn activity, supply integrity                            | 1                 |
| Sentiment & External |     | Macro indicators, correlated asset volatility, and external risk context                   | 2                 |

## 2.3 Scoring Ranges

| **Score Range** | **Risk Level** | **Colour** | **Implication**                                                    |
| --------------- | -------------- | ---------- | ------------------------------------------------------------------ |
| 0-25            | Normal         | Green      | Peg is stable.                                                     |
| 26-50           | Elevated       | Amber      | One or more sub-scores showing slightly elevated unusual activity. |
| 51-75           | High Risk      | Orange     | Multiple indicators in stress. Consider reducing exposure.         |
| 76-100          | Critical       | Red        | Depeg is imminent or underway.                                     |

## 2.4 Stablecoins in Scope (PoC) Data sources

| **Stablecoin** | **Issuer**   | **Chains (PoC)** |
| -------------- | ------------ | ---------------- |
| USDC           | Circle       | Ethereum         |
| USDT           | Tether       | Ethereum, Tron   |
| PYUSD          | Paypal/Paxos | Ethereum         |
| sUSD           | Synthetix    | Ethereum         |

Onchain data:

We are evaluating rwa.xyz. Dune, Allium and Range

Supplementary data (where APIs will be needed)

1-2 TBD

## 2.5 Data items

## Refer to Appendix

# 3\. PoC Scope and Objectives

## 3.1 Objectives

The PoC should demonstrate the following:

- Data pipeline: ingest real data from APIs, normalise it, and store it in a structured database
- Scoring engine: compute dimension sub-scores and a composite SPRI score using the weighted model defined in this document
- Persistent storage: store both raw inputs and computed scores in a relational/time-series database to support historical queries and future API access
- Dashboard: a web-based monitoring interface showing current scores, dimension breakdowns, and historical trends for each stablecoin
- Alert thresholds: visual indication of risk level based on the four-category model (Normal / Elevated / High Risk / Critical)

# 4\. Variable Specification

The following 9 variables have been selected for the PoC:

## 4.1 Reserve Quality - 3 variables

Reserve Quality evaluates the composition, transparency, and custodial safety of assets backing each stablecoin.

| **ID** | **Variable**                | **Description**                                                                                        | **API Source**                                                                              | **Frequency**                                |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- | -------------------------------------------- |
| RQ-1   | Reserve composition ratio   | Reserve composition (cash, T-bills, etc.)                                                              | Issuer attestation reports - can we build a scraping tool for this? If not, we can exclude. | Monthly (USDC) / Quarterly (USDT)            |
| RQ-3   | Overcollateralization ratio | Total reserve value / total circulating supply. Buffer above 1.0x absorbs losses.                      | Issuer website - can we build a scraping tool for this? If not, we can exclude.             | Daily (supply) / Monthly-Quarterly (reserve) |
| RQ-4   | Attestation timeliness      | Days since last published attestation vs expected schedule. A late or missing report is a risk signal. | Issuer website - can we build a scraping tool for this? If not, we can exclude.             | Daily check                                  |

## 4.2 Market Confidence - 3 variables

Market Confidence captures real-time price behaviour and liquidity conditions across centralised and decentralised trading platforms.

| **ID** | **Variable**                 | **Description**                                                                                                                                                                                | **API Source**        | **Frequency**    |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------- |
| MC-1   | CEX price deviation from peg | Average trading price across major exchanges, weighted by volume. We measure how far it drifts from \$1.00 in basis points. This is the most visible sign that a stablecoin is losing its peg. | CoinGecko API (free)  | Every 15 minutes |
| MC-5   | DEX pool depth (TVL)         | Total liquidity sitting in the main DEX pools like Curve.                                                                                                                                      | DeFi Llama API (free) | Every 15 minutes |
| MC-8   | Volume anomalies             | Trading volume deviation from 30-day moving average. A volume spike paired with price movement away from the peg is a strong signal something's wrong.                                         | CoinGecko API (free)  | Every 15 minutes |

## 4.3 On-Chain Behaviour - 1 variable

On-Chain Behaviour tracks blockchain-native signals.

| **ID** | **Variable**       | **Description**                                          | **API Source** | **Frequency** |
| ------ | ------------------ | -------------------------------------------------------- | -------------- | ------------- |
| OC-7   | Total supply trend | Tracks the daily rate of change in on-chain totalSupply. | DeFi Llama     | Daily         |

## 4.4 Sentiment & External - 2 variables

Sentiment & External provides macro and cross-asset context.

| **ID** | **Variable**              | **Description**                                                           | **API Source**                       | **Frequency**    |
| ------ | ------------------------- | ------------------------------------------------------------------------- | ------------------------------------ | ---------------- |
| SE-2   | Community Sentiment Score | % of negative sentiment votes for each Stablecoin                         | CoinGecko                            | Every 30 minutes |
| SE-4   | FRED macro indicators     | Fed funds rate. Banking stress indicator correlated with stablecoin risk. | TBD subject to provider confirmation | Daily            |

## 4.5 Reserve Quality Retrieval Tool

Design a configurable tool that connects to a list of issuer URLs and retrieves the page content or attestation report for each stablecoin in scope.

URLs and retrieval schedules are stored in a database table so new issuers can be added without code changes.

Retrieved files ares stored locally with timestamp and source identifiers. Each retrieval attempt is logged with source URL and timestamp.

For the PoC, Reserve Quality variable values can be populated from a seeded static dataset.

# 5\. Scoring Engine Specification

## 5.1 Scoring Approach

The PoC scoring engine uses a straightforward equal-weight approach at the individual variable level. Each variable is normalised to a 0-100 scale. The composite SPRI score is the simple average of all variable scores. Dimensions (Reserve Quality, Market Confidence, On-Chain Behaviour, Sentiment & External) exist as organisational groupings for the dashboard, they do not carry separate weights in the formula.

## 5.2 Normalisation

Each variable is normalised to a 0-100 scale where 0 = no risk signal and 100 = extreme risk signal. Normalisation rules are variable-specific

Nuvanté will provide a detailed normalisation specification spreadsheet (with examples) prior to build start.

## 5.3 Aggregation Formula

The composite SPRI score for each stablecoin is calculated as:

**SPRI = (1/n) × (V₁ + V₂ + V₃ + ... + Vₙ)**

Where V is the normalised score (0-100) for each individual variable and n is the total number of variables. Each variable contributes equally.

Variable weights are stored in a configurable database table, not hardcoded. For the PoC, all weights default to equal (1/n). Weights should be manually updatable in the database at any time without code changes. This is a **hard requirement**. Nuvanté will replace these equal weights with values derived through backtesting and ML-based optmisation in a subsequent phase.

## 5.4 Computation Frequency

The scoring engine should recompute scores every 5 minutes using the latest available data. If a data source has not refreshed since the last computation cycle, the engine should use the most recent stored value (carry-forward).

## 5.5 First Difference Overlay

SPRI may also look at how quickly a variable's normalised score is changing. The system should store the previous normalised score along with the previous timestamp for each variable (as indicated in Section 6.2 below).

We can use the delta as an indicator of the change and trigger a flag (rapid movers within a 24-hour period as displayed on the SPRI Monitor Dashboard) if the normalised score increases by +25 points within a single scoring cycle.

# 6\. Data Architecture

## 6.1 High-Level Pipeline

The data architecture should follow a three-stage pattern: Ingest → Store → Score → Serve.

- **Ingest:** Scheduled jobs pull data from external APIs at defined intervals included in the table below. Each data source has its own ingestion script with error handling and retry logic.
- **Store:** Raw data is written to a time-series database with source metadata (timestamp, source, stablecoin, chain).
- **Score:** The scoring engine reads the latest values from the database, applies normalisation and weighting, and writes computed sub-scores and composite scores back to the database.
- **Serve:** The dashboard reads current and historical scores from the database. A simple REST API layer should sit between the database and front end.

## 6.2 Database Layer

The PoC should use PostgreSQL as the primary data store with the TimescaleDB extension for time-series data. It should ideally track the following (as a reference)

| **Table**         | **Purpose**                            | **Key Columns**                                                       |
| ----------------- | -------------------------------------- | --------------------------------------------------------------------- |
| stablecoins       | Reference data for each stablecoin     | id, symbol, name, issuer, chains                                      |
| data_sources      | Configuration for each data source/API | id, name, api_url, polling_interval, dimension                        |
| raw_metrics       | Raw ingested data from all sources     | timestamp, stablecoin_id, variable_id, value, source, chain           |
| normalised_scores | Per-variable normalised scores (0-100) | timestamp, stablecoin_id, variable_id, normalised_value               |
| dimension_scores  | Per-dimension sub-scores               | timestamp, stablecoin_id, dimension, score                            |
| composite_scores  | Final SPRI composite scores            | timestamp, stablecoin_id, composite_score, risk_level                 |
| alerts            | Threshold breach events                | timestamp, stablecoin_id, previous_level, new_level, trigger_variable |

All raw metric data should be retained indefinitely.

## 6.3 API Data Sources

All PoC data sources use free or low-cost tiers.

| **API**                 | **Data Points Fed**             | **Auth** | **Polling Frequency**                                                                                                                                               |
| ----------------------- | ------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CoinGecko (free tier)   | MC-1, MC-8, SE-2                | API key  | Every 15 minutes (MC-1, MC-8) - I believe we can batch multiple coins in one call, Every 30 minutes (SE-2)<br><br>This combo should keep us below the 10k threshold |
| DeFi Llama              | MC-5, OC-7                      | None     | Every 15 minutes (MC-5), Daily (OC-7)                                                                                                                               |
| Issuer reports (seeded) | RQ-1, RQ-3 (reserve side), RQ-4 | N/A      | Manual                                                                                                                                                              |

# 7\. Dashboard Requirements

## 7.1 Overview

The dashboard is a web-based single-page application providing real-time visibility into SPRI scores. It is the primary output of the PoC and should demonstrate the value proposition clearly to relevant participants.

Refer to Appendix and Lovable prototype.

## 7.2 Technical Preferences

- **Front-end:** React (preferred).
- **Charting:** Recharts or equivalent.
- **Styling:** The visual tone should be institutional and clean.
- **Data refresh:** Poll the backend API every 60 seconds or use WebSocket for real-time push updates.

# 8\. Technical Architecture

## 8.1 Preferred Stack

| **Layer**      | **Technology**                        |
| -------------- | ------------------------------------- |
| Ingestion      | Python (scheduled jobs)               |
| Database       | PostgreSQL + TimescaleDB              |
| Scoring Engine | Python                                |
| Backend API    | Python (FastAPI) or Node.js (Express) |
| Front-end      | React                                 |
| Hosting        | Single cloud instance (AWS/GCP)       |

We welcome feedback from 57blocks on the technology choices.

## 8.2 Architecture Diagram (Logical)

A simplified view of the PoC data flow:

\[CoinGecko\] \[DeFi Llama\] \[On-Chain TBD\] \[Issuer Reports\]

| | | |

v v v v

+----------------------------------------------------------------------+

| INGESTION LAYER (Python) |

+----------------------------------------------------------------------+

|

v

+----------------------------------------------------------------------+

| PostgreSQL + TimescaleDB (raw_metrics) |

+----------------------------------------------------------------------+

|

v

+----------------------------------------------------------------------+

| SCORING ENGINE (normalise -> weight -> aggregate) |

+----------------------------------------------------------------------+

|

v

+----------------------------------------------------------------------+

| PostgreSQL + TimescaleDB (normalised_scores, dimension_scores, |

| composite_scores, alerts) |

+----------------------------------------------------------------------+

|

v

+-------------------+ +-------------------------------------------+

| REST API (FastAPI)| | React Dashboard (SPRI Monitor) |

+-------------------+ +-------------------------------------------+

# 9\. Deliverables and Success Markers

## 9.1 Deliverables

| **#** | **Deliverable**             | **Description**                                                                      | **Format**              |
| ----- | --------------------------- | ------------------------------------------------------------------------------------ | ----------------------- |
| 1     | Data Ingestion Pipeline     | Scheduled scripts pulling data from all API sources, writing to database             | Python scripts + config |
| 2     | Database Schema + Seed Data | PostgreSQL + TimescaleDB schema with seed data for Reserve Quality dimension         | SQL migration scripts   |
| 3     | Scoring Engine              | Normalisation logic, dimension aggregation, composite score calculation              | Python module           |
| 4     | Backend API                 | REST endpoints serving current scores, historical data, dimension breakdowns, alerts | FastAPI or Express      |
| 5     | Dashboard                   | React web application with Monitor and Detail views per Section 7                    | React SPA               |
| 6     | Documentation               | Setup guide, architecture overview, API endpoint docs                                | README + inline docs    |

## 9.2 Success Markers

- the dashboard displays live SPRI scores for all stablecoins, refreshed at least every 5 minutes
- the Monitor View shows the stablecoins clearly, with correct score values and risk-level colour coding
- clicking a stablecoin opens a Detail View with the expected sections, including summary, top drivers, historical trend, variable drill-down, and alert history
- the database contains at least 7 days of historical raw metric data and computed scores
- dimension sub-scores visibly change in response to real market data movements
- the system runs on a single cloud instance or local Docker Compose setup without manual intervention

# 10\. Contacts

| **Name**        | **Role**         | **Responsibility**                       | **Email**            |
| --------------- | ---------------- | ---------------------------------------- | -------------------- |
| Michael Chapman | CEO & Co-Founder | Business requirements, sign-off          | <michael@nuvante.io> |
| Sam Lopez       | CTO & Co-Founder | Technical requirements, SPRI methodology | <samuel@nuvante.io>  |

# 11\. Appendix

## 11.1 Data Items by Variable

Each variable requires one or more underlying data items to compute its score. This table defines what data is needed, its format, and key attributes.

**Reserve Quality**

| Data Item                          | Variable | Data Format      | Attributes                 |
| ---------------------------------- | -------- | ---------------- | -------------------------- |
| Government bonds / T-bills balance | RQ-1     | Currency (USD)   | Issuer, maturity, rating   |
| Cash reserves                      | RQ-1     | Currency (USD)   | Custodian, jurisdiction    |
| Overnight reverse repo             | RQ-1     | Currency (USD)   | Counterparty, maturity     |
| Money market fund holdings         | RQ-1     | Currency (USD)   | Fund name, rating          |
| Total reserve value                | RQ-3     | Currency (USD)   | As reported in attestation |
| Total circulating supply           | RQ-3     | Integer (tokens) | Cross-chain aggregate      |
| Date of last published attestation | RQ-4     | Date             | Issuer, auditor name       |

**Market Confidence**

| Data Item                | Variable | Data Format    | Attributes                   |
| ------------------------ | -------- | -------------- | ---------------------------- |
| Peg target value         | MC-1     | Decimal        | Currency                     |
| DEX pool TVL (USD)       | MC-5     | Currency (USD) | Pool ID, DEX protocol, chain |
| 24h trading volume (USD) | MC-8     | Currency (USD) | Cross-chain aggregate value  |

**On-Chain Behaviour**

| Data Item                  | Variable | Data Format      | Attributes                  |
| -------------------------- | -------- | ---------------- | --------------------------- |
| Current circulating supply | OC-7     | Integer (tokens) | Cross-chain aggregate value |

**Sentiment & External**

| Data Item                  | Variable | Data Format | Attributes           |
| -------------------------- | -------- | ----------- | -------------------- |
| Sentiment votes percentage | SE-2     | Decimal (%) | Per stablecoin       |
| Fed funds effective rate   | SE-4     | Decimal (%) | Daily published rate |

## 11.1 Lovable Prototype

Please click on the link below to access a view only version of the Lovable prototype:

[Lovable Prototype](https://id-preview--75808eb0-c75b-4343-9cf4-4e76c317c9ee.lovable.app/?__lovable_token=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiTno2VkJoOHFpYVdnRkRoZHRNZkNwa0RLUWV2MSIsInByb2plY3RfaWQiOiI3NTgwOGViMC1jNzViLTQzNDMtOWNmNC00ZTc2YzMxN2M5ZWUiLCJhY2Nlc3NfdHlwZSI6InByb2plY3QiLCJpc3MiOiJsb3ZhYmxlLWFwaSIsInN1YiI6Ijc1ODA4ZWIwLWM3NWItNDM0My05Y2Y0LTRlNzZjMzE3YzllZSIsImF1ZCI6WyJsb3ZhYmxlLWFwcCJdLCJleHAiOjE3NzYzMDIwMzYsIm5iZiI6MTc3NTY5NzIzNiwiaWF0IjoxNzc1Njk3MjM2fQ.k__XQFcoGSplUj0gEvrV-W6EfsRqkEgMpeOX9TxFfSDDGTwPmP2jrq7WhvkIWg8AGvIrNgwBtbglOjoK-fmVnGsjiNthn-lJAw8_KMqim5QGeK5ouwbVAuoGjeJ46qEk0wSF7fagqflY4KxblZEfir93rjsUjFxh9W6nayu5zjLRCvwt_eNLkwizU8M7BNZ4kxZJNpvieeDtOwS_IGzparj2etoqLkENYQt0kCAvmQDDBN2C51fIwsyN3UPa3aEV30tboXpwdZmF8bOHxNy62J4Q5DEf3OYEtMATkXjxyNBZT46n97xCV2Wx3_-_Sp9a5yv97xdoy3Xo0Dojr2VmzRv2HnEXGAyrMmyW2XHOiAPov3335nVxzlNRwcOptE9Mw4Amtw1_D8O9GAnhkUh94W7yf4zbSyTUemMn5LGI67HCZRqu4uOfCW-y16L8Zktd7xBOCTl5u6_-RNRSeo8PB6E16mq4WVF7D2WuRb98paMIgcqMrXrpWcC7AxpNz10s_Noz0fbDW5lKBOfH6BoSKwRXHcz6UxNo1vtpIcXK8uE_9qri-cjRzZ28OKJU7VI5-Y71y2O4imRPpggA08FLIq6U-XFKIrdrZn5C4wVo4mGXkHs3hN8Mu2NHYiiV0dfxX4qdcc1YeWg6NuxtdGDwF9YXS5HFvSRdKgMQXAYN_Js)
