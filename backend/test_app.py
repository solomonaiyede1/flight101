import io
import json
import urllib.error
import unittest
from unittest.mock import patch

import app as app_module
from app import app, _parse_navigation_table, parse_icao_notam, parse_ofp


SAMPLE_OFP = """PAGE 1/13 DPJ893D/PD893A  14JUN P0800 ZBAD/OTHH P0300  B77W XXBET
ETOPS:180MIN
PKX-40E:ZBAD 11L IDKEX B339 ASILA A575 UPREK W28 LAGEB
FL341 ADMUX/FL361 PURPA/FL360 KABRA/FL380
                  FUEL    TIME
TAXI               654    0018
TRIP             64159    0834
MIN FUEL REQ     76850    1042
RAMP FUEL         81190    1127
ETD              15/1500
STA 15/0155
DEST ALTN DIST FL    WC    TIME FUEL ROUTE
OOMS 26L 0426 330 P008 0108 7773 BUNDU B415 RURAL
OEDF 34R 0245 290 M002 0046 5438 ALVEN P430 RAMKI
OERK 33R 0639 280 P002 0139 11241 DATRI
OEJN 34R 0987 280 P002 0222 15932 DATRI
GRND ALTM CHK:
ETOPS SUITABLE ALTN AIRPORTS:
ZLLL 01
ZWWW 26L
AWY            ITT       FL  WIND
PG 114.30
PAGE 12/13 DPJ893D/PD893A
HIGHEST MORA IS 276 AT PURPA
(FPL-DPJ893D-IS
-B77W/H-SDE1E3
-ZBAD1500
-K0896S1040 IDKEX B339 ASILA
-OTHH0824 OOMS OEDF
-PBN/A1B1C1 DOF/260615 REG/XXBET RALT/ZLLL ZWWW
RMK/TCAS PAX FLIGHT)"""


def authenticated_client():
    client = app.test_client()
    response = client.post(
        "/api/login",
        json={"username": "admin@gmail.com", "password": "admin"},
    )
    if response.status_code != 200:
        raise AssertionError("Could not sign in test client.")
    return client


class ParseOFPTests(unittest.TestCase):
    def test_extracts_dispatch_fields_without_reconciling_date(self):
        result = parse_ofp(SAMPLE_OFP, 1)
        self.assertEqual(result["flight"]["number"], "DPJ893")
        self.assertEqual(result["flight"]["aircraft"], "B77W")
        self.assertEqual(result["flight"]["departure"], "ZBAD")
        self.assertEqual(result["flight"]["destination"], "OTHH")
        self.assertEqual(result["flight"]["date"], "14JUN")
        self.assertEqual(result["flight"]["fplDateOfFlight"], "2026-06-15")
        self.assertEqual(result["flight"]["etd"], "15/1500")
        self.assertEqual(result["flight"]["sta"], "15/0155")
        self.assertTrue(any("Date fields differ" in warning for warning in result["warnings"]))
        self.assertEqual(result["route"]["flightLevels"], [380, 361, 360, 341])
        self.assertEqual(result["route"]["firs"], [])
        self.assertTrue(all("coordinates" in point and "eto" in point for point in result["route"]["points"]))
        self.assertEqual(result["route"]["frequencies"], [{"identifier": "PG", "mhz": "114.30"}])
        self.assertTrue(result["icaoFlightPlan"].startswith("(FPL-DPJ893D"))

    def test_extracts_route_fuel_alternates_and_etops(self):
        result = parse_ofp(SAMPLE_OFP, 1)
        self.assertIn("ASILA", result["route"]["waypoints"])
        self.assertEqual(result["fuel"][1]["kilograms"], 64159)
        self.assertEqual(result["flightTime"], "08:34")
        self.assertEqual(
            [item["airport"] for item in result["alternates"]],
            ["OOMS", "OEDF", "OERK", "OEJN"],
        )
        self.assertEqual(result["etops"]["minutes"], 180)
        self.assertEqual(result["etops"]["alternates"], ["ZLLL", "ZWWW"])
        self.assertEqual(result["weatherAndTerrain"]["highestMoraValue"], 276)

    def test_upload_endpoint_reports_validation_errors(self):
        client = app.test_client()
        unauthorized = client.post("/api/extract")
        self.assertEqual(unauthorized.status_code, 401)
        client.post(
            "/api/login",
            json={"username": "admin@gmail.com", "password": "admin"},
        )
        missing = client.post("/api/extract")
        self.assertEqual(missing.status_code, 400)
        unsupported = client.post(
            "/api/extract",
            data={"file": (io.BytesIO(b"not a pdf"), "ofp.txt")},
        )
        self.assertEqual(unsupported.status_code, 415)


class AuthenticationTests(unittest.TestCase):
    def test_default_credentials_create_a_session(self):
        client = app.test_client()
        response = client.post(
            "/api/login",
            json={"username": "admin@gmail.com", "password": "admin"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["authenticated"])
        self.assertTrue(client.get("/api/auth").get_json()["authenticated"])
        protected = client.post("/api/analyze-notams", json={})
        self.assertEqual(protected.status_code, 400)
        protected_recommendation = client.post("/api/hypothetical-recommendation", json={})
        self.assertEqual(protected_recommendation.status_code, 400)

    def test_invalid_credentials_do_not_authenticate(self):
        client = app.test_client()
        response = client.post(
            "/api/login",
            json={"username": "admin@gmail.com", "password": "wrong"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertFalse(client.get("/api/auth").get_json()["authenticated"])
        self.assertEqual(client.post("/api/analyze-notams", json={}).status_code, 401)
        self.assertEqual(client.post("/api/hypothetical-recommendation", json={}).status_code, 401)

    def test_logout_revokes_access_to_protected_endpoints(self):
        client = app.test_client()
        client.post(
            "/api/login",
            json={"username": "admin@gmail.com", "password": "admin"},
        )
        response = client.post("/api/logout")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(client.get("/api/auth").get_json()["authenticated"])
        self.assertEqual(client.post("/api/analyze-notams", json={}).status_code, 401)
        self.assertEqual(client.post("/api/hypothetical-recommendation", json={}).status_code, 401)


class NotamAnalysisTests(unittest.TestCase):
    NOTAM = """A1234/26 NOTAMN
Q) XXXX/QXXXX/IV/NBO/E/340/380/5120N00027W005
A) XXXX B) 2606151510 C) 2606151600
E) AIRWAY B339 CLOSED AT IDKEX"""

    def test_parses_q_line_geometry_and_validity(self):
        result = parse_icao_notam(self.NOTAM)
        self.assertEqual(result["fir"], "XXXX")
        self.assertEqual(result["qLine"]["code"], "QXXXX")
        self.assertEqual(result["qLine"]["lowerFlightLevel"], 340)
        self.assertEqual(result["geometry"]["radiusNm"], 5)
        self.assertAlmostEqual(result["geometry"]["center"]["lat"], 51 + 20 / 60)
        self.assertEqual(result["validity"]["start"], "2026-06-15T15:10:00+00:00")
        self.assertEqual(result["condition"], "AIRWAY B339 CLOSED AT IDKEX")
        self.assertEqual(result["warnings"], [])

    def test_analyzes_confirmed_route_altitude_and_time_overlap(self):
        client = authenticated_client()
        response = client.post(
            "/api/analyze-notams",
            json={
                "notams": self.NOTAM,
                "route": {
                    "waypoints": ["IDKEX", "ASILA"],
                    "airways": ["B339"],
                    "flightLevels": [360],
                    "firs": [],
                    "points": [
                        {
                            "name": "IDKEX",
                            "coordinates": None,
                            "airway": "B339",
                            "flightLevel": 360,
                            "eto": "2026-06-15T15:20:00+00:00",
                        }
                    ],
                },
                "flight": {
                    "departure": "ZBAD",
                    "destination": "OTHH",
                    "fplDateOfFlight": "2026-06-15",
                    "etd": "15/1500",
                    "sta": "16/0155",
                },
            },
        )
        self.assertEqual(response.status_code, 200)
        result = response.get_json()["results"][0]
        self.assertEqual(result["impact"], "affected")
        self.assertEqual(result["dimensions"], {
            "spatial": "intersects",
            "altitude": "intersects",
            "time": "intersects",
        })
        self.assertEqual(result["recommendedAction"]["type"], "reroute")

    def test_missing_route_evidence_is_undetermined_not_clear(self):
        response = authenticated_client().post(
            "/api/analyze-notams",
            json={
                "notams": self.NOTAM,
                "route": {
                    "waypoints": ["OTHER"],
                    "airways": [],
                    "flightLevels": [],
                    "firs": ["XXXX"],
                },
                "flight": {},
            },
        )
        result = response.get_json()["results"][0]
        self.assertEqual(result["impact"], "undetermined")
        self.assertEqual(result["dimensions"]["spatial"], "unknown")
        self.assertEqual(result["recommendedAction"]["type"], "manual_review")

    def test_geospatial_engine_detects_route_segment_intersection(self):
        response = authenticated_client().post(
            "/api/analyze-notams",
            json={
                "notams": self.NOTAM,
                "route": {
                    "waypoints": ["POINT1", "POINT2"],
                    "airways": [],
                    "flightLevels": [360],
                    "points": [
                        {
                            "name": "POINT1",
                            "coordinates": {"lat": 51.3333, "lon": -0.5},
                            "eto": "2026-06-15T15:20:00+00:00",
                        },
                        {
                            "name": "POINT2",
                            "coordinates": {"lat": 51.3333, "lon": 0.5},
                            "eto": "2026-06-15T15:30:00+00:00",
                        },
                    ],
                },
                "flight": {
                    "fplDateOfFlight": "2026-06-15",
                    "etd": "15/1500",
                    "sta": "16/0155",
                },
            },
        )
        result = response.get_json()["results"][0]
        self.assertEqual(result["dimensions"]["spatial"], "intersects")
        self.assertEqual(result["impact"], "affected")
        self.assertLessEqual(result["evidence"]["nearestGeometryDistanceNm"], 5)

    def test_geospatial_engine_detects_polygon_crossing(self):
        polygon_notam = self.NOTAM.replace(
            "E) AIRWAY B339 CLOSED AT IDKEX",
            "E) AREA BOUNDED BY 5120N00030W 5125N00030W "
            "5125N00020W 5120N00020W",
        )
        response = authenticated_client().post(
            "/api/analyze-notams",
            json={
                "notams": polygon_notam,
                "route": {
                    "waypoints": [],
                    "airways": [],
                    "flightLevels": [360],
                    "points": [
                        {
                            "name": "P1",
                            "coordinates": {"lat": 51.375, "lon": -0.6},
                            "eto": "2026-06-15T15:20:00+00:00",
                        },
                        {
                            "name": "P2",
                            "coordinates": {"lat": 51.375, "lon": -0.2},
                            "eto": "2026-06-15T15:30:00+00:00",
                        },
                    ],
                },
                "flight": {
                    "fplDateOfFlight": "2026-06-15",
                    "etd": "15/1500",
                    "sta": "16/0155",
                },
            },
        )
        result = response.get_json()["results"][0]
        self.assertEqual(result["notam"]["geometry"]["type"], "polygon")
        self.assertEqual(result["dimensions"]["spatial"], "intersects")
        self.assertEqual(result["impact"], "affected")

    def test_navigation_table_adds_waypoint_eto_fir_and_level(self):
        table = """AWY            ITT       FL  WIND
WPT / FREQ     IMT  DIS  SPD GS/TAS    MORA CTM RTA ATA        RFOB
W28            248        361  295/050   P05   4 ....   ....
FIX01          252   6  0.830 452/486    63 0012                59.2
                          LONDON FIR EGTT
N4121.0E10529.8     39                 63 0013                59.1"""
        result = _parse_navigation_table(table, "2026-06-15", "15/1500")
        self.assertIn("W28", result["airways"])
        self.assertEqual(result["flightLevels"], {361})
        self.assertEqual(result["firs"], ["EGTT"])
        self.assertEqual(result["points"][0]["eto"], "2026-06-15T15:12:00+00:00")
        self.assertEqual(result["points"][0]["flightLevel"], 361)
        self.assertEqual(result["points"][1]["fir"], "EGTT")
        self.assertAlmostEqual(result["points"][1]["coordinates"]["lat"], 41 + 21 / 60)

    def test_notam_schedule_prevents_false_time_clearance(self):
        scheduled = self.NOTAM.replace(
            "C) 2606151600", "C) 2606151600\nD) DLY 1500-1600"
        )
        response = authenticated_client().post(
            "/api/analyze-notams",
            json={
                "notams": scheduled,
                "route": {
                    "waypoints": ["IDKEX"],
                    "airways": ["B339"],
                    "flightLevels": [360],
                },
                "flight": {
                    "fplDateOfFlight": "2026-06-15",
                    "etd": "15/1500",
                    "sta": "16/0155",
                },
            },
        )
        result = response.get_json()["results"][0]
        self.assertEqual(result["dimensions"]["time"], "unknown")
        self.assertEqual(result["impact"], "undetermined")

    def test_point_level_and_notam_time_can_prove_no_impact(self):
        response = authenticated_client().post(
            "/api/analyze-notams",
            json={
                "notams": self.NOTAM.replace(
                    "2606151510 C) 2606151600",
                    "2606161510 C) 2606161600",
                ),
                "route": {
                    "waypoints": ["IDKEX"],
                    "airways": ["B339"],
                    "flightLevels": [360],
                    "points": [
                        {
                            "name": "IDKEX",
                            "coordinates": None,
                            "airway": "B339",
                            "flightLevel": 330,
                            "eto": "2026-06-15T15:20:00+00:00",
                        }
                    ],
                },
                "flight": {
                    "fplDateOfFlight": "2026-06-15",
                    "etd": "15/1500",
                    "sta": "16/0155",
                },
            },
        )
        result = response.get_json()["results"][0]
        self.assertEqual(result["dimensions"]["altitude"], "separate")
        self.assertEqual(result["dimensions"]["time"], "separate")
        self.assertEqual(result["impact"], "no_impact")
        self.assertEqual(result["recommendedAction"]["type"], "no_action")

    def test_validation_errors_for_missing_notams(self):
        response = authenticated_client().post(
            "/api/analyze-notams",
            json={"notams": "", "route": {}, "flight": {}},
        )
        self.assertEqual(response.status_code, 400)

    def test_hypothetical_recommendation_uses_configured_model_and_screening_findings(self):
        client = authenticated_client()
        with (
            patch("app.OLLAMA_CHAT_URL", "https://ollama.com/api/chat"),
            patch("app.OLLAMA_API_KEY", "test-ollama-key"),
            patch("app.urllib.request.urlopen") as mock_urlopen,
        ):
            mock_urlopen.return_value.__enter__.return_value.read.return_value = json.dumps(
                {"message": {"content": "Hypothetical: manually verify this NOTAM."}}
            ).encode("utf-8")
            response = client.post(
                "/api/hypothetical-recommendation",
                json={
                    "notams": self.NOTAM,
                    "route": {"waypoints": ["IDKEX"], "airways": [], "flightLevels": [], "firs": []},
                    "flight": {},
                },
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json()["recommendation"],
            "Hypothetical: manually verify this NOTAM.",
        )
        self.assertEqual(response.get_json()["model"], app_module.OLLAMA_MODEL)
        request_body = json.loads(mock_urlopen.call_args.args[0].data.decode("utf-8"))
        self.assertEqual(request_body["model"], app_module.OLLAMA_MODEL)
        self.assertIn("undetermined", request_body["messages"][1]["content"])
        self.assertEqual(
            mock_urlopen.call_args.args[0].full_url,
            "https://ollama.com/api/chat",
        )
        self.assertEqual(
            mock_urlopen.call_args.args[0].get_header("Authorization"),
            "Bearer test-ollama-key",
        )

    def test_hypothetical_recommendation_reports_unavailable_local_model(self):
        with patch(
            "app.urllib.request.urlopen",
            side_effect=urllib.error.URLError("connection refused"),
        ):
            response = authenticated_client().post(
                "/api/hypothetical-recommendation",
                json={"notams": self.NOTAM, "route": {}, "flight": {}},
            )

        self.assertEqual(response.status_code, 503)
        self.assertIn("configured Ollama service", response.get_json()["error"])


if __name__ == "__main__":
    unittest.main()
