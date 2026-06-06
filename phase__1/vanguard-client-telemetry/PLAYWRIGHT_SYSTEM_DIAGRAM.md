# How Playwright Works in This System

## Architecture Diagram

```mermaid
flowchart TB
    subgraph Entry["Entry"]
        A[run.js<br/>CLI args]
        A --> B[runner.ts<br/>runSessions]
    end

    subgraph Playwright["Playwright Engine"]
        C[Chromium<br/>headless]
        B --> C
        C --> D[Browser Context<br/>one per session]
        D --> E[Page<br/>simulates user]
    end

    subgraph MockSite["Mock Website (Vanguard)"]
        F["localhost:3000<br/>trade.html / index.html / help.html"]
    end

    subgraph ScenarioLogic["scenarios.ts"]
        G[selectScenario<br/>weighted mix]
        H1[normal_user]
        H2[frustrated_user]
        H3[lost_user]
        H4[error_user]
        G --> H1
        G --> H2
        G --> H3
        G --> H4
    end

    subgraph Behaviors["behaviors.ts"]
        I1[performClick<br/>rageClick<br/>performDeadClick]
        I2[simulateMouseShake<br/>simulateErraticScroll]
        I3[refocusClick<br/>idle / scroll]
    end

    subgraph Output["Output"]
        LOG[SessionLogger]
        FILE[full_results.json NDJSON]
        LOG --> FILE
    end

    B --> G
    E --> F
    F <--> E
    H1 --> I1
    H2 --> I1
    H2 --> I2
    H3 --> I3
    H4 --> I1
    I1 --> LOG
    I2 --> LOG
    I3 --> LOG
```

---

## Simplified: Playwright Data Flow

```mermaid
flowchart LR
    subgraph Playwright["Playwright"]
        A[run.js]
        B[Chromium]
        C[4 Scenarios]
        A --> B
        B --> C
    end

    D[(Mock Website<br/>Vanguard)]
    E[SessionLogger]
    F[(full_results.json)]

    C -->|navigate and interact| D
    D -->|page events| C
    C -->|log event| E
    E --> F
```

---

## Flow Summary

| Step | Component | Role |
|------|-----------|------|
| 1 | run.js | Parse `--baseUrl`, `--sessions`, `--scenarioMix`, `--output` |
| 2 | runner.ts | Launch Chromium, run sessions in loop |
| 3 | selectScenario | Pick scenario by mix (normal 40%, frustrated 30%, lost 20%, error 10%) |
| 4 | Page + Mock Website | Playwright-controlled page visits Mock site (trade.html, etc.) |
| 5 | scenarios.ts | Run scenario: normal clicks, frustrated rage+shake, lost hesitation+backtrack, error 404 |
| 6 | behaviors.ts | Actions: rageClick, mouse shake, erratic scroll, refocus, etc. |
| 7 | SessionLogger | Write events to NDJSON file |
| 8 | full_results.json | Output for Phase 2 (Matomo, AWS) |

---

## One-line Summary

> **Playwright launches a headless browser, visits the Vanguard Mock site, simulates user behavior across 4 scenarios (clicks, scrolls, idle, etc.), and logs events to NDJSON via SessionLogger for downstream analysis.**
