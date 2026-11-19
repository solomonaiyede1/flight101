import { useEffect, useRef, useState } from "react";
import "./notams.css";

const sections = [
  { id: "overview", label: "Overview", icon: "◫" },
  { id: "route", label: "Route & nav", icon: "⌁" },
  { id: "weather", label: "Weather & terrain", icon: "☼" },
  { id: "fpl", label: "ICAO flight plan", icon: "≡" },
  { id: "notams", label: "NOTAM impact", icon: "!" },
];

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatKg(value) {
  return value == null ? "—" : `${formatNumber(value)} kg`;
}

function App() {
  const inputRef = useRef(null);
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [flight, setFlight] = useState(null);
  const [activeSection, setActiveSection] = useState("overview");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notamText, setNotamText] = useState("");
  const [notamResults, setNotamResults] = useState([]);
  const [notamBusy, setNotamBusy] = useState(false);
  const [hypotheticalRecommendation, setHypotheticalRecommendation] = useState("");
  const [recommendationModel, setRecommendationModel] = useState("");
  const [recommendationBusy, setRecommendationBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("https://flight-backend-32yg.onrender.com/api/auth")
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not check your login.");
        if (active) setAuthenticated(result.authenticated);
      })
      .catch((authCheckError) => {
        if (active) setAuthError(authCheckError.message || "Could not connect to the login service.");
      })
      .finally(() => {
        if (active) setAuthReady(true);
      });
    return () => { active = false; };
  }, []);

  async function submitLogin(username, password) {
    setAuthError("");
    setAuthBusy(true);
    try {
      const response = await fetch("https://flight-backend-32yg.onrender.com/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Sign-in failed.");
      setAuthenticated(true);
    } catch (loginError) {
      setAuthError(loginError.message || "Could not connect to the login service.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    setError("");
    try {
      const response = await fetch("https://flight-backend-32yg.onrender.com/api/logout", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not sign out.");
      setAuthenticated(false);
      setFlight(null);
      setNotamText("");
      setNotamResults([]);
      setHypotheticalRecommendation("");
    } catch (logoutError) {
      setError(logoutError.message || "Could not connect to the login service.");
    }
  }

  async function uploadFile(file) {
    if (!file) return;
    setError("");
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const response = await fetch("https://flight-backend-32yg.onrender.com/api/extract", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          setAuthenticated(false);
          setFlight(null);
        }
        throw new Error(result.error || "Could not process this OFP.");
      }
      setFlight(result);
      setNotamResults([]);
      setNotamText("");
      setHypotheticalRecommendation("");
      setActiveSection("overview");
    } catch (uploadError) {
      setError(uploadError.message || "Could not connect to the OFP extraction service.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function analyzeNotams() {
    setError("");
    setNotamResults([]);
    setHypotheticalRecommendation("");
    setNotamBusy(true);
    try {
      const response = await fetch("/api/analyze-notams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notams: notamText,
          route: flight.route,
          flight: flight.flight,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          setAuthenticated(false);
          setFlight(null);
        }
        throw new Error(result.error || "Could not analyze these NOTAMs.");
      }
      setNotamResults(result.results);
    } catch (analysisError) {
      setError(analysisError.message || "Could not connect to the NOTAM analysis service.");
    } finally {
      setNotamBusy(false);
    }
  }

  async function generateHypotheticalRecommendation() {
    setError("");
    setHypotheticalRecommendation("");
    setRecommendationModel("");
    setRecommendationBusy(true);
    try {
      const response = await fetch("https://flight-backend-32yg.onrender.com/api/hypothetical-recommendation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notams: notamText,
          route: flight.route,
          flight: flight.flight,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401) {
          setAuthenticated(false);
          setFlight(null);
        }
        throw new Error(result.error || "Could not generate a hypothetical recommendation.");
      }
      setHypotheticalRecommendation(result.recommendation);
      setRecommendationModel(result.model);
    } catch (recommendationError) {
      setError(recommendationError.message || "Could not connect to local Ollama.");
    } finally {
      setRecommendationBusy(false);
    }
  }

  function onDrop(event) {
    event.preventDefault();
    uploadFile(event.dataTransfer.files?.[0]);
  }

  async function copyFpl() {
    if (!flight?.icaoFlightPlan) return;
    try {
      await navigator.clipboard.writeText(flight.icaoFlightPlan);
    } catch {
      setError("Clipboard access was denied. Select and copy the flight-plan text instead.");
    }
  }

  const tripFuel = flight?.fuel.find((item) => item.label === "Trip");
  const rampFuel = flight?.fuel.find((item) => item.label === "Ramp fuel");

  if (!authReady) return <LoginScreen loading />;
  if (!authenticated) {
    return (
      <LoginScreen
        busy={authBusy}
        error={authError}
        onSubmit={submitLogin}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">D</div>
          <div><strong>dispatch<span>desk</span></strong><small>FLIGHT OPERATIONS</small></div>
        </div>
        <div className="side-caption">WORKSPACE</div>
        <button className="side-link selected"><span className="side-icon">▤</span> OFP briefing</button>
        <div className="side-caption second-caption">TOOLS</div>
        <div className="side-link muted"><span className="side-icon">⌖</span> Route analysis</div>
        <div className="side-link muted"><span className="side-icon">◷</span> Fuel planning</div>
        <div className="sidebar-bottom">
          <div className="local-badge"><span className="status-dot" /> LOCAL WORKSPACE</div>
          <p>OFP extraction and NOTAM screening run locally. Optional recommendations use the configured Ollama model; cloud endpoints receive screening details.</p>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">Operations <span>/</span> <strong>OFP briefing</strong></div>
          <div className="topbar-right"><span className="secure-label"><span className="status-dot" /> Local processing</span><button className="logout-button" onClick={signOut}>Sign out</button><div className="avatar">AD</div></div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">FLIGHT OPERATIONS · DOCUMENT INTELLIGENCE</div>
              <h1>OFP briefing</h1>
              <p className="subtitle">Extract a reviewable route, then screen ICAO NOTAMs across location, altitude and validity.</p>
            </div>
            {flight && <button className="secondary-button" onClick={() => { setFlight(null); setError(""); setNotamResults([]); setNotamText(""); setHypotheticalRecommendation(""); }}>＋ <span>New briefing</span></button>}
          </div>

          {!flight ? (
            <section className="upload-panel">
              <div className="upload-illustration"><span>↑</span><i /></div>
              <h2>{busy ? "Reading your flight plan…" : "Start with an OFP"}</h2>
              <p>Upload a dispatch PDF to extract flight details, route, fuel, alternates,<br className="desktop-break" /> ETOPS, weather, terrain and the ICAO flight-plan message.</p>
              <div
                className={`drop-zone ${busy ? "busy" : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={onDrop}
                onClick={() => !busy && inputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => event.key === "Enter" && inputRef.current?.click()}
              >
                <span className="file-icon">PDF</span>
                <span><strong>{busy ? "Extracting document" : "Choose a PDF"}</strong><small>or drag and drop it here · up to 20 MB</small></span>
                <span className="browse-button">{busy ? <span className="spinner" /> : "Browse files"}</span>
                <input ref={inputRef} type="file" accept=".pdf,application/pdf" hidden onChange={(event) => uploadFile(event.target.files?.[0])} />
              </div>
              {error && <div className="error-banner" role="alert">{error}</div>}
              <div className="upload-footnote"><span>▣</span> Text-based PDFs supported. Scanned PDFs require OCR, which is not enabled.</div>
            </section>
          ) : (
            <>
              {flight.warnings.length > 0 && <div className="warning-banner"><span className="warning-symbol">!</span><div><strong>Review before operational use</strong>{flight.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div>}
              <section className="flight-banner">
                <div className="flight-banner-main">
                  <span className="flight-tag"><span className="status-dot" /> FLIGHT BRIEFING</span>
                  <div className="flight-number">{flight.flight.number || "Flight plan"} <span>{flight.flight.aircraft || "Aircraft n/a"}</span></div>
                  <div className="flight-meta">{flight.flight.planIdentifiers.join(" / ")} <i /> {flight.flight.date || "Date n/a"} <i /> {flight.pageCount} pages</div>
                </div>
                <div className="route-overview">
                  <div className="airport"><span>DEPARTURE</span><strong>{flight.flight.departure || "—"}</strong><small>RWY {flight.flight.departureRunway || "—"}</small></div>
                  <div className="route-connector"><span>━━━━━━━◈━━━━━━━</span><small>{flight.flight.etd ? `ETD ${flight.flight.etd}` : "PLANNED ROUTE"}</small></div>
                  <div className="airport destination"><span>DESTINATION</span><strong>{flight.flight.destination || "—"}</strong><small>RWY {flight.flight.destinationRunway || "—"}</small></div>
                </div>
              </section>

              <nav className="section-tabs" aria-label="Briefing sections">
                {sections.map((section) => <button key={section.id} className={activeSection === section.id ? "active" : ""} onClick={() => setActiveSection(section.id)}><span>{section.icon}</span>{section.label}</button>)}
              </nav>

              {activeSection === "overview" && (
                <div className="section-body">
                  <div className="metric-grid">
                    <Metric label="TRIP FUEL" value={formatKg(tripFuel?.kilograms)} detail={`Flight time ${flight.flightTime || "—"}`} icon="◉" />
                    <Metric label="RAMP FUEL" value={formatKg(rampFuel?.kilograms)} detail="Planned departure fuel" icon="◌" />
                    <Metric label="ETOPS" value={flight.etops.minutes ? `${flight.etops.minutes} min` : "—"} detail={`${flight.etops.alternates.length} suitable alternates`} icon="⌁" />
                    <Metric label="FLIGHT LEVELS" value={flight.route.flightLevels.map((level) => `FL${level}`).join(" · ") || "—"} detail="Planned en-route levels" icon="↗" compact />
                  </div>
                  <div className="overview-grid">
                    <section className="content-card">
                      <CardTitle title="Flight snapshot" badge="EXTRACTED FROM OFP" />
                      <div className="detail-rows">
                        <Detail label="Planned departure (as printed)" value={flight.flight.etd || "—"} />
                        <Detail label="Scheduled arrival (as printed)" value={flight.flight.sta || "—"} />
                        <Detail label="Header date" value={flight.flight.date || "—"} />
                        <Detail label="FPL date of flight" value={flight.flight.fplDateOfFlight || "Not stated"} />
                        <Detail label="Route waypoints" value={flight.route.waypoints.length} />
                      </div>
                      <div className="route-preview"><span className="mini-label">ROUTE</span><p>{flight.route.text || "Route not identified"}</p><button onClick={() => setActiveSection("route")}>View route & navigation <span>→</span></button></div>
                    </section>
                    <section className="content-card">
                      <CardTitle title="Alternates & ETOPS" badge="DISPATCH PLAN" />
                      <div className="alternate-list">
                        {flight.alternates.map((alternate) => <div className="alternate-row" key={alternate.airport}><span className="airport-code">{alternate.airport}</span><span className="alternate-runway">RWY {alternate.runway}<small>{alternate.distanceNm} NM · FL{alternate.flightLevel}</small></span><span className="alternate-time">{alternate.time}<small>{formatNumber(alternate.fuelKg)} kg</small></span></div>)}
                        {!flight.alternates.length && <p className="empty-state">No destination alternates identified.</p>}
                      </div>
                      <div className="etops-strip"><span>ETOPS SUITABLE</span><strong>{flight.etops.alternates.join(" · ") || "Not listed"}</strong><small>{flight.etops.minutes ? `${flight.etops.minutes}-minute diversion capability` : "ETOPS data unavailable"}</small></div>
                    </section>
                  </div>
                  <section className="assistant-card">
                    <div className="assistant-icon">✳</div>
                    <div><span className="assistant-label">BRIEFING ASSIST</span><h3>Key items to review</h3><p>{flight.warnings.length ? "Resolve the date discrepancy shown above against the current dispatch release. " : "Confirm the extracted details against the source OFP. "}{flight.weatherAndTerrain.highestMoraValue ? `The route table reports a highest MORA value of ${flight.weatherAndTerrain.highestMoraValue} at ${flight.weatherAndTerrain.highestMoraWaypoint}; the unit is not inferred.` : "Review the route weather and terrain tables before departure."}</p></div>
                    <button onClick={() => setActiveSection("weather")}>Review conditions <span>→</span></button>
                  </section>
                  <SourceDisclosure text={flight.sourceText} />
                </div>
              )}

              {activeSection === "route" && (
                <div className="section-body">
                  <section className="content-card route-card">
                    <CardTitle title="Planned route" badge={`${flight.route.waypoints.length} WAYPOINTS`} />
                    <p className="route-text">{flight.route.text || "Route not identified"}</p>
                    <div className="route-point-scroll">
                      <div className="route-point-table" role="table" aria-label="Structured route points">
                        <div className="route-point-row route-point-header" role="row">
                          <span role="columnheader">Waypoint</span><span role="columnheader">Coordinates</span><span role="columnheader">Airway</span><span role="columnheader">FIR</span><span role="columnheader">ETO (UTC)</span><span role="columnheader">Planned FL</span>
                        </div>
                        {(flight.route.points || []).map((point, index) => (
                          <div className="route-point-row" role="row" key={`${point.name}-${index}`}>
                            <strong role="cell">{point.name}</strong>
                            <span role="cell">{point.coordinates ? `${point.coordinates.lat.toFixed(4)}, ${point.coordinates.lon.toFixed(4)}` : "—"}</span>
                            <span role="cell">{point.airway || "—"}</span>
                            <span role="cell">{point.fir || "—"}</span>
                            <span role="cell">{point.eto ? point.eto.slice(11, 16) : "—"}</span>
                            <span role="cell">{point.flightLevel ? `FL${point.flightLevel}` : "—"}</span>
                          </div>
                        ))}
                        {!flight.route.points?.length && <p className="empty-state">No structured route points were extracted.</p>}
                      </div>
                    </div>
                    <div className="route-stat-row"><Detail label="Airways" value={flight.route.airways.join(" · ") || "Not identified"} /><Detail label="Flight levels" value={flight.route.flightLevels.map((level) => `FL${level}`).join(" · ") || "Not identified"} /></div>
                  </section>
                  <section className="content-card"><CardTitle title="Navigation frequencies" badge={`${flight.route.frequencies.length} IDENTIFIED`} /><div className="frequency-grid">{flight.route.frequencies.map((item, index) => <div className="frequency-row" key={`${item.identifier}-${index}`}><span>{item.identifier}</span><strong>{item.mhz} <small>MHz</small></strong></div>)}{!flight.route.frequencies.length && <p className="empty-state">No frequencies identified in the document.</p>}</div></section>
                  <SourceDisclosure text={flight.weatherAndTerrain.performanceTable} label="Open route performance & navigation table" />
                </div>
              )}

              {activeSection === "weather" && (
                <div className="section-body">
                  <section className="content-card terrain-summary"><div className="terrain-icon">△</div><div><span className="mini-label">HIGHEST ROUTE MORA · OFP VALUE</span><strong>{flight.weatherAndTerrain.highestMoraValue ?? "Not identified"}</strong><small>{flight.weatherAndTerrain.highestMoraWaypoint ? `At ${flight.weatherAndTerrain.highestMoraWaypoint} · unit not inferred` : "Check the source terrain table"}</small></div><div className="terrain-note">Displayed as reported in the OFP; no unit conversion is assumed. Check the underlying chart and current operational data.</div></section>
                  {flight.weatherAndTerrain.weatherSummary.length > 0 && <section className="content-card"><CardTitle title="OFP weather & performance notes" badge="SOURCE VALUES" /><div className="weather-notes">{flight.weatherAndTerrain.weatherSummary.map((line) => <p key={line}>{line}</p>)}</div></section>}
                  <SourceDisclosure text={flight.weatherAndTerrain.routeTable} label="Open route weather table (wind, temperature & shear)" />
                  <SourceDisclosure text={flight.weatherAndTerrain.performanceTable} label="Open navigation, winds & performance table" />
                </div>
              )}

              {activeSection === "fpl" && (
                <div className="section-body">
                  <section className="content-card fpl-card"><div className="fpl-header"><CardTitle title="ICAO flight-plan message" badge={flight.icaoFlightPlan ? "SOURCE TEXT" : "NOT FOUND"} /><button className="secondary-button copy-button" onClick={copyFpl} disabled={!flight.icaoFlightPlan}>Copy FPL</button></div>{flight.icaoFlightPlan ? <pre className="fpl-text">{flight.icaoFlightPlan}</pre> : <p className="empty-state">No ICAO flight-plan message was found in this document.</p>}</section>
                  <SourceDisclosure text={flight.sourceText} />
                </div>
              )}
              {activeSection === "notams" && (
                <div className="section-body">
                  <section className="content-card notam-entry">
                    <CardTitle title="Screen NOTAMs against this route" badge="ICAO FORMAT" />
                    <p className="notam-help">Paste one or more NOTAMs, including their Q-line, validity fields and E) description. Separate NOTAMs with a blank line.</p>
                    <textarea
                      aria-label="ICAO NOTAM text"
                      value={notamText}
                      onChange={(event) => {
                        setNotamText(event.target.value);
                        setNotamResults([]);
                        setHypotheticalRecommendation("");
                      }}
                      placeholder={"A1234/26 NOTAMN\nQ) XXXX/QXXXX/IV/NBO/E/000/999/5120N00027W005\nA) XXXX B) 2611050400 C) 2611050800\nE) Example restriction text"}
                      rows={8}
                    />
                    <div className="notam-submit-row">
                      <span>Missing coordinates, flight levels or times are reported as undetermined, not clear.</span>
                      <button className="primary-button" onClick={analyzeNotams} disabled={notamBusy || !notamText.trim()}>
                        {notamBusy ? "Analyzing…" : "Analyze NOTAMs"}
                      </button>
                    </div>
                  </section>
                  <section className="content-card hypothetical-card">
                    <div className="hypothetical-heading">
                      <div>
                        <CardTitle title="Hypothetical AI recommendation" badge="OLLAMA MODEL" />
                        <p>
                          Drafted from the screening results for review only. It is not an operational decision.
                          {!notamResults.length && " Analyze NOTAMs above to enable the button."}
                        </p>
                      </div>
                      <button
                        className="secondary-button"
                        onClick={generateHypotheticalRecommendation}
                        disabled={recommendationBusy || notamBusy || notamResults.length === 0}
                      >
                        {recommendationBusy ? "Generating…" : "Generate hypothetical recommendation"}
                      </button>
                    </div>
                    {hypotheticalRecommendation && (
                      <div className="hypothetical-output" aria-live="polite">
                        <strong>Hypothetical draft · {recommendationModel}</strong>
                        <p>{hypotheticalRecommendation}</p>
                      </div>
                    )}
                  </section>
                  {notamResults.map((result, index) => (
                    <section className="content-card notam-result" key={`${result.notam.identifier || "notam"}-${index}`}>
                      <div className="notam-result-heading">
                        <CardTitle title={result.notam.identifier || `NOTAM ${index + 1}`} badge={result.impact.replace("_", " ").toUpperCase()} />
                        <span className={`impact-status ${result.impact}`}>{result.impact.replace("_", " ")}</span>
                      </div>
                      <p className="notam-condition">{result.notam.condition || "E) description not identified"}</p>
                      <div className="notam-dimensions">
                        <Detail label="Spatial" value={result.dimensions.spatial} />
                        <Detail label="Altitude" value={result.dimensions.altitude} />
                        <Detail label="Time" value={result.dimensions.time} />
                        <Detail label="FIR comparison" value={result.evidence.firMatch} />
                        <Detail label="Matched route items" value={result.evidence.matchedRouteItems.join(" · ") || "None identified"} />
                      </div>
                      {result.evidence.nearestGeometryDistanceNm != null && <p className="notam-distance">Nearest route geometry: {result.evidence.nearestGeometryDistanceNm} NM from the NOTAM {result.notam.geometry?.type === "polygon" ? "boundary" : "center"}.</p>}
                      <div className="notam-recommendation"><strong>Recommendation: {result.recommendedAction.type.replace("_", " ")}</strong><p>{result.recommendedAction.rationale}</p></div>
                      {result.recommendedAction.otherOptionsToAssess?.length > 0 && <div className="notam-alternatives"><strong>Other options to assess</strong>{result.recommendedAction.otherOptionsToAssess.map((option) => <p key={option.type}><b>{option.type.replace("_", " ")}</b> — {option.rationale}</p>)}</div>}
                      {result.notam.warnings.map((warning) => <p className="notam-warning" key={warning}>{warning}</p>)}
                      <details className="notam-raw"><summary>Review parsed NOTAM fields</summary><pre>{JSON.stringify({ qLine: result.notam.qLine, validity: result.notam.validity, geometry: result.notam.geometry }, null, 2)}</pre></details>
                    </section>
                  ))}
                  <p className="notam-disclaimer">Screening support only. NOTAM scope, schedules, route data and proposed actions must be checked by a dispatcher against current authoritative sources. This tool does not authorize flight-plan changes.</p>
                </div>
              )}
              {error && <div className="error-banner" role="alert">{error}</div>}
              <footer className="disclaimer">For briefing support only. Always verify extracted values against the current, authoritative OFP and operational sources.</footer>
            </>
          )}
          {!flight && <footer className="landing-disclaimer">Extraction is deterministic and runs locally. Always verify extracted values against the current, authoritative OFP.</footer>}
        </div>
      </main>
    </div>
  );
}

function Metric({ label, value, detail, icon, compact }) {
  return <div className="metric-card"><div className="metric-top"><span>{label}</span><i>{icon}</i></div><strong className={compact ? "compact-value" : ""}>{value}</strong><small>{detail}</small></div>;
}

function LoginScreen({ busy = false, error = "", loading = false, onSubmit }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(username, password);
  }

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="brand login-brand">
          <div className="brand-mark">D</div>
          <div><strong>dispatch<span>desk</span></strong><small>FLIGHT OPERATIONS</small></div>
        </div>
        {loading ? (
          <div className="login-loading"><span className="spinner" /> Checking your session…</div>
        ) : (
          <>
            <h1>Sign in</h1>
            <p>Sign in to access the flight operations workspace.</p>
            <form className="login-form" onSubmit={handleSubmit}>
              <label htmlFor="login-username">Username</label>
              <input
                id="login-username"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              {error && <div className="error-banner" role="alert">{error}</div>}
              <button className="primary-button login-submit" type="submit" disabled={busy}>
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

function CardTitle({ title, badge }) {
  return <div className="card-title"><h2>{title}</h2><span>{badge}</span></div>;
}

function Detail({ label, value }) {
  return <div className="detail-row"><span>{label}</span><strong>{value ?? "—"}</strong></div>;
}

function SourceDisclosure({ text, label = "View extracted source text" }) {
  return <details className="source-disclosure"><summary>{label}<span>Reviewable source · expand</span></summary><pre>{text || "No source table available."}</pre></details>;
}

export default App;
