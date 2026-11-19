# Dispatch Desk

A local-first React and Flask application for reviewing dispatch OFPs and screening ICAO NOTAMs against an extracted route. The OFP parser extracts selectable PDF text with `pypdf` and presents flight identifiers, route points, fuel, alternates, ETOPS, flight levels, navigation frequencies, weather/terrain source tables, and the ICAO flight-plan message. The NOTAM workflow parses Q-line classification, validity and vertical limits, plus Q-line circle or supported E-line polygon geometry, then compares them with route waypoint/airway text, available coordinates, flight levels and planned flight times. An optional button can ask a local Ollama model to draft a hypothetical note from those deterministic screening results.

## Run locally

Requirements: Python 3.10+ and Node.js 18+.

1. Start the Flask API from the repository root:

   ```powershell
   python -m pip install -r backend\requirements.txt
   python backend\app.py
   ```

2. In another terminal, start the React application:

   ```powershell
   cd frontend
   npm install
   npm run dev
   ```

3. Open the local URL shown by Vite (usually `http://localhost:5173`).

The frontend proxies `/api` requests to Flask on `127.0.0.1:5000`. Uploaded files are read in memory and are not saved by the application. Extraction and screening run locally. By default, optional AI recommendations use a local Ollama server at `127.0.0.1:11434`; install Ollama and run `ollama pull llama3.2:3b` for the default model. Set `DISPATCH_OLLAMA_MODEL` before starting Flask to use another model.

To use Ollama Cloud, configure these environment variables in the same terminal before starting Flask:

```powershell
$env:DISPATCH_OLLAMA_CHAT_URL = "https://ollama.com/api/chat"
$env:DISPATCH_OLLAMA_API_KEY = "<your-rotated-Ollama-API-key>"
$env:DISPATCH_OLLAMA_MODEL = "<model-name-from-Ollama>"
python backend\app.py
```

The API key is read only from the environment and must not be added to source files. Cloud recommendations send the analyzed NOTAM screening findings (including route-related evidence) to the configured Ollama endpoint; OFP extraction and deterministic screening remain local. If the key was shared in a chat or other public place, revoke it and create a replacement before using it. Google Fonts are loaded by the browser when internet access is available.

The workspace requires a sign-in. The local demo credentials are `admin@gmail.com` / `admin`; change them before exposing the service to other users or networks. Configure `DISPATCH_ADMIN_USERNAME` and `DISPATCH_ADMIN_PASSWORD` to override the local defaults, or set `DISPATCH_ADMIN_PASSWORD_HASH` to use a Werkzeug password hash. Set `DISPATCH_SESSION_SECRET` to a long, persistent random secret in deployed environments, and enable `DISPATCH_COOKIE_SECURE=true` when serving over HTTPS. Sessions use HTTP-only, SameSite=Lax cookies and expire after eight hours.

After uploading an OFP, open **NOTAM impact** and paste one or more NOTAMs with their Q-line, B)/C) validity and E) description. Separate NOTAMs with a blank line. The API is also available as `POST /api/analyze-notams` with JSON containing `notams`, the extracted `route`, and `flight` objects.

## Tests

From the repository root:

```powershell
python -m unittest discover -s backend -v
```

## Limitations and operational use

Only text-based PDFs are supported. Scanned/image-only PDFs require OCR, which is intentionally not enabled. Extraction is deterministic and may miss fields in OFPs with different layouts; route coordinates, FIRs and ETOs are exposed only when present in a form the parser can identify, and are not inferred. NOTAM schedules in D) are displayed but not evaluated, and the parser does not resolve every NOTAM geometry or operational qualifier. Missing evidence is reported as undetermined rather than no impact. AI-generated text is hypothetical and may be incorrect; it must not override deterministic findings or authoritative sources. Verify NOTAMs and route data and obtain required dispatch/ATC approval. The supplied demo password is intentionally weak and must not be used in a network-exposed deployment. This tool is not an operational flight-planning system.
