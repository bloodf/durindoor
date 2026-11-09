# Blocked Port Revalidation Report (Issue #1149)

Revalidation audit conducted on 2026-11-07 for DurinDoor v5 against the four historically blocked domains under Issue #1149.

## Overview

This document records the exact historical blocker, current source evidence, external prerequisite/owner, evaluated disposition, and next action for each of the four designated domains. No live infrastructure calls, credential rotations, or data mutations were performed.

---

## Domain 1: Session & Browser Integration
- **Historical Blocker:** Lack of dedicated headful/headless browser session state isolation and automated multi-tab context persistence within the Next.js frontend and open-sse gateways.
- **Current Source Fact:** Codebase inspects clean separation between Next.js UI (`src/`) and gateway routing (`open-sse/`), with Vitest suites covering translator and transport layers. However, integrated browser session synchronization under high concurrency remains gated by sandbox constraints.
- **External Prerequisite / Owner:** Integration Owner / Frontend Engineering (Upstream decolua/9router session management parity).
- **Disposition:** Deferred pending upstream stabilization of session drivers and dedicated container isolation.
- **Next Action:** Monitor upstream release streams for stable session management patches before attempting integration.

---

## Domain 2: Entra ID (Azure AD) Authentication
- **Historical Blocker:** Absence of enterprise-grade OpenID Connect / Microsoft Entra ID claims validation middleware inside the `/v1` gateway authentication adapters.
- **Current Source Fact:** Gateway auth relies primarily on local SQLite API key tables and bearer token validation without native multi-tenant enterprise federation endpoints.
- **Enterprise Prerequisite / Owner:** Security Engineering / Enterprise Architecture Group.
- **Disposition:** Blocked on enterprise tenant credentials, certificate registration, and multi-tenant test rigs.
- **Next Action:** Keep tenant federation adapters in backlog; do not implement without explicit enterprise authorization.

---

## Domain 3: Nix Packaging & Reproducible Environment
- **Historical Blocker:** Missing complete `flake.nix` and `default.nix` declarations for unprivileged hermetic container builds across different architectures (`arm64`/`x64`).
- **Current Source Fact:** Standard npm/Node 26 packaging and Docker tooling exist, but fully declarative Nix flake pipelines for hermetic C/C++ dependencies (`sqlite3`, native bindings) remain incomplete.
- **External Prerequisite / Owner:** Infrastructure & Tooling Team.
- **Disposition:** Deferred pending container registry consolidation and standard build pipeline hardening.
- **Next Action:** Retain standard npm/Docker build flows as primary targets; defer Nix packaging until post-V5 stabilisation.

---

## Domain 4: Agent Attribution & Telemetry Lineage
- **Historical Blocker:** Lack of fine-grained metadata propagation for subagent attribution across async gateway proxy hops and tool execution boundaries.
- **Current Source Fact:** Trace headers and logging exist in `open-sse/translator/`, but granular downstream tracing of multi-tier agent identity requires end-to-end context propagation specs.
- **External Prerequisite / Owner:** Core Architecture & Telemetry Team.
- **Disposition:** Partially addressed via structured logging, but complete provenance tracking remains blocked on upstream protocol definitions.
- **Next Action:** Maintain existing telemetry hooks; align downstream provenance schema when upstream stabilizes tracing specs.

